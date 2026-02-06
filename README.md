# BoldChrome - AI-Powered Medium Article Summarizer Extension

A Chrome extension built with **SvelteKit** that (for local development) shows a mock Bitcoin wallet popup with balance, transactions, and send/receive actions. It can also be extended to use Google's Generative AI for article summarization.

## Quick Start

For complete setup and development instructions, see:
- 📖 **[BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md)** - Detailed setup guide
- ✅ **[SETUP_CHECKLIST.md](SETUP_CHECKLIST.md)** - Quick verification checklist

## Overview

**BoldChrome** detects when you're reading a Medium article, extracts the content, and generates a concise AI-powered summary using Google's Generative AI API.

### Features
- 🔍 Automatic Medium article detection
- 🤖 AI-powered content summarization
- 💜 Clean, modern popup interface
- ⚡ Fast and lightweight
- 🔒 Client-side processing (API key needed)

## Prerequisites

- **Node.js** v18+ and **pnpm** (or npm)
- **Chrome** browser
- **Google API Key** (get it free at [ai.google.dev](https://ai.google.dev))

## Quick Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment template
cp .env.example .env.local

# 3. Add your Google API key to .env.local
# PUBLIC_GOOGLE_API_KEY=your_key_here

# 4. Build the extension
pnpm run build

# 5. Load in Chrome
# - Go to chrome://extensions
# - Enable "Developer mode"
# - Click "Load unpacked"
# - Select the /build directory
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
4. Click "Load unpacked" → select `/build` folder
5. Test on any Medium article

## Troubleshooting

**Extension won't load?**
- Verify `/build/manifest.json` exists
- Check Chrome DevTools for errors
- Try reloading the extension

**API key errors?**
- Verify key at [Google AI Studio](https://ai.google.dev)
- Check `.env.local` format
- Rebuild after changing `.env.local`

**Popup blank?**
- Right-click popup → Inspect
- Check Console tab for errors
- Verify you're on a Medium article

## Documentation

- [📋 Complete Build Instructions](BUILD_INSTRUCTIONS.md)
- [✅ Setup Checklist](SETUP_CHECKLIST.md)
- [🔗 Chrome Extension Manifest](static/manifest.json)

## Tech Stack

- **Framework:** SvelteKit 2.x
- **Build Tool:** Vite
- **Language:** TypeScript
- **Styling:** Scoped Svelte CSS
- **API:** Google Generative AI + Chrome Extensions API

## Resources

- [SvelteKit Docs](https://svelte.dev/docs/kit)
- [Chrome Extension API](https://developer.chrome.com/docs/extensions/)
- [Google Generative AI](https://ai.google.dev)
- [Manifest v3](https://developer.chrome.com/docs/extensions/mv3/)

## License

See LICENSE file

---

**Need help?** See [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md) for detailed setup and troubleshooting.
