# BoldChrome Extension - Local Development Guide

## Project Overview

BoldChrome is a Chrome extension built with **SvelteKit** that provides AI-powered article summaries for Medium.com articles using Google's Generative AI.

### Key Features
- Detects when you're on a Medium article
- Extracts article content
- Generates intelligent summaries using Google Generative AI
- Clean, responsive popup UI

---

## Prerequisites

Before you start, make sure you have installed:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **pnpm** (recommended) or npm/yarn
  - Install pnpm: `npm install -g pnpm`
- **Chrome Browser** (or any Chromium-based browser)

### Optional Dependencies

For linting and code quality:
- **ESLint** - Will be installed via dev dependencies
- **Svelte Check** - Included in devDependencies

---

## Setup Instructions

### 1. Install Dependencies

```bash
cd BoldChrome
pnpm install
# or if using npm:
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the project root with your Google API key:

```bash
cp .env.example .env.local
```

Then edit `.env.local` and add your actual Google Generative AI API key:

```
PUBLIC_GOOGLE_API_KEY=your_actual_api_key_here
```

**How to get a Google API Key:**

1. Go to [Google AI Studio](https://ai.google.dev)
2. Click "Get API Key"
3. Create a new API key or use an existing one
4. Copy the key and paste it into `.env.local`

⚠️ **Important:** Never commit `.env.local` to version control. The file is already in `.gitignore`.

---

## Development Workflow

### Build the Extension

#### Development Build (with source maps)
```bash
pnpm run build
```

This creates a `/build` directory with the compiled extension.

#### Production Build (optimized)
```bash
pnpm run build:prod
```

Creates an optimized production build in `/build`.

### Type Checking

Check for TypeScript and Svelte errors without building:

```bash
pnpm run check
```

For continuous checking while developing:

```bash
pnpm run check:watch
```

### Preview Build

To run a preview server of the built extension:

```bash
pnpm run preview
```

---

## Loading the Extension in Chrome

### Step-by-Step Guide

1. **Build the extension:**
   ```bash
   pnpm run build
   ```

2. **Open Chrome Extensions Page:**
   - Press `Ctrl+Shift+M` on Windows/Linux or `Cmd+Shift+M` on Mac
   - Or go to: `chrome://extensions`

3. **Enable Developer Mode:**
   - Toggle the "Developer mode" switch (top right corner)

4. **Load the Extension:**
   - Click "Load unpacked"
   - Navigate to the `BoldChrome/build` directory
   - Select the folder and click "Select Folder"

5. **Verify Installation:**
   - You should see "Bold Bitcoin Wallet" extension in your extensions list
   - Click the extension icon to see the popup

### Testing the Extension

1. **Visit a Medium Article:**
   - Go to any article on [medium.com](https://medium.com)
   - Click the BoldChrome extension icon in the toolbar
   - The popup should show "Processing article..."
   - After a moment, you'll see a summary
   - If `PUBLIC_GOOGLE_API_KEY` is not set, a **mock summary** (first ~500 characters) will be shown for testing

2. **Test on Non-Medium Sites:**
   - Navigate to any non-Medium website
   - Click the extension icon
   - It should display "Please visit a Medium article to use this extension"

---

## File Structure

```
src/
├── routes/
│   ├── +layout.svelte       # Root layout wrapper
│   ├── +page.svelte         # Main page (currently landing)
│   └── popup/
│       ├── +page.svelte     # Popup UI component (wallet UI)
│       └── page.ts          # Popup logic (API calls, Chrome integration)
│
├── lib/
│   ├── stores/
│   │   └── index.ts        # Svelte stores (onMedium, summary)
│   └── assets/
│       └── favicon.svg     # Default logo used in popup (replaceable)

**Replace or add** `src/lib/assets/logo.png` (or `favicon.svg`) to change the popup logo to your preferred image.│
├── app.html                 # Root HTML template
└── app.d.ts               # TypeScript definitions

static/
├── manifest.json           # Chrome extension manifest
└── robots.txt

Configuration Files:
├── svelte.config.js        # SvelteKit config (uses Chrome extension adapter)
├── vite.config.ts          # Vite build config
├── tsconfig.json           # TypeScript config
├── package.json            # Dependencies and scripts
└── .env.local              # Local environment variables (not in git)
```

---

## Build Output

When you run `pnpm run build`, the compiled extension is created in the `/build` directory:

```
build/
├── _app/                    # SvelteKit app files
├── index.html              # Entry HTML
├── manifest.json           # Chrome extension manifest (copied from static/)
└── popup.html              # Popup page
```

---

## Debugging

### Chrome DevTools for Extension

1. **Inspect the Popup:**
   - Right-click the extension popup
   - Select "Inspect"
   - DevTools will open

2. **View Extension Logs:**
   - Extensions page → Find "Bold Bitcoin Wallet"
   - Click "Details"
   - Click "Errors" to see any runtime errors

3. **Enable Source Maps:**
   - Source maps are automatically enabled in development builds
   - You can see original TypeScript/Svelte source in DevTools

### Common Issues

**Issue:** "PUBLIC_GOOGLE_API_KEY is undefined"
- **Solution:** Make sure `.env.local` exists and has `PUBLIC_GOOGLE_API_KEY` set

**Issue:** Extension not loading
- **Solution:** 
  - Delete the extension and rebuild
  - Make sure you're loading from the `/build` directory
  - Check the extension details page for errors

**Issue:** Popup is blank
- **Solution:**
  - Check Chrome DevTools console for errors
  - Verify the Google API key is valid
  - Check that you're on a Medium.com article

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `pnpm run build` | Build extension (development) |
| `pnpm run build:prod` | Build extension (production/optimized) |
| `pnpm run preview` | Preview build locally |
| `pnpm run check` | Check TypeScript & Svelte types |
| `pnpm run check:watch` | Watch mode for type checking |
| `pnpm run test` | Run tests (placeholder for now) |

---

## Development Tips

### Hot Reload During Development

Currently, you need to:
1. Make code changes
2. Run `pnpm run build`
3. Go to `chrome://extensions`
4. Click the reload icon on the BoldChrome extension

Future enhancement: Set up auto-rebuild with file watcher.

### Styling

The extension uses scoped Svelte styles. Modify styles in the `<style>` block of:
- `/src/routes/popup/+page.svelte`

The gradient purple theme is currently set inline; adjust colors as needed.

### Adding API Requests

The extension uses the native `fetch` API. You can add more API calls in:
- `/src/routes/popup/page.ts` - Main extension logic
- Update the stores in `/src/lib/stores/index.ts` to manage state

---

## Updating Dependencies

Check for updates:
```bash
pnpm outdated
```

Update all dependencies:
```bash
pnpm update
```

Update a specific package:
```bash
pnpm add -u package-name
```

---

## Troubleshooting

### Extension not showing in Chrome
- Check if Developer Mode is enabled
- Try reloading the extension (reload icon on extensions page)
- Check for errors on the extension details page

### API key errors
- Verify the key is valid in [Google AI Studio](https://ai.google.dev)
- Check that `.env.local` has the correct format
- Ensure the key has access to the Generative AI API

### Build errors
- Delete `/node_modules` and `.svelte-kit` directory
- Run `pnpm install` again
- Try building: `pnpm run build`

---

## Next Steps

1. **Testing:** Set up automated tests with Vitest/Playwright
2. **Content Script:** Add content script support for direct page interaction
3. **Background Service Worker:** Add background tasks if needed
4. **Chrome Web Store:** Prepare for publishing to Chrome Web Store
5. **Additional Features:** Context menu integration, keyboard shortcuts, etc.

---

## Resources

- [SvelteKit Documentation](https://svelte.dev/docs/kit)
- [Chrome Extension API](https://developer.chrome.com/docs/extensions/)
- [Google Generative AI API](https://ai.google.dev)
- [Manifest v3 Guide](https://developer.chrome.com/docs/extensions/mv3/)

---

## Support

For issues or questions:
1. Check the [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
2. Review the [SvelteKit Docs](https://svelte.dev/docs/kit)
3. Check Google AI documentation for API issues
