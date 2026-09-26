'use strict';

const path = require('path');

const config = require('../config');
const logger = require('../utils/logger');

const UNKNOWN_ARTIST = '未知艺术家';

/** 封面常见的后缀，匹配时先剥掉这些后缀再比较（保持旧行为）。 */
const COVER_SUFFIXES = ['-cover', '-artwork', '-album', '-front', '-back', '-cd', '-digi', '-booklet'];

/**
 * 还原上传文件名的编码。
 *
 * multipart 表单里的文件名按 RFC 7578 应为 UTF-8，但历史上 multer/busboy 会给到
 * latin1 解码后的字符串，中文名会变成乱码（README 里提到的“文件名乱码”问题）。
 * 旧实现无条件 `Buffer.from(str, 'binary').toString('utf8')`，对已经是正确 UTF-8
 * 的名字反而会二次损坏。这里只在“看起来确实是 latin1 乱码”时才转换：
 *  - 全部字符都落在 latin1 范围内，且至少有一个非 ASCII → 尝试转换；
 *  - 转换结果出现替换字符 U+FFFD 说明猜错了，保留原字符串。
 */
function decodeUploadFilename(name) {
    if (typeof name !== 'string' || name === '') return '';

    const allLatin1 = !/[^\u0000-\u00ff]/.test(name);
    const hasNonAscii = /[\u0080-\u00ff]/.test(name);
    if (!allLatin1 || !hasNonAscii) return name;

    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? name : decoded;
}

/** 去掉扩展名与封面后缀，得到用于配对的基础名（保持旧行为）。 */
function smartBaseName(filename) {
    const decoded = decodeUploadFilename(filename);
    let base = path.basename(decoded, path.extname(decoded));

    for (const suffix of COVER_SUFFIXES) {
        if (base.toLowerCase().endsWith(suffix)) {
            base = base.slice(0, -suffix.length);
            break;
        }
    }

    return base.trim();
}

/**
 * 从“歌手 - 歌名”形式的文件名里拆分信息。
 * 无法拆分时返回 { artist: '未知艺术家', title: 文件名 }（保持旧行为）。
 */
function splitArtistTitle(filename) {
    const decoded = decodeUploadFilename(filename);
    const base = path.basename(decoded, path.extname(decoded));
    const parts = base.split(/\s*-\s*/);

    if (parts.length >= 2) {
        return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    }
    return { artist: UNKNOWN_ARTIST, title: base.trim() };
}

/**
 * music-metadata 自 v8 起是纯 ESM 包，本项目后端仍是 CommonJS，
 * 因此用动态 import 加载（只加载一次，之后走模块缓存），
 * 这样既能用上最新版本，也不必把整个后端改成 ESM。
 */
let parseFilePromise = null;

function loadParseFile() {
    if (!parseFilePromise) {
        parseFilePromise = import('music-metadata').then((module) => module.parseFile);
    }
    return parseFilePromise;
}

/** 读取音频元数据，解析失败时返回空值，由调用方回退到文件名。 */
async function readAudioTags(filePath, contextLabel = '') {
    try {
        const parseFile = await loadParseFile();
        const info = await parseFile(filePath);
        return {
            title: info.common?.title || '',
            artist: info.common?.artist || '',
            duration: Math.round(info.format?.duration || 0),
        };
    } catch (err) {
        logger.warn(`[metadata] 元数据解析失败，改用文件名（${contextLabel || path.basename(filePath)}）:`, err.message);
        return { title: '', artist: '', duration: 0 };
    }
}

/** 元数据 + 文件名回退，得到最终写入 playlist 的曲目信息。 */
async function resolveTrackInfo(filePath, originalname) {
    const tags = await readAudioTags(filePath, originalname);
    const extracted = splitArtistTitle(originalname);

    return {
        title: tags.title || extracted.title,
        artist: tags.artist || extracted.artist,
        duration: tags.duration || 0,
    };
}

/** 是否为允许的歌词文件。 */
function isLyricFilename(filename) {
    const decoded = decodeUploadFilename(filename);
    return config.lyricExtensions.includes(path.extname(decoded).toLowerCase());
}

module.exports = {
    UNKNOWN_ARTIST,
    COVER_SUFFIXES,
    decodeUploadFilename,
    smartBaseName,
    splitArtistTitle,
    readAudioTags,
    resolveTrackInfo,
    isLyricFilename,
};
