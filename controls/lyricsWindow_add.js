(() => {
    'use strict';

    const SETTINGS_KEY = 'mediaMonkeySyllableLyrics_settings';
    const DEFAULT_SETTINGS = {
        enabled: true,
        online: true,
        romanization: false,
        offsetMs: 0,
        smoothScroll: true
    };

    function getSettings() {
        return app.getValue(SETTINGS_KEY, { ...DEFAULT_SETTINGS });
    }

    function storeSettings(settings) {
        app.setValue(SETTINGS_KEY, settings);
        app.notifySettingsChange();
    }

    function createToolButton(id, icon, tip) {
        const wrapper = document.createElement('div');
        wrapper.className = 'noPadding lvHeaderItem';

        const button = document.createElement('div');
        button.dataset.id = id;
        button.dataset.icon = icon;
        button.dataset.tip = tip;
        button.dataset.controlClass = 'ToolButton';
        button.className = 'menuButton toolbutton';
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', tip);
        wrapper.appendChild(button);

        return { wrapper, button };
    }

    function appendTextElement(parent, className, text) {
        const element = document.createElement('div');
        element.className = className;
        element.textContent = text || '';
        parent.appendChild(element);
        return element;
    }

    function containsRtlText(text) {
        return Array.from(text || '').some((character) => {
            const codePoint = character.codePointAt(0);
            return (codePoint >= 0x0590 && codePoint <= 0x08ff)
                || (codePoint >= 0xfb1d && codePoint <= 0xfeff);
        });
    }

    function segmentGraphemes(text) {
        const characters = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
            ? Array.from(new Intl.Segmenter().segment(text || ''), (part) => part.segment)
            : Array.from(text || '');
        const merged = [];
        characters.forEach((character) => {
            if (merged.length > 0 && /^[!?.,;:~…‥。、！？]/.test(character)) {
                merged[merged.length - 1] += character;
            } else {
                merged.push(character);
            }
        });
        return merged;
    }

    function isWhitespaceGrapheme(character) {
        return /^\s+$/.test(character);
    }

    function easeInOut(value) {
        const progress = Math.max(0, Math.min(1, value));
        let parameter = progress;
        for (let iteration = 0; iteration < 4; iteration += 1) {
            const inverse = 1 - parameter;
            const estimate = 3 * inverse * inverse * parameter * 0.42
                + 3 * inverse * parameter * parameter * 0.58
                + parameter * parameter * parameter;
            const derivative = 3 * inverse * inverse * 0.42
                + 6 * inverse * parameter * 0.16
                + 3 * parameter * parameter * 0.42;
            if (derivative < 0.0001) {
                break;
            }
            parameter = Math.max(0, Math.min(1, parameter - (estimate - progress) / derivative));
        }
        return parameter * parameter * (3 - 2 * parameter);
    }

    class SyllableLyricsController {
        constructor(owner, UI, toggleButton, reloadButton, focusButton) {
            this.owner = owner;
            this.UI = UI;
            this.toggleButton = toggleButton;
            this.reloadButton = reloadButton;
            this.focusButton = focusButton;
            this.settings = getSettings();
            this.requestSerial = 0;
            this.trackKey = '';
            this.lyrics = null;
            this.renderedLines = [];
            this.activeLineIndex = -1;
            this.scrollLineIndex = -1;
            this.scrollVelocity = 0;
            this.lastScrollAnimationTimeMs = 0;
            this.scrollFollowUntilMs = 0;
            this.focusOverlay = null;
            this.focusArtwork = null;
            this.focusWindowState = null;
            this.artworkSerial = 0;
            this.artworkPath = '';
            this.romanizationSerial = 0;
            this.romanizationLoading = false;
            this.romanizationReady = false;
            this.measureContext = document.createElement('canvas').getContext('2d');
            this.destroyed = false;

            this.onPlaybackState = this.onPlaybackState.bind(this);
            this.onSettingsChange = this.onSettingsChange.bind(this);
            this.onFullscreenChange = this.onFullscreenChange.bind(this);
            this.tick = this.tick.bind(this);

            this.createLayout();
            this.attachEvents();
            this.applySettings();
            this.owner.requestFrame(this.tick);
        }

        createLayout() {
            this.owner.container.classList.add('mm-sl-window');

            this.host = document.createElement('section');
            this.host.className = 'mm-sl-host';
            this.host.setAttribute('aria-label', _('Syllable lyrics'));

            this.panelArtwork = document.createElement('img');
            this.panelArtwork.className = 'mm-sl-panel-artwork';
            this.panelArtwork.alt = '';
            this.panelArtwork.setAttribute('aria-hidden', 'true');
            const artworkFrame = document.createElement('div');
            artworkFrame.className = 'mm-sl-panel-artwork-frame';
            artworkFrame.appendChild(this.panelArtwork);
            this.host.appendChild(artworkFrame);

            const artworkShade = document.createElement('div');
            artworkShade.className = 'mm-sl-panel-shade';
            this.host.appendChild(artworkShade);

            const trackInfo = document.createElement('header');
            trackInfo.className = 'mm-sl-track-info';
            this.trackInfo = trackInfo;
            this.trackTitle = appendTextElement(trackInfo, 'mm-sl-track-title', '');
            this.trackArtist = appendTextElement(trackInfo, 'mm-sl-track-artist', '');
            this.romanizationButton = document.createElement('button');
            this.romanizationButton.type = 'button';
            this.romanizationButton.className = 'mm-sl-romanization-toggle';
            this.romanizationButton.hidden = true;
            this.romanizationButton.setAttribute('aria-pressed', 'false');
            trackInfo.appendChild(this.romanizationButton);
            this.host.appendChild(trackInfo);

            this.status = appendTextElement(this.host, 'mm-sl-status', _('Waiting for a track'));
            this.status.setAttribute('role', 'status');

            this.scroller = document.createElement('div');
            this.scroller.className = 'mm-sl-scroll';
            this.linesElement = document.createElement('div');
            this.linesElement.className = 'mm-sl-lines';
            this.scroller.appendChild(this.linesElement);
            this.host.appendChild(this.scroller);

            const contentParent = this.UI.fLyrics.parentElement || this.owner.container;
            contentParent.classList.add('mm-sl-content');
            contentParent.appendChild(this.host);
        }

        attachEvents() {
            this.owner.localListen(this.toggleButton, 'click', () => {
                const settings = getSettings();
                settings.enabled = !settings.enabled;
                storeSettings(settings);
            });

            this.owner.localListen(this.reloadButton, 'click', () => {
                MediaMonkeySyllableLyricsCore.clearCache();
                this.loadCurrentTrack(true);
            });

            this.owner.localListen(this.focusButton, 'click', () => {
                if (this.focusOverlay) {
                    this.exitFocusMode(true);
                } else {
                    this.enterFocusMode();
                }
            });

            this.owner.localListen(this.romanizationButton, 'click', () => {
                const settings = getSettings();
                settings.romanization = !settings.romanization;
                storeSettings(settings);
            });

            this.owner.localListen(this.scroller, 'click', (event) => {
                this.seekFromEvent(event);
            });
            this.owner.localListen(this.scroller, 'keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    this.seekFromEvent(event);
                }
            });

            app.listen(app.player, 'playbackState', this.onPlaybackState);
            app.listen(app, 'settingschange', this.onSettingsChange);
            this.owner.localListen(document, 'fullscreenchange', this.onFullscreenChange);
        }

        applySettings() {
            this.settings = getSettings();
            const enabled = Boolean(this.settings.enabled);
            this.owner.container.classList.toggle('mm-sl-active', enabled);
            this.toggleButton.classList.toggle('mm-sl-toggle-active', enabled);
            this.toggleButton.setAttribute('aria-pressed', String(enabled));
            this.reloadButton.parentElement.hidden = !enabled;
            this.focusButton.parentElement.hidden = !enabled;
            this.host.hidden = !enabled;
            this.updateRomanizationControl();

            if (enabled) {
                this.loadCurrentTrack(false);
            } else {
                this.exitFocusMode(true);
                this.requestSerial += 1;
            }
        }

        onSettingsChange() {
            const previous = this.settings;
            this.settings = getSettings();
            const lookupChanged = previous.online !== this.settings.online;
            const enabledChanged = previous.enabled !== this.settings.enabled;
            const romanizationChanged = previous.romanization !== this.settings.romanization;

            this.owner.container.classList.toggle('mm-sl-active', Boolean(this.settings.enabled));
            this.toggleButton.classList.toggle('mm-sl-toggle-active', Boolean(this.settings.enabled));
            this.toggleButton.setAttribute('aria-pressed', String(Boolean(this.settings.enabled)));
            this.reloadButton.parentElement.hidden = !this.settings.enabled;
            this.focusButton.parentElement.hidden = !this.settings.enabled;
            this.host.hidden = !this.settings.enabled;
            this.updateRomanizationControl();

            if (this.settings.enabled && (enabledChanged || lookupChanged)) {
                this.loadCurrentTrack(lookupChanged);
            } else if (this.settings.enabled && romanizationChanged && this.lyrics) {
                this.romanizationSerial += 1;
                this.romanizationLoading = false;
                this.renderLyrics(this.lyrics);
                if (this.settings.romanization) {
                    this.ensureRomanization();
                }
            } else if (!this.settings.enabled) {
                this.exitFocusMode(true);
                this.requestSerial += 1;
            }
        }

        updateRomanizationControl() {
            if (!this.romanizationButton) {
                return;
            }
            const active = Boolean(this.settings.romanization);
            const core = window.MediaMonkeySyllableLyricsCore;
            const hasRomanization = Boolean(this.lyrics && core.hasRomanization(this.lyrics));
            const canGenerate = Boolean(
                this.lyrics
                && this.settings.online
                && core.canRomanize(this.lyrics)
            );
            const unavailable = Boolean(this.lyrics) && !hasRomanization && !canGenerate;

            this.romanizationButton.hidden = !this.lyrics;
            this.romanizationButton.disabled = this.romanizationLoading || unavailable;
            this.romanizationButton.classList.toggle('mm-sl-romanization-active', active);
            this.romanizationButton.setAttribute('aria-pressed', String(active));
            this.romanizationButton.setAttribute('aria-busy', String(this.romanizationLoading));
            this.romanizationButton.textContent = this.romanizationLoading
                ? _('Romanizing...')
                : active
                    ? _('Romanized')
                    : _('Romanize');
            this.romanizationButton.title = unavailable
                ? _('Romanization is unavailable for these lyrics')
                : active
                    ? _('Show original lyrics')
                    : _('Show romanized lyrics');
        }

        async ensureRomanization() {
            const core = window.MediaMonkeySyllableLyricsCore;
            if (!this.settings.romanization || !this.lyrics || this.romanizationLoading
                || this.romanizationReady || !core.canRomanize(this.lyrics)) {
                this.updateRomanizationControl();
                return;
            }
            if (!this.settings.online) {
                this.romanizationReady = true;
                this.updateRomanizationControl();
                return;
            }

            const serial = ++this.romanizationSerial;
            const lyrics = this.lyrics;
            this.romanizationLoading = true;
            this.updateRomanizationControl();
            let romanized = lyrics;
            try {
                romanized = await core.romanizeLyrics(lyrics, {
                    fetchImpl: window.fetch.bind(window),
                    timeoutMs: 8000
                });
            } catch (error) {
                romanized = lyrics;
            }
            if (serial !== this.romanizationSerial || lyrics !== this.lyrics
                || !this.settings.romanization) {
                return;
            }

            this.romanizationLoading = false;
            this.romanizationReady = true;
            this.renderLyrics(romanized || lyrics);
        }

        onPlaybackState(newState) {
            if (newState === 'trackChanged' || newState === 'play') {
                this.owner.requestTimeout(() => this.loadCurrentTrack(false), 50);
            } else {
                this.syncToPlayer();
            }
        }

        onFullscreenChange() {
            if (!this.focusOverlay) {
                return;
            }
            if (document.fullscreenElement === this.focusOverlay) {
                this.activeLineIndex = -1;
                this.owner.requestFrame(() => {
                    if (this.focusOverlay) {
                        this.syncToPlayer();
                    }
                });
            } else {
                this.exitFocusMode(false);
            }
        }

        enterFocusMode() {
            if (!this.settings.enabled || this.focusOverlay) {
                return;
            }

            const overlay = document.createElement('div');
            overlay.className = 'mm-sl-focus-overlay';
            overlay.tabIndex = -1;
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-label', _('Fullscreen lyrics'));

            const artwork = document.createElement('img');
            artwork.className = 'mm-sl-focus-artwork';
            artwork.alt = '';
            artwork.setAttribute('aria-hidden', 'true');
            const artworkFrame = document.createElement('div');
            artworkFrame.className = 'mm-sl-focus-artwork-frame';
            artworkFrame.appendChild(artwork);
            overlay.appendChild(artworkFrame);

            const shade = document.createElement('div');
            shade.className = 'mm-sl-focus-shade';
            overlay.appendChild(shade);

            const surface = document.createElement('main');
            surface.className = 'mm-sl-focus-surface';
            overlay.appendChild(surface);

            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.className = 'mm-sl-focus-close';
            closeButton.title = _('Exit fullscreen lyrics');
            closeButton.setAttribute('aria-label', _('Exit fullscreen lyrics'));
            closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
                + '<path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/>'
                + '</svg>';
            overlay.appendChild(closeButton);
            overlay.appendChild(this.romanizationButton);

            this.focusHostParent = this.host.parentElement;
            this.focusHostNextSibling = this.host.nextSibling;
            surface.appendChild(this.host);
            document.body.appendChild(overlay);
            document.documentElement.classList.add('mm-sl-focus-open');
            document.body.classList.add('mm-sl-focus-open');

            this.focusOverlay = overlay;
            this.focusArtwork = artwork;
            this.focusButton.classList.add('mm-sl-toggle-active');
            this.focusButton.setAttribute('aria-pressed', 'true');
            this.owner.localListen(closeButton, 'click', () => this.exitFocusMode(true));
            this.owner.localListen(overlay, 'keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this.exitFocusMode(true);
                }
            });

            if (this.artworkPath) {
                artwork.src = this.artworkPath;
                overlay.classList.add('mm-sl-focus-has-artwork');
            } else {
                this.loadArtwork(app.player.getCurrentTrack());
            }
            this.activeLineIndex = -1;
            this.syncToPlayer();
            overlay.focus();
            this.owner.requestFrame(() => {
                if (this.focusOverlay === overlay) {
                    this.activeLineIndex = -1;
                    this.syncToPlayer();
                }
            });

            let usingHostFullscreen = false;
            if (typeof setWindowState === 'function' && typeof window.maximize === 'function') {
                const windowState = {
                    bordered: Boolean(window.bordered),
                    flat: Boolean(window.flat),
                    maximized: Boolean(window.maximized)
                };
                try {
                    setWindowState(false, true);
                    this.focusWindowState = windowState;
                    window.maximize();
                    usingHostFullscreen = true;
                } catch (error) {
                    this.focusWindowState = null;
                }
            }

            if (usingHostFullscreen) {
                this.owner.requestTimeout(() => {
                    if (this.focusOverlay === overlay) {
                        this.activeLineIndex = -1;
                        this.syncToPlayer();
                    }
                }, 100);
            } else if (typeof overlay.requestFullscreen === 'function') {
                try {
                    const request = overlay.requestFullscreen();
                    if (request && typeof request.catch === 'function') {
                        request.catch(() => {});
                    }
                } catch (error) {
                    // The fixed overlay remains usable if fullscreen is unavailable.
                }
            }
        }

        exitFocusMode(exitNativeFullscreen) {
            const overlay = this.focusOverlay;
            if (!overlay) {
                return;
            }

            const shouldExitFullscreen = exitNativeFullscreen
                && document.fullscreenElement === overlay
                && typeof document.exitFullscreen === 'function';
            const focusWindowState = this.focusWindowState;
            this.focusOverlay = null;
            this.focusWindowState = null;
            this.focusArtwork = null;

            if (this.focusHostParent) {
                const nextSibling = this.focusHostNextSibling;
                this.focusHostParent.insertBefore(
                    this.host,
                    nextSibling && nextSibling.parentElement === this.focusHostParent ? nextSibling : null
                );
            }
            this.trackInfo.appendChild(this.romanizationButton);
            overlay.remove();
            document.documentElement.classList.remove('mm-sl-focus-open');
            document.body.classList.remove('mm-sl-focus-open');
            this.focusHostParent = null;
            this.focusHostNextSibling = null;
            this.focusButton.classList.remove('mm-sl-toggle-active');
            this.focusButton.setAttribute('aria-pressed', 'false');

            if (shouldExitFullscreen) {
                try {
                    const exit = document.exitFullscreen();
                    if (exit && typeof exit.catch === 'function') {
                        exit.catch(() => {});
                    }
                } catch (error) {
                    // Removing the fullscreen element can exit native fullscreen first.
                }
            }

            if (focusWindowState && typeof setWindowState === 'function') {
                try {
                    setWindowState(focusWindowState.bordered, focusWindowState.flat);
                    if (focusWindowState.maximized && typeof window.maximize === 'function') {
                        window.maximize();
                    } else if (!focusWindowState.maximized && typeof window.restore === 'function') {
                        window.restore();
                    }
                } catch (error) {
                    // Keep the restored lyrics panel usable if the host rejects a window-state change.
                }
            }

            this.activeLineIndex = -1;
            this.syncToPlayer();
            this.focusButton.focus();
        }

        loadArtwork(track) {
            const serial = ++this.artworkSerial;
            this.artworkPath = '';
            this.panelArtwork.removeAttribute('src');
            this.host.classList.remove('mm-sl-panel-has-artwork');
            if (this.focusArtwork && this.focusOverlay) {
                this.focusArtwork.removeAttribute('src');
                this.focusOverlay.classList.remove('mm-sl-focus-has-artwork');
            }
            if (!track) {
                return;
            }

            const applyArtwork = (path) => {
                if (serial !== this.artworkSerial || this.destroyed) {
                    return;
                }
                if (path && path !== '-') {
                    this.artworkPath = path;
                    this.panelArtwork.src = path;
                    this.host.classList.add('mm-sl-panel-has-artwork');
                    if (this.focusArtwork && this.focusOverlay) {
                        this.focusArtwork.src = path;
                        this.focusOverlay.classList.add('mm-sl-focus-has-artwork');
                    }
                }
            };

            if (typeof track.getCachedThumb === 'function') {
                try {
                    applyArtwork(track.getCachedThumb(1600, 1600));
                } catch (error) {
                    // Fall through to the asynchronous artwork lookup.
                }
            }
            if (typeof track.getThumbAsync === 'function') {
                try {
                    track.getThumbAsync(1600, 1600, applyArtwork);
                } catch (error) {
                    // Keep the default background when artwork cannot be loaded.
                }
            }
        }

        getCurrentSong() {
            const track = app.player.getCurrentTrack();
            if (!track || !track.title) {
                return null;
            }

            const lengthMs = Number(app.player.trackLengthMS || track.playLength || track.songLength || 0);
            return {
                track,
                title: track.title || '',
                artist: track.artist || track.albumArtist || '',
                album: track.album || '',
                duration: lengthMs > 0 ? Math.round(lengthMs / 10) / 100 : 0,
                isrc: track.isrc || ''
            };
        }

        async loadCurrentTrack(forceReload) {
            if (!this.settings.enabled) {
                return;
            }

            const song = this.getCurrentSong();
            if (!song) {
                this.trackKey = '';
                this.lyrics = null;
                this.loadArtwork(null);
                this.showStatus(_('Play a track to load synchronized lyrics'));
                return;
            }

            const key = [song.title, song.artist, song.album, song.duration].join('|');
            if (forceReload || key !== this.trackKey) {
                this.loadArtwork(song.track);
            }
            if (!forceReload && key === this.trackKey) {
                return;
            }

            this.trackKey = key;
            this.romanizationSerial += 1;
            this.romanizationLoading = false;
            this.romanizationReady = false;
            const serial = ++this.requestSerial;
            this.trackTitle.textContent = song.title;
            this.trackArtist.textContent = song.artist;
            this.showStatus(_('Looking for synchronized lyrics...'));

            let embeddedLyrics = '';
            try {
                embeddedLyrics = await song.track.getLyricsAsync();
            } catch (error) {
                embeddedLyrics = '';
            }

            if (serial !== this.requestSerial || !this.settings.enabled) {
                return;
            }

            let lyrics = null;
            try {
                lyrics = await MediaMonkeySyllableLyricsCore.findLyrics(song, embeddedLyrics, {
                    online: Boolean(this.settings.online),
                    forceReload: Boolean(forceReload),
                    fetchImpl: window.fetch.bind(window)
                });
            } catch (error) {
                lyrics = null;
            }

            if (serial !== this.requestSerial || key !== this.trackKey || !this.settings.enabled) {
                return;
            }

            if (!lyrics) {
                this.lyrics = null;
                this.showStatus(
                    this.settings.online
                        ? _('No synchronized lyrics were found for this track')
                        : _('No embedded synchronized lyrics were found')
                );
                return;
            }

            this.renderLyrics(lyrics);
            if (this.settings.romanization) {
                this.ensureRomanization();
            }
        }

        showStatus(message) {
            this.lyrics = null;
            this.status.textContent = message;
            this.status.hidden = false;
            this.scroller.hidden = true;
            this.linesElement.textContent = '';
            this.renderedLines = [];
            this.activeLineIndex = -1;
            this.scrollLineIndex = -1;
            this.scrollVelocity = 0;
            this.lastScrollAnimationTimeMs = 0;
            this.scrollFollowUntilMs = 0;
            this.updateRomanizationControl();
        }

        renderLyrics(lyrics) {
            this.lyrics = lyrics;
            this.linesElement.textContent = '';
            this.renderedLines = [];
            this.activeLineIndex = -1;
            this.scrollLineIndex = -1;
            this.scrollVelocity = 0;
            this.lastScrollAnimationTimeMs = 0;
            this.scrollFollowUntilMs = 0;
            this.status.hidden = true;
            this.scroller.hidden = false;
            this.host.classList.toggle('mm-sl-plain-mode', lyrics.type === 'plain');
            this.updateRomanizationControl();

            const singerSides = new Map();
            let nextSingerIsRight = false;

            lyrics.lines.forEach((line, index) => {
                const lineText = this.settings.romanization && line.romanizedText
                    ? line.romanizedText
                    : line.text;
                const lineElement = document.createElement('div');
                lineElement.className = 'mm-sl-line';
                lineElement.dataset.index = String(index);
                lineElement.dir = 'auto';

                if (lyrics.type !== 'plain') {
                    lineElement.tabIndex = 0;
                    lineElement.setAttribute('role', 'button');
                    lineElement.setAttribute('aria-label', _('Seek to') + ' ' + lineText);
                }

                if (line.singer) {
                    if (!singerSides.has(line.singer)) {
                        singerSides.set(line.singer, nextSingerIsRight);
                        nextSingerIsRight = !nextSingerIsRight;
                    }
                    lineElement.classList.toggle('mm-sl-singer-right', singerSides.get(line.singer));
                }

                const lineContainer = document.createElement('div');
                lineContainer.className = 'mm-sl-line-container';
                lineElement.appendChild(lineContainer);

                const main = document.createElement('div');
                main.className = 'mm-sl-main-vocal';
                lineContainer.appendChild(main);

                const background = document.createElement('div');
                background.className = 'mm-sl-background-vocal';
                const syllableElements = [];
                const wordElements = [];
                const currentWords = { main: null, background: null };
                const firstSyllables = { main: true, background: true };
                let previousTargetName = null;

                if (lyrics.type === 'word' && line.syllables.length > 0) {
                    line.syllables.forEach((syllable) => {
                        const syllableText = this.settings.romanization && syllable.romanizedText
                            ? syllable.romanizedText
                            : syllable.text;
                        const targetName = syllable.isBackground ? 'background' : 'main';
                        const target = syllable.isBackground ? background : main;
                        if (previousTargetName && previousTargetName !== targetName) {
                            currentWords[previousTargetName] = null;
                        }
                        if (!currentWords[targetName] || /^\s/.test(syllableText)) {
                            const wordElement = document.createElement('span');
                            wordElement.className = 'mm-sl-word';
                            target.appendChild(wordElement);
                            currentWords[targetName] = {
                                element: wordElement,
                                parent: target,
                                text: '',
                                startMs: syllable.startMs,
                                endMs: syllable.endMs,
                                isBackground: syllable.isBackground,
                                growable: false,
                                durationMs: 0,
                                timedDurationMs: 0,
                                syllables: [],
                                chars: []
                            };
                            wordElements.push(currentWords[targetName]);
                        }

                        const word = currentWords[targetName];
                        const syllableElement = document.createElement('span');
                        syllableElement.className = 'mm-sl-syllable';
                        syllableElement.textContent = syllableText;
                        syllableElement.style.setProperty('--mm-sl-progress', '0%');
                        if (containsRtlText(syllableText)) {
                            syllableElement.classList.add('mm-sl-rtl');
                        }
                        word.element.appendChild(syllableElement);
                        word.text += syllableText;
                        word.startMs = Math.min(word.startMs, syllable.startMs);
                        word.endMs = Math.max(word.endMs, syllable.endMs);
                        const renderedSyllable = {
                            element: syllableElement,
                            data: syllable,
                            progress: -1,
                            state: '',
                            displayText: syllableText,
                            timingText: syllableText,
                            lane: targetName,
                            isFirstInContainer: firstSyllables[targetName],
                            preWipeDurationMs: 0,
                            preWipeStartMs: null,
                            preWipeEndMs: null,
                            preWipeProgress: -1,
                            wipeRatio: 1,
                            chars: []
                        };
                        firstSyllables[targetName] = false;
                        syllableElements.push(renderedSyllable);
                        word.syllables.push(renderedSyllable);
                        word.timedDurationMs += Math.max(1, syllable.endMs - syllable.startMs);
                        if (/\s$/.test(syllableText)) {
                            currentWords[targetName] = null;
                        }
                        previousTargetName = targetName;
                    });

                    wordElements.forEach((word) => {
                        const text = word.text.trim();
                        const leadingSpace = word.text.match(/^\s+/);
                        const trailingSpace = word.text.match(/\s+$/);
                        if (text.length === 0) {
                            word.syllables.forEach((syllable) => {
                                syllable.displayText = '';
                                syllable.element.textContent = '';
                            });
                            word.parent.insertBefore(document.createTextNode(word.text), word.element);
                        } else {
                            if (leadingSpace && word.syllables.length > 0) {
                                const firstSyllable = word.syllables[0];
                                firstSyllable.displayText = firstSyllable.displayText.slice(leadingSpace[0].length);
                                word.parent.insertBefore(document.createTextNode(leadingSpace[0]), word.element);
                            }
                            if (trailingSpace && word.syllables.length > 0) {
                                const lastSyllable = word.syllables[word.syllables.length - 1];
                                lastSyllable.displayText = lastSyllable.displayText.slice(0, -trailingSpace[0].length);
                                word.parent.insertBefore(
                                    document.createTextNode(trailingSpace[0]),
                                    word.element.nextSibling
                                );
                            }
                            word.syllables.forEach((syllable) => {
                                syllable.element.textContent = syllable.displayText;
                            });
                        }
                        word.durationMs = Math.max(1, word.endMs - word.startMs);
                        word.growable = !word.isBackground
                            && text.length > 0
                            && text.length <= 7
                            && !containsRtlText(text)
                            && word.timedDurationMs >= 1000;
                        if (word.growable) {
                            word.syllables.forEach((renderedSyllable) => {
                                renderedSyllable.element.textContent = '';
                                renderedSyllable.element.classList.add('mm-sl-syllable-chars');
                                segmentGraphemes(renderedSyllable.displayText).forEach((character) => {
                                    if (isWhitespaceGrapheme(character)) {
                                        renderedSyllable.element.appendChild(document.createTextNode(character));
                                        return;
                                    }
                                    const characterElement = document.createElement('span');
                                    characterElement.className = 'mm-sl-char';
                                    characterElement.textContent = character;
                                    renderedSyllable.element.appendChild(characterElement);
                                    const renderedCharacter = {
                                        element: characterElement,
                                        text: character,
                                        index: word.chars.length,
                                        isFirstInContainer: renderedSyllable.isFirstInContainer
                                            && renderedSyllable.chars.length === 0,
                                        wipeStart: 0,
                                        wipeDuration: 1,
                                        maxScale: 1,
                                        shadowIntensity: 0.4,
                                        translateYPeak: -2,
                                        horizontalOffset: 0,
                                        preWipeStartMs: null,
                                        preWipeEndMs: null,
                                        wipeProgress: -1,
                                        preWipeProgress: -1,
                                        growProgress: -1
                                    };
                                    renderedSyllable.chars.push(renderedCharacter);
                                    word.chars.push(renderedCharacter);
                                });
                            });
                        }
                    });
                    if (!main.textContent.trim() && !background.textContent.trim()) {
                        main.textContent = lineText;
                    }
                } else {
                    main.textContent = lineText;
                }

                if (background.textContent.trim()) {
                    lineContainer.appendChild(background);
                }

                this.linesElement.appendChild(lineElement);
                wordElements.forEach((word) => this.prepareWordAnimation(word));
                this.preparePreWipes(syllableElements);
                this.renderedLines.push({
                    element: lineElement,
                    syllables: syllableElements,
                    words: wordElements
                });
            });
            this.syncToPlayer();
        }

        prepareWordAnimation(word) {
            if (word.syllables.length === 0 || !this.measureContext) {
                return;
            }

            const referenceElement = word.chars.length > 0
                ? word.chars[0].element
                : word.syllables[0].element;
            const computed = window.getComputedStyle(referenceElement);
            const fontSize = Number.parseFloat(computed.fontSize) || 25;
            this.measureContext.font = [computed.fontWeight, computed.fontSize, computed.fontFamily].join(' ');
            const measure = (text) => Math.max(0, this.measureContext.measureText(text).width);

            word.syllables.forEach((syllable) => {
                const timingText = syllable.timingText;
                const graphemes = segmentGraphemes(timingText);
                const widths = graphemes.map((character) => measure(character));
                const totalWidth = widths.reduce((total, width) => total + width, 0);
                const visibleWidth = measure(timingText.trim());
                const fullTextWidth = measure(timingText);
                const syllableDuration = Math.max(1, syllable.data.endMs - syllable.data.startMs);
                syllable.wipeRatio = !word.growable && fullTextWidth > 0
                    ? Math.min(1, visibleWidth / fullTextWidth)
                    : 1;
                syllable.preWipeDurationMs = fullTextWidth > 0
                    ? 0.375 * fontSize / (fullTextWidth / syllableDuration)
                    : 0;
                const characterPreWipeDurationMs = totalWidth > 0
                    ? 0.375 * fontSize / (totalWidth / syllableDuration)
                    : 0;

                let cumulativeWidth = 0;
                let characterIndex = 0;
                graphemes.forEach((grapheme, index) => {
                    if (!isWhitespaceGrapheme(grapheme)) {
                        const character = syllable.chars[characterIndex];
                        if (character) {
                            character.wipeStart = totalWidth > 0 ? cumulativeWidth / totalWidth : 0;
                            character.wipeDuration = totalWidth > 0 ? widths[index] / totalWidth : 1;
                            character.fontSize = fontSize;
                            if (characterIndex > 0 && characterPreWipeDurationMs > 0) {
                                character.preWipeEndMs = syllable.data.startMs
                                    + syllableDuration * character.wipeStart;
                                character.preWipeStartMs = character.preWipeEndMs
                                    - characterPreWipeDurationMs;
                            }
                        }
                        characterIndex += 1;
                    }
                    cumulativeWidth += widths[index];
                });
            });

            if (!word.growable || word.chars.length === 0) {
                return;
            }

            const wordWidth = Math.max(0.01, measure(word.element.textContent.trim()));
            const wordLength = segmentGraphemes(word.text.trim()).length;
            const durationProgress = Math.min(1, Math.max(0, (word.durationMs - 1000) / 4000));
            const easedProgress = Math.pow(durationProgress, 3);
            const firstDuration = word.syllables.length > 0
                ? Math.max(1, word.syllables[0].data.endMs - word.syllables[0].data.startMs)
                : word.durationMs;
            const imbalanceRatio = firstDuration / Math.max(1, word.durationMs);
            const penaltyFactor = word.syllables.length > 1 && imbalanceRatio < 0.25
                ? 0.5 + 0.5 * (imbalanceRatio / 0.25)
                : 1;
            let maxDecayRate = 0;
            if (wordLength > 5 || word.durationMs < 1500 || penaltyFactor < 0.95) {
                let decayStrength = 0;
                if (wordLength > 5) {
                    decayStrength += Math.min((wordLength - 5) / 3, 1) * 0.4;
                }
                if (word.durationMs < 1500) {
                    decayStrength += Math.max(0, 1 - (word.durationMs - 1000) / 500) * 0.4;
                }
                if (penaltyFactor < 0.95) {
                    decayStrength += Math.pow(1 - penaltyFactor, 0.7) * 1.2;
                }
                maxDecayRate = Math.min(decayStrength, 0.85);
            }

            let cumulativeWidth = 0;
            word.chars.forEach((character, index) => {
                const characterWidth = Math.max(0.01, measure(character.text.trim()));
                const positionInWord = word.chars.length > 1 ? index / (word.chars.length - 1) : 0;
                const decayFactor = 1 - positionInWord * maxDecayRate;
                const characterProgress = easedProgress * penaltyFactor * decayFactor;
                const baseGrowth = word.chars.length <= 3 ? 0.07 : 0.05;
                character.maxScale = 1 + baseGrowth + characterProgress * 0.1;
                character.shadowIntensity = 0.4 + characterProgress * 0.4;
                character.translateYPeak = -((character.maxScale - 1) / 0.13) * 6;
                const position = (cumulativeWidth + characterWidth / 2) / wordWidth;
                character.horizontalOffset = (position - 0.5) * 2 * ((character.maxScale - 1) * 25);
                character.fontSize = fontSize;
                cumulativeWidth += characterWidth;
            });
        }

        preparePreWipes(syllables) {
            const previousVisible = { main: null, background: null };
            syllables.forEach((syllable) => {
                if (!syllable.displayText.trim()) {
                    return;
                }
                const firstCharacter = syllable.chars[0];
                const previous = previousVisible[syllable.lane];
                if (!previous) {
                    syllable.isFirstInContainer = true;
                    if (firstCharacter) {
                        firstCharacter.isFirstInContainer = true;
                    }
                } else if (previous.preWipeDurationMs > 0) {
                    syllable.preWipeEndMs = previous.data.endMs;
                    syllable.preWipeStartMs = previous.data.endMs - previous.preWipeDurationMs;
                    if (firstCharacter) {
                        firstCharacter.preWipeEndMs = syllable.preWipeEndMs;
                        firstCharacter.preWipeStartMs = syllable.preWipeStartMs;
                    }
                }
                previousVisible[syllable.lane] = syllable;
            });
        }

        updateWordAnimation(word, positionMs) {
            const growDuration = Math.max(1, word.durationMs * 1.5);
            word.syllables.forEach((syllable) => {
                const syllableDuration = Math.max(1, syllable.data.endMs - syllable.data.startMs);
                const syllableElapsed = positionMs - syllable.data.startMs;
                syllable.chars.forEach((character) => {
                    const wipeDelay = syllableDuration * character.wipeStart;
                    const wipeDuration = Math.max(1, syllableDuration * character.wipeDuration);
                    const wipeProgress = Math.max(0, Math.min(1, (syllableElapsed - wipeDelay) / wipeDuration));
                    const preWipeProgress = character.preWipeStartMs === null
                        ? -1
                        : Math.max(0, Math.min(
                            1,
                            (positionMs - character.preWipeStartMs)
                                / Math.max(1, character.preWipeEndMs - character.preWipeStartMs)
                        ));
                    if (Math.abs(wipeProgress - character.wipeProgress) >= 0.001
                        || Math.abs(preWipeProgress - character.preWipeProgress) >= 0.001) {
                        character.wipeProgress = wipeProgress;
                        character.preWipeProgress = preWipeProgress;
                        const startOffset = character.isFirstInContainer ? -0.75 : -0.375;
                        const offset = wipeProgress > 0
                            ? startOffset + (0.375 - startOffset) * wipeProgress
                            : preWipeProgress >= 0
                                ? -0.75 + 0.375 * preWipeProgress
                                : startOffset;
                        character.element.style.backgroundSize = '0.75em 100%, '
                            + (wipeProgress * 100).toFixed(2) + '% 100%';
                        character.element.style.backgroundPosition = 'calc('
                            + (wipeProgress * 100).toFixed(2) + '% + '
                            + offset.toFixed(3) + 'em) 0, left';
                    }

                    const growDelay = word.durationMs * 0.09 * character.index;
                    const growProgress = Math.max(0, Math.min(
                        1,
                        (positionMs - word.startMs - growDelay) / growDuration
                    ));
                    if (Math.abs(growProgress - character.growProgress) < 0.001) {
                        return;
                    }
                    character.growProgress = growProgress;

                    let peakAmount;
                    if (growProgress < 0.25) {
                        peakAmount = easeInOut(growProgress / 0.25);
                    } else if (growProgress <= 0.3) {
                        peakAmount = 1;
                    } else {
                        peakAmount = 1 - easeInOut((growProgress - 0.3) / 0.7);
                    }
                    const fontScale = 24 / 25;
                    const scale = 1 + (character.maxScale * fontScale - 1) * peakAmount;
                    const horizontalOffset = character.horizontalOffset * fontScale * peakAmount;
                    const peakY = character.translateYPeak;
                    const finalY = -0.035 * character.fontSize;
                    const verticalOffset = growProgress <= 0.3
                        ? peakY * peakAmount
                        : finalY + (peakY - finalY) * peakAmount;
                    const shadow = character.shadowIntensity * peakAmount;
                    const shadowSize = 0.1 * peakAmount;
                    const hasTransform = Math.abs(horizontalOffset) >= 0.001
                        || Math.abs(verticalOffset) >= 0.001
                        || Math.abs(scale - 1) >= 0.0001;
                    character.element.style.transform = hasTransform
                        ? 'translate(' + horizontalOffset.toFixed(3) + 'px, '
                            + verticalOffset.toFixed(3) + 'px) scale(' + scale.toFixed(4) + ')'
                        : 'none';
                    character.element.style.filter = shadow >= 0.01
                        ? 'drop-shadow(0 0 ' + shadowSize.toFixed(3)
                            + 'em rgba(255, 255, 255, ' + shadow.toFixed(3) + '))'
                        : 'none';
                });
            });
        }

        seekFromEvent(event) {
            const lineElement = event.target.closest('.mm-sl-line[data-index]');
            if (!lineElement || !this.lyrics || this.lyrics.type === 'plain') {
                return;
            }
            const line = this.lyrics.lines[Number(lineElement.dataset.index)];
            if (line) {
                event.preventDefault();
                app.player.seekMSAsync(Math.max(0, line.startMs - Number(this.settings.offsetMs || 0)));
            }
        }

        findActiveLine(positionMs) {
            if (!this.lyrics || this.lyrics.type === 'plain' || this.lyrics.lines.length === 0) {
                return -1;
            }
            if (positionMs < this.lyrics.lines[0].startMs) {
                return -1;
            }

            let low = 0;
            let high = this.lyrics.lines.length - 1;
            let result = -1;
            while (low <= high) {
                const middle = Math.floor((low + high) / 2);
                if (this.lyrics.lines[middle].startMs <= positionMs) {
                    result = middle;
                    low = middle + 1;
                } else {
                    high = middle - 1;
                }
            }

            const lastLine = this.lyrics.lines[result];
            const currentLine = this.lyrics.lines[this.activeLineIndex];
            if (currentLine && result > this.activeLineIndex && positionMs < currentLine.endMs) {
                return this.activeLineIndex;
            }
            if (result === this.lyrics.lines.length - 1 && positionMs > lastLine.endMs + 1500) {
                return -1;
            }
            return result;
        }

        updateLineStates(activeIndex) {
            const lineChanged = activeIndex !== this.activeLineIndex;
            if (lineChanged) {
                const previousLine = this.renderedLines[this.activeLineIndex];
                if (previousLine) {
                    previousLine.words.forEach((word) => {
                        word.chars.forEach((character) => {
                            character.element.style.removeProperty('background-size');
                            character.element.style.removeProperty('background-position');
                            character.element.style.removeProperty('transform');
                            character.element.style.removeProperty('filter');
                            character.wipeProgress = -1;
                            character.preWipeProgress = -1;
                            character.growProgress = -1;
                        });
                    });
                }
                this.activeLineIndex = activeIndex;
                this.renderedLines.forEach((rendered, index) => {
                    const active = index === activeIndex;
                    rendered.element.classList.toggle('mm-sl-line-active', active);
                    if (active) {
                        rendered.element.setAttribute('aria-current', 'true');
                    } else {
                        rendered.element.removeAttribute('aria-current');
                    }
                });
            }

            if (activeIndex < 0) {
                this.scrollLineIndex = -1;
                this.scrollVelocity = 0;
                this.lastScrollAnimationTimeMs = 0;
            }
            return lineChanged;
        }

        updateActiveLineScroll(frameTimeMs, lineChanged) {
            const rendered = this.renderedLines[this.activeLineIndex];
            if (!rendered) {
                return;
            }

            const firstCenter = this.scrollLineIndex < 0;
            if (lineChanged) {
                this.scrollLineIndex = this.activeLineIndex;
                this.scrollVelocity = 0;
                this.scrollFollowUntilMs = frameTimeMs + 850;
            } else if (frameTimeMs > this.scrollFollowUntilMs && Math.abs(this.scrollVelocity) < 1) {
                return;
            }

            const activeRect = rendered.element.getBoundingClientRect();
            const scrollerRect = this.scroller.getBoundingClientRect();
            const target = Math.max(0, Math.min(
                this.scroller.scrollHeight - this.scroller.clientHeight,
                this.scroller.scrollTop
                + activeRect.top
                - scrollerRect.top
                - (scrollerRect.height - activeRect.height) / 2
            ));
            const reducedMotion = window.matchMedia
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const smooth = this.settings.smoothScroll && !reducedMotion;
            this.scroller.style.scrollBehavior = 'auto';

            if (!smooth || firstCenter) {
                this.scroller.scrollTop = target;
                this.scrollVelocity = 0;
                this.lastScrollAnimationTimeMs = frameTimeMs;
                return;
            }

            const elapsedSeconds = this.lastScrollAnimationTimeMs > 0
                ? Math.max(0.001, Math.min(0.05, (frameTimeMs - this.lastScrollAnimationTimeMs) / 1000))
                : 1 / 60;
            const displacement = this.scroller.scrollTop - target;
            const angularFrequency = 10;
            const velocityTerm = this.scrollVelocity + angularFrequency * displacement;
            const decay = Math.exp(-angularFrequency * elapsedSeconds);
            const nextDisplacement = (displacement + velocityTerm * elapsedSeconds) * decay;
            this.scrollVelocity = (this.scrollVelocity
                - angularFrequency * velocityTerm * elapsedSeconds) * decay;
            this.lastScrollAnimationTimeMs = frameTimeMs;

            if (Math.abs(nextDisplacement) < 0.25 && Math.abs(this.scrollVelocity) < 1) {
                this.scroller.scrollTop = target;
                this.scrollVelocity = 0;
            } else {
                this.scroller.scrollTop = target + nextDisplacement;
            }
        }

        updateSyllables(positionMs) {
            if (this.activeLineIndex < 0 || this.lyrics.type !== 'word') {
                return;
            }

            const renderedLine = this.renderedLines[this.activeLineIndex];
            renderedLine.syllables.forEach((syllable) => {
                const duration = Math.max(1, syllable.data.endMs - syllable.data.startMs);
                const visualDuration = Math.max(1, duration * syllable.wipeRatio);
                const normalized = Math.max(0, Math.min(
                    1,
                    (positionMs - syllable.data.startMs) / visualDuration
                ));
                const progress = Math.round(normalized * 1000) / 10;
                const preWipeProgress = syllable.preWipeStartMs === null
                    ? -1
                    : Math.max(0, Math.min(
                        1,
                        (positionMs - syllable.preWipeStartMs)
                            / Math.max(1, syllable.preWipeEndMs - syllable.preWipeStartMs)
                    ));
                if (progress !== syllable.progress
                    || Math.abs(preWipeProgress - syllable.preWipeProgress) >= 0.001) {
                    syllable.progress = progress;
                    syllable.preWipeProgress = preWipeProgress;
                    syllable.element.style.setProperty('--mm-sl-progress', progress + '%');
                    const rtl = syllable.element.classList.contains('mm-sl-rtl');
                    const wipeStartOffset = syllable.isFirstInContainer
                        ? (rtl ? 0.75 : -0.75)
                        : (rtl ? 0.375 : -0.375);
                    const wipeEndOffset = rtl ? -0.75 : 0.375;
                    const preWipeStartOffset = rtl ? 0.75 : -0.75;
                    const preWipeEndOffset = rtl ? 0.375 : -0.375;
                    const sheenOffset = normalized <= 0 && preWipeProgress >= 0
                        ? preWipeStartOffset
                            + (preWipeEndOffset - preWipeStartOffset) * preWipeProgress
                        : wipeStartOffset + (wipeEndOffset - wipeStartOffset) * normalized;
                    syllable.element.style.setProperty(
                        '--mm-sl-sheen-offset',
                        sheenOffset.toFixed(3) + 'em'
                    );
                }

                const state = positionMs >= syllable.data.endMs
                    ? 'finished'
                    : positionMs >= syllable.data.startMs
                        ? 'current'
                        : 'pending';
                if (state !== syllable.state) {
                    syllable.state = state;
                    syllable.element.classList.toggle('mm-sl-syllable-current', state === 'current');
                    syllable.element.classList.toggle('mm-sl-syllable-finished', state === 'finished');
                }
            });

            renderedLine.words.forEach((word) => {
                if (word.growable) {
                    this.updateWordAnimation(word, positionMs);
                }
            });
        }

        syncToPlayer() {
            if (!this.settings.enabled || !this.lyrics || this.lyrics.type === 'plain') {
                return;
            }
            const positionMs = Number(app.player.trackPositionMS || 0) + Number(this.settings.offsetMs || 0);
            const frameTimeMs = typeof performance !== 'undefined' && performance.now
                ? performance.now()
                : Date.now();
            const activeIndex = this.findActiveLine(positionMs);
            const lineChanged = this.updateLineStates(activeIndex);
            this.updateSyllables(positionMs);
            this.updateActiveLineScroll(frameTimeMs, lineChanged);
        }

        tick() {
            if (this.destroyed) {
                return;
            }

            if (this.settings.enabled && !this.host.hidden && this.host.offsetParent !== null) {
                this.syncToPlayer();
            }

            const frameTimeMs = typeof performance !== 'undefined' && performance.now
                ? performance.now()
                : Date.now();
            const scrollAnimating = frameTimeMs <= this.scrollFollowUntilMs
                || Math.abs(this.scrollVelocity) >= 1;
            if ((app.player.isPlaying && !app.player.paused && this.settings.enabled)
                || scrollAnimating) {
                this.owner.requestFrame(this.tick);
            } else {
                this.owner.requestTimeout(this.tick, 150);
            }
        }

        destroy() {
            this.exitFocusMode(true);
            this.destroyed = true;
            this.requestSerial += 1;
            this.artworkSerial += 1;
            app.unlisten(app.player, 'playbackState', this.onPlaybackState);
            app.unlisten(app, 'settingschange', this.onSettingsChange);
        }
    }

    LyricsWindow.prototype.override({
        initialize: function ($super, parentElement, params) {
            $super(parentElement, params);

            const UI = getAllUIElements(this.container);
            if (!UI.header || !UI.fLyrics || !window.MediaMonkeySyllableLyricsCore) {
                return;
            }

            const toggle = createToolButton('mmSyllableLyricsToggle', 'lyrics', _('Syllable lyrics'));
            const reload = createToolButton('mmSyllableLyricsReload', 'refresh', _('Reload synchronized lyrics'));
            const focus = createToolButton('mmSyllableLyricsFocus', 'mode_fullscreen', _('Fullscreen lyrics'));
            const insertionPoint = UI.saveLyricsBtn || null;
            UI.header.insertBefore(toggle.wrapper, insertionPoint);
            UI.header.insertBefore(reload.wrapper, insertionPoint);
            UI.header.insertBefore(focus.wrapper, insertionPoint);
            initializeControls(toggle.wrapper);
            initializeControls(reload.wrapper);
            initializeControls(focus.wrapper);

            const controller = new SyllableLyricsController(
                this,
                UI,
                toggle.button,
                reload.button,
                focus.button
            );
            this.addCleanFunc(() => controller.destroy());
        }
    });
})();
