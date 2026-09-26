'use strict';

const path = require('path');

/**
 * 把用户可控的文件名安全地解析到指定目录内。
 * 只取 basename（丢弃任何目录部分），并再次确认解析结果确实位于目录内部，
 * 从而阻断 `../../etc/passwd` 一类路径穿越。
 *
 * @returns {string|null} 绝对路径；非法输入返回 null。
 */
function resolveInsideDir(dir, filename) {
    if (typeof filename !== 'string' || filename === '') return null;

    const base = path.basename(filename);
    if (!base || base === '.' || base === '..') return null;

    const baseDir = path.resolve(dir);
    const resolved = path.resolve(baseDir, base);
    if (resolved !== path.join(baseDir, base)) return null;
    if (!resolved.startsWith(baseDir + path.sep)) return null;

    return resolved;
}

/**
 * 生成存储用的安全文件名：时间戳 + 随机串 + 净化后的原名（保留扩展名）。
 *
 * 相比旧实现 `Date.now() + '-' + originalname`：
 *  - 加了随机串，避免同一批次内同名文件互相覆盖；
 *  - 去掉路径分隔符与控制字符，避免写到目录之外；
 *  - 原名先做编码还原，避免中文名在磁盘上变成乱码。
 */
function buildStoredFilename(originalname, decodeName) {
    const decoded = typeof decodeName === 'function' ? decodeName(originalname) : String(originalname || '');

    const rawExt = path.extname(decoded);
    const rawBase = path.basename(decoded, rawExt);

    const safeBase = stripUnsafe(rawBase).replace(/^[.\s]+/, '').slice(0, 80) || 'file';
    const safeExt = rawExt.replace(/[\\/:*?"<>|]/g, '').slice(0, 12);

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    return `${unique}-${safeBase}${safeExt}`;
}

function stripUnsafe(value) {
    // Windows 与 POSIX 下的非法字符 + 控制字符
    return String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
}

module.exports = { resolveInsideDir, buildStoredFilename };
