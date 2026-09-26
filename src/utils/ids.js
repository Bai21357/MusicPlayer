'use strict';

const crypto = require('crypto');

/**
 * 生成歌曲/歌词记录 ID。
 * 旧实现用 `Date.now() + Math.random().substr(2, 4)`，同一毫秒内可能碰撞，
 * 且 `substr` 已被废弃；这里改用加密随机 UUID。
 */
function createId() {
    return crypto.randomUUID();
}

module.exports = { createId };
