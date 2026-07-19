# Syllable Lyrics for MediaMonkey

Syllable Lyrics adds synchronized word-by-word karaoke highlighting to MediaMonkey 5 and MediaMonkey 2024. It extends the built-in Lyrics panel through MediaMonkey's add-on system and does not replace application files.

<img width="1920" height="1080" alt="Screenshot (21)" src="https://github.com/user-attachments/assets/4ea4ba1e-2aae-459d-b881-5abf42c2e430" />

## Fullscreen Mode

<img width="1920" height="1080" alt="Screenshot (22)" src="https://github.com/user-attachments/assets/44312974-3ec4-44a9-a56f-2029bb10edb0" />

## Romanized

<img width="1920" height="1080" alt="Screenshot (25)" src="https://github.com/user-attachments/assets/d7f35671-7ac7-4bfc-9f4b-9c86d0c0b7de" />

<img width="1920" height="1080" alt="Screenshot (24)" src="https://github.com/user-attachments/assets/03809175-deaf-4f1f-a915-fccae1bad469" />



## Features

- Word and syllable highlighting synchronized with playback
- Clickable timed lines for seeking
- Smooth automatic centering of the active lyric line
- Embedded enhanced LRC and TTML word timing
- Ordinary LRC line timing and plain-text fallback
- Background vocals and alternating singer alignment when supplied by the provider
- Lyrics+ compatible KPOE, Unison, and LRCLIB online lookup
- Optional provider or Google-powered romanization
- Blurred current-album-art backgrounds in normal and fullscreen modes
- Configurable timing offset, online lookup, and smooth scrolling

## Requirements

- MediaMonkey 5 or MediaMonkey 2024 on Windows
- An active track with embedded lyrics or enough metadata for online lookup
- Node.js 18 or newer only when building from source

## Installation

### Install a Release

1. Open the [latest GitHub release](https://github.com/Dipak-Chauhan/Syllable-Lyrics/releases/latest).
2. Download `SyllableLyrics-0.1.20.mmip` from the release assets.
3. In MediaMonkey, open `Tools > Addons`.
4. Select `Add` and choose the downloaded `.mmip` file.
5. Reload MediaMonkey when prompted.

### Build and Install from Source

```powershell
git clone https://github.com/Dipak-Chauhan/Syllable-Lyrics.git
cd Syllable-Lyrics
npm install
npm test
npm run check
npm run build
```

Install `dist/SyllableLyrics-0.1.20.mmip` from `Tools > Addons > Add`, then reload MediaMonkey.

## Usage

1. Configure the Lyrics panel. Go to View (Top bar) --> Layout,

<img width="1920" height="1080" alt="Screenshot (19)" src="https://github.com/user-attachments/assets/3cd99577-a677-40ba-93fe-6d6284c2a12a" />

3. then drag the Lyrics panel wherever you want; you can adjust its position as you like.
4. Select a timed lyric line to seek to that position in the track.
5. Use the refresh button to clear the cached result and retry embedded and online lyric lookup.
6. Use the fullscreen button for centred lyrics over blurred album artwork.
7. Use `Romanize` to switch between original and Latin-script lyrics when romanization is available.

Syllable Lyrics starts enabled. The normal and fullscreen views share the same Romanize setting.

## Settings

Open `Tools > Addons > Syllable Lyrics > Configure`.

| Setting | Default | Behavior |
| --- | --- | --- |
| Enable Syllable Lyrics | On | Shows synchronized lyrics instead of the standard lyrics view |
| Allow online lyric lookup | On | Searches online providers when embedded lyrics do not contain the best available timing |
| Show romanized lyrics | Off | Shows provider romanization or generates it online when possible |
| Smooth automatic scrolling | On | Animates movement to the active lyric line |
| Timing offset | `0 ms` | Positive values highlight earlier; negative values highlight later |

The timing offset accepts values from `-10000` to `10000` milliseconds.

## Supported Lyrics

Syllable Lyrics uses the most detailed result available: word timing, then line timing, then plain text. Embedded word-timed lyrics are used without an online request. When enabled, online providers can replace less detailed embedded lyrics with a better-timed result.

Ordinary LRC provides line synchronization:

```text
[00:12.00]First line
[00:15.50]Second line
```

Enhanced LRC provides word or syllable synchronization:

```text
[00:12.00]<00:12.00>First <00:12.45>line
```

TTML with timed paragraphs or spans is also supported. Embedded lyrics containing only plain text remain readable without synchronization.

## Online Data and Privacy

Online lookup is optional and enabled by default. It sends the current track title, artist, album, duration, and ISRC when available to these services:

1. Lyrics+ compatible KPOE services used by YouLyPlus
2. Unison
3. LRCLIB

The providers are queried together, and the add-on chooses the most detailed result while preserving the order above when quality is equal. Provider availability and lyric accuracy are outside this add-on's control.

When Romanize is enabled, provider-supplied transliteration is preferred. If it is unavailable and online lookup is enabled, non-Latin lyric text is sent to Google Translate's romanization endpoint.

Disable online lookup in the add-on settings to keep track metadata and lyric text local.

## Troubleshooting

- No synchronized lyrics: verify the title and artist metadata, enable online lookup, then use the refresh button.
- Lyrics are early or late: adjust the timing offset in the add-on settings.
- Only plain lyrics appear: the embedded or online result does not contain line or word timestamps.
- Romanize is unavailable: the lyrics are already Latin script, the provider has no transliteration, or online lookup is disabled.
- Standard lyrics are preferred: select the lyrics button in the panel header to switch views.

## Development

The project requires Node.js 18 or newer for checks and tests, plus PowerShell 7 or Windows PowerShell 5 for packaging.

```powershell
npm install
npm test
npm run check
npm run build
```

The `.mmip` format is a ZIP archive with `info.json` at its root. `build.ps1` packages only runtime files and user documentation; dependencies, tests, store-submission notes, and workspace metadata are excluded.

## Credits

The timed-lyrics data model, provider strategy, enhanced LRC and TTML parsing approach, and karaoke rendering behavior are adapted from [YouLyPlus](https://github.com/ibratabian17/YouLyPlus), licensed under MIT by Ibra Al Tabian. See `THIRD_PARTY_NOTICES.md` and `license.txt`.

## License

Syllable Lyrics is licensed under the MIT License. Copyright (c) 2026 GhosT. Adapted YouLyPlus portions retain Copyright (c) 2025 Ibra Al Tabian. See `license.txt` for the complete license text.
