# BoldChrome Architecture

## Overview

BoldChrome is a Chrome extension built with **SvelteKit** that analyzes Medium articles and provides AI-powered summaries. It uses Google's Generative AI API to understand and summarize article content.

## Extension Type

- **Manifest Version:** 3 (latest Chrome extension format)
- **Architecture:** Popup-based extension with no background service worker
- **Build System:** SvelteKit + Vite with Chrome Extension Adapter

## Technology Stack

```
┌─────────────────────────────────────────┐
│         Chrome Extension                 │
│  (Manifest v3 popup-based)               │
├─────────────────────────────────────────┤
│         SvelteKit Framework              │
│  (Component framework + routing)         │
├─────────────────────────────────────────┤
│         Vite Build Tool                  │
│  (Fast bundling and hot reload)          │
├─────────────────────────────────────────┤
│    Google Generative AI API              │
│    (Claude/Gemini for summarization)     │
└─────────────────────────────────────────┘
```

## Project Structure

### `/src` - Source Code

```
src/
├── app.d.ts                    # Type definitions for SvelteKit
├── app.html                    # Root HTML template
│
├── routes/
│   ├── +layout.svelte         # Root layout component
│   ├── +page.svelte           # Main page (landing)
│   │
│   └── popup/                 # Popup extension route
│       ├── +page.svelte       # Popup UI component
│       └── page.ts            # Popup data loader (Chrome API calls)
│
└── lib/
    ├── stores/
    │   └── index.ts           # Svelte stores for state management
    │       ├── onMedium       # Boolean: is current tab on Medium?
    │       └── summary        # String: article summary or status
    │
    └── assets/
        └── [icons, favicon]
```

### `/static` - Static Files

```
static/
├── manifest.json              # Chrome extension manifest
└── robots.txt
```

### Configuration Files

- **svelte.config.js** - SvelteKit configuration with Chrome extension adapter
- **vite.config.ts** - Vite build configuration optimized for extensions
- **tsconfig.json** - TypeScript configuration
- **package.json** - Dependencies and build scripts
- **.env.local** - Local development environment variables (NOT in git)

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Opens Extension Popup                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. +page.ts Loader Executes (popup/page.ts)                │
│    - Uses chrome.tabs.query() to detect current tab        │
│    - Checks if URL contains "medium.com"                   │
│    - Sets onMedium store accordingly                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
                   ┌─────────┴─────────┐
                   ↓                   ↓
          Not on Medium          On Medium Article
                   ↓                   ↓
         ┌──────────────────┐  ┌──────────────────┐
         │ Show Error Msg   │  │ Extract Content  │
         │ "Please visit    │  │ using Chrome API │
         │  Medium article" │  └──────────────────┘
         └──────────────────┘         ↓
                   ↑          ┌──────────────────┐
                   │          │ Call Google API  │
                   │          │ with article     │
                   │          │ text for summary │
                   │          └──────────────────┘
                   │                  ↓
                   │          ┌──────────────────┐
                   │          │ Update summary   │
                   │          │ store with       │
                   │          │ generated text   │
                   │          └──────────────────┘
                   │                  ↓
                   └──────────────────┤
                                      ↓
                          ┌──────────────────────┐
                          │ +page.svelte Updates │
                          │ UI to show summary   │
                          │ with beautiful UI    │
                          └──────────────────────┘
```

## Component Hierarchy

```
app.html (Root HTML)
  └─ +layout.svelte (Root Layout)
      ├─ +page.svelte (Main Page - not used in popup)
      │
      └─ popup/+page.svelte (Extension Popup)
          ├─ Header section (Title: "Bold Medium Summary")
          ├─ Main content area
          │   ├─ Error state (non-Medium sites)
          │   ├─ Loading state (Processing article...)
          │   ├─ Summary state (Display article summary)
          │   └─ Placeholder state (Waiting for article)
          └─ Styled with scoped CSS (gradient purple theme)
```

## State Management

### Svelte Stores (`src/lib/stores/index.ts`)

Two main stores manage the extension's state:

1. **`onMedium`** - Writable boolean store
   - `true` when current tab is a Medium article
   - `false` when on other websites
   - Used to show/hide content accordingly

2. **`summary`** - Writable string store
   - Empty string: initial/idle state
   - "Processing article...": API call in progress
   - Article text: successfully generated summary

### Data Flow with Stores

```
popup/page.ts (Loader)
  ├─ Detects Medium article
  ├─ Updates onMedium store
  ├─ Extracts article text
  ├─ Calls Google API
  └─ Updates summary store
         ↓
popup/+page.svelte (Component)
  ├─ Subscribes to onMedium
  ├─ Subscribes to summary
  └─ Re-renders UI when stores change
```

## Chrome Extension Integration

### Manifest v3 Configuration

```json
{
  "manifest_version": 3,
  "name": "Bold Bitcoin Wallet",
  "permissions": ["scripting", "activeTab"],
  "action": {
    "default_popup": "popup.html"
  }
}
```

### Chrome APIs Used

1. **chrome.tabs.query()**
   - Query current active tab
   - Check tab URL
   - Located in: `popup/page.ts`

2. **chrome.scripting.executeScript()**
   - Extract DOM content from current page
   - Get article text from Medium page
   - Located in: `popup/page.ts`

### Permissions

- `scripting` - Allows content script execution on pages
- `activeTab` - Access to current active tab information

## Google Generative AI Integration

### Flow

```
popup/page.ts
  └─ import GoogleGenerativeAI
     └─ Initialize with PUBLIC_GOOGLE_API_KEY
        └─ genAI.getGenerativeModel({ model: "gemini-pro" })
           └─ model.generateContent(articleText)
              └─ Returns summary text
```

### Environment Configuration

API key is passed via environment variable:
- Source: `.env.local` file
- Variable: `PUBLIC_GOOGLE_API_KEY`
- Exposed as: `$env/static/public` in SvelteKit

## Build Process

### Development Build

```
npm run build
  └─ Vite + SvelteKit processor
     ├─ Compiles Svelte components
     ├─ Transpiles TypeScript
     ├─ Generates source maps
     └─ Outputs to /build directory
        ├─ Preserves manifest.json
        ├─ Creates popup.html
        └─ Bundles all scripts
```

### Production Build

```
npm run build:prod
  └─ Optimized build
     ├─ Minified JavaScript
     ├─ No source maps
     └─ Smaller file size for distribution
```

### Output Structure

```
build/
├── manifest.json           # Chrome manifest (copied from static/)
├── popup.html             # Popup entry point
├── _app/                  # SvelteKit app bundle
│   ├── chunks/           # Code chunks
│   ├── immutable/        # Static files
│   └── manifest.json     # Route manifest
├── index.html            # Main page (not used)
└── [other assets]
```

## Extension Initialization

1. **First Run:** 
   - Extension loads `/popup.html`
   - SvelteKit mounts to DOM
   - `popup/page.ts` loader runs
   - Chrome API checks current tab

2. **Subsequent Clicks:**
   - Popup re-opens
   - Loader re-executes
   - Detects current tab again
   - Updates UI accordingly

## Key Design Decisions

### Popup-Only Architecture
- Simpler than background service worker
- All logic runs when popup is open
- Stateless between popup opens

### SvelteKit + Vite
- **Why SvelteKit?** 
  - Great TypeScript support
  - Reactive stores for state
  - File-based routing
  - Built-in styling
  
- **Why Vite?**
  - Fast build times
  - Hot reload during dev
  - Optimized production builds
  - Chrome extension support via adapter

### Google Generative AI
- **Why?**
  - Powerful summarization
  - Easy API integration
  - Affordable pricing
  - No server needed

## Future Enhancement Opportunities

1. **Background Service Worker**
   - Cache summaries
   - Pre-fetch articles
   - Schedule periodic tasks

2. **Content Script**
   - In-page summary display
   - Article highlighting
   - Full page context

3. **Storage**
   - Save summaries locally
   - History of read articles
   - User preferences

4. **Advanced Features**
   - Different summary lengths
   - Multiple language support
   - Custom AI models
   - Share summaries

## File Sizes (Approximate)

- `manifest.json` - 0.5 KB
- `popup.html` - 1-2 KB
- JavaScript bundle - 200-400 KB (uncompressed)
- Total extension - 300-500 KB

## Performance Considerations

- **Startup:** Extension loads quickly (DOM is small)
- **API calls:** Async, doesn't block UI
- **Memory:** Minimal (simple state management)
- **CPU:** Light usage (Chrome handles compilation)

---

## References

- [Chrome Extension Manifest v3](https://developer.chrome.com/docs/extensions/mv3/)
- [SvelteKit Documentation](https://svelte.dev/docs/kit)
- [Vite Documentation](https://vitejs.dev)
- [Google Generative AI API](https://ai.google.dev)
