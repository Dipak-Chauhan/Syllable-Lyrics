'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('@xmldom/xmldom');

global.DOMParser = DOMParser;
const core = require('../lib/lyricsCore');

test.beforeEach(() => {
    core.clearCache();
});

test('parses enhanced LRC into normalized word timing', () => {
    const lyrics = core.parseLrc([
        '[00:10.00]<00:10.00>Sing <00:10.50>now',
        '[00:12.00]Again'
    ].join('\n'), 'fixture');

    assert.equal(lyrics.type, 'word');
    assert.equal(lyrics.source, 'fixture');
    assert.equal(lyrics.lines[0].text, 'Sing now');
    assert.equal(lyrics.lines[0].endMs, lyrics.lines[1].startMs);
    assert.deepEqual(lyrics.lines[0].syllables, [
        { text: 'Sing ', startMs: 10000, endMs: 10500, isBackground: false },
        { text: 'now', startMs: 10500, endMs: 12000, isBackground: false }
    ]);
});

test('supports LRC offsets, colon fractions, and repeated timestamps', () => {
    const lyrics = core.parseLrc([
        '[offset:+250]',
        '[00:01:50][00:03.00]Echo'
    ].join('\n'));

    assert.equal(lyrics.type, 'line');
    assert.deepEqual(lyrics.lines.map((line) => line.startMs), [1750, 3250]);
    assert.deepEqual(lyrics.lines.map((line) => line.text), ['Echo', 'Echo']);
});

test('falls back to plain embedded lyrics', () => {
    const lyrics = core.parseLrc('[ar:Artist]\nFirst line\nSecond line');

    assert.equal(lyrics.type, 'plain');
    assert.deepEqual(lyrics.lines.map((line) => line.text), ['First line', 'Second line']);
});

test('parses TTML words, duration attributes, singers, and background vocals', () => {
    const lyrics = core.parseLyricsText([
        '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="en">',
        '<body><div><p begin="1s" end="3s" ttm:agent="voice-1">',
        '<span begin="1s" end="1.5s">Hel</span><span begin="1.5s" dur="0.5s">lo </span>',
        '<span ttm:role="x-bg"><span begin="2s" end="2.5s">echo</span></span>',
        '</p></div></body></tt>'
    ].join(''), 'Embedded lyrics');

    assert.equal(lyrics.type, 'word');
    assert.equal(lyrics.metadata.language, 'en');
    assert.equal(lyrics.lines[0].singer, 'voice-1');
    assert.equal(lyrics.lines[0].syllables[1].endMs, 2000);
    assert.equal(lyrics.lines[0].syllables[2].isBackground, true);
});

test('normalizes KPOE timing and background metadata', () => {
    const lyrics = core.parseKpoe({
        type: 'Word',
        metadata: { source: 'KPOE fixture' },
        lyrics: [{
            text: 'Hello',
            time: 1000,
            duration: 900,
            element: { singer: 'lead' },
            transliteration: {
                text: 'Herro',
                syllabus: [{ text: 'He' }, { text: 'rro' }]
            },
            syllabus: [
                { text: 'Hel', time: 1000, duration: 400 },
                { text: 'lo', time: 1400, duration: 500, isBackground: true }
            ]
        }]
    });

    assert.equal(lyrics.type, 'word');
    assert.equal(lyrics.lines[0].endMs, 1900);
    assert.equal(lyrics.lines[0].singer, 'lead');
    assert.equal(lyrics.lines[0].romanizedText, 'Herro');
    assert.equal(lyrics.lines[0].syllables[0].romanizedText, 'He');
    assert.equal(lyrics.lines[0].syllables[1].isBackground, true);
});

test('generates romanized syllables without changing karaoke timing', async () => {
    const lyrics = core.parseKpoe({
        type: 'Word',
        lyrics: [{
            text: '世界',
            time: 1000,
            duration: 1000,
            syllabus: [
                { text: '世 ', time: 1000, duration: 500 },
                { text: '界', time: 1500, duration: 500 }
            ]
        }]
    });
    let requestedUrl = '';

    const romanized = await core.romanizeLyrics(lyrics, {
        fetchImpl: async (url) => {
            requestedUrl = url;
            return response([[['sei|kai', null, null, 'sei|kai']]]);
        }
    });

    assert.match(requestedUrl, /dt=rm/);
    assert.equal(romanized.lines[0].romanizedText, 'sei kai');
    assert.equal(romanized.lines[0].syllables[0].romanizedText, 'sei ');
    assert.equal(romanized.lines[0].syllables[1].romanizedText, 'kai');
    assert.equal(romanized.lines[0].syllables[1].startMs, 1500);
    assert.equal(lyrics.lines[0].syllables[0].romanizedText, undefined);
    assert.equal(core.hasRomanization(romanized), true);
});

test('uses LRCLIB plain lyrics when synchronized lyrics are unavailable', () => {
    const lyrics = core.parseLrclib({
        plainLyrics: 'One\nTwo',
        trackName: 'Track',
        artistName: 'Artist'
    });

    assert.equal(lyrics.type, 'plain');
    assert.equal(lyrics.source, 'LRCLIB');
    assert.deepEqual(lyrics.lines.map((line) => line.text), ['One', 'Two']);
});

test('selects the highest-quality online result and caches it', async () => {
    const requestedUrls = [];
    const song = {
        title: 'A Song',
        artist: 'An Artist',
        album: 'An Album',
        duration: 123.4,
        isrc: 'TEST123'
    };
    const fetchImpl = async (url) => {
        requestedUrls.push(url);
        if (url.includes('unison.boidu.dev')) {
            return response({
                success: true,
                data: {
                    format: 'lrc',
                    lyrics: '[00:01.00]<00:01.00>Word<00:01.50> sync'
                }
            });
        }
        if (url.includes('lrclib.net')) {
            return response({ syncedLyrics: '[00:01.00]Line sync' });
        }
        return response({
            type: 'Line',
            metadata: { source: 'Lyrics+' },
            lyrics: [{ text: 'KPOE line', time: 1000, duration: 1000 }]
        });
    };

    const first = await core.findLyrics(song, '[00:01.00]Embedded line', {
        online: true,
        fetchImpl
    });
    assert.equal(first.type, 'word');
    assert.equal(first.source, 'Unison');
    assert.equal(requestedUrls.length, 3);
    assert.match(requestedUrls.find((url) => url.includes('/v2/lyrics/get')), /title=A\+Song/);
    assert.match(requestedUrls.find((url) => url.includes('/v2/lyrics/get')), /isrc=TEST123/);

    const second = await core.findLyrics(song, '[00:01.00]Embedded line', {
        online: true,
        fetchImpl: async () => {
            throw new Error('cache miss');
        }
    });
    assert.equal(second.type, 'word');
    assert.equal(second.source, 'Unison');
});

test('does not call providers when online lookup is disabled', async () => {
    let calls = 0;
    const lyrics = await core.findLyrics(
        { title: 'Local', artist: 'Only', duration: 10 },
        '[00:01.00]Embedded',
        {
            online: false,
            fetchImpl: async () => {
                calls += 1;
                return response({});
            }
        }
    );

    assert.equal(calls, 0);
    assert.equal(lyrics.source, 'Embedded lyrics');
});

function response(body) {
    return {
        ok: true,
        json: async () => body
    };
}
