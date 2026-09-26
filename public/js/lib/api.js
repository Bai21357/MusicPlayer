/**
 * 后端地址解析与接口调用封装。
 * 开发时若前端跑在 Live Server 等端口（5500/8080/...），自动指向本机 3000 端口。
 */

const DEV_PORTS = new Set(['5500', '8080', '1234', '5173', '3001']);

export function resolveBackendUrl() {
    const { protocol, hostname, port } = window.location;
    if (DEV_PORTS.has(port)) {
        return `${protocol}//${hostname}:3000`;
    }
    return `${protocol}//${hostname}${port ? ':' + port : ''}`;
}

export const BACKEND_URL = resolveBackendUrl();

/** 把 `/songs/xxx.mp3` 这类接口相对路径拼成完整地址。 */
export function assetUrl(filepath) {
    return filepath ? `${BACKEND_URL}${filepath}` : '';
}

function buildError(response, fallback) {
    const error = new Error(fallback);
    error.status = response.status;
    return error;
}

export async function fetchSongList() {
    const response = await fetch(`${BACKEND_URL}/api/songs`);
    if (!response.ok) throw buildError(response, '获取列表失败');
    return response.json();
}

/** 拉取歌词原文；文件名只取末段并做 URL 编码。 */
export async function fetchLyricText(filepath) {
    const filename = String(filepath).split('/').pop();
    const response = await fetch(`${BACKEND_URL}/api/lyrics/${encodeURIComponent(filename)}`);
    if (!response.ok) throw buildError(response, '歌词加载失败');
    return response.text();
}

/** 管理端带鉴权的 fetch。 */
export async function adminFetch(url, options = {}, token = '') {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = token;

    return fetch(`${BACKEND_URL}${url}`, { ...options, headers });
}

export { BACKEND_URL as backendUrl };
