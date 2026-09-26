/**
 * Split a raw lyric line into its primary and secondary parts.
 * @param {string} text Raw lyric line, possibly containing a dual-language separator.
 * @returns {{primary: string, secondary: string, isDual: boolean}} Primary text, secondary text, and whether the line was detected as dual.
 */
export function splitDualLyric(text) {
    let primary = text, secondary = '', isDual = false;
    let parts = text.split(/\s*\/\s*/);
    if (parts.length >= 2) {
        primary = parts[0].trim();
        secondary = parts.slice(1).join(' / ').trim();
        isDual = true;
    } else {
        parts = text.split(/\s*\|\s*/);
        if (parts.length >= 2) {
            primary = parts[0].trim();
            secondary = parts.slice(1).join(' | ').trim();
            isDual = true;
        } else {
            const matchBracket = text.match(/^(.+?)\s*[〈（(]\s*(.+?)\s*[〉）)]\s*$/);
            if (matchBracket) {
                primary = matchBracket[1].trim();
                secondary = matchBracket[2].trim();
                isDual = true;
            } else {
                const matchParen = text.match(/^(.+?)\s*\(\s*(.+?)\s*\)\s*$/);
                if (matchParen) {
                    primary = matchParen[1].trim();
                    secondary = matchParen[2].trim();
                    isDual = true;
                }
            }
        }
    }
    if (!primary || !secondary) return { primary: text, secondary: '', isDual: false };
    return { primary, secondary, isDual };
}

/**
 * Parse a full LRC-style lyrics document into timed entries plus metadata.
 * @param {string} text Raw lyrics document, one line per lyric with optional [mm:ss.xx] timestamps.
 * @returns {{lyrics: Array<{time: number, primary: string, secondary: string, isDual: boolean, text: string}>, meta: Object}} Sorted lyric entries and extracted metadata.
 */
export function parseLyrics(text) {
    const lines = text.split(/\r?\n/);
    const result = [];
    const meta = {};
    const metaRegex = /^\[(ti|ar|al|by|offset|re|ve|length)\s*:\s*(.+)\]$/i;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const metaMatch = line.match(metaRegex);
        if (metaMatch) {
            meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
            continue;
        }
        const timeRegex = /\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\]/g;
        let tempMatch;
        const timeMatches = [];
        while ((tempMatch = timeRegex.exec(line)) !== null) {
            const min = parseInt(tempMatch[1]), sec = parseInt(tempMatch[2]);
            const ms = tempMatch[3] ? parseInt(tempMatch[3].padEnd(3, '0')) : 0;
            const totalSec = min * 60 + sec + ms / 1000;
            timeMatches.push({ time: totalSec, index: tempMatch.index, end: tempMatch.index + tempMatch[0].length });
        }
        if (timeMatches.length > 0) {
            let lyricText = line;
            for (let i = timeMatches.length - 1; i >= 0; i--) {
                const m = timeMatches[i];
                lyricText = lyricText.slice(0, m.index) + lyricText.slice(m.end);
            }
            lyricText = lyricText.trim();
            if (lyricText) {
                const split = splitDualLyric(lyricText);
                for (const tm of timeMatches) {
                    result.push({
                        time: tm.time,
                        primary: split.primary,
                        secondary: split.secondary,
                        isDual: split.isDual,
                        text: lyricText
                    });
                }
            }
        } else {
            if (line.trim()) {
                const split = splitDualLyric(line.trim());
                result.push({
                    time: -1,
                    primary: split.primary,
                    secondary: split.secondary,
                    isDual: split.isDual,
                    text: line.trim()
                });
            }
        }
    }
    result.sort((a, b) => a.time - b.time);
    return { lyrics: result, meta };
}
