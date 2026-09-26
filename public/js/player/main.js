import { $, setHidden } from '../lib/dom.js';
import { formatTime } from '../lib/format.js';
import { assetUrl, fetchLyricText, fetchSongList } from '../lib/api.js';
import { parseLyrics } from '../lib/lyrics.js';
import { LyricsView } from './lyricsView.js';
import { PlaylistView } from './playlistView.js';

/**
 * 播放器主控制器：音频元素、播放控制、进度条、音量、快捷键与各视图的装配。
 * 逻辑与旧版单文件实现保持一致，只是拆成了模块并去掉了重复代码。
 */

const els = {
    bgLayer: $('bg-layer'),
    coverImg: $('coverImg'),
    coverPlaceholder: $('coverPlaceholder'),
    coverOverlay: $('coverOverlay'),
    songTitle: $('songTitle'),
    songArtist: $('songArtist'),
    progressFill: $('progressFill'),
    progressBar: $('progressBar'),
    currentTimeDisplay: $('currentTimeDisplay'),
    durationDisplay: $('durationDisplay'),
    playBtn: $('playBtn'),
    playIcon: $('playIcon'),
    prevBtn: $('prevBtn'),
    nextBtn: $('nextBtn'),
    volumeSlider: $('volumeSlider'),
    volumeWrapper: $('volumeWrapper'),
    lyricsContainer: $('lyricsContainer'),
    langToggle: $('langToggle'),
    langLabel: $('langLabel'),
    playlistBtn: $('playlistBtn'),
    playlistCount: $('playlistCount'),
    sidebar: $('sidebar'),
    sidebarOverlay: $('sidebarOverlay'),
    closeSidebar: $('closeSidebar'),
    songListContainer: $('songListContainer'),
};

const DEFAULT_VOLUME = 0.8;
const SEEK_STEP_SECONDS = 5;

const audio = new Audio();
let isPlaying = false;
let isDragging = false;
let currentPlaylist = [];
let currentIndex = -1;
let volumeBeforeMute = DEFAULT_VOLUME;
let isMuted = false;

const lyricsView = new LyricsView(els.lyricsContainer, {
    onModeChange: (mode, label) => {
        els.langLabel.textContent = label;
    },
});

const playlistView = new PlaylistView({
    sidebar: els.sidebar,
    overlay: els.sidebarOverlay,
    container: els.songListContainer,
    countBadge: els.playlistCount,
    onSelect: (index) => playSongFromList(index),
});

/* ------------------------------------------------------------------ */
/* 界面同步                                                            */
/* ------------------------------------------------------------------ */

function updatePlayIcon() {
    els.playIcon.innerHTML = isPlaying
        ? '<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>'
        : '<path d="M8 5v14l11-7z"/>';
}

function updateVolumeDisplay() {
    const percent = Math.round(audio.volume * 100);
    els.volumeWrapper.style.setProperty('--volume-fill', `${percent}%`);
}

function updateVolume(value) {
    const volume = Number.parseFloat(value);
    if (Number.isNaN(volume)) return;

    const clamped = Math.min(1, Math.max(0, volume));
    audio.volume = clamped;
    els.volumeSlider.value = String(clamped);

    if (clamped === 0) {
        isMuted = true;
    } else {
        isMuted = false;
        volumeBeforeMute = clamped;
    }

    updateVolumeDisplay();
}

function toggleMute() {
    if (isMuted) updateVolume(volumeBeforeMute || DEFAULT_VOLUME);
    else updateVolume(0);
}

function updateProgress(currentTime, duration) {
    if (!duration) return;
    const percent = Math.min(100, (currentTime / duration) * 100);
    els.progressFill.style.width = `${percent}%`;
    els.currentTimeDisplay.textContent = formatTime(currentTime);
    els.durationDisplay.textContent = formatTime(duration);
}

function resetProgress() {
    els.progressFill.style.width = '0%';
    els.currentTimeDisplay.textContent = '0:00';
    els.durationDisplay.textContent = '0:00';
}

/** 无封面时按标题/歌手长度生成一个稳定的色相，保持旧版观感。 */
function applyCover(title, artist, coverFilepath) {
    if (coverFilepath) {
        els.coverImg.src = assetUrl(coverFilepath);
        setHidden(els.coverImg, false);
        setHidden(els.coverPlaceholder, true);
        return;
    }

    setHidden(els.coverImg, true);
    setHidden(els.coverPlaceholder, false);

    const hue = (String(title || '').length * 37 + String(artist || '').length * 53) % 360;
    els.coverPlaceholder.style.background = `linear-gradient(135deg, hsl(${hue}, 30%, 20%), hsl(${(hue + 60) % 360}, 25%, 15%))`;

    const icon = els.coverPlaceholder.querySelector('.icon-big');
    icon.textContent = '🎵';
    icon.style.opacity = '0.6';
}

/* ------------------------------------------------------------------ */
/* 播放控制                                                            */
/* ------------------------------------------------------------------ */

function loadSong({ url, title, artist, index, lyricFilepath, coverFilepath }) {
    audio.src = url;
    audio.load();

    els.songTitle.textContent = title || '未知歌曲';
    els.songArtist.textContent = artist || '未知艺术家';

    applyCover(title, artist, coverFilepath);

    lyricsView.render([]);

    if (lyricFilepath) {
        fetchLyricText(lyricFilepath)
            .then((text) => {
                const { lyrics } = parseLyrics(text);
                lyricsView.render(lyrics);
                if (isPlaying && audio.currentTime !== undefined) {
                    lyricsView.updateHighlight(audio.currentTime);
                }
            })
            .catch((err) => console.warn('加载歌词失败:', err));
    }

    resetProgress();
    if (index !== undefined) currentIndex = index;

    audio
        .play()
        .then(() => {
            isPlaying = true;
            updatePlayIcon();
        })
        .catch(() => {
            isPlaying = false;
            updatePlayIcon();
        });

    playlistView.setActiveIndex(index);
}

function playSongFromList(index) {
    const song = currentPlaylist[index];
    if (!song) return;

    loadSong({
        url: assetUrl(song.filepath),
        title: song.title,
        artist: song.artist,
        index,
        lyricFilepath: song.lyricFilepath,
        coverFilepath: song.coverFilepath,
    });

    playlistView.close();
}

function togglePlay() {
    if (!audio.src) return;

    if (isPlaying) {
        audio.pause();
        isPlaying = false;
        updatePlayIcon();
        return;
    }

    audio
        .play()
        .then(() => {
            isPlaying = true;
            updatePlayIcon();
        })
        .catch(() => {
            isPlaying = false;
            updatePlayIcon();
        });
}

function playPrev() {
    if (currentPlaylist.length === 0) return;
    playSongFromList((currentIndex - 1 + currentPlaylist.length) % currentPlaylist.length);
}

function playNext() {
    if (currentPlaylist.length === 0) return;
    playSongFromList((currentIndex + 1) % currentPlaylist.length);
}

function playNextOrStop() {
    isPlaying = false;
    updatePlayIcon();

    if (currentPlaylist.length > 1) {
        playNext();
        return;
    }

    resetProgress();
    lyricsView.setActiveIndex(-1);
}

async function fetchSongs() {
    try {
        const songs = await fetchSongList();
        currentPlaylist = songs;
        playlistView.render(songs);
        playlistView.setCount(songs.length);
        return songs;
    } catch (err) {
        console.error('获取播放列表失败:', err);
        playlistView.setMessage('无法连接服务器');
        return [];
    }
}

/** 拖动/点击进度条定位。 */
function seekTo(point) {
    if (!point) return;

    const rect = els.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (point.clientX - rect.left) / rect.width));

    if (audio.duration && !Number.isNaN(audio.duration)) {
        audio.currentTime = ratio * audio.duration;
    }
    els.progressFill.style.width = `${ratio * 100}%`;
}

function seekBy(deltaSeconds) {
    if (!audio.duration || Number.isNaN(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + deltaSeconds));
}

function handleKeydown(event) {
    if (event.target.tagName === 'INPUT') return;

    switch (event.code) {
        case 'Space':
            event.preventDefault();
            togglePlay();
            break;
        case 'ArrowRight':
            event.preventDefault();
            seekBy(SEEK_STEP_SECONDS);
            break;
        case 'ArrowLeft':
            event.preventDefault();
            seekBy(-SEEK_STEP_SECONDS);
            break;
        case 'KeyL':
            event.preventDefault();
            lyricsView.cycleMode();
            break;
        case 'KeyM':
            event.preventDefault();
            toggleMute();
            break;
        default:
            break;
    }
}

/** 背景/封面特效（保留原有 flow / blur 两个主题）。 */
function setEffect(effect) {
    els.bgLayer.className = effect;
    els.coverOverlay.className = 'cover-overlay';
    if (effect === 'flow') els.coverOverlay.classList.add('flow');
    else if (effect === 'blur') els.coverOverlay.classList.add('blur');
}

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

function bindAudioEvents() {
    audio.addEventListener('timeupdate', () => {
        if (!isDragging && audio.duration) {
            updateProgress(audio.currentTime, audio.duration);
            lyricsView.updateHighlight(audio.currentTime);
        }
    });

    audio.addEventListener('loadedmetadata', () => {
        els.durationDisplay.textContent = formatTime(audio.duration);
    });

    audio.addEventListener('ended', playNextOrStop);
    audio.addEventListener('error', (event) => console.warn('音频错误', event));
}

function bindProgressEvents() {
    els.progressBar.addEventListener('mousedown', (event) => {
        isDragging = true;
        seekTo(event);
    });
    document.addEventListener('mousemove', (event) => {
        if (isDragging) seekTo(event);
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    els.progressBar.addEventListener('touchstart', (event) => {
        isDragging = true;
        seekTo(event.touches[0]);
    });
    document.addEventListener('touchmove', (event) => {
        if (isDragging) seekTo(event.touches[0]);
    });
    document.addEventListener('touchend', () => {
        isDragging = false;
    });
}

function bindVolumeEvents() {
    els.volumeSlider.addEventListener('input', (event) => updateVolume(event.target.value));
    els.volumeSlider.addEventListener('click', (event) => event.stopPropagation());

    els.volumeWrapper.addEventListener('click', (event) => {
        const rect = els.volumeWrapper.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        updateVolume(ratio);
    });
}

function init() {
    els.playBtn.addEventListener('click', togglePlay);
    els.prevBtn.addEventListener('click', playPrev);
    els.nextBtn.addEventListener('click', playNext);
    els.langToggle.addEventListener('click', () => lyricsView.cycleMode());

    bindProgressEvents();
    bindVolumeEvents();
    bindAudioEvents();

    els.playlistBtn.addEventListener('click', () => {
        playlistView.open();
        fetchSongs();
    });
    els.closeSidebar.addEventListener('click', () => playlistView.close());
    els.sidebarOverlay.addEventListener('click', () => playlistView.close());

    document.addEventListener('keydown', handleKeydown);

    updateVolume(DEFAULT_VOLUME);
    els.langLabel.textContent = lyricsView.modeLabel;
    updatePlayIcon();
    updateVolumeDisplay();

    fetchSongs();
    setEffect('flow');

    console.log('音乐播放器已启动');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// 调试用句柄（与旧版保持一致）
window.fetchSongs = fetchSongs;
window.playSongFromList = playSongFromList;
