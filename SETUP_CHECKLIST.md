# BoldChrome Setup Checklist

Use this checklist to ensure your development environment is properly configured.

## Prerequisites
- [ ] Node.js v18+ installed (`node --version`)
- [ ] pnpm installed (`pnpm --version`) or npm available
- [ ] Chrome/Chromium browser installed
- [ ] Git configured (for version control)

## Initial Setup

- [ ] Clone/navigate to BoldChrome directory
- [ ] Run `pnpm install` (or `npm install`)
- [ ] Copy `.env.example` to `.env.local`
- [ ] Add Google API key to `.env.local`

## Google API Key Setup

- [ ] Visit [Google AI Studio](https://ai.google.dev)
- [ ] Create or copy your API key
- [ ] Add key to `.env.local`: `PUBLIC_GOOGLE_API_KEY=your_key`
- [ ] ✅ Verify it's NOT committed to git (`.gitignore` should exclude it)

## Build & Test

- [ ] Run `pnpm run build` successfully
- [ ] Verify `/build` directory is created with `manifest.json`
- [ ] Check for any TypeScript errors: `pnpm run check`

## Chrome Extension Loading

- [ ] Open Chrome
- [ ] Go to `chrome://extensions`
- [ ] Enable "Developer mode" (top right)
- [ ] Click "Load unpacked"
- [ ] Select the `/build` directory
- [ ] See "Bold Bitcoin Wallet" extension loaded

## Extension Testing

### Test on Medium Article
- [ ] Navigate to [medium.com](https://medium.com)
- [ ] Find and open any article
- [ ] Click BoldChrome extension icon
- [ ] Wait for "Processing article..." message
- [ ] See generated summary appear

### Test on Non-Medium Site
- [ ] Go to any non-Medium website (e.g., google.com)
- [ ] Click BoldChrome extension icon
- [ ] See error message: "Please visit a Medium article to use this extension"

### Check DevTools
- [ ] Right-click popup → "Inspect"
- [ ] Check Console for any error messages
- [ ] Verify network requests are being made

## Development Workflow

- [ ] Make code changes
- [ ] Run `pnpm run build`
- [ ] Go to `chrome://extensions`
- [ ] Click reload icon on BoldChrome
- [ ] Test changes in Chrome

## Type Checking

- [ ] Run `pnpm run check` for one-time check
- [ ] Run `pnpm run check:watch` for continuous checking while developing

## Troubleshooting

If you encounter issues:

1. **Build fails:**
   - [ ] Delete `/node_modules` and `/.svelte-kit`
   - [ ] Run `pnpm install` again
   - [ ] Run `pnpm run build`

2. **Extension won't load:**
   - [ ] Verify `/build/manifest.json` exists
   - [ ] Check Chrome DevTools for permission errors
   - [ ] Try disabling and re-enabling the extension

3. **API key errors:**
   - [ ] Verify key is valid at [Google AI Studio](https://ai.google.dev)
   - [ ] Check `.env.local` has exact format: `PUBLIC_GOOGLE_API_KEY=xxx`
   - [ ] Rebuild after changing `.env.local`

4. **Popup appears blank:**
   - [ ] Inspect popup with DevTools (right-click → Inspect)
   - [ ] Check Console for JavaScript errors
   - [ ] Verify you're on a Medium article

## Additional Notes

- Don't commit `.env.local` (it's in `.gitignore`)
- Source maps are enabled in dev builds for debugging
- Use `pnpm run build:prod` for optimized production build
- See `BUILD_INSTRUCTIONS.md` for detailed documentation

## Helpful Commands

```bash
# Setup
pnpm install

# Development
pnpm run build
pnpm run check:watch

# Testing
pnpm run build:prod
pnpm run preview

# Type checking
pnpm run check
```

---

**Need help?** See `BUILD_INSTRUCTIONS.md` for detailed setup and troubleshooting guide.
