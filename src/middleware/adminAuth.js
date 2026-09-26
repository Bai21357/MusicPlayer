'use strict';

const crypto = require('crypto');

const config = require('../config');
const logger = require('../utils/logger');

/** 定长比较，避免用 === 比较密码时的时序侧信道。 */
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a), 'utf8');
    const bufB = Buffer.from(String(b), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/** 从 Authorization / query / body 中取出令牌（保持旧版三种取法）。 */
function extractToken(req) {
    const header = req.get('authorization');
    if (typeof header === 'string' && header) {
        return header.startsWith('Bearer ') ? header.slice(7).trim() : header;
    }
    if (typeof req.query?.token === 'string') return req.query.token;
    if (typeof req.body?.token === 'string') return req.body.token;
    return '';
}

/** 管理端鉴权中间件。 */
function adminAuth(req, res, next) {
    const token = extractToken(req);

    if (token && safeEqual(token, config.adminPassword)) return next();

    logger.warn(`[auth] 鉴权失败 ${req.method} ${req.originalUrl} from ${req.ip}`);
    res.status(401).json({ error: '未授权' });
}

module.exports = adminAuth;
module.exports.extractToken = extractToken;
