'use strict';

/**
 * 浏览器端端到端检查：真实启动服务 + 真实无头浏览器（Edge / Chrome），
 * 通过 CDP 驱动页面，验证播放器与管理端的运行期行为。
 *
 * 覆盖静态检查查不到的东西：模块能否真正执行、接口数据能否正确渲染、
 * 非 ASCII 歌名/歌词是否无损、歌词高亮与显示模式切换、批量删除按钮是否走通、
 * 以及控制台是否有异常。
 *
 * 用法：npm run check:browser
 *   - 需要本机装有 Edge 或 Chrome（可用 BROWSER_PATH 指定）
 *   - 找不到浏览器时会跳过并以 0 退出（便于在服务器上跑 CI）
 *   - 截图输出到系统临时目录（BROWSER_CHECK_SHOTS 可指定）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { buildTaggedWav, SAMPLE_LRC } = require('./lib/test-media');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number.parseInt(process.env.BROWSER_CHECK_PORT || '34568', 10);
const DEBUG_PORT = Number.parseInt(process.env.BROWSER_CHECK_DEBUG_PORT || '9333', 10);
const ADMIN_PASSWORD = 'browser-check-password';
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = process.env.BROWSER_CHECK_SHOTS || os.tmpdir();

const BROWSER_CANDIDATES = [
    process.env.BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

let problems = 0;
const consoleErrors = [];

function check(name, ok, detail = '') {
    if (ok) {
        console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
    } else {
        problems += 1;
        console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
    for (const candidate of BROWSER_CANDIDATES) {
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch {
            /* 忽略不可访问的路径 */
        }
    }
    return null;
}

async function waitFor(fn, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const value = await fn();
            if (value) return value;
        } catch (err) {
            lastError = err;
        }
        await sleep(200);
    }
    throw new Error(`等待超时${lastError ? `: ${lastError.message}` : ''}`);
}

/** 极简 CDP 客户端。 */
class Cdp {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 0;
        this.pending = new Map();
        this.waiters = new Map();
        this.exceptions = [];

        ws.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);

            if (message.id && this.pending.has(message.id)) {
                const { resolve, reject } = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) reject(new Error(message.error.message));
                else resolve(message.result);
                return;
            }

            if (message.method === 'Runtime.exceptionThrown') {
                const details = message.params.exceptionDetails;
                this.exceptions.push(details.exception?.description || details.text);
            }
            if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
                consoleErrors.push(`${message.params.entry.url || '(no url)'} :: ${message.params.entry.text}`);
            }
            if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
                consoleErrors.push((message.params.args || []).map((arg) => arg.value ?? arg.description).join(' '));
            }
            if (message.method === 'Page.javascriptDialogOpening') {
                this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => undefined);
            }

            const waiters = this.waiters.get(message.method);
            if (waiters && waiters.length > 0) {
                this.waiters.set(message.method, []);
                for (const resolve of waiters) resolve(message.params);
            }
        });
    }

    send(method, params = {}) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    once(method, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const list = this.waiters.get(method) || [];
            list.push(resolve);
            this.waiters.set(method, list);
            setTimeout(() => reject(new Error(`等待事件超时: ${method}`)), timeoutMs).unref?.();
        });
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result.value;
    }

    async goto(url) {
        const loaded = this.once('Page.loadEventFired');
        await this.send('Page.navigate', { url });
        await loaded;
    }

    async screenshot(name) {
        const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(SHOT_DIR, name);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        return file;
    }
}

/* ------------------------------------------------------------------ */
/* 服务端与测试数据                                                     */
/* ------------------------------------------------------------------ */

async function startServer(dataDir) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ADMIN_PASSWORD, MZ_DATA_DIR: dataDir },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let log = '';
    child.stdout.on('data', (chunk) => {
        log += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
        log += chunk.toString();
    });

    await waitFor(async () => (await fetch(`${BASE}/api/songs`)).ok);
    return { child, logOf: () => log };
}

async function seed() {
    const upload = async (entries, endpoint = '/admin/batch-upload') => {
        const form = new FormData();
        for (const [field, filename, content] of entries) {
            form.append(field, new Blob([content]), filename);
        }
        const response = await fetch(`${BASE}${endpoint}`, {
            method: 'POST',
            headers: { Authorization: ADMIN_PASSWORD },
            body: form,
        });
        if (!response.ok) throw new Error(`灌数据失败 ${response.status}: ${await response.text()}`);
        return response.json();
    };

    // 1) 非 ASCII 名 + 歌词 + 封面
    await upload([
        ['audio', 'Aimer - 夏の終わり.mp3', 'not-a-real-mp3'],
        ['lyric', 'Aimer - 夏の終わり.lrc', SAMPLE_LRC],
        ['cover', 'Aimer - 夏の終わり-cover.jpg', 'fake-cover-bytes'],
    ]);

    // 2) 真实 WAV（元数据链路：时长应显示为 0:02）
    await upload([['file', 'plain-name.wav', buildTaggedWav({ title: 'Tagged Title', artist: 'Tagged Artist', seconds: 2 })]], '/admin/songs');
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
    const browserPath = findBrowser();
    if (!browserPath) {
        console.log('未找到 Edge / Chrome，跳过浏览器端检查（可用 BROWSER_PATH 指定可执行文件）');
        return;
    }
    console.log(`使用浏览器: ${browserPath}`);

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-browser-data-'));
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-browser-profile-'));
    let server = null;
    let browser = null;

    try {
        server = await startServer(dataDir);
        await seed();

        browser = spawn(browserPath, [
            '--headless=new',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--mute-audio',
            `--remote-debugging-port=${DEBUG_PORT}`,
            `--user-data-dir=${profileDir}`,
            'about:blank',
        ], { stdio: 'ignore' });

        const target = await waitFor(async () => {
            const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
            const list = await response.json();
            return list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) || null;
        });

        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve, { once: true });
            ws.addEventListener('error', reject, { once: true });
        });

        const cdp = new Cdp(ws);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Log.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });

        // ---------------- 播放器 ----------------
        console.log('\n【播放器 index.html】');
        await cdp.goto(`${BASE}/index.html`);
        await sleep(1200);

        const list = await cdp.evaluate(`(() => ({
            count: document.getElementById('playlistCount').textContent,
            items: document.querySelectorAll('.song-item').length,
            titles: Array.from(document.querySelectorAll('.song-item .title')).map(el => el.textContent),
            durations: Array.from(document.querySelectorAll('.song-item .duration')).map(el => el.textContent)
        }))()`);

        check('播放列表加载（含徽标）', list.items === 2 && list.count === '2', `${list.items} 条 / 徽标 ${list.count}`);
        check('非 ASCII 标题无损', list.titles.includes('夏の終わり'), list.titles.join(' | '));
        check('元数据解析结果进入界面（时长 0:02）', list.durations.includes('0:02'), list.durations.join(' | '));

        await cdp.evaluate(`document.querySelectorAll('.song-item')[0].click()`);
        await sleep(1500);

        const player = await cdp.evaluate(`(() => ({
            title: document.getElementById('songTitle').textContent,
            artist: document.getElementById('songArtist').textContent,
            lines: document.querySelectorAll('#lyricsContainer .lyric-line').length,
            dual: document.querySelectorAll('#lyricsContainer .lyric-line:not(.single)').length,
            single: document.querySelectorAll('#lyricsContainer .lyric-line.single').length,
            firstSecondary: document.querySelector('#lyricsContainer .lyric-line .secondary')?.textContent,
            coverVisible: !document.getElementById('coverImg').classList.contains('hidden'),
            activeItems: document.querySelectorAll('.song-item.active').length,
            langLabel: document.getElementById('langLabel').textContent
        }))()`);

        check('点击歌曲更新标题/歌手', player.title === '夏の終わり' && player.artist === 'Aimer', `${player.title} / ${player.artist}`);
        check('歌词渲染（3 行，双语 2 + 单语 1）', player.lines === 3 && player.dual === 2 && player.single === 1, `${player.lines} 行`);
        check('译文无损', player.firstSecondary === '夏天的终结', `${player.firstSecondary}`);
        check('封面显示', player.coverVisible === true);
        check('当前曲目高亮', player.activeItems === 1);

        await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', bubbles: true }))`);
        const afterL = await cdp.evaluate(`document.getElementById('langLabel').textContent`);
        check('快捷键 L 切换显示模式', afterL === '主译', `按钮文案 ${afterL}`);

        const highlight = await cdp.evaluate(`(async () => {
            const { LyricsView } = await import('/js/player/lyricsView.js');
            const { parseLyrics } = await import('/js/lib/lyrics.js');
            const host = document.createElement('div');
            document.body.appendChild(host);
            const view = new LyricsView(host, {});
            view.render(parseLyrics('[00:01.00]A / 甲\\n[00:05.00]B / 乙\\n[00:09.00]C / 丙').lyrics);
            const probe = (t) => {
                view.updateHighlight(t);
                const active = host.querySelector('.lyric-line.active .primary');
                return { active: active ? active.textContent : null, prev: host.querySelectorAll('.lyric-line.prev-active').length };
            };
            return { before: probe(0.5), first: probe(1.2), second: probe(5.5), third: probe(10) };
        })()`);

        check('高亮：早于首行不高亮', highlight.before.active === null, JSON.stringify(highlight.before));
        check('高亮：第 1 行', highlight.first.active === 'A', JSON.stringify(highlight.first));
        check('高亮：第 2 行 + prev-active', highlight.second.active === 'B' && highlight.second.prev === 1, JSON.stringify(highlight.second));
        check('高亮：第 3 行', highlight.third.active === 'C', JSON.stringify(highlight.third));

        console.log(`  截图: ${await cdp.screenshot('player.png')}`);

        // ---------------- 管理端 ----------------
        console.log('\n【管理端 admin.html】');
        await cdp.goto(`${BASE}/admin.html`);
        await sleep(600);

        const beforeLogin = await cdp.evaluate(`(() => ({
            login: getComputedStyle(document.getElementById('loginBox')).display,
            panel: getComputedStyle(document.getElementById('adminPanel')).display
        }))()`);
        check('未登录仅显示登录框', beforeLogin.login !== 'none' && beforeLogin.panel === 'none', JSON.stringify(beforeLogin));

        await cdp.evaluate(`(() => {
            document.getElementById('passwordInput').value = ${JSON.stringify(ADMIN_PASSWORD)};
            document.getElementById('loginBtn').click();
        })()`);
        await sleep(1200);

        const admin = await cdp.evaluate(`(() => ({
            login: getComputedStyle(document.getElementById('loginBox')).display,
            panel: getComputedStyle(document.getElementById('adminPanel')).display,
            items: document.querySelectorAll('#songList .item').length,
            names: Array.from(document.querySelectorAll('#songList .name')).map(el => el.textContent),
            lyricStatus: Array.from(document.querySelectorAll('#songList .lyric-status')).map(el => el.textContent),
            thumbs: document.querySelectorAll('#songList .cover-thumb').length
        }))()`);

        check('登录后显示面板', admin.login === 'none' && admin.panel !== 'none');
        check('歌曲列表渲染', admin.items === 2, `${admin.items} 条`);
        check('非 ASCII 歌名无损', admin.names.includes('夏の終わり'), admin.names.join(' | '));
        check('歌词状态列正确', admin.lyricStatus.filter((s) => s === '有歌词').length === 1, admin.lyricStatus.join(' | '));
        check('封面缩略图渲染', admin.thumbs === 1, `${admin.thumbs} 张`);

        await cdp.evaluate(`(() => {
            document.getElementById('selectAll').checked = true;
            document.getElementById('selectAll').dispatchEvent(new Event('change'));
        })()`);
        await sleep(200);

        const selected = await cdp.evaluate(`(() => ({
            checked: document.querySelectorAll('#songList .song-checkbox:checked').length,
            label: document.getElementById('selectedCount').textContent
        }))()`);
        check('全选联动计数', selected.checked === 2 && selected.label === '已选 2 首', `${selected.checked} 项 / ${selected.label}`);

        console.log(`  截图: ${await cdp.screenshot('admin.png')}`);

        await cdp.evaluate(`document.getElementById('deleteBatchBtn').click()`);
        await sleep(1500);

        const afterDelete = await cdp.evaluate(`(() => ({
            items: document.querySelectorAll('#songList .item').length,
            empty: document.querySelector('#songList .empty-msg')?.textContent || null
        }))()`);
        check('批量删除按钮走通（旧版必然失败）', afterDelete.items === 0 && afterDelete.empty === '暂无歌曲', JSON.stringify(afterDelete));

        // ---------------- 控制台 ----------------
        console.log('\n【控制台】');
        check('无未捕获异常', cdp.exceptions.length === 0, cdp.exceptions.join(' | ') || '无');
        check('无 console error', consoleErrors.length === 0, consoleErrors.join(' | ') || '无');
    } finally {
        if (browser) browser.kill();
        if (server) server.child.kill();
        await sleep(300);
        fs.rmSync(profileDir, { recursive: true, force: true });
        fs.rmSync(dataDir, { recursive: true, force: true });
    }

    console.log(problems === 0 ? '\n浏览器端检查全部通过' : `\n浏览器端检查发现 ${problems} 个问题`);
    process.exitCode = problems === 0 ? 0 : 1;
}

main().catch((err) => {
    console.error('浏览器端检查自身出错:', err);
    process.exitCode = 1;
});
