'use strict';

const multer = require('multer');

const config = require('../config');
const { buildStoredFilename } = require('../utils/safePath');
const { decodeUploadFilename } = require('../services/metadata');

/**
 * multer 上传配置。
 *
 * 与旧实现的差别：
 *  - 存储文件名做了净化与去重（旧实现 `Date.now() + '-' + originalname` 在同一批次内
 *    同名文件会互相覆盖，且中文名可能以乱码形式落盘）；
 *  - 歌词池上传（POST /admin/lyrics）落盘到 lyrics/ 目录（旧实现误落到 songs/）。
 */

/** 字段名 -> 目标目录。 */
function destinationForField(fieldname) {
    if (fieldname === 'cover') return config.coversDir;
    if (fieldname === 'lyric') return config.lyricsDir;
    return config.songsDir; // audio / file
}

function makeStorage(resolveDir) {
    return multer.diskStorage({
        destination: (req, file, cb) => {
            try {
                cb(null, resolveDir(file.fieldname));
            } catch (err) {
                cb(err);
            }
        },
        filename: (req, file, cb) => {
            cb(null, buildStoredFilename(file.originalname, decodeUploadFilename));
        },
    });
}

const standardStorage = makeStorage(destinationForField);
const lyricsPoolStorage = makeStorage(() => config.lyricsDir);

const { audio: audioLimit, cover: coverLimit, lyric: lyricLimit } = config.uploadLimits;
const maxBatch = config.maxFilesPerField;

/** POST /admin/batch-upload：音频 + 歌词 + 封面一次性提交。 */
const batchUpload = multer({
    storage: standardStorage,
    limits: { fileSize: audioLimit, files: maxBatch * 3 },
}).fields([
    { name: 'audio', maxCount: maxBatch },
    { name: 'lyric', maxCount: maxBatch },
    { name: 'cover', maxCount: maxBatch },
]);

/** POST /admin/songs：多选音频（字段名保持 file）。 */
const uploadAudioMany = multer({
    storage: standardStorage,
    limits: { fileSize: audioLimit },
}).array('file', config.maxFilesPerAudioRequest);

/** POST /admin/songs/:id/cover */
const uploadCoverSingle = multer({
    storage: standardStorage,
    limits: { fileSize: coverLimit },
}).single('cover');

/** POST /admin/songs/:id/lyric */
const uploadLyricSingle = multer({
    storage: standardStorage,
    limits: { fileSize: lyricLimit },
}).single('lyric');

/** POST /admin/lyrics：歌词池，同时兼容 file / lyric 两种字段名。 */
const uploadLyricPool = multer({
    storage: lyricsPoolStorage,
    limits: { fileSize: lyricLimit },
}).fields([
    { name: 'file', maxCount: config.maxFilesPerAudioRequest },
    { name: 'lyric', maxCount: config.maxFilesPerAudioRequest },
]);

/** 把 multer 的 fields() 结果摊平成数组。 */
function collectFiles(req) {
    if (Array.isArray(req.files)) return req.files;
    if (req.files && typeof req.files === 'object') {
        return Object.values(req.files).flat();
    }
    return [];
}

module.exports = {
    batchUpload,
    uploadAudioMany,
    uploadCoverSingle,
    uploadLyricSingle,
    uploadLyricPool,
    collectFiles,
};
