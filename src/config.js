'use strict';

/**
 * 全局配置：所有可调参数集中在此处，避免散落在各个模块中。
 * 目录结构保持与旧版本一致（数据文件仍在项目根目录），因此可直接复用已有部署的数据。
 */

const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_ADMIN_PASSWORD = 'admin666';
const MB = 1024 * 1024;

/** 数据根目录，可用 MZ_DATA_DIR 覆盖（默认项目根目录，兼容旧部署）。 */
const DATA_DIR = process.env.MZ_DATA_DIR
    ? path.resolve(process.env.MZ_DATA_DIR)
    : ROOT_DIR;

function positiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const adminPassword = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

const config = {
    rootDir: ROOT_DIR,
    dataDir: DATA_DIR,
    publicDir: path.join(ROOT_DIR, 'public'),

    songsDir: path.join(DATA_DIR, 'songs'),
    lyricsDir: path.join(DATA_DIR, 'lyrics'),
    coversDir: path.join(DATA_DIR, 'covers'),
    playlistFile: path.join(DATA_DIR, 'playlist.json'),
    lyricsFile: path.join(DATA_DIR, 'lyrics.json'),

    host: process.env.HOST || '0.0.0.0',
    port: positiveInt(process.env.PORT, 3000),

    adminPassword,
    usingDefaultPassword: adminPassword === DEFAULT_ADMIN_PASSWORD,

    /** 歌词文件允许的扩展名（上传时校验）。 */
    lyricExtensions: ['.lrc', '.txt'],

    /** 上传体积上限，可用 MAX_AUDIO_MB / MAX_COVER_MB / MAX_LYRIC_MB 覆盖。 */
    uploadLimits: {
        audio: positiveInt(process.env.MAX_AUDIO_MB, 100) * MB,
        cover: positiveInt(process.env.MAX_COVER_MB, 20) * MB,
        lyric: positiveInt(process.env.MAX_LYRIC_MB, 10) * MB,
    },

    /** 单次批量上传中各类文件的字段上限。 */
    maxFilesPerField: 50,
    maxFilesPerAudioRequest: 10,
};

module.exports = config;
