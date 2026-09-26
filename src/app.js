'use strict';

const cors = require('cors');
const express = require('express');

const config = require('./config');
const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { errorHandler, apiNotFound } = require('./middleware/errorHandler');

/**
 * 组装 Express 应用。
 * 中间件顺序与实际生效顺序一致，可读性优先：
 *   解析 -> 接口路由 -> 静态资源 -> 404 -> 错误处理（必须最后）。
 */
function createApp() {
    const app = express();

    app.disable('x-powered-by');

    // 前端开发时常用 Live Server（5500/8080 等端口）跨端口访问后端，因此保留全量 CORS
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // ---- 接口 ----
    app.use('/api', publicRoutes);
    app.use('/admin', adminRoutes);

    // ---- 静态资源 ----
    app.use(express.static(config.publicDir));
    app.use('/songs', express.static(config.songsDir));
    app.use('/lyrics', express.static(config.lyricsDir));
    app.use('/covers', express.static(config.coversDir));

    // ---- 兜底 ----
    app.use(['/api', '/admin'], apiNotFound);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };
