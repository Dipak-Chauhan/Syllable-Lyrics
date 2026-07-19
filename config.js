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

    window.configInfo = {
        load: function (panel) {
            this.settings = app.getValue(SETTINGS_KEY, { ...DEFAULT_SETTINGS });
            const UI = getAllUIElements(panel);
            UI.enabled.controlClass.checked = Boolean(this.settings.enabled);
            UI.online.controlClass.checked = Boolean(this.settings.online);
            UI.romanization.controlClass.checked = Boolean(this.settings.romanization);
            UI.smoothScroll.controlClass.checked = Boolean(this.settings.smoothScroll);
            UI.offsetMs.controlClass.value = String(Number(this.settings.offsetMs) || 0);
        },

        save: function (panel) {
            const UI = getAllUIElements(panel);
            const offset = Number(UI.offsetMs.controlClass.value);
            this.settings.enabled = UI.enabled.controlClass.checked;
            this.settings.online = UI.online.controlClass.checked;
            this.settings.romanization = UI.romanization.controlClass.checked;
            this.settings.smoothScroll = UI.smoothScroll.controlClass.checked;
            this.settings.offsetMs = Number.isFinite(offset)
                ? Math.max(-10000, Math.min(10000, Math.round(offset)))
                : 0;
            app.setValue(SETTINGS_KEY, this.settings);
            app.notifySettingsChange();
        }
    };
})();
