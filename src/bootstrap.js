'use strict';

const fs = require('fs/promises');

const config = require('./config');
const logger = require('./utils/logger');
const { playlistStore, lyricsStore } = require('./store');

/**
 * 启动引导：准备数据目录与 JSON 文件。
 * 旧实现是在 require server.js 时同步创建（existsSync + mkdirSync），
 * 现在改为显式异步引导，且只用 async 版本，不阻塞事件循环。
 */
async function bootstrap() {
    await Promise.all([
        fs.mkdir(config.songsDir, { recursive: true }),
        fs.mkdir(config.lyricsDir, { recursive: true }),
        fs.mkdir(config.coversDir, { recursive: true }),
    ]);

    await playlistStore.ensureFile();
    await lyricsStore.ensureFile();

    logger.info(`[bootstrap] 数据目录: ${config.dataDir}`);
}

module.exports = { bootstrap };
