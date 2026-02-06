# BoldChrome - Quick Reference Guide

## One-Time Setup (First Time Only)

```bash
cd BoldChrome
pnpm install
cp .env.example .env.local
# Edit .env.local and add your Google API key
```

## Daily Development Workflow

### 1. Build Extension
```bash
pnpm run build
```
Creates `/build` directory with compiled extension.

### 2. Load in Chrome
1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select `/BoldChrome/build` folder
5. Extension appears in Chrome toolbar

### 3. Test Changes
1. Make code changes in `/src`
2. Run `pnpm run build` again
3. Go back to `chrome://extensions`
4. Click reload icon on BoldChrome extension
5. Test in Chrome

## Common Commands

```bash
# Check for TypeScript/Svelte errors
pnpm run check

# Watch mode (auto-checks on file changes)
pnpm run check:watch

# Preview the production build
pnpm run preview

# Verify setup
pnpm run verify
```

## File Locations

| What | Where |
|------|-------|
| Extension popup UI | `src/routes/popup/+page.svelte` |
| Extension logic | `src/routes/popup/page.ts` |
| State management | `src/lib/stores/index.ts` |
| Chrome manifest | `static/manifest.json` |
| Styles | Inside `<style>` blocks in `.svelte` files |
| Environment vars | `.env.local` (not in git) |

## Debugging in Chrome

### View Popup Errors
1. Right-click extension popup
2. Select "Inspect"
3. Open DevTools Console tab
4. See any JavaScript errors

### View Extension Errors
1. Go to `chrome://extensions`
2. Find "Bold Bitcoin Wallet"
3. Click "Details"
4. Click "Errors" button
5. See runtime errors

## Common Issues & Fixes

### Issue: "PUBLIC_GOOGLE_API_KEY is undefined"
**Fix:**
- Check `.env.local` exists
- Verify format: `PUBLIC_GOOGLE_API_KEY=your_key`
- Rebuild: `pnpm run build`

### Issue: Extension won't load
**Fix:**
- Delete extension from Chrome
- Check `/build/manifest.json` exists
- Rebuild: `pnpm run build`
- Load again from `/build` folder

### Issue: Popup appears blank
**Fix:**
- Right-click popup → "Inspect"
- Check Console for errors
- Verify you're on Medium.com
- Check API key is valid

### Issue: Build fails
**Fix:**
```bash
rm -rf node_modules .svelte-kit
pnpm install
pnpm run build
```

## Project Structure (Key Files)

```
BoldChrome/
├── src/
│   ├── routes/popup/
│   │   ├── +page.svelte      ← Edit popup UI here
│   │   └── page.ts           ← Edit popup logic here
│   └── lib/stores/
│       └── index.ts          ← State management
├── static/
│   └── manifest.json         ← Chrome extension config
├── .env.local                ← Your API key (not in git)
├── .env.example              ← Template for .env.local
├── svelte.config.js          ← Framework config
├── vite.config.ts            ← Build config
└── build/                    ← Generated extension (after build)
```

## Environment Variables

Only one required:

```
PUBLIC_GOOGLE_API_KEY=your_key_from_ai.google.dev
```

Get your key here: https://ai.google.dev

## Build Output

After running `pnpm run build`:

```
build/
├── manifest.json        ← This is what makes it a Chrome extension
├── popup.html          ← Popup entry point
├── _app/               ← SvelteKit application
└── [other files]
```

**This `/build` folder is what you load into Chrome.**

## How the Extension Works

1. User clicks extension icon
2. `popup/page.ts` runs (loader)
3. Detects if on Medium article
4. Extracts article content if on Medium
5. Calls Google API for summary
6. Updates `summary` store
7. `+page.svelte` renders the UI

## CSS/Styling

Edit styles in `/src/routes/popup/+page.svelte`:

```svelte
<style>
  :global(body) { }      ← Global styles
  .container { }         ← Scoped to this component
  .error { }             ← Only affects this component
</style>
```

Styles are automatically scoped to the component.

## Adding Code

### Add a new store
1. Edit `src/lib/stores/index.ts`
2. Use `writable()` from Svelte
3. Import in components

### Add a new component
1. Create `.svelte` file in `src/lib/`
2. Import in popup page
3. Use in template

### Add functionality
1. Edit `src/routes/popup/page.ts` (logic)
2. Update `src/routes/popup/+page.svelte` (UI)
3. Test with `pnpm run build`

## Deployment Checklist

- [ ] All changes committed to git
- [ ] `pnpm run check` passes
- [ ] `pnpm run build:prod` builds successfully
- [ ] Tested on real Chrome extension install
- [ ] No console errors in DevTools
- [ ] Works on Medium articles
- [ ] Shows error on non-Medium sites

## Important Gotchas

⚠️ **Don't commit `.env.local`** - It's in `.gitignore` for security

⚠️ **Rebuild after changing .env.local** - Changes don't apply without rebuild

⚠️ **Reload extension in Chrome** - Required after each build

⚠️ **Use `/build` folder in Chrome** - That's what you load as unpacked extension

## Performance Tips

- Minimize API calls (currently one per popup open)
- Cache results if user opens popup multiple times
- Use `check:watch` while developing to catch errors early

## Resources

- [Chrome Extensions Docs](https://developer.chrome.com/docs/extensions/)
- [SvelteKit Docs](https://svelte.dev/docs/kit)
- [Vite Docs](https://vitejs.dev)
- [Google AI Docs](https://ai.google.dev)

---

**Pro Tip:** Use `pnpm run verify` anytime to check your setup!
