# BoldChrome - Troubleshooting Guide

## Extension Won't Load in Chrome

### Symptom
You try to load unpacked but the folder doesn't appear as a valid extension.

### Causes & Solutions

#### 1. **manifest.json Missing or Invalid**
```bash
# Check if manifest.json exists in /build
ls -la build/manifest.json

# If missing, rebuild
pnpm run build

# Check manifest is valid JSON
cat build/manifest.json
```

#### 2. **Build Directory Doesn't Exist**
```bash
# Build the extension
pnpm run build

# Verify build folder was created
ls -la build/

# Should see manifest.json, popup.html, _app folder
```

#### 3. **Wrong Directory Selected**
- ✅ Correct: Select `/BoldChrome/build` 
- ❌ Wrong: Selecting `/BoldChrome/src` or `/BoldChrome` root

Rebuild and try again with the `/build` folder.

#### 4. **Browser Cache Issues**
```bash
# Remove the extension completely
# Then in browser:
# 1. Go to chrome://extensions
# 2. Find "Bold Bitcoin Wallet"
# 3. Click trash icon to remove
# 4. Clear browser cache: Ctrl+Shift+Delete

# Rebuild and reload
pnpm run build
# Then load unpacked again
```

---

## Extension Shows But Popup Is Blank

### Symptom
Extension loads in Chrome but popup shows nothing when clicked.

### Diagnosis Steps

1. **Check Console for Errors**
   ```
   Right-click popup → Inspect → Console tab
   ```
   Look for red error messages.

2. **Check Network Tab**
   ```
   Right-click popup → Inspect → Network tab
   Click extension again → See any failed requests?
   ```

### Common Causes

#### 1. **API Key Not Set**
Error: `PUBLIC_GOOGLE_API_KEY is undefined`

**Fix:**
```bash
# Check .env.local exists
cat .env.local

# Should show:
# PUBLIC_GOOGLE_API_KEY=your_key_here

# If empty, add your key:
nano .env.local

# Then rebuild
pnpm run build
```

#### 2. **Svelte Component Error**
Error: Various JavaScript errors in console

**Fix:**
```bash
# Run type check
pnpm run check

# Should show any errors
# Fix them in src/routes/popup/+page.svelte

# Rebuild
pnpm run build
```

#### 3. **Chrome API Not Available**
Error: `chrome is not defined`

**Fix:**
- This is normal in development if testing outside popup
- Make sure popup is accessed via extension popup button
- Only works in actual Chrome extension context

#### 4. **Popup HTML Not Generated**
```bash
# Check if popup.html exists
ls -la build/popup.html

# If missing, rebuild
pnpm run build

# Verify it has content
head -20 build/popup.html
```

---

## API Key Issues

### Symptom
API calls fail, summary doesn't appear, or error about Google API.

### Solutions

#### 1. **Verify API Key Format**
```bash
# Check .env.local format
cat .env.local

# Should be exactly:
# PUBLIC_GOOGLE_API_KEY=sk-...
# (No quotes, no spaces)
```

#### 2. **API Key Validity**
1. Go to [Google AI Studio](https://ai.google.dev)
2. Check if your key is listed
3. Check if it's enabled
4. Try creating a new key

#### 3. **API Key Permissions**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Find your project
3. Go to APIs & Services → Credentials
4. Check if API key has access to Generative AI API
5. Enable the API if needed:
   - APIs & Services → Library
   - Search "Generative AI"
   - Click "Google Generative AI API"
   - Click "Enable"

#### 4. **Quota Exceeded**
If you get rate limit errors:
1. Check your quota in Google Cloud Console
2. Wait a bit before making more requests
3. Upgrade to paid plan if needed

**Fix - Rebuild after fixing:**
```bash
# After fixing .env.local
pnpm run build

# Reload extension in Chrome
# chrome://extensions → find BoldChrome → reload icon
```

---

## Build Failures

### Symptom
`pnpm run build` fails with errors.

### Solutions

#### 1. **Node Modules Corrupted**
```bash
# Clean install
rm -rf node_modules .svelte-kit pnpm-lock.yaml
pnpm install
pnpm run build
```

#### 2. **TypeScript Errors**
Error: `TS1234: [file] error TS...`

**Fix:**
```bash
# See what errors
pnpm run check

# Fix them:
# 1. Read error messages
# 2. Fix the TypeScript in that file
# 3. Save
# 4. Try again: pnpm run build
```

#### 3. **Missing Dependencies**
Error: `Module not found: 'package-name'`

**Fix:**
```bash
# Install the missing package
pnpm add package-name

# Or reinstall everything
pnpm install

# Then build
pnpm run build
```

#### 4. **Version Mismatch**
If you get cryptic build errors:

```bash
# Update dependencies to latest
pnpm update

# Or specific package
pnpm add -u @sveltejs/kit

# Then try building
pnpm run build
```

---

## Extension Loads But Doesn't Work on Medium

### Symptom
Extension loads but clicking it shows "Please visit a Medium article" even when you are on Medium.

### Diagnosis

1. **Check if on correct Medium URL**
   ```
   Should contain: medium.com
   NOT: *.medium.com subdomains (might not work)
   ```

2. **Check Manifest Permissions**
   ```bash
   cat static/manifest.json
   # Should have:
   # "permissions": ["scripting", "activeTab"]
   ```

3. **Check Console**
   ```
   Right-click popup → Inspect → Console
   Look for errors about chrome.tabs or chrome.scripting
   ```

### Solutions

#### 1. **Update Manifest Permissions**
If manifest.json is missing permissions:

```json
{
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"],
  "host_permissions": ["https://medium.com/*"],
  "action": {
    "default_popup": "popup.html"
  }
}
```

Then rebuild:
```bash
pnpm run build
# Remove and reload extension in Chrome
```

#### 2. **Test URL Detection**
Edit `src/routes/popup/page.ts` and add logging:

```typescript
if (!tab?.url?.includes('medium.com')) {
  console.log('Not on Medium. URL:', tab?.url);
  onMedium.set(false);
  return;
}
console.log('On Medium!');
```

#### 3. **Check Content Extraction**
The issue might be extracting article text. Try this:

```typescript
// In popup/page.ts, modify extraction:
const [result] = await chrome.scripting.executeScript({
  target: { tabId: tab.id! },
  func: () => {
    const content = document.querySelector('section')?.textContent;
    console.log('Extracted content length:', content?.length);
    return content || 'FAILED_TO_EXTRACT';
  }
});

const postContent = result?.result || '';
console.log('Post content:', postContent.substring(0, 100));
```

Rebuild and check console for debug output.

---

## Performance Issues

### Symptom
Extension is slow, takes long to load, or freezes.

### Solutions

#### 1. **API Call Timeout**
If API calls are slow:
- Google API takes 5-10 seconds sometimes
- This is normal, especially first time
- User sees "Processing article..." message

#### 2. **Large Article Content**
If extraction is slow:
- Article might be very long
- Article might have many nested elements
- Try limiting extracted content:

```typescript
// In popup/page.ts, cap the length
const postContent = (result?.result || '').substring(0, 3000);
```

#### 3. **Memory Usage**
Clean up if extension runs often:
```bash
# Check for memory leaks
# DevTools → Memory tab → Take heap snapshot
# See if growing over time

# Current implementation is lightweight
# Should be < 50MB
```

---

## Environment Variable Issues

### Symptom
Environment variable not being picked up even after setting it.

### Solutions

#### 1. **File Not Saved**
```bash
# Make sure .env.local is saved
cat .env.local

# Should show your key
```

#### 2. **Wrong File Name**
- ✅ Correct: `.env.local` (lowercase, dot at start)
- ❌ Wrong: `env.local`, `.env`, `ENV.LOCAL`

#### 3. **Rebuild Required**
Environment variables are baked into the build:

```bash
# Change .env.local
nano .env.local

# Must rebuild
pnpm run build

# Cannot hot-reload environment changes
# Must delete and reload extension in Chrome
```

#### 4. **Public vs Private**
Must start with `PUBLIC_` to be available in browser:

```
✅ PUBLIC_GOOGLE_API_KEY=xxx     (available in app)
❌ GOOGLE_API_KEY=xxx             (NOT available)
❌ SECRET_KEY=xxx                 (NOT available)
```

---

## Chrome Permissions Issues

### Symptom
Getting `Permission denied` or similar errors in console.

### Solutions

1. **Check manifest.json has correct permissions:**
```json
{
  "manifest_version": 3,
  "permissions": ["scripting", "activeTab"]
}
```

2. **Reinstall extension:**
   - Remove from chrome://extensions
   - Rebuild: `pnpm run build`
   - Load unpacked again

3. **Check you're on supported sites:**
   - Works on https:// sites
   - Doesn't work on chrome:// or about: pages
   - Doesn't work on Chrome Web Store pages

---

## Debugging Tips

### Enable Verbose Logging

Add logging to popup/page.ts:

```typescript
console.log('=== BoldChrome Debug ===');
console.log('Current tab:', tab);
console.log('Tab URL:', tab?.url);
console.log('Is Medium?', tab?.url?.includes('medium.com'));
console.log('Post content length:', postContent.length);
```

### Check Built Files

```bash
# See what's in the build
ls -la build/

# Check specific file
head -50 build/popup.html
cat build/manifest.json

# Size of extension
du -sh build/
```

### Test Outside Extension

```bash
# Test component locally (requires setup)
pnpm run preview
# Then visit http://localhost:5173
```

### Use Chrome DevTools

1. **Popup Inspection:**
   - Right-click popup → Inspect
   - See HTML, CSS, JS in real-time

2. **Network Tab:**
   - Check API calls to Google
   - See response status and payload

3. **Sources Tab:**
   - Set breakpoints
   - Step through code
   - Check variable values

---

## Still Stuck?

### Verify Setup First
```bash
# Run verification script
pnpm run verify

# Should show all green checks
```

### Check Logs
```bash
# Look for error messages
pnpm run build 2>&1 | grep -i error

# Check TypeScript
pnpm run check
```

### Nuclear Option
```bash
# Complete fresh start
rm -rf node_modules .svelte-kit build
rm pnpm-lock.yaml
pnpm install
pnpm run build

# Then reload in Chrome
```

### Get Help

1. Check [Chrome Extensions Docs](https://developer.chrome.com/docs/extensions/)
2. Check [SvelteKit Docs](https://svelte.dev/docs/kit)
3. Check [Google API Docs](https://ai.google.dev)
4. Check the QUICK_REFERENCE.md and BUILD_INSTRUCTIONS.md

---

## Common Error Messages

| Error | Meaning | Fix |
|-------|---------|-----|
| `PUBLIC_GOOGLE_API_KEY is undefined` | API key not in .env.local | Add key to .env.local, rebuild |
| `Module not found: '@sveltejs/kit'` | Dependencies not installed | `pnpm install` |
| `chrome is not defined` | Running outside extension context | Only test in popup, not dev server |
| `Cannot read property 'tabs' of undefined` | Chrome API unavailable | Using in popup properly? |
| `Failed to fetch` | API request failed | Check API key, network connection |
| `Manifest error` | manifest.json invalid | Check JSON syntax, required fields |
| `Script timeout` | API call took too long | Google API is slow, normal |

---

**Last Resort:** Delete everything and start fresh:
```bash
cd /path/to/BoldChrome
rm -rf node_modules .svelte-kit build pnpm-lock.yaml
pnpm install
pnpm run build
# Load in Chrome again
```

This usually fixes 90% of issues!
