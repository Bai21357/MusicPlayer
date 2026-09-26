'use strict';

const fs = require('fs/promises');
const path = require('path');

const config = require('../config');
const logger = require('../utils/logger');
const { createId } = require('../utils/ids');
const { resolveInsideDir } = require('../utils/safePath');
const { removeFile, removeFiles } = require('../utils/fsHelpers');
const metadata = require('./metadata');
const { playlistStore, lyricsStore } = require('../store');

/**
 * 媒体库：所有涉及“磁盘文件 + JSON 记录”一致性的业务逻辑都收敛在这里。
 * 路由层只负责参数校验与 HTTP 语义。
 */

/** 歌曲记录 -> 绝对路径（始终限定在对应目录内）。 */
const songAudioPath = (song) => resolveInsideDir(config.songsDir, song.filename);
const coverPath = (filePathOrName) =>
    resolveInsideDir(config.coversDir, path.basename(String(filePathOrName || '')));
const lyricPath = (filePathOrName) =>
    resolveInsideDir(config.lyricsDir, path.basename(String(filePathOrName || '')));

function buildSongRecord(file, info, matchedLyric, matchedCover) {
    return {
        id: createId(),
        title: info.title,
        artist: info.artist,
        duration: info.duration,
        filename: file.filename,
        filepath: `/songs/${file.filename}`,
        originalname: metadata.decodeUploadFilename(file.originalname),
        lyricFilepath: matchedLyric ? `/lyrics/${matchedLyric.filename}` : null,
        coverFilepath: matchedCover ? `/covers/${matchedCover.filename}` : null,
    };
}

function buildLyricRecord(file) {
    return {
        id: createId(),
        filename: file.filename,
        originalname: metadata.decodeUploadFilename(file.originalname),
        filepath: `/lyrics/${file.filename}`,
        uploaded: new Date().toISOString(),
    };
}

/** 按“基础名”建立索引，用于歌词/封面与音频的自动配对。 */
function buildNameIndex(files) {
    const exact = new Map();
    const insensitive = new Map();

    for (const file of files) {
        const base = metadata.smartBaseName(file.originalname);
        if (!base) continue;
        exact.set(base, file); // 同名时后一个覆盖前一个（保持旧行为）
        insensitive.set(base.toLowerCase(), file);
    }

    return { exact, insensitive };
}

function pickMatch(index, base) {
    if (!base) return null;
    return index.exact.get(base) || index.insensitive.get(base.toLowerCase()) || null;
}

async function listSongs() {
    return playlistStore.read();
}

async function listLyrics() {
    return lyricsStore.read();
}

/** 删除一首歌关联的音频/封面/歌词文件。 */
async function removeSongAssets(song) {
    const targets = [songAudioPath(song)];
    if (song.coverFilepath) targets.push(coverPath(song.coverFilepath));
    if (song.lyricFilepath) targets.push(lyricPath(song.lyricFilepath));
    await removeFiles(targets.filter(Boolean));
}

/**
 * 批量上传：音频 + 歌词 + 封面。
 * 相比旧实现：整批只做一次读-改-写（原来是每个文件一次全量读写），失败文件会被清理。
 */
async function addSongsBatch({ audioFiles, lyricFiles = [], coverFiles = [] }) {
    const lyricIndex = buildNameIndex(lyricFiles);
    const coverIndex = buildNameIndex(coverFiles);

    const uploaded = [];
    const errors = [];
    const failedUploads = [];
    const newLyricRecords = [];

    for (const audio of audioFiles) {
        try {
            const base = metadata.smartBaseName(audio.originalname);
            const matchedLyric = pickMatch(lyricIndex, base);
            const matchedCover = pickMatch(coverIndex, base);
            const info = await metadata.resolveTrackInfo(audio.path, audio.originalname);

            uploaded.push(buildSongRecord(audio, info, matchedLyric, matchedCover));
            if (matchedLyric) newLyricRecords.push(buildLyricRecord(matchedLyric));
        } catch (err) {
            logger.error('[library] 处理音频失败:', audio.originalname, err.message);
            errors.push({ file: audio.originalname, error: err.message });
            failedUploads.push(audio.path);
        }
    }

    if (uploaded.length === 0) {
        // 整批失败：清掉所有已落盘的上传文件，避免留下孤儿文件
        await removeFiles([...audioFiles, ...lyricFiles, ...coverFiles].map((f) => f.path));
        return { uploaded, errors };
    }

    await playlistStore.update((list) => {
        list.push(...uploaded);
    });

    if (newLyricRecords.length > 0) {
        await lyricsStore.update((list) => {
            list.push(...newLyricRecords);
        });
    }

    await removeFiles(failedUploads);

    return { uploaded, errors };
}

/** 单组音频上传（POST /admin/songs）。 */
async function addAudioFiles(files) {
    const uploaded = [];

    for (const file of files) {
        const info = await metadata.resolveTrackInfo(file.path, file.originalname);
        uploaded.push(buildSongRecord(file, info, null, null));
    }

    if (uploaded.length > 0) {
        await playlistStore.update((list) => {
            list.push(...uploaded);
        });
    }

    return uploaded;
}

/** 歌词池上传（POST /admin/lyrics）：只入库，不与歌曲自动配对（保持旧语义）。 */
async function addLyricPool(files) {
    const accepted = [];
    const rejected = [];

    for (const file of files) {
        if (!metadata.isLyricFilename(file.originalname)) {
            rejected.push(metadata.decodeUploadFilename(file.originalname));
            await removeFile(file.path);
            continue;
        }
        accepted.push(buildLyricRecord(file));
    }

    if (accepted.length > 0) {
        await lyricsStore.update((list) => {
            list.push(...accepted);
        });
    }

    return { accepted, rejected };
}

/**
 * 替换某首歌的封面。歌曲不存在时删除刚上传的文件并返回 null。
 */
async function setSongCover(songId, file) {
    let missing = false;
    let replacedPath = null;
    const newCoverPath = `/covers/${file.filename}`;

    await playlistStore.update((list) => {
        const song = list.find((item) => String(item.id) === String(songId));
        if (!song) {
            missing = true;
            return;
        }
        replacedPath = song.coverFilepath;
        song.coverFilepath = newCoverPath;
    });

    if (missing) {
        await removeFile(file.path);
        return null;
    }

    if (replacedPath) await removeFile(coverPath(replacedPath));
    return { coverFilepath: newCoverPath };
}

/**
 * 替换某首歌的歌词：更新 playlist.json 并追加一条歌词记录。
 * @returns {{ok: false, reason: string} | {ok: true, lyricFilepath: string}}
 */
async function setSongLyric(songId, file) {
    if (!metadata.isLyricFilename(file.originalname)) {
        await removeFile(file.path);
        return { ok: false, reason: 'invalid-extension' };
    }

    const record = buildLyricRecord(file);
    let missing = false;
    let replacedPath = null;

    await playlistStore.update((list) => {
        const song = list.find((item) => String(item.id) === String(songId));
        if (!song) {
            missing = true;
            return;
        }
        replacedPath = song.lyricFilepath;
        song.lyricFilepath = record.filepath;
    });

    if (missing) {
        await removeFile(file.path);
        return { ok: false, reason: 'song-not-found' };
    }

    if (replacedPath) await removeFile(lyricPath(replacedPath));

    await lyricsStore.update((list) => {
        list.push(record);
    });

    return { ok: true, lyricFilepath: record.filepath };
}

/**
 * 删除若干歌曲：单删与批删共用同一条路径（旧实现重复了两份逻辑）。
 * @returns {Promise<{deleted: Array, deletedCount: number}>}
 */
async function removeSongs(ids) {
    const targets = new Set((ids || []).map((id) => String(id)));
    if (targets.size === 0) return { deleted: [], deletedCount: 0 };

    const current = await playlistStore.read();
    const deleted = current.filter((song) => targets.has(String(song.id)));
    if (deleted.length === 0) return { deleted: [], deletedCount: 0 };

    const deletedIds = new Set(deleted.map((song) => String(song.id)));
    await playlistStore.update((list) => list.filter((song) => !deletedIds.has(String(song.id))));

    // 1) 删除磁盘文件
    for (const song of deleted) await removeSongAssets(song);

    // 2) 同步清理歌词池里指向这些文件的记录
    const orphanLyricPaths = new Set(deleted.map((song) => song.lyricFilepath).filter(Boolean));
    if (orphanLyricPaths.size > 0) {
        await lyricsStore.update((list) => list.filter((item) => !orphanLyricPaths.has(item.filepath)));
    }

    return { deleted, deletedCount: deleted.length };
}

/** 按歌词记录 ID 删除（含磁盘文件）。 */
async function removeLyricById(lyricId) {
    let removed = null;

    await lyricsStore.update((list) => {
        const index = list.findIndex((item) => String(item.id) === String(lyricId));
        if (index === -1) return;
        removed = list[index];
        list.splice(index, 1);
    });

    if (!removed) return null;

    await removeFile(lyricPath(removed.filename || removed.filepath));
    return removed;
}

/** 读取歌词文本，文件名限定在 lyrics 目录内（阻断路径穿越）。 */
async function readLyricFile(filename) {
    const resolved = resolveInsideDir(config.lyricsDir, filename);
    if (!resolved) return null;

    try {
        return await fs.readFile(resolved, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

module.exports = {
    listSongs,
    listLyrics,
    addSongsBatch,
    addAudioFiles,
    addLyricPool,
    setSongCover,
    setSongLyric,
    removeSongs,
    removeLyricById,
    readLyricFile,
};
