# Getting Started with BoldChrome

Welcome! This guide will help you get the BoldChrome Chrome extension up and running locally.

## What is BoldChrome?

BoldChrome is a Chrome extension that uses AI to summarize Medium articles. When you click the extension icon on a Medium article, it extracts the content and generates a concise summary using Google's Generative AI.

**Key Features:**
- 🔍 Automatic Medium article detection
- 🤖 AI-powered summarization  
- 💜 Beautiful, responsive popup UI
- ⚡ Fast and lightweight
- 🛠️ Built with SvelteKit + Chrome Extensions API

## 5-Minute Quick Start

### Step 1: Install Dependencies
```bash
cd BoldChrome
pnpm install
```

### Step 2: Get Your API Key
1. Go to [Google AI Studio](https://ai.google.dev)
2. Click "Get API Key"
3. Copy your API key

### Step 3: Configure
```bash
cp .env.example .env.local
# Edit .env.local and paste your API key
```

### Step 4: Build
```bash
pnpm run build
```

### Step 5: Load in Chrome
1. Open Chrome
2. Go to `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `/build` folder
6. Done! 🎉

### Step 6: Test
1. Go to any [Medium.com](https://medium.com) article
2. Click the BoldChrome icon in your toolbar
3. Wait for the summary to generate

## File Guide

Here's what each file does and when you need to change it:

### 📚 Documentation Files
These are for reference and don't need changes:

| File | Purpose | When to Read |
|------|---------|--------------|
| `README.md` | Overview and quick start | First |
| `SETUP_CHECKLIST.md` | Step-by-step verification | Before testing |
| `QUICK_REFERENCE.md` | Common commands and tasks | During development |
| `BUILD_INSTRUCTIONS.md` | Detailed setup guide | If stuck |
| `ARCHITECTURE.md` | How the extension works | Understanding the code |
| `TROUBLESHOOTING.md` | Problem solving | If something breaks |

### Logo / Assets
If you want to replace the logo shown in the popup, add a file at `src/lib/assets/logo.png` or replace `favicon.svg` with your preferred asset. The popup currently imports `src/lib/assets/favicon.svg` as the logo; larger images from other project folders can be copied here and renamed to `logo.png` for convenience.
### ⚙️ Configuration Files
These control how the extension builds:

| File | Purpose | Change When |
|------|---------|-------------|
| `package.json` | Dependencies and scripts | Adding packages |
| `svelte.config.js` | SvelteKit settings | Building differently |
| `vite.config.ts` | Build tool settings | Performance tuning |
| `tsconfig.json` | TypeScript settings | Changing TS rules |
| `.env.local` | Your API key (secret!) | First setup only |
| `static/manifest.json` | Chrome extension settings | Extension permissions |

### 💻 Source Code Files
These are what you'll modify to develop:

| File | Purpose | Change For |
|------|---------|------------|
| `src/routes/popup/+page.svelte` | Popup UI & styling | Changing how it looks |
| `src/routes/popup/page.ts` | Popup logic & API calls | Changing how it works |
| `src/lib/stores/index.ts` | State management | Adding new data states |

## Development Workflow

### Making Changes

1. **Edit code** in `/src` folder
2. **Build:** `pnpm run build`
3. **Reload:** Go to `chrome://extensions` and click reload icon
4. **Test:** Click extension and see changes

### Checking for Errors

```bash
# Check for TypeScript/Svelte errors
pnpm run check

# Or watch for changes automatically
pnpm run check:watch
```

### Understanding the Code Flow

```
User clicks extension
        ↓
popup/page.ts runs
        ↓
Checks if on Medium.com
        ↓
If YES: Extract article text
If NO: Show error message
        ↓
Call Google API
        ↓
Get summary
        ↓
+page.svelte renders UI
        ↓
User sees summary
```

## Common Tasks

### Task: Change the styling
1. Edit `/src/routes/popup/+page.svelte`
2. Modify the `<style>` section
3. Rebuild: `pnpm run build`
4. Reload in Chrome

### Task: Change the popup size
In `/src/routes/popup/+page.svelte`, change the CSS:
```css
:global(body) {
  width: 500px;  /* Change this */
  min-height: 400px;  /* Or this */
}
```

### Task: Add new functionality
1. Edit `/src/routes/popup/page.ts` for logic
2. Edit `/src/routes/popup/+page.svelte` for UI
3. Use stores in `/src/lib/stores/index.ts` for state
4. Test with `pnpm run build`

### Task: Debug an issue
1. Right-click popup → "Inspect"
2. Check Console tab for errors
3. Check Network tab for failed requests
4. See TROUBLESHOOTING.md for solutions

## When Things Go Wrong

### Quick Diagnostic
```bash
# Verify everything is set up correctly
pnpm run verify

# This checks for all required files and configuration
```

### Most Common Issues

**Problem:** Build fails
```bash
rm -rf node_modules .svelte-kit
pnpm install
pnpm run build
```

**Problem:** API key error
- Check `.env.local` has your key
- Key must start with `PUBLIC_GOOGLE_API_KEY=`
- Rebuild after changing

**Problem:** Extension won't load
- Verify `/build/manifest.json` exists
- Try loading `/build` folder again
- Check extension errors page

**Problem:** Popup is blank
- Right-click popup → Inspect
- Check Console for red errors
- Verify on actual Medium article
- See TROUBLESHOOTING.md for detailed help

## Project Structure

```
BoldChrome/
├── src/                      ← Source code (what you edit)
│   ├── routes/popup/
│   │   ├── +page.svelte     ← Popup UI (styling & HTML)
│   │   └── page.ts          ← Popup logic (API calls)
│   └── lib/stores/
│       └── index.ts         ← State management
│
├── static/
│   └── manifest.json        ← Chrome extension config
│
├── build/                   ← Built extension (auto-generated)
│   ├── manifest.json       ← Copied to here
│   ├── popup.html
│   └── _app/               ← App code
│
├── .env.local               ← Your API key (SECRET!)
├── package.json            ← Dependencies
├── svelte.config.js        ← Framework config
├── vite.config.ts          ← Build config
│
└── Documentation/
    ├── README.md           ← Start here
    ├── QUICK_REFERENCE.md  ← Common commands
    ├── BUILD_INSTRUCTIONS.md  ← Detailed setup
    ├── ARCHITECTURE.md     ← How it works
    └── TROUBLESHOOTING.md  ← Problem solving
```

## Key Concepts

### Svelte Components
The UI is written in `.svelte` files. These have 3 sections:

```svelte
<script>
  // JavaScript logic
  let count = 0;
</script>

<div>
  <!-- HTML template -->
  <p>Count: {count}</p>
</div>

<style>
  /* CSS styling (automatically scoped) */
  p { color: blue; }
</style>
```

### Stores
Svelte stores hold shared state:

```typescript
// Define in stores/index.ts
export const summary = writable<string>('');

// Use in components
import { summary } from '$lib/stores';
<p>{$summary}</p>
```

### Chrome APIs
The extension uses Chrome's native APIs:

```typescript
// Get current tab
chrome.tabs.query({ currentWindow: true, active: true }, (tabs) => {
  const tab = tabs[0];
  console.log(tab.url);
});

// Run script in page
chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: () => document.body.innerText
});
```

## Next Steps

1. **Run the setup:**
   - Follow the 5-Minute Quick Start above
   - Use `pnpm run verify` to confirm

2. **Test the extension:**
   - Go to a Medium article
   - Click the extension
   - See it generate a summary

3. **Explore the code:**
   - Read ARCHITECTURE.md to understand how it works
   - Look at `/src/routes/popup/+page.svelte` for the UI
   - Look at `/src/routes/popup/page.ts` for the logic

4. **Make changes:**
   - Try changing the colors in the CSS
   - Try modifying the summary prompt
   - Read QUICK_REFERENCE.md for helpful commands

5. **Learn more:**
   - [SvelteKit Docs](https://svelte.dev/docs/kit)
   - [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
   - [Google Generative AI Docs](https://ai.google.dev)

## Environment Setup

### Prerequisites
- Node.js 18+ ([Download](https://nodejs.org/))
- pnpm ([Install](https://pnpm.io/installation)) or npm/yarn
- Chrome browser
- Google account for API key

### Verify Installation
```bash
node --version  # Should be v18+
pnpm --version  # Should be installed
chrome --version  # Should exist
```

## Useful Commands

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies (one-time) |
| `pnpm run build` | Build extension to `/build` |
| `pnpm run check` | Check for TypeScript errors |
| `pnpm run verify` | Verify everything is set up |
| `pnpm run build:prod` | Build optimized for production |

## Support & Resources

- **Need help?** See TROUBLESHOOTING.md
- **Quick commands?** See QUICK_REFERENCE.md
- **Detailed setup?** See BUILD_INSTRUCTIONS.md
- **How does it work?** See ARCHITECTURE.md
- **Common errors?** See TROUBLESHOOTING.md

## Tips for Success

✅ **DO:**
- Read SETUP_CHECKLIST.md before testing
- Use `pnpm run verify` when stuck
- Rebuild (`pnpm run build`) after code changes
- Reload extension in Chrome after rebuilds
- Check console for error messages

❌ **DON'T:**
- Commit `.env.local` to git (it's ignored for security)
- Forget to rebuild after editing code
- Select the wrong folder when loading unpacked
- Edit files in `/build` directory (it's auto-generated)

## You're Ready!

Everything is set up for you to start developing. Follow the 5-Minute Quick Start above and you'll have a working Chrome extension in minutes.

Happy coding! 🚀

---

**Next:** Run `pnpm install` and follow the Quick Start steps!
