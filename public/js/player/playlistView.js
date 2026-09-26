import { createEl } from '../lib/dom.js';
import { formatTime } from '../lib/format.js';

/**
 * 播放列表面板（右侧抽屉）。
 * 列表项用 DOM API 构建而非 innerHTML 拼接，标题/歌手不再有 XSS 注入面。
 */
export class PlaylistView {
    constructor(options) {
        this.sidebar = options.sidebar;
        this.overlay = options.overlay;
        this.container = options.container;
        this.countBadge = options.countBadge;
        this.onSelect = options.onSelect || (() => {});
        this.activeIndex = -1;
    }

    open() {
        this.sidebar.classList.add('open');
        this.overlay.classList.add('open');
    }

    close() {
        this.sidebar.classList.remove('open');
        this.overlay.classList.remove('open');
    }

    isOpen() {
        return this.sidebar.classList.contains('open');
    }

    setCount(count) {
        if (this.countBadge) this.countBadge.textContent = String(count ?? 0);
    }

    setMessage(text, className = 'empty-msg') {
        this.container.innerHTML = '';
        this.container.appendChild(createEl('div', className, text));
    }

    render(songs) {
        const list = Array.isArray(songs) ? songs : [];

        if (list.length === 0) {
            this.setMessage('播放列表为空');
            return;
        }

        this.container.innerHTML = '';

        list.forEach((song, index) => {
            const item = createEl('div', 'song-item');
            item.dataset.index = String(index);
            item.dataset.id = song.id ?? '';

            const info = createEl('div', 'info');
            info.appendChild(createEl('div', 'title', song.title));
            info.appendChild(createEl('div', 'artist', song.artist));
            item.appendChild(info);

            item.appendChild(createEl('span', 'duration', song.duration ? formatTime(song.duration) : '--:--'));

            item.addEventListener('click', () => this.onSelect(index));
            this.container.appendChild(item);
        });

        this.setCount(list.length);
        this.setActiveIndex(this.activeIndex);
    }

    setActiveIndex(index) {
        this.activeIndex = index;
        this.container.querySelectorAll('.song-item').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });
    }
}
