'use strict';

/**
 * 前端静态检查（无需浏览器、无需安装依赖，仅用 Node 内置模块）。
 *
 * 前端是原生 ES module、没有构建步骤，因此拼错 import 路径或写错 DOM id
 * 只有打开页面才会暴露。本脚本在提交前把这些错误挡下来：
 *   1. 从各页面的 <script type="module"> 入口递归解析 import 图，检查目标文件是否存在；
 *   2. 对图中每个模块做语法检查（复制为 .mjs 后 `node --check`）；
 *   3. 检查模块里 getElementById / $('id') 引用的 id 是否都在该页面中声明；
 *   4. 检查页面引用的样式表是否存在。
 *
 * 用法：npm run check:frontend
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const pages = ['index.html', 'admin.html'];
let problems = 0;

function readFile(abs) {
    return fs.readFileSync(abs, 'utf8');
}

/** 递归收集一个页面用到的所有模块文件。 */
function collectModules(entryFile, seen = new Set()) {
    const abs = path.resolve(entryFile);
    if (seen.has(abs)) return seen;
    seen.add(abs);

    const source = readFile(abs);
    const importRe = /(?:^|\n)\s*import\s+(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRe.exec(source)) !== null) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) {
            console.log(`  ✗ ${path.relative(ROOT, abs)} 引入了非相对模块: ${specifier}`);
            problems += 1;
            continue;
        }
        const target = path.resolve(path.dirname(abs), specifier);
        if (!fs.existsSync(target)) {
            console.log(`  ✗ ${path.relative(ROOT, abs)} 的 import 无法解析: ${specifier}`);
            problems += 1;
            continue;
        }
        collectModules(target, seen);
    }

    return seen;
}

for (const page of pages) {
    const pagePath = path.join(PUBLIC_DIR, page);
    const html = readFile(pagePath);
    console.log(`\n【${page}】`);

    const scriptMatch = html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/);
    if (!scriptMatch) {
        console.log('  ✗ 未找到 module 脚本入口');
        problems += 1;
        continue;
    }

    const entry = path.join(PUBLIC_DIR, scriptMatch[1]);
    if (!fs.existsSync(entry)) {
        console.log(`  ✗ 入口脚本不存在: ${scriptMatch[1]}`);
        problems += 1;
        continue;
    }
    console.log(`  入口: ${scriptMatch[1]}`);

    // 1) import 图 + 语法检查
    const modules = collectModules(entry);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-verify-'));
    let syntaxOk = 0;
    for (const abs of modules) {
        const tmpFile = path.join(tmpDir, `${path.basename(abs, '.js')}-${Math.abs(abs.length)}.mjs`);
        fs.copyFileSync(abs, tmpFile);
        try {
            execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
            syntaxOk += 1;
        } catch (err) {
            console.log(`  ✗ 语法错误 ${path.relative(ROOT, abs)}: ${String(err.stderr || err.message).split('\n')[0]}`);
            problems += 1;
        }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`  模块数: ${modules.size}（语法检查通过 ${syntaxOk}）`);
    for (const abs of modules) console.log(`      ${path.relative(ROOT, abs)}`);

    // 2) DOM id 引用
    const declaredIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const referencedIds = new Set();
    for (const abs of modules) {
        const source = readFile(abs);
        for (const m of source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)) referencedIds.add(m[1]);
        for (const m of source.matchAll(/\$\(\s*['"]([^'"]+)['"]/g)) referencedIds.add(m[1]);
    }

    const missing = [...referencedIds].filter((id) => !declaredIds.has(id));
    console.log(`  DOM id: 引用 ${referencedIds.size} 个，声明 ${declaredIds.size} 个`);
    if (missing.length > 0) {
        console.log(`  ✗ 页面中不存在的 id: ${missing.join(', ')}`);
        problems += missing.length;
    } else {
        console.log('  ✓ 所有引用的 id 都存在');
    }

    // 3) 引用的 CSS 是否存在
    const cssMatch = html.match(/<link[^>]*href=["']([^"']+\.css)["']/);
    if (!cssMatch) {
        console.log('  ✗ 未找到样式表引用');
        problems += 1;
    } else if (!fs.existsSync(path.join(PUBLIC_DIR, cssMatch[1]))) {
        console.log(`  ✗ 样式表不存在: ${cssMatch[1]}`);
        problems += 1;
    } else {
        console.log(`  ✓ 样式表存在: ${cssMatch[1]}`);
    }
}

console.log(problems === 0 ? '\n前端静态检查全部通过' : `\n前端静态检查发现 ${problems} 个问题`);
process.exitCode = problems === 0 ? 0 : 1;
