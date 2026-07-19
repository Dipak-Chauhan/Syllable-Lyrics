(function (root, factory) {
    'use strict';

    var api = factory(root);

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.MediaMonkeySyllableLyricsCore = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    var DEFAULT_KPOE_SERVERS = [
        'https://lyricsplus.binimum.org',
        'https://lyricsplus.prjktla.my.id',
        'https://lyricsplus.prjktla.workers.dev'
    ];
    var REQUEST_TIMEOUT_MS = 8000;
    var MAX_CACHE_ENTRIES = 100;
    var cache = new Map();
    var lastWorkingKpoeServer = null;

    function numberOr(value, fallback) {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function cleanText(value) {
        return typeof value === 'string' ? value : '';
    }

    function remember(key, value) {
        if (!value) {
            return;
        }
        if (cache.has(key)) {
            cache.delete(key);
        }
        cache.set(key, value);
        while (cache.size > MAX_CACHE_ENTRIES) {
            cache.delete(cache.keys().next().value);
        }
    }

    function parseClock(value) {
        var text = String(value || '').trim().replace(/^[<[]|[>\]]$/g, '');
        if (!text) {
            return 0;
        }

        if (/ms$/i.test(text)) {
            return Math.max(0, Math.round(numberOr(text.replace(/ms$/i, ''), 0)));
        }

        if (/s$/i.test(text)) {
            return Math.max(0, Math.round(numberOr(text.replace(/s$/i, ''), 0) * 1000));
        }

        var parts = text.split(':').map(function (part) {
            return numberOr(part.replace(',', '.'), 0);
        });
        var seconds = 0;

        if (parts.length === 3) {
            seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            seconds = parts[0] * 60 + parts[1];
        } else {
            seconds = parts[0];
        }

        return Math.max(0, Math.round(seconds * 1000));
    }

    function normalizeType(type, lines) {
        var normalized = String(type || '').toLowerCase();
        if (normalized === 'word' || normalized === 'syllable' || normalized === 'richsync') {
            return 'word';
        }
        if (normalized === 'plain' || normalized === 'none') {
            return 'plain';
        }
        if (normalized === 'line' || normalized === 'linesync') {
            return 'line';
        }
        return lines.some(function (line) {
            return line.syllables && line.syllables.length > 0;
        }) ? 'word' : 'line';
    }

    function finalizeLyrics(value) {
        if (!value || !Array.isArray(value.lines) || value.lines.length === 0) {
            return null;
        }

        var lines = value.lines.map(function (line) {
            var startMs = Math.max(0, numberOr(line.startMs, 0));
            var endMs = Math.max(startMs, numberOr(line.endMs, 0));
            var syllables = Array.isArray(line.syllables) ? line.syllables.map(function (syllable) {
                var syllableStart = Math.max(0, numberOr(syllable.startMs, startMs));
                var syllableEnd = Math.max(syllableStart, numberOr(syllable.endMs, 0));
                var normalizedSyllable = {
                    text: cleanText(syllable.text),
                    startMs: syllableStart,
                    endMs: syllableEnd,
                    isBackground: Boolean(syllable.isBackground)
                };
                var romanizedText = cleanText(syllable.romanizedText);
                if (romanizedText) {
                    normalizedSyllable.romanizedText = romanizedText;
                }
                return normalizedSyllable;
            }).filter(function (syllable) {
                return syllable.text.length > 0;
            }).sort(function (a, b) {
                return a.startMs - b.startMs;
            }) : [];

            var normalizedLine = {
                text: cleanText(line.text) || syllables.map(function (syllable) {
                    return syllable.text;
                }).join('').trim(),
                startMs: startMs,
                endMs: endMs,
                syllables: syllables,
                singer: cleanText(line.singer)
            };
            var romanizedText = cleanText(line.romanizedText);
            if (romanizedText) {
                normalizedLine.romanizedText = romanizedText;
            }
            return normalizedLine;
        }).filter(function (line) {
            return line.text.trim() || line.syllables.length > 0;
        }).sort(function (a, b) {
            return a.startMs - b.startMs;
        });

        if (lines.length === 0) {
            return null;
        }

        lines.forEach(function (line, lineIndex) {
            var nextLine = lines[lineIndex + 1];
            if (line.endMs <= line.startMs) {
                line.endMs = nextLine ? Math.max(line.startMs + 100, nextLine.startMs) : line.startMs + 5000;
            }

            line.syllables.forEach(function (syllable, syllableIndex) {
                if (syllable.endMs <= syllable.startMs) {
                    var nextSyllable = line.syllables[syllableIndex + 1];
                    syllable.endMs = nextSyllable && nextSyllable.startMs > syllable.startMs
                        ? nextSyllable.startMs
                        : line.endMs;
                }
                line.endMs = Math.max(line.endMs, syllable.endMs);
            });
        });

        return {
            type: normalizeType(value.type, lines),
            lines: lines,
            source: cleanText(value.source) || 'Unknown',
            metadata: value.metadata || {}
        };
    }

    function parseLrc(text, source) {
        if (!text || typeof text !== 'string') {
            return null;
        }

        var offsetMatch = /^\s*\[offset:([+-]?\d+)\]\s*$/im.exec(text);
        var offsetMs = offsetMatch ? numberOr(offsetMatch[1], 0) : 0;
        var linePrefix = /^\s*((?:\[\d{1,3}:\d{2}(?:[.,:]\d{1,3})?\])+)[ \t]*(.*)$/;
        var lineTag = /\[(\d{1,3}):(\d{2}(?:[.,:]\d{1,3})?)\]/g;
        var wordTag = /<(\d{1,3}):(\d{2}(?:[.,:]\d{1,3})?)>/g;
        var lines = [];
        var hasWordTiming = false;

        function parseLrcClock(minutes, seconds) {
            return Math.max(0, Math.round(
                numberOr(minutes, 0) * 60000
                + numberOr(String(seconds).replace(/[,:]/, '.'), 0) * 1000
                + offsetMs
            ));
        }

        text.split(/\r?\n/).forEach(function (rawLine) {
            var match = linePrefix.exec(rawLine);
            if (!match) {
                return;
            }

            var content = match[2] || '';
            var timestamps = Array.from(match[1].matchAll(lineTag));
            timestamps.forEach(function (timestamp) {
                var lineStart = parseLrcClock(timestamp[1], timestamp[2]);
                var matches = Array.from(content.matchAll(wordTag));
                var syllables = [];
                var visibleText = content;

                if (matches.length > 0) {
                    hasWordTiming = true;
                    visibleText = '';

                    if (matches[0].index > 0) {
                        var leadingText = content.slice(0, matches[0].index);
                        syllables.push({
                            text: leadingText,
                            startMs: lineStart,
                            endMs: 0
                        });
                        visibleText += leadingText;
                    }

                    matches.forEach(function (wordMatch, index) {
                        var segmentStart = wordMatch.index + wordMatch[0].length;
                        var segmentEnd = index + 1 < matches.length ? matches[index + 1].index : content.length;
                        var segmentText = content.slice(segmentStart, segmentEnd);
                        if (!segmentText) {
                            return;
                        }
                        syllables.push({
                            text: segmentText,
                            startMs: parseLrcClock(wordMatch[1], wordMatch[2]),
                            endMs: 0
                        });
                        visibleText += segmentText;
                    });
                }

                if (!visibleText.trim() || /^[\u266a\u266b]+$/.test(visibleText.trim())) {
                    return;
                }

                lines.push({
                    text: visibleText,
                    startMs: lineStart,
                    endMs: 0,
                    syllables: syllables
                });
            });
        });

        if (lines.length > 0) {
            return finalizeLyrics({
                type: hasWordTiming ? 'word' : 'line',
                lines: lines,
                source: source || 'Embedded lyrics'
            });
        }

        var plainLines = text.split(/\r?\n/).map(function (line) {
            return line.trim();
        }).filter(function (line) {
            return line && !/^\[[a-zA-Z#][^\]]*:.*\]$/.test(line);
        }).map(function (line) {
            return { text: line, startMs: 0, endMs: 0, syllables: [] };
        });

        return plainLines.length > 0 ? {
            type: 'plain',
            lines: plainLines,
            source: source || 'Embedded lyrics',
            metadata: {}
        } : null;
    }

    function parseKpoe(data) {
        if (!data || !Array.isArray(data.lyrics) || data.lyrics.length === 0) {
            return null;
        }

        return finalizeLyrics({
            type: data.type,
            source: data.metadata && data.metadata.source ? String(data.metadata.source) : 'Lyrics+',
            metadata: data.metadata || {},
            lines: data.lyrics.map(function (line) {
                var startMs = Math.max(0, numberOr(line.time, 0));
                var durationMs = Math.max(0, numberOr(line.duration, 0));
                var sourceSyllables = Array.isArray(line.syllabus) ? line.syllabus : [];
                var transliteration = line.transliteration || {};
                var transliteratedSyllables = Array.isArray(transliteration.syllabus)
                    && transliteration.syllabus.length === sourceSyllables.length
                    ? transliteration.syllabus
                    : null;
                return {
                    text: cleanText(line.text),
                    romanizedText: cleanText(line.romanizedText) || cleanText(transliteration.text),
                    startMs: startMs,
                    endMs: startMs + durationMs,
                    singer: line.element && line.element.singer,
                    syllables: sourceSyllables.map(function (syllable, index) {
                        var syllableStart = Math.max(0, numberOr(syllable.time, startMs));
                        return {
                            text: cleanText(syllable.text),
                            romanizedText: cleanText(syllable.romanizedText)
                                || cleanText(transliteratedSyllables
                                    && transliteratedSyllables[index]
                                    && transliteratedSyllables[index].text),
                            startMs: syllableStart,
                            endMs: syllableStart + Math.max(0, numberOr(syllable.duration, 0)),
                            isBackground: syllable.isBackground
                        };
                    })
                };
            })
        });
    }

    function getAttribute(element, names) {
        for (var index = 0; index < names.length; index += 1) {
            var value = element.getAttribute(names[index]);
            if (value !== null && value !== '') {
                return value;
            }
        }
        return '';
    }

    function isBackgroundSpan(span, paragraph) {
        var current = span.parentNode;
        while (current && current !== paragraph) {
            if (current.getAttribute) {
                var role = getAttribute(current, ['ttm:role', 'role']);
                if (role === 'x-bg') {
                    return true;
                }
            }
            current = current.parentNode;
        }
        return false;
    }

    function getDescendants(element, localName) {
        var nodes = [];
        if (element && typeof element.getElementsByTagNameNS === 'function') {
            nodes = Array.from(element.getElementsByTagNameNS('*', localName));
        }
        if (nodes.length === 0 && element && typeof element.getElementsByTagName === 'function') {
            nodes = Array.from(element.getElementsByTagName(localName));
        }
        return nodes;
    }

    function parseTtml(text, source) {
        var Parser = root && root.DOMParser;
        if (!text || typeof Parser !== 'function') {
            return null;
        }

        var documentNode = new Parser().parseFromString(text, 'application/xml');
        if (!documentNode || getDescendants(documentNode, 'parsererror').length > 0) {
            return null;
        }

        var paragraphs = getDescendants(documentNode, 'p');
        var foundWordTiming = false;
        var foundLineTiming = false;
        var lines = paragraphs.map(function (paragraph) {
            var timedSpans = getDescendants(paragraph, 'span').filter(function (span) {
                if (!getAttribute(span, ['begin'])) {
                    return false;
                }
                return !getDescendants(span, 'span').some(function (child) {
                    return Boolean(getAttribute(child, ['begin']));
                });
            });
            var syllables = [];

            timedSpans.forEach(function (span) {
                var directText = Array.from(span.childNodes).filter(function (node) {
                    return node.nodeType === 3;
                }).map(function (node) {
                    return node.nodeValue || '';
                }).join('');
                var spanText = directText || span.textContent || '';
                var trailingNode = span.nextSibling;
                if (trailingNode && trailingNode.nodeType === 3 && /^\s+$/.test(trailingNode.nodeValue || '')) {
                    spanText += trailingNode.nodeValue;
                }
                if (!spanText) {
                    return;
                }

                var startMs = parseClock(getAttribute(span, ['begin']));
                var endMs = parseClock(getAttribute(span, ['end']));
                var durationMs = parseClock(getAttribute(span, ['dur']));
                if (!endMs && durationMs) {
                    endMs = startMs + durationMs;
                }
                syllables.push({
                    text: spanText,
                    startMs: startMs,
                    endMs: endMs,
                    isBackground: isBackgroundSpan(span, paragraph)
                });
            });

            if (syllables.length > 0) {
                foundWordTiming = true;
            }

            var paragraphStart = parseClock(getAttribute(paragraph, ['begin']));
            var paragraphEnd = parseClock(getAttribute(paragraph, ['end']));
            var paragraphDuration = parseClock(getAttribute(paragraph, ['dur']));
            if (!paragraphEnd && paragraphDuration) {
                paragraphEnd = paragraphStart + paragraphDuration;
            }
            if (getAttribute(paragraph, ['begin', 'end', 'dur'])) {
                foundLineTiming = true;
            }
            if (!paragraphStart && syllables.length > 0) {
                paragraphStart = Math.min.apply(null, syllables.map(function (syllable) {
                    return syllable.startMs;
                }));
            }
            if (!paragraphEnd && syllables.length > 0) {
                paragraphEnd = Math.max.apply(null, syllables.map(function (syllable) {
                    return syllable.endMs;
                }));
            }

            return {
                text: (paragraph.textContent || '').trim(),
                startMs: paragraphStart,
                endMs: paragraphEnd,
                singer: getAttribute(paragraph, ['ttm:agent', 'agent']),
                syllables: syllables
            };
        }).filter(function (line) {
            return line.text || line.syllables.length > 0;
        });

        var rootElement = documentNode.documentElement;
        return finalizeLyrics({
            type: foundWordTiming ? 'word' : foundLineTiming ? 'line' : 'plain',
            lines: lines,
            source: source || 'Unison',
            metadata: {
                language: rootElement ? getAttribute(rootElement, ['xml:lang', 'lang']) : ''
            }
        });
    }

    function parseLyricsText(text, source) {
        if (!text || typeof text !== 'string') {
            return null;
        }
        if (/<(?:[a-zA-Z_][\w.-]*:)?tt(?:\s|>)/i.test(text)) {
            return parseTtml(text, source);
        }
        return parseLrc(text, source);
    }

    function parseUnison(data) {
        var payload = data && data.success ? data.data : data;
        if (!payload || !payload.lyrics) {
            return null;
        }

        var format = String(payload.format || '').toLowerCase();
        if (format === 'ttml') {
            return parseTtml(payload.lyrics, 'Unison');
        }
        return parseLrc(payload.lyrics, 'Unison');
    }

    function parseLrclib(data) {
        if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
            return null;
        }
        var parsed = parseLrc(data.syncedLyrics || data.plainLyrics, 'LRCLIB');
        if (parsed) {
            parsed.metadata = {
                title: cleanText(data.trackName),
                artist: cleanText(data.artistName),
                album: cleanText(data.albumName),
                duration: numberOr(data.duration, 0)
            };
        }
        return parsed;
    }

    function containsNonLatinText(text) {
        return /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(cleanText(text));
    }

    function hasRomanization(lyrics) {
        return Boolean(lyrics && Array.isArray(lyrics.lines) && lyrics.lines.some(function (line) {
            return cleanText(line.romanizedText).trim()
                || line.syllables.some(function (syllable) {
                    return cleanText(syllable.romanizedText).trim();
                });
        }));
    }

    function canRomanize(lyrics) {
        return hasRomanization(lyrics)
            || Boolean(lyrics && Array.isArray(lyrics.lines) && lyrics.lines.some(function (line) {
                return containsNonLatinText(line.text)
                    || line.syllables.some(function (syllable) {
                        return containsNonLatinText(syllable.text);
                    });
            }));
    }

    function parseRomanizationResponse(data, originalTexts) {
        var segments = data && Array.isArray(data[0]) ? data[0] : [];
        var combined = segments.map(function (segment) {
            return Array.isArray(segment) ? cleanText(segment[3]) || cleanText(segment[0]) : '';
        }).join('');
        if (!combined) {
            return originalTexts;
        }

        var values = combined.replace(/\s*\|\s*/g, '|').split('|');
        if (values.length !== originalTexts.length) {
            return originalTexts.length === 1 ? [combined] : originalTexts;
        }
        return values.map(function (value, index) {
            var original = originalTexts[index];
            var leadingSpace = /^\s+/.exec(original);
            var trailingSpace = /\s+$/.exec(original);
            var romanized = (value || original).trim();
            return (leadingSpace ? leadingSpace[0] : '')
                + romanized
                + (trailingSpace ? trailingSpace[0] : '');
        });
    }

    async function romanizeTexts(texts, options) {
        var uniqueTexts = [];
        var queued = new Set();
        texts.forEach(function (text) {
            if (containsNonLatinText(text) && !queued.has(text)) {
                queued.add(text);
                uniqueTexts.push(text);
            }
        });

        var generated = new Map();
        var batches = [];
        var batch = [];
        var batchLength = 0;
        uniqueTexts.forEach(function (text) {
            if (batch.length >= 40 || (batch.length > 0 && batchLength + text.length > 1200)) {
                batches.push(batch);
                batch = [];
                batchLength = 0;
            }
            batch.push(text);
            batchLength += text.length + 1;
        });
        if (batch.length > 0) {
            batches.push(batch);
        }

        for (var index = 0; index < batches.length; index += 1) {
            var currentBatch = batches[index];
            var params = new URLSearchParams({
                client: 'gtx',
                sl: 'auto',
                tl: 'en',
                dt: 'rm',
                q: currentBatch.join('|')
            });
            var data = await fetchJson(
                options.fetchImpl,
                'https://translate.googleapis.com/translate_a/single?' + params.toString(),
                options
            );
            var values = parseRomanizationResponse(data, currentBatch);
            currentBatch.forEach(function (text, batchIndex) {
                if (values[batchIndex] && values[batchIndex] !== text) {
                    generated.set(text, values[batchIndex]);
                }
            });
        }
        return generated;
    }

    async function romanizeLyrics(lyrics, options) {
        options = options || {};
        if (!lyrics || !Array.isArray(lyrics.lines) || typeof options.fetchImpl !== 'function') {
            return lyrics;
        }
        options.timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;

        var texts = [];
        lyrics.lines.forEach(function (line) {
            if (line.syllables.length > 0) {
                line.syllables.forEach(function (syllable) {
                    if (!cleanText(syllable.romanizedText)) {
                        texts.push(syllable.text);
                    }
                });
            } else if (!cleanText(line.romanizedText)) {
                texts.push(line.text);
            }
        });
        var generated = await romanizeTexts(texts, options);

        var lines = lyrics.lines.map(function (line) {
            var syllables = line.syllables.map(function (syllable) {
                var copy = Object.assign({}, syllable);
                var romanizedText = cleanText(syllable.romanizedText)
                    || generated.get(syllable.text)
                    || '';
                if (romanizedText) {
                    copy.romanizedText = romanizedText;
                }
                return copy;
            });
            var copy = Object.assign({}, line, { syllables: syllables });
            var lineRomanization = cleanText(line.romanizedText);
            if (!lineRomanization && syllables.length > 0
                && syllables.some(function (syllable) { return cleanText(syllable.romanizedText); })) {
                lineRomanization = syllables.map(function (syllable) {
                    return cleanText(syllable.romanizedText) || syllable.text;
                }).join('').trim();
            }
            if (!lineRomanization) {
                lineRomanization = generated.get(line.text) || '';
            }
            if (lineRomanization) {
                copy.romanizedText = lineRomanization;
            }
            return copy;
        });
        return Object.assign({}, lyrics, { lines: lines });
    }

    async function fetchJson(fetchImpl, url, options) {
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = controller ? setTimeout(function () {
            controller.abort();
        }, options.timeoutMs || REQUEST_TIMEOUT_MS) : null;

        try {
            var response = await fetchImpl(url, {
                cache: options.forceReload ? 'no-store' : 'default',
                signal: controller ? controller.signal : undefined
            });
            if (!response || !response.ok) {
                return null;
            }
            return await response.json();
        } catch (error) {
            return null;
        } finally {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
    }

    function createSearchParams(song, kpoe) {
        var params = new URLSearchParams();
        params.set(kpoe ? 'title' : 'song', song.title || '');
        params.set('artist', song.artist || '');
        if (song.album) {
            params.set('album', song.album);
        }
        if (song.duration > 0) {
            params.set('duration', String(song.duration));
        }
        if (kpoe && song.isrc) {
            params.set('isrc', song.isrc);
        }
        return params;
    }

    async function fetchKpoe(song, options) {
        var servers = (options.kpoeServers || DEFAULT_KPOE_SERVERS).slice();
        if (lastWorkingKpoeServer && servers.indexOf(lastWorkingKpoeServer) !== -1) {
            servers = [lastWorkingKpoeServer].concat(servers.filter(function (server) {
                return server !== lastWorkingKpoeServer;
            }));
        }

        var params = createSearchParams(song, true);
        if (options.forceReload) {
            params.set('forceReload', 'true');
        }

        var deadline = Date.now() + options.timeoutMs;
        for (var index = 0; index < servers.length; index += 1) {
            var server = servers[index].replace(/\/$/, '');
            var remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                break;
            }
            var requestOptions = Object.assign({}, options, {
                timeoutMs: Math.max(1, Math.floor(remainingMs / (servers.length - index)))
            });
            var data = await fetchJson(options.fetchImpl, server + '/v2/lyrics/get?' + params.toString(), requestOptions);
            var parsed = parseKpoe(data);
            if (parsed) {
                lastWorkingKpoeServer = servers[index];
                return parsed;
            }
        }
        return null;
    }

    async function fetchUnison(song, options) {
        var data = await fetchJson(
            options.fetchImpl,
            'https://unison.boidu.dev/lyrics?' + createSearchParams(song, false).toString(),
            options
        );
        return parseUnison(data);
    }

    async function fetchLrclib(song, options) {
        var params = new URLSearchParams({
            track_name: song.title || '',
            artist_name: song.artist || ''
        });
        if (song.album) {
            params.set('album_name', song.album);
        }
        if (song.duration > 0) {
            params.set('duration', String(song.duration));
        }
        var data = await fetchJson(options.fetchImpl, 'https://lrclib.net/api/get?' + params.toString(), options);
        return parseLrclib(data);
    }

    function scoreLyrics(lyrics) {
        if (!lyrics || !Array.isArray(lyrics.lines) || lyrics.lines.length === 0) {
            return 0;
        }
        if (lyrics.type === 'word') {
            return 3;
        }
        if (lyrics.type === 'line') {
            return 2;
        }
        return 1;
    }

    function cacheKey(song) {
        return [song.title, song.artist, song.album, Math.round(numberOr(song.duration, 0))]
            .map(function (part) { return String(part || '').trim().toLowerCase(); })
            .join('|');
    }

    async function findLyrics(song, embeddedText, options) {
        options = options || {};
        options.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        options.timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;

        var key = cacheKey(song);
        var embedded = parseLyricsText(embeddedText, 'Embedded lyrics');
        var best = embedded;
        if (!options.forceReload && cache.has(key) && scoreLyrics(cache.get(key)) > scoreLyrics(best)) {
            best = cache.get(key);
        }

        if (scoreLyrics(best) === 3 || options.online === false || !options.fetchImpl) {
            remember(key, best);
            return best;
        }

        var providers = [fetchKpoe, fetchUnison, fetchLrclib];
        var results = await Promise.all(providers.map(function (provider) {
            return provider(song, options).catch(function () {
                return null;
            });
        }));
        for (var index = 0; index < providers.length; index += 1) {
            var result = results[index];
            if (scoreLyrics(result) > scoreLyrics(best)) {
                best = result;
            }
        }

        remember(key, best);
        return best;
    }

    function clearCache() {
        cache.clear();
    }

    return {
        clearCache: clearCache,
        canRomanize: canRomanize,
        findLyrics: findLyrics,
        hasRomanization: hasRomanization,
        parseKpoe: parseKpoe,
        parseLrc: parseLrc,
        parseLrclib: parseLrclib,
        parseLyricsText: parseLyricsText,
        romanizeLyrics: romanizeLyrics
    };
});
