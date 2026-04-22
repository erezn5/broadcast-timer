# Broadcast Timer (Electron)

Dual broadcast counters with UP/DN modes, large on-screen display, and a manual-adjustable system clock footer.

## Features

- Two independent timer cards
- UP mode and DN mode per timer
- `SET`, `START/PAUSE`, `RESET`
- Keyboard-friendly time input (`HH:MM:SS`, numeric only, auto-advance, Enter triggers `SET`)
- Progress bar per timer
- Footer system clock (local machine time + optional manual offset via `SET`)
- Layout toggle: single timer / two timers
- Electron packaging for macOS, Windows, and Linux
- Icon generation pipeline from `.ico` source

## Requirements

- Node.js 18+ (recommended)
- npm
- macOS for generating `.icns` locally (script uses `sips`)

## Install

```bash
npm install
```

## Run In Development

```bash
npm start
```

## Build Icons

Default source is:

```text
assets/icons/icon.ico
```

Generate all target icons:

```bash
npm run generate-icons
```

Outputs:

- `assets/icons/icon.icns` (macOS)
- `assets/icons/icon.ico` (Windows)
- `assets/icons/icon.png` (general / runtime / Linux makers)
- `assets/icons/linux/icon-*.png` (Linux sizes)

Optional: use a different source file:

```bash
node scripts/generate-icons.js path/to/source.ico
```

## Package / Make Artifacts

General:

```bash
npm run make
```

Specific targets:

```bash
npm run make -- --platform=darwin --arch=arm64 --targets=@electron-forge/maker-zip
npm run make -- --platform=win32 --arch=x64 --targets=@electron-forge/maker-zip
```

Artifacts are created under:

```text
out/make
```

## How To Use The Timers

1. Choose mode: `UP` or `DN`
2. Enter time in `HH:MM:SS`
3. Press `SET` (or press `Enter` while focused in a time field)
4. Press `START` (button changes to `PAUSE` while running)
5. Press `RESET` to return to the configured value in the input fields

## Main Files

- `index.html` – UI structure
- `style.css` – layout and visual styles
- `script.js` – timer + clock logic
- `main.js` / `preload.js` – Electron main/preload wiring
- `forge.config.js` – build and maker config
- `scripts/generate-icons.js` – icon conversion pipeline
