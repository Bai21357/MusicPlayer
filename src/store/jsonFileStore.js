'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const logger = require('../utils/logger');

/**
 * 单文件 JSON 存储。
 *
 * 解决了旧实现（每次读写都同步 readFileSync/writeFileSync）的几个问题：
 *  1. 原子写：先写临时文件再 rename，进程被杀不会留下半截 JSON；
 *  2. 串行化：所有 update() 通过 Promise 队列排队，并发请求不会互相覆盖；
 *  3. 内存缓存：一次读取后复用，批量上传不再 O(n²) 反复读全量文件；
 *  4. 损坏自愈：JSON 解析失败时备份原文件并重置为空数组，不会静默丢数据。
 *
 * 注意：串行化只保证单进程安全（本项目的部署方式即单进程 PM2），
 * 多进程/多实例同时写同一文件不在保证范围内。
 */
class JsonFileStore {
    /**
     * @param {string} filePath JSON 文件绝对路径
     * @param {{validate?: (data: unknown) => boolean}} [options]
     */
    constructor(filePath, options = {}) {
        this.filePath = filePath;
        this.validate = options.validate || ((data) => Array.isArray(data));
        this._cache = null;
        this._loading = null;
        this._queue = Promise.resolve();
    }

    /** 确保文件存在（不存在则写入空数组），供启动引导调用。 */
    async ensureFile() {
        try {
            await fs.access(this.filePath);
        } catch {
            await fs.mkdir(path.dirname(this.filePath), { recursive: true });
            await fs.writeFile(this.filePath, '[]', 'utf8');
        }
    }

    /** 读取当前数据（返回内部缓存对象，调用方不要直接修改）。 */
    async read() {
        if (this._cache !== null) return this._cache;
        if (!this._loading) {
            this._loading = this._loadFromDisk().then((data) => {
                this._cache = data;
                this._loading = null;
                return data;
            });
        }
        return this._loading;
    }

    /**
     * 串行读-改-写。
     * @param {(draft: any[]) => (any[] | void | Promise<any[] | void>)} mutator
     *        接收数据副本，可原地修改；返回新数组则以其为准。
     * @returns {Promise<any[]>} 写入后的数据
     */
    async update(mutator) {
        const run = this._queue.then(async () => {
            const current = await this.read();
            const draft = structuredClone(current);
            const result = await mutator(draft);
            const next = Array.isArray(result) ? result : draft;
            await this._writeAtomic(next);
            this._cache = next;
            return next;
        });

        // 无论成功失败都保持队列可用，避免一次失败卡死后续写入
        this._queue = run.then(
            () => undefined,
            () => undefined,
        );

        return run;
    }

    async _loadFromDisk() {
        let raw;
        try {
            raw = await fs.readFile(this.filePath, 'utf8');
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.error(`[store] 读取 ${path.basename(this.filePath)} 失败:`, err.message);
            }
            return [];
        }

        if (!raw.trim()) return [];

        try {
            const parsed = JSON.parse(raw);
            if (!this.validate(parsed)) throw new Error('顶层结构不是数组');
            return parsed;
        } catch (err) {
            logger.error(
                `[store] ${path.basename(this.filePath)} 解析失败（${err.message}），已备份原文件并重置为空列表`,
            );
            await this._backupCorrupt(raw);
            return [];
        }
    }

    async _backupCorrupt(raw) {
        const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
        try {
            await fs.writeFile(backupPath, raw, 'utf8');
            logger.warn(`[store] 损坏文件已备份到 ${path.basename(backupPath)}`);
        } catch (err) {
            logger.error('[store] 备份损坏文件失败:', err.message);
        }
    }

    async _writeAtomic(data) {
        const dir = path.dirname(this.filePath);
        await fs.mkdir(dir, { recursive: true });

        const tmpPath = path.join(
            dir,
            `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
        );

        let handle = null;
        try {
            handle = await fs.open(tmpPath, 'w');
            await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
            await handle.sync();
        } finally {
            if (handle) await handle.close().catch(() => undefined);
        }

        try {
            await fs.rename(tmpPath, this.filePath);
        } catch (err) {
            await fs.rm(tmpPath, { force: true }).catch(() => undefined);
            throw err;
        }
    }
}

module.exports = { JsonFileStore };
