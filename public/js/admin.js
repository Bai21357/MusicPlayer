import { BACKEND_URL, adminFetch } from './lib/api.js';
import { $, createEl } from './lib/dom.js';
import { formatTime } from './lib/format.js';

/**
 * 管理后台逻辑。
 *
 * 相比旧版内联脚本：
 *  - 所有列表项改用 DOM API 构建，标题/歌手/文件名不再拼进 innerHTML（XSS 修复）；
 *  - 「全选」监听器只绑定一次（旧版每次渲染列表都会再绑一次，监听器不断累积）；
 *  - 上传/删除等操作抽成小函数，删掉了重复的选择器查询。
 */

const TOKEN_KEY = 'adminToken';

const els = {
    loginBox: $('loginBox'),
    adminPanel: $('adminPanel'),
    passwordInput: $('passwordInput'),
    loginBtn: $('loginBtn'),
    loginError: $('loginError'),
    logoutBtn: $('logoutBtn'),
    fileInput: $('fileInput'),
    uploadStatus: $('uploadStatus'),
    songList: $('songList'),
    toast: $('toast'),
    audioInput: $('audioInput'),
    lyricInput: $('lyricInput'),
    coverInput: $('coverInput'),
    fileListDiv: $('fileList'),
    batchUploadBtn: $('batchUploadBtn'),
    batchProgressWrap: $('batchProgressWrap'),
    batchProgressBar: $('batchProgressBar'),
    batchProgressText: $('batchProgressText'),
    batchStatus: $('batchStatus'),
    selectAll: $('selectAll'),
    selectedCount: $('selectedCount'),
    deleteBatchBtn: $('deleteBatchBtn'),
};

let adminToken = sessionStorage.getItem(TOKEN_KEY) || '';
let toastTimer = null;

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2500);
}

function setToken(token) {
    adminToken = token;
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
}

function setLoggedIn(loggedIn) {
    els.loginBox.style.display = loggedIn ? 'none' : 'block';
    els.adminPanel.style.display = loggedIn ? 'block' : 'none';
}

/** 带鉴权请求；401 时统一登出（登录流程请用 rawFetch）。 */
async function adminRequest(url, options = {}) {
    const response = await adminFetch(url, options, adminToken);

    if (response.status === 401) {
        setToken('');
        setLoggedIn(false);
        showToast('会话已过期，请重新登录');
        throw new Error('未授权');
    }

    return response;
}

/** 不带 401 副作用的请求，用于登录校验。 */
function rawFetch(url, options = {}) {
    return adminFetch(url, options, adminToken);
}

async function readError(response, fallback) {
    try {
        const payload = await response.json();
        return payload.error || fallback;
    } catch {
        return fallback;
    }
}

/** 弹出系统文件选择框，返回选中的文件（取消则 null）。 */
function pickFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.addEventListener('change', () => {
            resolve(input.files && input.files[0] ? input.files[0] : null);
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
    });
}

/* ------------------------------------------------------------------ */
/* 歌曲列表                                                            */
/* ------------------------------------------------------------------ */

async function loadSongs() {
    try {
        const response = await adminRequest('/admin/songs', { method: 'GET' });
        if (!response.ok) throw new Error('加载失败');
        renderSongList(await response.json());
    } catch {
        els.songList.innerHTML = '';
        els.songList.appendChild(createEl('div', 'empty-msg', '加载失败，请刷新'));
    }
}

function renderSongList(songs) {
    const list = Array.isArray(songs) ? songs : [];
    els.songList.innerHTML = '';

    if (list.length === 0) {
        els.songList.appendChild(createEl('div', 'empty-msg', '暂无歌曲'));
        updateSelectedCount();
        return;
    }

    for (const song of list) {
        els.songList.appendChild(buildSongItem(song));
    }

    updateSelectedCount();
}

function buildSongItem(song) {
    const item = createEl('div', 'item');
    item.dataset.id = song.id ?? '';

    // 复选框
    const checkboxWrap = createEl('div', 'checkbox');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'song-checkbox';
    checkbox.value = song.id ?? '';
    checkbox.addEventListener('change', updateSelectedCount);
    checkboxWrap.appendChild(checkbox);
    item.appendChild(checkboxWrap);

    // 信息
    const info = createEl('div', 'info');
    info.appendChild(createEl('div', 'name', song.title));
    const meta = createEl('div', 'meta');
    meta.append(
        document.createTextNode(`${song.artist ?? ''} · `),
        document.createTextNode(song.duration ? formatTime(song.duration) : '--:--'),
        document.createTextNode(' · '),
        createEl('span', 'lyric-status', song.lyricFilepath ? '有歌词' : '无歌词'),
    );
    info.appendChild(meta);
    item.appendChild(info);

    // 操作区
    const actions = createEl('div', 'actions');

    if (song.coverFilepath) {
        const thumb = document.createElement('img');
        thumb.src = `${BACKEND_URL}${song.coverFilepath}`;
        thumb.className = 'cover-thumb';
        thumb.alt = '封面';
        thumb.addEventListener('error', () => {
            thumb.style.display = 'none';
        });
        actions.appendChild(thumb);
    }

    const coverBtn = createEl('button', 'btn cover-btn', '上传封面');
    coverBtn.dataset.id = song.id ?? '';
    coverBtn.addEventListener('click', () => uploadCover(song.id));
    actions.appendChild(coverBtn);

    const lyricBtn = createEl('button', 'btn lyric-btn', '上传歌词');
    lyricBtn.dataset.id = song.id ?? '';
    lyricBtn.addEventListener('click', () => uploadLyric(song.id));
    actions.appendChild(lyricBtn);

    const deleteBtn = createEl('button', 'delete-btn', '✕');
    deleteBtn.dataset.id = song.id ?? '';
    deleteBtn.addEventListener('click', () => deleteSong(song.id));
    actions.appendChild(deleteBtn);

    item.appendChild(actions);
    return item;
}

function updateSelectedCount() {
    const all = els.songList.querySelectorAll('.song-checkbox');
    const checked = els.songList.querySelectorAll('.song-checkbox:checked');

    els.selectedCount.textContent = `已选 ${checked.length} 首`;
    if (all.length > 0) els.selectAll.checked = checked.length === all.length;
    else els.selectAll.checked = false;
}

/* ------------------------------------------------------------------ */
/* 单个操作                                                            */
/* ------------------------------------------------------------------ */

async function deleteSong(id) {
    if (!confirm('确定删除该歌曲吗？')) return;

    try {
        const response = await adminRequest(`/admin/songs/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(await readError(response, '删除失败'));
        showToast('删除成功');
        loadSongs();
    } catch (err) {
        showToast(`删除失败: ${err.message}`);
    }
}

async function uploadCover(id) {
    const file = await pickFile('image/*');
    if (!file) return;

    const formData = new FormData();
    formData.append('cover', file);

    try {
        const response = await adminRequest(`/admin/songs/${encodeURIComponent(id)}/cover`, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) throw new Error(await readError(response, '上传失败'));
        showToast('封面上传成功');
        loadSongs();
    } catch (err) {
        showToast(`封面上传失败: ${err.message}`);
    }
}

async function uploadLyric(id) {
    const file = await pickFile('.lrc,.txt');
    if (!file) return;

    const formData = new FormData();
    formData.append('lyric', file);

    try {
        const response = await adminRequest(`/admin/songs/${encodeURIComponent(id)}/lyric`, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) throw new Error(await readError(response, '上传失败'));
        showToast('歌词上传成功');
        loadSongs();
    } catch (err) {
        showToast(`歌词上传失败: ${err.message}`);
    }
}

async function deleteSelected() {
    const checked = els.songList.querySelectorAll('.song-checkbox:checked');
    if (checked.length === 0) {
        showToast('请至少选择一首歌曲');
        return;
    }
    if (!confirm(`确定删除选中的 ${checked.length} 首歌曲吗？`)) return;

    const ids = Array.from(checked).map((checkbox) => checkbox.value);

    try {
        const response = await adminRequest('/admin/songs/batch', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
        if (!response.ok) throw new Error(await readError(response, '批量删除失败'));
        const result = await response.json();
        showToast(`成功删除 ${result.deleted} 首歌曲`);
        loadSongs();
    } catch (err) {
        showToast(`批量删除失败: ${err.message}`);
    }
}

/* ------------------------------------------------------------------ */
/* 批量上传                                                            */
/* ------------------------------------------------------------------ */

function updateFileList() {
    const audioCount = els.audioInput.files.length;
    const lyricCount = els.lyricInput.files.length;
    const coverCount = els.coverInput.files.length;

    let text = '';
    if (audioCount) text += `${audioCount} 个音频 `;
    if (lyricCount) text += `${lyricCount} 个歌词 `;
    if (coverCount) text += `${coverCount} 个封面 `;

    els.fileListDiv.textContent = text || '未选择任何文件';
}

function resetBatchInputs() {
    els.audioInput.value = '';
    els.lyricInput.value = '';
    els.coverInput.value = '';
    els.fileListDiv.textContent = '';
}

function hideBatchProgress() {
    els.batchProgressWrap.style.display = 'none';
    els.batchProgressText.style.display = 'none';
}

function batchUpload() {
    const audioFiles = els.audioInput.files;
    const lyricFiles = els.lyricInput.files;
    const coverFiles = els.coverInput.files;

    if (audioFiles.length === 0) {
        showToast('请至少选择音频文件');
        return;
    }

    els.batchProgressWrap.style.display = 'block';
    els.batchProgressText.style.display = 'block';
    els.batchProgressBar.style.width = '0%';
    els.batchProgressText.textContent = '0%';

    const formData = new FormData();
    for (const file of audioFiles) formData.append('audio', file);
    for (const file of lyricFiles) formData.append('lyric', file);
    for (const file of coverFiles) formData.append('cover', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BACKEND_URL}/admin/batch-upload`, true);
    xhr.setRequestHeader('Authorization', adminToken);

    let lastLoaded = 0;
    let lastTime = Date.now();

    xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;

        const percent = Math.round((event.loaded / event.total) * 100);
        els.batchProgressBar.style.width = `${percent}%`;

        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed <= 0.1) return;

        const speed = (event.loaded - lastLoaded) / elapsed;
        const speedKb = (speed / 1024).toFixed(1);
        const remaining = speed > 0 ? Math.round((event.total - event.loaded) / speed) : 0;
        const remainingText = remaining > 60
            ? `${Math.floor(remaining / 60)}分${remaining % 60}秒`
            : `${remaining}秒`;

        els.batchProgressText.textContent = `${percent}%  (${speedKb} KB/s 剩余 ${remainingText})`;
        lastLoaded = event.loaded;
        lastTime = now;
    };

    xhr.onload = () => {
        hideBatchProgress();

        if (xhr.status === 201) {
            const result = JSON.parse(xhr.responseText);
            showToast(`成功上传 ${result.uploaded.length} 首歌曲`);
            els.batchStatus.textContent = '';
            loadSongs();
            resetBatchInputs();
            return;
        }

        let message = '上传失败';
        try {
            const payload = JSON.parse(xhr.responseText);
            message = payload.error || message;
        } catch {
            /* 响应不是 JSON，保留默认提示 */
        }
        els.batchStatus.textContent = `上传失败: ${message}`;
        showToast(`上传失败: ${message}`);
    };

    xhr.onerror = () => {
        hideBatchProgress();
        els.batchStatus.textContent = '网络错误，请重试';
        showToast('网络错误，请重试');
    };

    els.batchStatus.textContent = `上传中... (${audioFiles.length} 个音频, ${lyricFiles.length} 个歌词, ${coverFiles.length} 个封面)`;
    xhr.send(formData);
}

/* ------------------------------------------------------------------ */
/* 登录 / 登出                                                         */
/* ------------------------------------------------------------------ */

async function login() {
    const password = els.passwordInput.value.trim();
    if (!password) {
        els.loginError.textContent = '请输入密码';
        return;
    }

    setToken(password);

    try {
        const response = await rawFetch('/admin/songs', { method: 'GET' });
        if (!response.ok) throw new Error('密码错误');

        els.loginError.textContent = '';
        setLoggedIn(true);
        loadSongs();
        showToast('登录成功');
    } catch {
        setToken('');
        els.loginError.textContent = '密码错误，请重试';
    }
}

function logout() {
    setToken('');
    setLoggedIn(false);
    showToast('已退出');
}

/** 页面加载时用已保存的令牌自动登录。 */
async function restoreSession() {
    if (!adminToken) {
        setLoggedIn(false);
        return;
    }

    try {
        const response = await rawFetch('/admin/songs', { method: 'GET' });
        if (!response.ok) throw new Error('未授权');
        setLoggedIn(true);
        loadSongs();
    } catch {
        setToken('');
        setLoggedIn(false);
    }
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

function init() {
    els.loginBtn.addEventListener('click', login);
    els.passwordInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') login();
    });
    els.logoutBtn.addEventListener('click', logout);

    // 只绑定一次（旧实现在每次渲染列表时重复绑定）
    els.selectAll.addEventListener('change', () => {
        const checked = els.selectAll.checked;
        els.songList.querySelectorAll('.song-checkbox').forEach((checkbox) => {
            checkbox.checked = checked;
        });
        updateSelectedCount();
    });

    els.deleteBatchBtn.addEventListener('click', deleteSelected);
    els.batchUploadBtn.addEventListener('click', batchUpload);

    els.audioInput.addEventListener('change', updateFileList);
    els.lyricInput.addEventListener('change', updateFileList);
    els.coverInput.addEventListener('change', updateFileList);

    // 单独上传入口暂未接线，保留原有提示（批量上传是推荐流程）
    els.fileInput.addEventListener('change', () => {
        showToast('建议使用批量上传功能');
        els.fileInput.value = '';
    });

    restoreSession();
}

init();
