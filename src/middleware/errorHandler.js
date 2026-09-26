'use strict';

const multer = require('multer');

const config = require('../config');
const logger = require('../utils/logger');

/** multer 错误码 -> 面向用户的中文提示。 */
const MULTER_MESSAGES = {
    LIMIT_FILE_SIZE: '文件过大，超出上传大小限制',
    LIMIT_FILE_COUNT: '文件数量超出限制',
    LIMIT_UNEXPECTED_FILE: '上传字段不正确（音频用 audio/file，歌词用 lyric，封面用 cover）',
    LIMIT_PART_COUNT: '表单分段数超出限制',
    LIMIT_FIELD_COUNT: '表单字段数超出限制',
    LIMIT_FIELD_KEY: '表单字段名过长',
    LIMIT_FIELD_VALUE: '表单字段值过大',
};

/**
 * 统一错误中间件。
 *
 * 注意：Express 的错误中间件必须注册在**所有路由之后**才生效。
 * 旧实现把它放在路由之前（server.js 第 77 行），因此 multer 的错误
 * 从来不会被捕获，上传超限时返回的是 Express 默认 HTML 错误页。
 */
// eslint-disable-next-line no-unused-vars -- Express 靠 4 个参数识别错误中间件
function errorHandler(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        const message = MULTER_MESSAGES[err.code] || err.message;
        logger.warn(`[upload] ${req.method} ${req.originalUrl} 上传失败: ${err.code} ${message}`);
        return res.status(400).json({ error: message, code: err.code });
    }

    // express.json() / urlencoded() 解析失败或体积超限
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: '请求体过大' });
    }
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
        return res.status(400).json({ error: '请求体不是合法的 JSON' });
    }

    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;

    if (status >= 500) {
        logger.error(`[error] ${req.method} ${req.originalUrl}:`, err.stack || err.message);
        return res.status(status).json({ error: '服务器内部错误' });
    }

    return res.status(status).json({ error: err.message || '请求失败' });
}

/** 未被任何路由处理的 /api、/admin 请求返回 JSON（而不是 HTML）。 */
function apiNotFound(req, res) {
    res.status(404).json({ error: '接口不存在' });
}

/** 进程级兜底：避免未捕获异常直接静默退出。 */
function registerProcessHandlers() {
    process.on('unhandledRejection', (reason) => {
        logger.error('[process] 未处理的 Promise 拒绝:', reason && reason.stack ? reason.stack : reason);
    });
    process.on('uncaughtException', (err) => {
        logger.error('[process] 未捕获异常:', err.stack || err.message);
        if (config.usingDefaultPassword) {
            logger.warn('[process] 当前仍在使用默认管理员密码，建议通过 ADMIN_PASSWORD 环境变量修改');
        }
    });
}

module.exports = { errorHandler, apiNotFound, registerProcessHandlers };
