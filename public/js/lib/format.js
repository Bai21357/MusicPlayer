/** 格式化与转义工具（播放端与管理端共用）。 */

/** 秒 -> m:ss。 */
export function formatTime(seconds) {
    if (!seconds || Number.isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 注意：本项目的列表渲染统一走 DOM API（textContent），
 * 不再把来自上传元数据的标题/歌手拼进 innerHTML，
 * 因此这里不再需要 escapeHtml 之类的字符串转义工具。
 */
