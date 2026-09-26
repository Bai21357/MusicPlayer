'use strict';

const express = require('express');

const library = require('../services/library');
const { asyncHandler } = require('../utils/fsHelpers');

/** 访客端接口（无需鉴权）。 */
const router = express.Router();

/** 歌曲列表。 */
router.get(
    '/songs',
    asyncHandler(async (req, res) => {
        res.json(await library.listSongs());
    }),
);

/**
 * 歌词原文。
 * 文件名会经过 resolveInsideDir 校验，`../` 之类的穿越请求一律 404。
 */
router.get(
    '/lyrics/:filename',
    asyncHandler(async (req, res) => {
        const content = await library.readLyricFile(req.params.filename);
        if (content === null) {
            return res.status(404).json({ error: '歌词文件不存在' });
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(content);
    }),
);

module.exports = router;
