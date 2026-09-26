'use strict';

/**
 * 应用入口：只负责启动与优雅退出，业务代码全部在 src/ 下。
 */

const config = require('./src/config');
const logger = require('./src/utils/logger');
const { bootstrap } = require('./src/bootstrap');
const { createApp } = require('./src/app');
const { registerProcessHandlers } = require('./src/middleware/errorHandler');

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
    registerProcessHandlers();
    await bootstrap();

    const app = createApp();
    const server = app.listen(config.port, config.host, () => {
        logger.info(`服务器运行在 http://${config.host}:${config.port}`);
        logger.info(`访客端 http://${config.host}:${config.port}/  管理端 http://${config.host}:${config.port}/admin.html`);

        if (config.usingDefaultPassword) {
            logger.warn('当前使用默认管理员密码 admin666，请通过环境变量 ADMIN_PASSWORD 修改');
        }
    });

    server.on('error', (err) => {
        logger.error('[server] 启动失败:', err.message);
        process.exit(1);
    });

    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`[server] 收到 ${signal}，正在关闭...`);

        const forceExit = setTimeout(() => {
            logger.warn('[server] 关闭超时，强制退出');
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        forceExit.unref();

        server.close((err) => {
            if (err) {
                logger.error('[server] 关闭时出错:', err.message);
                process.exit(1);
            }
            logger.info('[server] 已安全关闭');
            process.exit(0);
        });
    };

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => shutdown(signal));
    }
}

main().catch((err) => {
    logger.error('[server] 初始化失败:', err.stack || err.message);
    process.exit(1);
});
