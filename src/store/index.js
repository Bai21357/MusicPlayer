'use strict';

const config = require('../config');
const { JsonFileStore } = require('./jsonFileStore');

/** 歌曲列表（playlist.json）。 */
const playlistStore = new JsonFileStore(config.playlistFile);

/** 歌词元数据（lyrics.json）。 */
const lyricsStore = new JsonFileStore(config.lyricsFile);

module.exports = { playlistStore, lyricsStore };
