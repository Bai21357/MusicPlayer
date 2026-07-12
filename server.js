const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseFile } = require('music-metadata');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = '123890Zzz';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const songsDir = path.join(__dirname, 'songs');
if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir);
const playlistFile = path.join(__dirname, 'playlist.json');
if (!fs.existsSync(playlistFile)) fs.writeFileSync(playlistFile, '[]', 'utf8');

const lyricsDir = path.join(__dirname, 'lyrics');
if (!fs.existsSync(lyricsDir)) fs.mkdirSync(lyricsDir);
const lyricsFile = path.join(__dirname, 'lyrics.json');
if (!fs.existsSync(lyricsFile)) fs.writeFileSync(lyricsFile, '[]', 'utf8');

const coversDir = path.join(__dirname, 'covers');
if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir);


function readPlaylist() {
    try { return JSON.parse(fs.readFileSync(playlistFile, 'utf8')); } catch { return []; }
}
function writePlaylist(list) {
    fs.writeFileSync(playlistFile, JSON.stringify(list, null, 2), 'utf8');
}
function readLyrics() {
    try { return JSON.parse(fs.readFileSync(lyricsFile, 'utf8')); } catch { return []; }
}
function writeLyrics(list) {
    fs.writeFileSync(lyricsFile, JSON.stringify(list, null, 2), 'utf8');
}

function adminAuth(req, res, next) {
    const token = req.headers['authorization'] || req.query.token || req.body.token;
    if (token === ADMIN_PASSWORD) return next();
    res.status(401).json({ error: '未授权' });
}


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'audio' || file.fieldname === 'file') cb(null, songsDir);
        else if (file.fieldname === 'lyric') cb(null, lyricsDir);
        else if (file.fieldname === 'cover') cb(null, coversDir);
        else cb(null, songsDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const batchUpload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }
}).fields([
    { name: 'audio', maxCount: 50 },
    { name: 'lyric', maxCount: 50 },
    { name: 'cover', maxCount: 50 }
]);

const uploadCover = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } }).single('cover');
const uploadLyricSingle = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } }).single('lyric');
const uploadAudioSingle = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } }).array('file', 10);


app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
    }
    console.error('全局错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
});


function toUtf8(str) {
    try {
        return Buffer.from(str, 'binary').toString('utf8');
    } catch (e) {
        return str;
    }
}
function extractArtistTitle(filename) {
    const base = path.basename(filename, path.extname(filename));
    const parts = base.split(/\s*-\s*/);
    if (parts.length >= 2) {
        return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    }
    return { artist: '未知艺术家', title: base.trim() };
}


function getSmartBaseName(filename) {
    const utf8Name = toUtf8(filename);
    let base = path.basename(utf8Name, path.extname(utf8Name));
    const suffixes = ['-cover', '-artwork', '-album', '-front', '-back', '-cd', '-digi', '-booklet'];
    for (const suffix of suffixes) {
        if (base.toLowerCase().endsWith(suffix)) {
            base = base.slice(0, -suffix.length);
            break;
        }
    }
    return base.trim();
}


app.get('/api/songs', (req, res) => {
    res.json(readPlaylist());
});
app.get('/api/lyrics/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(lyricsDir, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '歌词文件不存在' });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
});


app.get('/admin/songs', adminAuth, (req, res) => {
    res.json(readPlaylist());
});


app.post('/admin/batch-upload', adminAuth, batchUpload, async (req, res) => {
    try {
        console.log('批量上传请求到达');
        const audioFiles = req.files['audio'] || [];
        const lyricFiles = req.files['lyric'] || [];
        const coverFiles = req.files['cover'] || [];

        if (audioFiles.length === 0) {
            return res.status(400).json({ error: '至少需要上传一个音频文件' });
        }


        const lyricMap = {};
        lyricFiles.forEach(file => {
            const base = getSmartBaseName(file.originalname);
            lyricMap[base] = file;
        });
        const coverMap = {};
        coverFiles.forEach(file => {
            const base = getSmartBaseName(file.originalname);
            coverMap[base] = file;
        });

        const results = [];
        const errors = [];

        for (const audio of audioFiles) {
            try {
                const audioBase = getSmartBaseName(audio.originalname);

                let metadata = { title: '', artist: '' };
                let duration = 0;
                try {
                    const info = await parseFile(audio.path);
                    if (info.common.title) metadata.title = info.common.title;
                    if (info.common.artist) metadata.artist = info.common.artist;
                    duration = Math.round(info.format.duration || 0);
                } catch (err) {
                    console.warn('元数据解析失败，使用文件名提取:', audio.originalname);
                }
                if (!metadata.title || !metadata.artist) {
                    const extracted = extractArtistTitle(toUtf8(audio.originalname));
                    if (!metadata.title) metadata.title = extracted.title;
                    if (!metadata.artist) metadata.artist = extracted.artist;
                }

                const matchedLyric = lyricMap[audioBase];
                const matchedCover = coverMap[audioBase];

                const newSong = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
                    title: metadata.title,
                    artist: metadata.artist,
                    duration: duration,
                    filename: audio.filename,
                    filepath: `/songs/${audio.filename}`,
                    originalname: toUtf8(audio.originalname),
                    lyricFilepath: matchedLyric ? `/lyrics/${matchedLyric.filename}` : null,
                    coverFilepath: matchedCover ? `/covers/${matchedCover.filename}` : null
                };

                const list = readPlaylist();
                list.push(newSong);
                writePlaylist(list);

                if (matchedLyric) {
                    const lyricsList = readLyrics();
                    lyricsList.push({
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
                        filename: matchedLyric.filename,
                        originalname: toUtf8(matchedLyric.originalname),
                        filepath: `/lyrics/${matchedLyric.filename}`,
                        uploaded: new Date().toISOString()
                    });
                    writeLyrics(lyricsList);
                }

                results.push(newSong);
            } catch (err) {
                console.error('处理音频失败:', audio.originalname, err);
                errors.push({ file: audio.originalname, error: err.message });
            }
        }

        if (results.length === 0 && errors.length > 0) {
            return res.status(500).json({ error: '所有文件上传失败', details: errors });
        }

        res.status(201).json({ uploaded: results, errors });
    } catch (err) {
        console.error('批量上传路由错误:', err);
        res.status(500).json({ error: '服务器内部错误: ' + err.message });
    }
});


app.post('/admin/songs', adminAuth, uploadAudioSingle, async (req, res) => {
    try {
        const files = req.files || [];
        if (files.length === 0) return res.status(400).json({ error: '没有音频文件' });
        const results = [];
        for (const file of files) {
            let metadata = { title: '', artist: '' };
            let duration = 0;
            try {
                const info = await parseFile(file.path);
                if (info.common.title) metadata.title = info.common.title;
                if (info.common.artist) metadata.artist = info.common.artist;
                duration = Math.round(info.format.duration || 0);
            } catch (err) {}
            const utf8Name = toUtf8(file.originalname);
            const extracted = extractArtistTitle(utf8Name);
            if (!metadata.title) metadata.title = extracted.title;
            if (!metadata.artist) metadata.artist = extracted.artist;
            const list = readPlaylist();
            list.push({
                id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
                title: metadata.title,
                artist: metadata.artist,
                duration: duration,
                filename: file.filename,
                filepath: `/songs/${file.filename}`,
                originalname: utf8Name,
                lyricFilepath: null,
                coverFilepath: null
            });
            writePlaylist(list);
            results.push({ title: metadata.title });
        }
        res.status(201).json({ uploaded: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.post('/admin/songs/:id/cover', adminAuth, uploadCover, async (req, res) => {
    try {
        const id = req.params.id;
        if (!req.file) return res.status(400).json({ error: '没有封面文件' });
        const list = readPlaylist();
        const idx = list.findIndex(s => s.id === id);
        if (idx === -1) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: '歌曲不存在' });
        }
        const old = list[idx].coverFilepath;
        if (old) {
            const oldPath = path.join(coversDir, path.basename(old));
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        const coverPath = `/covers/${req.file.filename}`;
        list[idx].coverFilepath = coverPath;
        writePlaylist(list);
        res.json({ success: true, coverFilepath: coverPath });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.post('/admin/songs/:id/lyric', adminAuth, uploadLyricSingle, async (req, res) => {
    try {
        const id = req.params.id;
        if (!req.file) return res.status(400).json({ error: '没有歌词文件' });
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!['.lrc', '.txt'].includes(ext)) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: '仅支持 .lrc 或 .txt' });
        }
        const list = readPlaylist();
        const idx = list.findIndex(s => s.id === id);
        if (idx === -1) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: '歌曲不存在' });
        }
        const old = list[idx].lyricFilepath;
        if (old) {
            const oldPath = path.join(lyricsDir, path.basename(old));
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        const lyricPath = `/lyrics/${req.file.filename}`;
        list[idx].lyricFilepath = lyricPath;
        writePlaylist(list);

        const lyricsList = readLyrics();
        lyricsList.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
            filename: req.file.filename,
            originalname: toUtf8(req.file.originalname),
            filepath: lyricPath,
            uploaded: new Date().toISOString()
        });
        writeLyrics(lyricsList);

        res.json({ success: true, lyricFilepath: lyricPath });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/admin/songs/:id', adminAuth, (req, res) => {
    try {
        const list = readPlaylist();
        const idx = list.findIndex(s => s.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: '歌曲不存在' });
        const song = list[idx];
        const audioPath = path.join(songsDir, song.filename);
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        if (song.coverFilepath) {
            const coverPath = path.join(coversDir, path.basename(song.coverFilepath));
            if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
        }
        if (song.lyricFilepath) {
            const lyricPath = path.join(lyricsDir, path.basename(song.lyricFilepath));
            if (fs.existsSync(lyricPath)) fs.unlinkSync(lyricPath);
            const lyricsList = readLyrics();
            const lIdx = lyricsList.findIndex(l => l.filepath === song.lyricFilepath);
            if (lIdx !== -1) lyricsList.splice(lIdx, 1);
            writeLyrics(lyricsList);
        }
        list.splice(idx, 1);
        writePlaylist(list);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/admin/songs/batch', adminAuth, (req, res) => {
    try {
        const ids = req.body.ids;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '请提供要删除的歌曲ID数组' });
        }
        const list = readPlaylist();
        const toDelete = [];
        const remaining = [];
        list.forEach(song => {
            if (ids.includes(song.id)) toDelete.push(song);
            else remaining.push(song);
        });
        if (toDelete.length === 0) return res.status(404).json({ error: '没有找到要删除的歌曲' });
        toDelete.forEach(song => {
            const audioPath = path.join(songsDir, song.filename);
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            if (song.coverFilepath) {
                const coverPath = path.join(coversDir, path.basename(song.coverFilepath));
                if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
            }
            if (song.lyricFilepath) {
                const lyricPath = path.join(lyricsDir, path.basename(song.lyricFilepath));
                if (fs.existsSync(lyricPath)) fs.unlinkSync(lyricPath);
                const lyricsList = readLyrics();
                const lIdx = lyricsList.findIndex(l => l.filepath === song.lyricFilepath);
                if (lIdx !== -1) lyricsList.splice(lIdx, 1);
                writeLyrics(lyricsList);
            }
        });
        writePlaylist(remaining);
        res.json({ success: true, deleted: toDelete.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get('/admin/lyrics', adminAuth, (req, res) => {
    res.json(readLyrics());
});
app.post('/admin/lyrics', adminAuth, uploadAudioSingle, async (req, res) => {
    try {
        const files = req.files || [];
        if (files.length === 0) return res.status(400).json({ error: '没有歌词文件' });
        const results = [];
        for (const file of files) {
            const ext = path.extname(file.originalname).toLowerCase();
            if (!['.lrc', '.txt'].includes(ext)) {
                fs.unlinkSync(file.path);
                continue;
            }
            const list = readLyrics();
            list.push({
                id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
                filename: file.filename,
                originalname: toUtf8(file.originalname),
                filepath: `/lyrics/${file.filename}`,
                uploaded: new Date().toISOString()
            });
            writeLyrics(list);
            results.push({ filename: file.filename });
        }
        res.status(201).json({ uploaded: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/admin/lyrics/:id', adminAuth, (req, res) => {
    try {
        const list = readLyrics();
        const idx = list.findIndex(l => l.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: '歌词不存在' });
        const lyric = list[idx];
        const filePath = path.join(lyricsDir, lyric.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        list.splice(idx, 1);
        writeLyrics(list);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/songs', express.static(songsDir));
app.use('/lyrics', express.static(lyricsDir));
app.use('/covers', express.static(coversDir));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务器运行在 http://0.0.0.0:${PORT}`);
    console.log(`管理员密码: ${ADMIN_PASSWORD}`);
});