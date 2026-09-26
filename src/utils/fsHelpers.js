'use strict';

const fs = require('fs/promises');

/** 删除文件，忽略“不存在”等错误（旧实现到处写 existsSync + unlinkSync）。 */
async function removeFile(filePath) {
    if (!filePath) return false;
    try {
        await fs.unlink(filePath);
        return true;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            // 删除失败不应让整个请求失败，只记录
            require('./logger').warn(`[fs] 删除文件失败 ${filePath}:`, err.message);
        }
        return false;
    }
}

/** 删除多个文件。 */
async function removeFiles(paths) {
    const list = (paths || []).filter(Boolean);
    await Promise.all(list.map((p) => removeFile(p)));
}

/** 包住 async 路由处理器，把 reject 交给 Express 错误中间件。 */
function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { removeFile, removeFiles, asyncHandler };
