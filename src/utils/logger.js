'use strict';

/**
 * 极简日志封装：统一前缀，便于在 pm2/nginx 日志中检索。
 * 不引入额外依赖，也不打印任何敏感信息。
 */

function stamp() {
    return new Date().toISOString();
}

function write(stream, level, args) {
    stream(`[${stamp()}] [${level}]`, ...args);
}

module.exports = {
    info: (...args) => write(console.log, 'INFO', args),
    warn: (...args) => write(console.warn, 'WARN', args),
    error: (...args) => write(console.error, 'ERROR', args),
};
