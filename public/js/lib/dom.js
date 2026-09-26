/** 与 DOM 相关的小工具。 */

/** getElementById 简写。 */
export const $ = (id) => document.getElementById(id);

/** 创建元素：createEl('div', 'lyric-line', '文本')。 */
export function createEl(tag, className = '', text = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}

/** 显示/隐藏（沿用原项目的 .hidden 工具类）。 */
export function setHidden(el, hidden) {
    el.classList.toggle('hidden', hidden);
}
