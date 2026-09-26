import { createEl } from '../lib/dom.js';

const MODES = ['dual', 'primary', 'secondary'];
const MODE_LABELS = { dual: '双语', primary: '主译', secondary: '译' };

/**
 * 歌词视图：负责渲染、高亮与显示模式（双语/主译/译）。
 *
 * 相比旧实现（原地嵌在 index.html 里）：
 *  - 三处几乎相同的“渲染一行歌词”代码合并为一处；
 *  - 高亮索引直接对应定时行数组，修掉了旧版把“含未定时行在内的数组下标”
 *    当作“定时行序号”使用、以及 DOM 顺序与解析顺序不一致导致的高亮错位；
 *  - 所有文本用 textContent 写入，不再有 innerHTML 注入面。
 */
export class LyricsView {
    constructor(container, options = {}) {
        this.container = container;
        this.mode = 'dual';
        this.onModeChange = options.onModeChange || (() => {});

        /** 定时行原始数据，与 lineElements 一一对应。 */
        this.timedLines = [];
        /** 定时行对应的 DOM 元素（顺序与 timedLines 相同）。 */
        this.lineElements = [];
        this.activeIndex = -1;
    }

    get modeLabel() {
        return MODE_LABELS[this.mode] || MODE_LABELS.dual;
    }

    /** 渲染整篇歌词；传空数组等价于“暂无歌词”。 */
    render(lyricsData) {
        this.container.innerHTML = '';
        this.timedLines = [];
        this.lineElements = [];
        this.activeIndex = -1;

        const entries = Array.isArray(lyricsData) ? lyricsData : [];
        const timed = entries.filter((line) => line.time >= 0);
        const untimed = entries.filter((line) => line.time < 0);

        if (timed.length === 0 && untimed.length === 0) {
            this._appendPlaceholder('暂无歌词');
            return;
        }

        for (const line of timed) {
            const el = this._buildLine(line);
            el.dataset.time = String(line.time);
            this.container.appendChild(el);
            this.timedLines.push(line);
            this.lineElements.push(el);
        }

        if (timed.length > 0 && untimed.length > 0) {
            const separator = this._appendPlaceholder('— · —');
            separator.style.padding = '18px 0';
        }

        const untimedOpacity = timed.length > 0 ? '0.5' : '0.6';
        for (const line of untimed) {
            const el = this._buildLine(line);
            el.style.opacity = untimedOpacity;
            this.container.appendChild(el);
        }

        this.applyMode();
    }

    /** 切换显示模式：双语 -> 主译 -> 译 -> 双语。 */
    cycleMode() {
        const index = MODES.indexOf(this.mode);
        this.mode = MODES[(index + 1) % MODES.length];
        this.applyMode();
    }

    /** 按当前模式设置每行的内联样式，并同步按钮文案。 */
    applyMode() {
        for (const el of this.container.querySelectorAll('.lyric-line')) {
            if (el.classList.contains('empty')) continue;
            const primary = el.querySelector('.primary');
            if (!primary) continue;
            applyLineMode(primary, el.querySelector('.secondary'), this.mode);
        }

        this.refreshHighlight();
        this.onModeChange(this.mode, this.modeLabel);
    }

    /** 根据播放进度定位当前行。 */
    updateHighlight(currentTime) {
        if (this.timedLines.length === 0) return;

        let index = -1;
        for (let i = 0; i < this.timedLines.length; i++) {
            if (currentTime >= this.timedLines[i].time) index = i;
            else break;
        }

        this.setActiveIndex(index);
    }

    setActiveIndex(index) {
        if (index === this.activeIndex) return;
        this.activeIndex = index;
        this.refreshHighlight();
    }

    /** 重新应用 active / prev-active 类并滚动到可视区域。 */
    refreshHighlight() {
        for (const el of this.lineElements) el.classList.remove('active', 'prev-active');

        const target = this.activeIndex >= 0 ? this.lineElements[this.activeIndex] : null;
        if (!target) return;

        target.classList.add('active');
        const previous = this.activeIndex > 0 ? this.lineElements[this.activeIndex - 1] : null;
        if (previous) previous.classList.add('prev-active');

        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    _buildLine(line) {
        const el = createEl('div', 'lyric-line');
        if (!line.isDual) el.classList.add('single');

        el.appendChild(createEl('span', 'primary', line.primary));
        if (line.isDual && line.secondary) {
            el.appendChild(createEl('span', 'secondary', line.secondary));
        }

        return el;
    }

    _appendPlaceholder(text) {
        const el = createEl('div', 'lyric-line empty');
        el.appendChild(createEl('span', 'primary', text));
        this.container.appendChild(el);
        return el;
    }
}

/** 单个歌词行的模式样式（与原实现逐条对应）。 */
function applyLineMode(primary, secondary, mode) {
    if (mode === 'primary') {
        primary.style.display = 'block';
        primary.style.fontSize = '30px';
        primary.style.color = 'var(--text-primary)';
        primary.style.fontWeight = '500';
        if (secondary) secondary.style.display = 'none';
        return;
    }

    if (mode === 'secondary') {
        if (secondary) {
            primary.style.display = 'none';
            secondary.style.display = 'block';
            secondary.style.fontSize = '28px';
            secondary.style.color = 'var(--text-primary)';
            secondary.style.fontWeight = '500';
        } else {
            primary.style.display = 'block';
            primary.style.fontSize = '28px';
            primary.style.color = 'var(--text-primary)';
            primary.style.fontWeight = '500';
        }
        return;
    }

    // dual
    primary.style.display = 'block';
    primary.style.fontSize = '';
    primary.style.color = '';
    primary.style.fontWeight = '';
    if (secondary) {
        secondary.style.display = 'block';
        secondary.style.fontSize = '';
        secondary.style.color = '';
        secondary.style.opacity = '';
    }
}
