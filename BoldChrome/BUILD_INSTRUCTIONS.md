# BoldChrome – Build & load

## Prerequisites

- **Node.js** v18+
- **npm** (comes with Node.js)
- **Chrome** (or Chromium)

## 1. Install

```bash
cd BoldChrome
npm install
```

## 2. Build

```bash
npm run build
```

Output is in the **`build`** directory (or **`extension-build`** depending on your adapter). That folder is what you load in Chrome.

## 3. Load in Chrome

1. Open **chrome://extensions**
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Choose the **`build`** (or `extension-build`) folder inside BoldChrome
5. The **Bold Bitcoin Wallet** extension should appear in the toolbar

## 4. After code changes

1. Run `npm run build` again  
2. In **chrome://extensions**, click the **reload** icon on BoldChrome  

(No hot reload; rebuild and reload each time.)

## Other commands

- **Type check:** `npm run check` or `npm run check:watch`
- **Verify setup:** `npm run verify`
- **Production build:** `npm run build:prod`

## Troubleshooting

- **Extension won’t load:** Ensure you selected the **build** (or **extension-build**) folder that contains `manifest.json`, not `src` or the repo root.
- **Popup blank:** Right‑click the popup → **Inspect** and check the console for errors.
- **Build errors:** Remove `node_modules` and `.svelte-kit`, run `npm install`, then `npm run build` again.

For architecture and pairing flow, see [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/PAIRING_VIA_QR.md](docs/PAIRING_VIA_QR.md).
