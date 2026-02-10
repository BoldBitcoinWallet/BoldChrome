# BoldChrome – Bold Bitcoin Wallet (Chrome Extension)

A **watch-only** Bitcoin wallet Chrome extension that pairs with the Bold mobile app via **QR codes**. Built with SvelteKit and the Chrome Extensions API.

## Features

- Pair with Bold mobile app via QR (no backend required)
- View balance and addresses (watch-only)
- Send / Receive flows; QR-based signing with mobile
- Light/dark theme; compact popup UI

## Quick start

```bash
npm install
npm run build
```

Then in Chrome: **chrome://extensions** → Enable **Developer mode** → **Load unpacked** → select the **`build`** folder (or `extension-build` if your build outputs there).

## Docs

- **[BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md)** – Build, load, and debug
- **[ARCHITECTURE.md](ARCHITECTURE.md)** – Project structure and flow
- **[docs/PAIRING_VIA_QR.md](docs/PAIRING_VIA_QR.md)** – QR pairing flow
- **[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)** – UI/theme

## Commands

| Command            | Description                |
|--------------------|----------------------------|
| `npm run build`    | Build extension            |
| `npm run build:prod` | Production build        |
| `npm run check`    | TypeScript + Svelte check  |
| `npm run verify`   | Verify build/setup         |

## Tech

- **SvelteKit** + **Vite** + **TypeScript**
- **Chrome Extension** (Manifest v3)
- **sveltekit-adapter-chrome-extension** for build output
