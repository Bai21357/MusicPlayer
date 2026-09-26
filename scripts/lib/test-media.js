'use strict';

/**
 * 测试用的媒体素材生成器（不提交任何二进制文件，全部在内存里合成）。
 *
 * buildTaggedWav 会生成一个真实可被 music-metadata 解析的 WAV：
 * RIFF/WAVE + PCM 数据 + LIST/INFO(INAM/IART) 标签，
 * 这样测试既能覆盖“元数据解析成功”，也能覆盖“解析失败回退文件名”。
 */

function riffChunk(id, payload) {
    const header = Buffer.alloc(8);
    header.write(id, 0, 'ascii');
    header.writeUInt32LE(payload.length, 4);
    const pad = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
    return Buffer.concat([header, payload, pad]);
}

/**
 * 合成带标题/歌手标签的 8-bit 单声道 PCM WAV。
 * @param {{title: string, artist: string, seconds?: number, sampleRate?: number}} options
 * @returns {Buffer}
 */
function buildTaggedWav({ title, artist, seconds = 2, sampleRate = 8000 }) {
    const bytesPerSample = 1;
    const dataSize = sampleRate * seconds * bytesPerSample;

    const fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(1, 0); // PCM
    fmt.writeUInt16LE(1, 2); // 单声道
    fmt.writeUInt32LE(sampleRate, 4);
    fmt.writeUInt32LE(sampleRate * bytesPerSample, 8);
    fmt.writeUInt16LE(bytesPerSample, 12);
    fmt.writeUInt16LE(bytesPerSample * 8, 14);

    const list = riffChunk('LIST', Buffer.concat([
        Buffer.from('INFO', 'ascii'),
        riffChunk('INAM', Buffer.from(`${title}\0`, 'latin1')),
        riffChunk('IART', Buffer.from(`${artist}\0`, 'latin1')),
    ]));

    const body = Buffer.concat([
        Buffer.from('WAVE', 'ascii'),
        riffChunk('fmt ', fmt),
        list,
        riffChunk('data', Buffer.alloc(dataSize, 128)),
    ]);

    const riff = Buffer.alloc(8);
    riff.write('RIFF', 0, 'ascii');
    riff.writeUInt32LE(body.length, 4);

    return Buffer.concat([riff, body]);
}

/** 播放器可直接解析的双语歌词样例。 */
const SAMPLE_LRC = [
    '[00:00.50]夏の終わり / 夏天的终结',
    '[00:03.00]君の声が聞こえる / 能听见你的声音',
    '[00:06.00]Single line without translation',
    '',
].join('\n');

module.exports = { riffChunk, buildTaggedWav, SAMPLE_LRC };
