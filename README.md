# BoldChrome - Bitcoin Wallet Extension for Bold

A Chrome extension built with **SvelteKit** that enables secure communication between the Bold Bitcoin Wallet mobile app and your web browser. It allows you to manage Bitcoin transactions, sign PSBTs, and pair with your mobile wallet device via QR code.

## Quick Start

For complete setup and development instructions, see:
- 📖 **[BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md)** - Detailed setup guide
- ✅ **[SETUP_CHECKLIST.md](SETUP_CHECKLIST.md)** - Quick verification checklist
- 🔗 **[PAIRING_VIA_QR.md](docs/PAIRING_VIA_QR.md)** - Device pairing instructions

## Overview

**BoldChrome** is a companion extension to the Bold Bitcoin Wallet that allows you to interact with your hardware-backed Bitcoin wallet from your desktop browser. Scan a QR code to pair with your mobile device and securely sign transactions.

### Features
- 📱 QR code-based device pairing
- 🔐 End-to-end encrypted communication (ECIES)
- ✍️ Secure PSBT transaction signing
- 💰 Bitcoin send/receive operations
- 🔒 HSM-backed key management (TSS)
- 🌐 Testnet & Mainnet support

## Prerequisites

- **Node.js** v18+ and **pnpm** (or npm)
- **Chrome** browser (v90+)
- **Bold Wallet mobile app** (paired device)
- No API keys needed—fully self-custodial

## Quick Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Build the extension
pnpm run build

# 3. Load in Chrome
# - Go to chrome://extensions
# - Enable "Developer mode" (top-right toggle)
# - Click "Load unpacked"
# - Select the /build directory

# 4. Open the extension and scan the QR code from your Bold mobile app
# - Click the extension icon in Chrome toolbar
# - Allow camera permissions when prompted
# - Scan the pairing QR from your mobile wallet
```

## Development Commands

```bash
pnpm run build          # Build extension (dev mode)
pnpm run build:prod     # Production build (optimized)
pnpm run check          # Type check (TypeScript + Svelte)
pnpm run check:watch    # Watch mode type checking
pnpm run preview        # Preview build locally
```

## Project Structure

```
src/
├── routes/
│   ├── +layout.svelte      # Layout
│   ├── +page.svelte        # Main page
│   └── popup/
│       ├── +page.svelte    # Popup UI
│       └── page.ts         # Popup logic & Chrome API
├── lib/
│   └── stores/index.ts     # Svelte stores
static/
└── manifest.json           # Chrome extension manifest
```

## Testing in Chrome

1. Build: `pnpm run build`
2. Open Chrome: `chrome://extensions`
3. Enable Developer Mode
4. Click "Load unpacked" (toggle in top-right)
4. Click "Load unpacked" → select `/build` folder
5. Open the Bold mobile app and generate a pairing QR code
6. Click the extension icon and scan the QR

## Troubleshooting

**Extension won't load?**
- Verify `/build/manifest.json` exists
- Check Chrome DevTools for errors (F12)
- Try clicking "Reload" on the extension card

**Camera permissions denied?**
- Click the extension icon → allow camera access
- Check Chrome settings: Settings → Privacy → Site Settings → Camera
- Reload the extension

**QR code won't scan?**
- Ensure good lighting and distance (6-12 inches)
- Try rotating the QR code
- Check browser console for camera errors

**Can't connect to mobile device?**
- Verify both devices are on the same WiFi network
- Check local network permissions in Chrome
- Ensure mobile app is in pairing mode
- Try restarting both apps
## Documentation

- [📋 Complete Build Instructions](BUILD_INSTRUCTIONS.md)
- [✅ Setup Checklist](SETUP_CHECKLIST.md)
- [🔗 Chrome Extension Manifest](static/manifest.json)

## Tech Stack

- **Framework:** SvelteKit 2.x
- **Build Tool:** Vite
- **Language:** TypeScript
- **Styling:** Scoped Svelte CSS

## Resources

- [SvelteKit Docs](https://svelte.dev/docs/kit)
- [Chrome Extension API](https://developer.chrome.com/docs/extensions/)
- [Google Generative AI](https://ai.google.dev)
- [Manifest v3](https://developer.chrome.com/docs/extensions/mv3/)

## License

See LICENSE file

---

**Need help?** See [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md) for detailed setup and troubleshooting.
