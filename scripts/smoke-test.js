'use strict';

/**
 * 端到端冒烟测试：在临时数据目录里真实启动一次服务，跑完主要 API 后退出。
 *
 * 覆盖点包括本次重构修复的几个缺陷：
 *   - DELETE /admin/songs/batch 是否真的命中批量删除路由（旧版被 :id 路由抢占）
 *   - multer 错误是否被错误中间件转成 JSON（旧版错误中间件注册在路由之前）
 *   - /api/lyrics/:filename 的路径穿越是否被拦截
 *   - 同批次同名文件是否会发生覆盖
 *   - 并发写入 playlist.json 是否丢数据
 *   - /admin/lyrics 上传的歌词是否落盘到 lyrics/ 目录
 *
 * 用法：npm run test:smoke    （可用 SMOKE_PORT 覆盖端口）
 */

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { buildTaggedWav } = require('./lib/test-media');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number.parseInt(process.env.SMOKE_PORT || '34567', 10);
const ADMIN_PASSWORD = 'smoke-test-password';
const BASE = `http://127.0.0.1:${PORT}`;

const LRC = '[00:01.00]Hello / 你好\n[00:03.50]World / 世界\n';

let passed = 0;
const failures = [];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || '值不相等'}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    }
}

async function test(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  \u2713 ${name}`);
    } catch (err) {
        failures.push({ name, error: err });
        console.error(`  \u2717 ${name}\n      ${err.message}`);
    }
}

function jsonOf(response) {
    return response.json().catch(() => null);
}

function blobOf(content) {
    return new Blob([content]);
}

function formOf(entries) {
    const form = new FormData();
    for (const [field, filename, content] of entries) {
        form.append(field, blobOf(content), filename);
    }
    return form;
}

function authHeaders(extra = {}) {
    return { Authorization: ADMIN_PASSWORD, ...extra };
}

async function batchUpload(entries) {
    return fetch(`${BASE}/admin/batch-upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: formOf(entries),
    });
}

async function uploadAudioFiles(entries) {
    return fetch(`${BASE}/admin/songs`, {
        method: 'POST',
        headers: authHeaders(),
        body: formOf(entries),
    });
}

async function waitForServer(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${BASE}/api/songs`);
            if (response.ok) return;
        } catch {
            /* 还没起来 */
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('服务未在超时时间内启动');
}

async function listSongs() {
    const response = await fetch(`${BASE}/api/songs`);
    return response.json();
}

async function main() {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'musicplayer-smoke-'));
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: {
            ...process.env,
            PORT: String(PORT),
            HOST: '127.0.0.1',
            ADMIN_PASSWORD,
            MZ_DATA_DIR: dataDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let serverLog = '';
    child.stdout.on('data', (chunk) => {
        serverLog += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
        serverLog += chunk.toString();
    });

    const cleanup = async () => {
        if (!child.killed) child.kill();
        await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    };

    try {
        await waitForServer();
        console.log(`\n服务已在 ${BASE} 启动（数据目录 ${dataDir}）\n`);

        // ---------- 基础 ----------
        console.log('【基础接口】');
        await test('GET /api/songs 初始为空数组', async () => {
            const songs = await listSongs();
            assert(Array.isArray(songs) && songs.length === 0, '初始列表应为空数组');
        });

        await test('未带令牌访问管理接口返回 401 JSON', async () => {
            const response = await fetch(`${BASE}/admin/songs`);
            assertEqual(response.status, 401, '状态码');
            const payload = await jsonOf(response);
            assertEqual(payload?.error, '未授权', '错误信息');
        });

        await test('带令牌访问管理接口返回列表', async () => {
            const response = await fetch(`${BASE}/admin/songs`, { headers: authHeaders() });
            assertEqual(response.status, 200, '状态码');
            assert(Array.isArray(await response.json()), '应返回数组');
        });

        await test('未知 /api 路径返回 JSON 404', async () => {
            const response = await fetch(`${BASE}/api/does-not-exist`);
            assertEqual(response.status, 404, '状态码');
            const payload = await jsonOf(response);
            assertEqual(payload?.error, '接口不存在', '错误信息');
        });

        // ---------- 前端静态资源 ----------
        console.log('\n【静态资源】');
        await test('访客端页面与拆分后的 css/js 可访问', async () => {
            const targets = [
                '/index.html',
                '/admin.html',
                '/css/player.css',
                '/css/admin.css',
                '/js/player/main.js',
                '/js/lib/lyrics.js',
                '/js/admin.js',
            ];
            for (const target of targets) {
                const response = await fetch(`${BASE}${target}`);
                assertEqual(response.status, 200, `${target} 状态码`);
                const body = await response.text();
                assert(body.length > 0, `${target} 内容为空`);
            }
        });

        // ---------- 批量上传 ----------
        console.log('\n【批量上传与自动配对】');
        let uploadedSong = null;

        await test('批量上传音频+歌词+封面并按文件名配对', async () => {
            const response = await batchUpload([
                ['audio', 'Test Artist - Test Song.mp3', 'not-a-real-mp3'],
                ['lyric', 'Test Artist - Test Song.lrc', LRC],
                ['cover', 'Test Artist - Test Song-cover.jpg', 'fake-image-bytes'],
            ]);
            assertEqual(response.status, 201, '状态码');

            const payload = await response.json();
            assertEqual(payload.uploaded.length, 1, '上传数量');
            assertEqual(payload.errors.length, 0, '错误数量');

            uploadedSong = payload.uploaded[0];
            assertEqual(uploadedSong.title, 'Test Song', '标题（元数据解析失败时回退文件名）');
            assertEqual(uploadedSong.artist, 'Test Artist', '歌手');
            assert(uploadedSong.lyricFilepath, '应配对到歌词');
            assert(uploadedSong.coverFilepath, '应配对到封面');
            assertEqual(uploadedSong.filepath, `/songs/${uploadedSong.filename}`, '音频路径');
        });

        await test('元数据解析失败时不会中断入库', async () => {
            const songs = await listSongs();
            assertEqual(songs.length, 1, '列表长度');
        });

        await test('真实音频的元数据解析（music-metadata）优先于文件名', async () => {
            const wav = buildTaggedWav({ title: 'Tagged Title', artist: 'Tagged Artist', seconds: 2 });
            // 文件名故意不含“歌手 - 歌名”，以确认信息确实来自音频标签
            const form = formOf([['file', 'plain-name.wav', wav]]);

            const response = await fetch(`${BASE}/admin/songs`, {
                method: 'POST',
                headers: authHeaders(),
                body: form,
            });
            assertEqual(response.status, 201, '状态码');

            const song = (await listSongs()).find((item) => item.title === 'Tagged Title');
            assert(song, '应写入来自标签的标题');
            assertEqual(song.artist, 'Tagged Artist', '歌手应来自标签');
            assertEqual(song.duration, 2, '时长应来自音频（2 秒）');
        });

        await test('歌词接口返回原文（UTF-8，且 Content-Type 正确）', async () => {
            const filename = uploadedSong.lyricFilepath.split('/').pop();
            const response = await fetch(`${BASE}/api/lyrics/${encodeURIComponent(filename)}`);
            assertEqual(response.status, 200, '状态码');
            assert(
                (response.headers.get('content-type') || '').includes('text/plain'),
                `Content-Type 应为 text/plain，实际 ${response.headers.get('content-type')}`,
            );
            const text = await response.text();
            assertEqual(text, LRC, '歌词内容');
        });

        await test('非 ASCII 文件名：编码还原、落盘与静态访问', async () => {
            const audioName = '周杰倫 - 七里香.mp3';
            const response = await batchUpload([
                ['audio', audioName, 'fake-audio'],
                ['lyric', '周杰倫 - 七里香.lrc', LRC],
            ]);
            assertEqual(response.status, 201, '状态码');

            const payload = await response.json();
            assertEqual(payload.uploaded.length, 1, '上传数量');
            const song = payload.uploaded[0];

            assertEqual(song.artist, '周杰倫', '歌手（来自文件名）');
            assertEqual(song.title, '七里香', '标题（来自文件名）');
            assertEqual(song.originalname, audioName, 'originalname 应还原为原始中文名');
            assert(song.lyricFilepath, '中文名歌词应配对成功');
            assert(song.filename.includes('七里香'), `落盘文件名应保留中文名，实际 ${song.filename}`);

            const fileOnDisk = await fs.stat(path.join(dataDir, 'songs', song.filename)).catch(() => null);
            assert(fileOnDisk, '文件应真实存在于 songs/');

            const served = await fetch(`${BASE}/songs/${encodeURIComponent(song.filename)}`);
            assertEqual(served.status, 200, '中文名文件应可通过静态路由访问');
        });

        await test('同批次内同名音频不会互相覆盖', async () => {
            const response = await batchUpload([
                ['audio', 'Same Name.mp3', 'a'],
                ['audio', 'Same Name.mp3', 'b'],
            ]);
            assertEqual(response.status, 201, '状态码');

            const payload = await response.json();
            assertEqual(payload.uploaded.length, 2, '两条记录');
            const names = payload.uploaded.map((song) => song.filename);
            assertEqual(new Set(names).size, 2, '磁盘文件名应互不相同');

            for (const name of names) {
                const file = await fs.readFile(path.join(dataDir, 'songs', name)).catch(() => null);
                assert(file, `${name} 应真实存在于 songs/`);
            }
        });

        await test('音频文件可通过 /songs 静态访问', async () => {
            const response = await fetch(`${BASE}${uploadedSong.filepath}`);
            assertEqual(response.status, 200, '状态码');
        });

        // ---------- 安全 ----------
        console.log('\n【安全】');
        await test('路径穿越读取歌词被拦截', async () => {
            const attempts = ['../../../package.json', '..\\..\\package.json', '....//package.json'];
            for (const attempt of attempts) {
                const response = await fetch(`${BASE}/api/lyrics/${encodeURIComponent(attempt)}`);
                assertEqual(response.status, 404, `${attempt} 状态码`);
            }
        });

        await test('上传字段错误返回 JSON 而非 HTML 错误页', async () => {
            const response = await batchUpload([['unexpected', 'x.mp3', 'x']]);
            assertEqual(response.status, 400, '状态码');
            const payload = await jsonOf(response);
            assert(payload && payload.error, '应返回 JSON 错误信息');
            assert(!String(payload.error).includes('<html'), '不应是 HTML');
        });

        // ---------- 并发 ----------
        console.log('\n【并发写入】');
        await test('5 个并发上传全部入库（无覆盖丢失）', async () => {
            const before = (await listSongs()).length;
            const responses = await Promise.all(
                Array.from({ length: 5 }, (_, i) => uploadAudioFiles([[`file`, `Concurrent Artist ${i} - Song ${i}.mp3`, `x${i}`]])),
            );
            for (const response of responses) assertEqual(response.status, 201, '状态码');

            const after = await listSongs();
            assertEqual(after.length, before + 5, '列表长度');
        });

        await test('playlist.json 始终是合法 JSON 数组', async () => {
            const raw = await fs.readFile(path.join(dataDir, 'playlist.json'), 'utf8');
            const parsed = JSON.parse(raw);
            assert(Array.isArray(parsed), '应为数组');
        });

        // ---------- 单曲操作 ----------
        console.log('\n【单曲操作】');
        await test('替换封面成功', async () => {
            const form = formOf([['cover', 'new-cover.png', 'png-bytes']]);
            const response = await fetch(`${BASE}/admin/songs/${uploadedSong.id}/cover`, {
                method: 'POST',
                headers: authHeaders(),
                body: form,
            });
            assertEqual(response.status, 200, '状态码');
            const payload = await response.json();
            assert(payload.coverFilepath, '应返回新封面路径');
        });

        await test('歌词扩展名校验生效', async () => {
            const form = formOf([['lyric', 'bad.md', 'nope']]);
            const response = await fetch(`${BASE}/admin/songs/${uploadedSong.id}/lyric`, {
                method: 'POST',
                headers: authHeaders(),
                body: form,
            });
            assertEqual(response.status, 400, '状态码');
            const payload = await jsonOf(response);
            assertEqual(payload?.error, '仅支持 .lrc 或 .txt', '错误信息');
        });

        await test('给不存在的歌曲上传封面返回 404', async () => {
            const form = formOf([['cover', 'c.png', 'bytes']]);
            const response = await fetch(`${BASE}/admin/songs/not-exist/cover`, {
                method: 'POST',
                headers: authHeaders(),
                body: form,
            });
            assertEqual(response.status, 404, '状态码');
        });

        // ---------- 歌词池 ----------
        console.log('\n【歌词池】');
        await test('POST /admin/lyrics 落盘到 lyrics/ 目录', async () => {
            const form = formOf([['file', 'pool.lyric.lrc', LRC]]);
            const response = await fetch(`${BASE}/admin/lyrics`, {
                method: 'POST',
                headers: authHeaders(),
                body: form,
            });
            assertEqual(response.status, 201, '状态码');

            const payload = await response.json();
            assertEqual(payload.uploaded.length, 1, '上传数量');

            const filename = payload.uploaded[0].filename;
            const inLyrics = await fs.stat(path.join(dataDir, 'lyrics', filename)).catch(() => null);
            const inSongs = await fs.stat(path.join(dataDir, 'songs', filename)).catch(() => null);
            assert(inLyrics, '文件应在 lyrics/ 目录');
            assert(!inSongs, '文件不应落在 songs/ 目录');
        });

        await test('GET /admin/lyrics 返回歌词记录', async () => {
            const response = await fetch(`${BASE}/admin/lyrics`, { headers: authHeaders() });
            assertEqual(response.status, 200, '状态码');
            const records = await response.json();
            assert(records.length >= 2, '应至少有配对写入与手动上传两条记录');
        });

        // ---------- 删除 ----------
        console.log('\n【删除】');
        await test('批量删除接口命中批量路由（旧版返回 404）', async () => {
            const songs = await listSongs();
            const ids = songs.slice(0, 2).map((song) => song.id);
            const doomedAudioFiles = songs.slice(0, 2).map((song) => song.filename);

            const response = await fetch(`${BASE}/admin/songs/batch`, {
                method: 'DELETE',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ ids }),
            });

            assertEqual(response.status, 200, '状态码');
            const payload = await response.json();
            assertEqual(payload.deleted, 2, '删除数量');

            const remaining = await listSongs();
            assertEqual(remaining.length, songs.length - 2, '剩余数量');

            for (const filename of doomedAudioFiles) {
                const file = await fs.stat(path.join(dataDir, 'songs', filename)).catch(() => null);
                assert(!file, `${filename} 应已被删除`);
            }
        });

        await test('批量删除传入不存在的 id 返回 404', async () => {
            const response = await fetch(`${BASE}/admin/songs/batch`, {
                method: 'DELETE',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ ids: ['nope'] }),
            });
            assertEqual(response.status, 404, '状态码');
        });

        await test('批量删除缺少 ids 返回 400', async () => {
            const response = await fetch(`${BASE}/admin/songs/batch`, {
                method: 'DELETE',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({}),
            });
            assertEqual(response.status, 400, '状态码');
        });

        await test('单曲删除会一并清理歌词记录与文件', async () => {
            const songs = await listSongs();
            const target = songs.find((song) => song.lyricFilepath) || songs[0];
            const lyricFilename = target.lyricFilepath ? target.lyricFilepath.split('/').pop() : null;

            const response = await fetch(`${BASE}/admin/songs/${target.id}`, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            assertEqual(response.status, 200, '状态码');

            if (lyricFilename) {
                const lyricFile = await fs.stat(path.join(dataDir, 'lyrics', lyricFilename)).catch(() => null);
                assert(!lyricFile, '歌词文件应被删除');
            }
        });

        await test('删除不存在的歌曲返回 404', async () => {
            const response = await fetch(`${BASE}/admin/songs/not-exist`, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            assertEqual(response.status, 404, '状态码');
        });
    } finally {
        await cleanup();
    }

    console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
    if (failures.length > 0) {
        console.error('\n失败详情：');
        for (const failure of failures) console.error(`  - ${failure.name}: ${failure.error.message}`);
        console.error(`\n--- 服务端日志 ---\n${serverLog}`);
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('冒烟测试自身出错:', err);
    process.exitCode = 1;
});
