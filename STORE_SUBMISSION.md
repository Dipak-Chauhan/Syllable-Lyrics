# MediaMonkey Add-on Store Submission

Prepared for Syllable Lyrics version 0.1.20.

## Form Values

| Field | Value |
| --- | --- |
| Category | MediaMonkey 5 / 2024 > Management > Metadata lookup |
| Name | Syllable Lyrics |
| Author | GhosT |
| License Type | MIT |
| Version | 0.1.20 |
| Compatibility | MediaMonkey 5.0.0 through MediaMonkey 2024 |
| Upload | `dist/SyllableLyrics-0.1.20.mmip` |
| External Download Link | Leave blank; upload the MMIP directly |
| Support Link | https://github.com/Dipak-Chauhan/Syllable-Lyrics/issues |
| Author Link | https://github.com/Dipak-Chauhan/Syllable-Lyrics |
| Image | Optional but recommended; upload a square Syllable Lyrics icon or screenshot |

## Description

Syllable Lyrics brings synchronized, word-by-word karaoke lyrics to MediaMonkey 5 and MediaMonkey 2024. It extends MediaMonkey's built-in Lyrics panel and does not replace application files.

### Highlights

- Word and syllable highlighting synchronized with playback
- Clickable timed lines for seeking and automatic active-line centering
- Embedded enhanced LRC support, including word timestamps
- TTML, ordinary line-synchronized LRC, and plain-text fallback
- Background vocals and alternating singer alignment when provided by the lyric source
- Blurred current-album-art backgrounds in the Lyrics panel and fullscreen view
- Fullscreen lyrics with centered karaoke presentation
- Lyrics+ compatible KPOE, Unison, and LRCLIB online fallback
- Optional romanization with provider-supplied transliteration preferred
- Configurable timing offset, online lookup, and smooth scrolling

After installation and the requested MediaMonkey reload, open the Lyrics panel. Use the lyrics button in the panel header to switch between standard and synchronized lyrics. The adjacent controls retry the lyric lookup and open fullscreen lyrics. Settings are available from Tools > Addons > Syllable Lyrics > Configure.

### Online Data and Privacy

Online lookup is optional and enabled by default. When enabled, Syllable Lyrics sends the current track title, artist, album, duration, and ISRC when available to Lyrics+ compatible KPOE services, Unison, and LRCLIB in that order.

When Romanize is enabled, provider-supplied transliteration is used first. If none is available and online lookup remains enabled, non-Latin lyric text is sent to Google Translate's romanization endpoint.

Online lookup can be disabled in the add-on settings. With online lookup disabled, track metadata and lyric text remain local. Third-party service availability, content, accuracy, and terms are controlled by their respective operators.

Syllable Lyrics is independently developed and is not affiliated with or endorsed by MediaMonkey, Lyrics+, Unison, LRCLIB, Google, or the operators of those services.

## What's New in 0.1.20

- Initial public release of synchronized word and syllable karaoke highlighting
- Added embedded enhanced LRC, TTML, line-timed, and plain-text lyric support
- Added Lyrics+ compatible KPOE, Unison, and LRCLIB provider fallback
- Added normal and fullscreen blurred album-art backgrounds
- Added clickable seeking, smooth active-line centering, timing offset, and retry controls
- Added background-vocal, singer-alignment, and romanization support

## Moderator Notes

- The MMIP is a ZIP archive with `info.json` at its root.
- The add-on extends `controls/lyricsWindow.js` and `skin/skin_base.less` through MediaMonkey's `_add` mechanism.
- The package includes `README.md`, `license.txt`, and `THIRD_PARTY_NOTICES.md`.
- The add-on is MIT licensed. Adapted YouLyPlus portions retain the upstream copyright notice and MIT license.
- Online behavior and the controls for disabling it are disclosed in the listing and package README.

## Final Submission Checklist

- Sign in with a MediaMonkey forum account at https://www.mediamonkey.com/addon_system/admin/login.php.
- Perform a clean install and uninstall test using the packaged MMIP.
- Confirm operation on every MediaMonkey version selected in the compatibility form.
- Optionally upload a square listing image and provide public support and author links.
- Select Submit New Addon under the Metadata lookup category and enter the form values above.
- Upload the MMIP, enter the description and release notes, save, review, and finish the submission.
- Wait for moderator approval; the listing remains red in the publisher interface until approved.

Official instructions: https://www.mediamonkey.com/wiki/Getting_Started_%28Addons%29#Submitting_an_addon
