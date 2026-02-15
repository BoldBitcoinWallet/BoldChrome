# BoldChrome UI/UX Design System & Alignment Plan

This document is the **single source of truth** for UI/UX in the extension. **The extension themes, styles, and fonts follow the BoldWallet app** so the experience is consistent across web and extension.

---

## 1. Design tokens (canonical)

All UI must use **CSS variables** from the theme. No hardcoded hex colors, font names, or magic-number spacing in components.

### 1.1 Colors (BoldWallet-aligned)

Defined in `src/lib/styles/theme.ts`. Values match BoldWallet app (gold primary `#ffd600`, green secondary `#4caf50`, navy wallet card `#14213d`, background `#f5f7fa`). Use only:

| Token (CSS var) | Purpose |
|-----------------|--------|
| `--color-primary` | Primary CTAs (BoldWallet gold) |
| `--color-subPrimary` | Hover primary (lighter gold) |
| `--color-secondary` | Secondary actions (green) |
| `--color-accent` | Highlights, focus (gold) |
| `--color-background` | Page/popup background |
| `--color-cardBackground` | Cards, modals |
| `--color-inputBackground` | Input fields background |
| `--color-text` | Primary text |
| `--color-textSecondary` | Muted text |
| `--color-textOnPrimary` | Text on primary buttons (dark on gold) |
| `--color-border` | Borders, dividers |
| `--color-disabled` | Disabled state |
| `--color-success` | Success (green) |
| `--color-error` | Errors |
| `--color-warning` | Warnings |
| `--color-walletCard` | BoldWallet navy card (#14213d) |
| `--color-textOnDark` | Text on navy/dark |
| `--color-accentOnDark` | Gold on navy |
| `--color-labelOnDark` | Labels on navy (#bfc8e6) |
| `--color-inputOnDark` | Input bg on navy (#232946) |
| `--color-borderOnDark` | Border on navy (#3a3a4d) |

### 1.2 Typography

| Token | Value | Use |
|-------|--------|-----|
| `--font-sans` | System UI stack | Body, headings, labels |
| `--font-mono` | Monospace stack | Addresses, tx ids, code |

**Font stack (sans):**  
`var(--font-sans)` → `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif`

**Font stack (mono):**  
`var(--font-mono)` → `'SF Mono', Monaco, 'Fira Code', 'Courier New', monospace`

**Scale (use rem or var where we add --text-*):**  
- Title: 1.5rem–1.75rem, font-weight 700  
- Section: 1rem–1.125rem, font-weight 600  
- Body: 0.875rem–1rem, font-weight 400–500  
- Caption: 0.75rem, font-weight 500  
- Mono: 0.8125rem–0.875rem  

### 1.3 Real estate (spacing & layout)

| Token | Value | Use |
|-------|--------|-----|
| `--space-1` | 4px | Tight gaps |
| `--space-2` | 8px | Inline spacing |
| `--space-3` | 12px | Small padding |
| `--space-4` | 16px | Default padding |
| `--space-5` | 20px | Section padding |
| `--space-6` | 24px | Large padding |
| `--radius-sm` | 6px | Inputs (BoldWallet) |
| `--radius-md` | 8px | Buttons |
| `--radius-lg` | 12px | Cards |
| `--radius-xl` | 18px | Hero/wallet card (BoldWallet) |

Popup constraints: **width 380px**, **min-height 580px** (set in `app.html`).

### 1.4 Themes (BoldWallet-aligned)

- **lightPolished** – default: #f5f7fa background, gold (#ffd600) primary, green secondary, white cards. Matches BoldWallet wallet page.
- **darkPolished** – navy (#14213d) background, gold accent, same semantic tokens.

Theme is applied in `+layout.svelte` via `applyTheme()`. All tokens come from the active theme.

---

## 2. Alignment plan (extension → design system)

### Phase 1 – Single source of truth (done / in progress)

- [x] Document tokens in this file.
- [x] Add `inputBackground` (and any missing color) to `theme.ts`.
- [x] Add font and spacing tokens to `theme.ts` and set CSS vars in `applyTheme()`.

### Phase 2 – Remove hardcoded values

Replace every hardcoded color/font/spacing with a token:

| File | What to do |
|------|------------|
| `src/routes/popup.html/+page.svelte` | Replace all `#hex`, `font-family`, `font-size` with `var(--color-*)`, `var(--font-*)`, `var(--space-*)` / `var(--text-*)` or rem scale. |
| `src/routes/+page.svelte` | Same; remove Bitcoin-orange/gray hardcodes, use theme vars. |
| `src/routes/scanner/+page.svelte` | Use theme vars for background, text, borders, buttons. |
| `src/routes/permission/+page.svelte` | Use theme vars; gradient can use `--color-primary` / `--color-subPrimary`. |
| `src/popup/SendBitcoin.svelte` | Use theme vars only. |
| `src/lib/components/SendTransaction.svelte` | Use theme vars only. |
| `src/lib/components/QRScannerPopup.svelte` | Use theme vars only. |
| `src/lib/components/QRScanner.svelte` | Use theme vars only. |
| `src/app.html` | Use `var(--font-sans)` for body; keep size constraints. |

### Phase 3 – Consistency checks

- [ ] No `#hex` or `rgb()` in `.svelte` or `app.html` except inside `theme.ts`.
- [ ] No raw font names; use `var(--font-sans)` or `var(--font-mono)`.
- [ ] Spacing uses `var(--space-*)` or a shared rem scale.
- [ ] Border radius uses `var(--radius-*)`.

### Phase 4 – Align with BoldWallet app ✅

- **Done:** Extension theme matches BoldWallet app. Primary is gold (#ffd600), background #f5f7fa, green secondary, navy wallet card tokens available. See `theme.ts`.

---

## 3. Rules for new UI

1. **Colors** – Use only `var(--color-*)` from the theme.
2. **Fonts** – Use `var(--font-sans)` or `var(--font-mono)`.
3. **Spacing** – Prefer `var(--space-*)`; avoid arbitrary pixel values.
4. **Radii** – Use `var(--radius-sm|md|lg|xl)`.
5. **New tokens** – Add to `theme.ts` and this doc; then use the var everywhere.

---

## 4. File reference

| File | Role |
|------|------|
| `src/lib/styles/theme.ts` | Defines themes and sets all CSS variables. |
| `src/routes/+layout.svelte` | Calls `applyTheme()` on mount. |
| `docs/DESIGN_SYSTEM.md` | This document – UI/UX code of conduct. |

Once alignment is complete, this doc plus `theme.ts` are the only places that define colors, fonts, and spacing; the rest of the extension only consumes them.
