# Broadcast Timer (Electron)

Dual broadcast counters with UP/DN modes, large on-screen display, and a system clock footer that supports local or manual time.

## Features

- Two independent timer cards
- UP mode and DN mode per timer
- `SET`, `START/PAUSE`, `RESET`
- Keyboard-friendly time input (`HH:MM:SS`, numeric only, auto-advance, Enter triggers `SET`)
- Progress bar per timer
- Footer system clock (local machine time by default)
- Manual system clock offset via `SET`
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

## System Clock

1. The footer clock follows the local machine clock by default.
2. Enter a manual time in the footer inputs and press `SET` to apply an offset.

## Main Files

- `index.html` – UI structure
- `style.css` – layout and visual styles
- `script.js` – timer + clock logic
- `main.js` / `preload.js` – Electron main/preload wiring
- `forge.config.js` – build and maker config
- `scripts/generate-icons.js` – icon conversion pipeline

## Open Source Setup (Safe Main Branch)

To keep the project open for community improvements without allowing direct overwrites of `main`, use this flow:

1. Make the repository public on GitHub.
2. Let contributors work through forks + Pull Requests.
3. Protect `main` with branch rules.

### Recommended Branch Protection (GitHub)

In GitHub:

`Repository -> Settings -> Branches -> Add branch protection rule`

Use pattern:

`main`

Enable:

- Require a pull request before merging
- Require approvals (at least 1)
- Dismiss stale approvals when new commits are pushed
- Require conversation resolution before merging
- Require status checks to pass before merging (if you add CI)
- Restrict who can push to matching branches (only maintainers)
- Do not allow force pushes
- Do not allow deletions

### Contribution Flow

1. Fork the repo
2. Create a feature branch
3. Open a Pull Request to `main`
4. Review + merge via PR only

## License

This project is licensed under the ISC License.
See [LICENSE](./LICENSE).
