'use strict';

const express = require('express');

const adminAuth = require('../middleware/adminAuth');
const {
    batchUpload,
    uploadAudioMany,
    uploadCoverSingle,
    uploadLyricSingle,
    uploadLyricPool,
    collectFiles,
} = require('../middleware/upload');
const library = require('../services/library');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/fsHelpers');

/** 管理端接口：全部挂在 adminAuth 之后。 */
const router = express.Router();

router.use(adminAuth);

/* ------------------------------------------------------------------ */
/* 歌曲                                                                */
/* ------------------------------------------------------------------ */

router.get(
    '/songs',
    asyncHandler(async (req, res) => {
        res.json(await library.listSongs());
    }),
);

/** 批量上传：音频 + 歌词 + 封面（按文件名自动配对）。 */
router.post(
    '/batch-upload',
    batchUpload,
    asyncHandler(async (req, res) => {
        const audioFiles = req.files?.audio || [];
        const lyricFiles = req.files?.lyric || [];
        const coverFiles = req.files?.cover || [];

        logger.info(
            `[batch-upload] 收到 ${audioFiles.length} 个音频 / ${lyricFiles.length} 个歌词 / ${coverFiles.length} 个封面`,
        );

        if (audioFiles.length === 0) {
            return res.status(400).json({ error: '至少需要上传一个音频文件' });
        }

        const { uploaded, errors } = await library.addSongsBatch({ audioFiles, lyricFiles, coverFiles });

        if (uploaded.length === 0 && errors.length > 0) {
            return res.status(500).json({ error: '所有文件上传失败', details: errors });
        }

        res.status(201).json({ uploaded, errors });
    }),
);

/** 单独上传音频（多选）。 */
router.post(
    '/songs',
    uploadAudioMany,
    asyncHandler(async (req, res) => {
        const files = collectFiles(req);
        if (files.length === 0) {
            return res.status(400).json({ error: '没有音频文件' });
        }

        const uploaded = await library.addAudioFiles(files);
        res.status(201).json({ uploaded: uploaded.map((song) => ({ title: song.title })) });
    }),
);

/**
 * 批量删除。
 * 必须注册在 `/songs/:id` 之前：Express 按注册顺序匹配，
 * 否则 "batch" 会被当作歌曲 id，请求永远落到单删路由并返回 404。
 */
router.delete(
    '/songs/batch',
    asyncHandler(async (req, res) => {
        const ids = req.body?.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '请提供要删除的歌曲ID数组' });
        }

        const { deletedCount } = await library.removeSongs(ids);
        if (deletedCount === 0) {
            return res.status(404).json({ error: '没有找到要删除的歌曲' });
        }

        res.json({ success: true, deleted: deletedCount });
    }),
);

/** 上传/替换封面。 */
router.post(
    '/songs/:id/cover',
    uploadCoverSingle,
    asyncHandler(async (req, res) => {
        if (!req.file) return res.status(400).json({ error: '没有封面文件' });

        const result = await library.setSongCover(req.params.id, req.file);
        if (!result) return res.status(404).json({ error: '歌曲不存在' });

        res.json({ success: true, coverFilepath: result.coverFilepath });
    }),
);

/** 上传/替换单曲歌词。 */
router.post(
    '/songs/:id/lyric',
    uploadLyricSingle,
    asyncHandler(async (req, res) => {
        if (!req.file) return res.status(400).json({ error: '没有歌词文件' });

        const result = await library.setSongLyric(req.params.id, req.file);
        if (!result.ok) {
            const status = result.reason === 'song-not-found' ? 404 : 400;
            const error = result.reason === 'song-not-found' ? '歌曲不存在' : '仅支持 .lrc 或 .txt';
            return res.status(status).json({ error });
        }

        res.json({ success: true, lyricFilepath: result.lyricFilepath });
    }),
);

/** 删除单曲（含音频/封面/歌词文件与歌词记录）。 */
router.delete(
    '/songs/:id',
    asyncHandler(async (req, res) => {
        const { deletedCount } = await library.removeSongs([req.params.id]);
        if (deletedCount === 0) return res.status(404).json({ error: '歌曲不存在' });

        res.json({ success: true });
    }),
);

/* ------------------------------------------------------------------ */
/* 歌词池                                                              */
/* ------------------------------------------------------------------ */

router.get(
    '/lyrics',
    asyncHandler(async (req, res) => {
        res.json(await library.listLyrics());
    }),
);

router.post(
    '/lyrics',
    uploadLyricPool,
    asyncHandler(async (req, res) => {
        const files = collectFiles(req);
        if (files.length === 0) {
            return res.status(400).json({ error: '没有歌词文件' });
        }

        const { accepted, rejected } = await library.addLyricPool(files);
        res.status(201).json({
            uploaded: accepted.map((record) => ({ filename: record.filename })),
            rejected,
        });
    }),
);

router.delete(
    '/lyrics/:id',
    asyncHandler(async (req, res) => {
        const removed = await library.removeLyricById(req.params.id);
        if (!removed) return res.status(404).json({ error: '歌词不存在' });

        res.json({ success: true });
    }),
);

module.exports = router;
