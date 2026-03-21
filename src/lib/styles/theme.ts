/**
 * BoldChrome theme – aligned with BoldWallet app (theme/themes.ts, theme/fonts.ts).
 * Colors, font sizes, spacing, and border radius match the wallet app for consistency.
 */
import { writable } from 'svelte/store';

/** Font stacks – Inter + JetBrains Mono (same as BoldWallet; load via app.html) */
const fontFamilies = {
	regular: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
	medium: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
	bold: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
	monospace: "'JetBrains Mono', 'SF Mono', Monaco, 'Courier New', monospace",
};

/** Font sizes (px) – match BoldWallet theme/themes.ts */
const fontSizes = {
	xs: 10,
	sm: 12,
	base: 14,
	md: 15,
	lg: 16,
	xl: 18,
	'2xl': 20,
	'3xl': 24,
};

/** Font weights – match BoldWallet */
const fontWeights = {
	normal: '400',
	medium: '500',
	semibold: '600',
	bold: '700',
};

/** Spacing (px) – match BoldWallet theme spacing */
const spacing = {
	small: 8,
	medium: 12,
	large: 20,
	extraLarge: 30,
};

/** Border radius (px) – match BoldWallet theme borderRadius */
const borderRadius = {
	small: 8,
	medium: 10,
	large: 12,
};

/** Light theme – exact match to BoldWallet lightTheme (themes.ts) */
const lightColors: Record<string, string> = {
	primary: '#1A2B3C',
	subPrimary: '#033e3e',
	secondary: '#344960',
	danger: '#e74c3c',
	accent: '#f1c40f',
	background: '#ffffff',
	text: '#2c3e50',
	textSecondary: '#6b7280',
	cardBackground: '#f8f9fa',
	disabled: '#cbd5e1',
	border: '#94a3b8',
	textOnPrimary: '#ffffff',
	sent: '#E53935',
	received: '#4CAF50',
	success: '#34C759',
	successLight: '#66BB6A',
	error: '#e74c3c',
	warning: '#FFA500',
	bitcoinOrange: '#F7931A',
	white: '#ffffff',
	shadowColor: '#000',
	inputBackground: '#f8f9fa',
	modalBackdrop: 'rgba(0, 0, 0, 0.8)',
	skeletonGray: '#e9ecef',
};

/** Dark theme – exact match to BoldWallet darkTheme (themes.ts) */
const darkColors: Record<string, string> = {
	primary: '#3A3A3A',
	subPrimary: '#4A4A4A',
	secondary: '#00D2B8',
	danger: '#FF6B6B',
	accent: '#E6C435',
	background: '#121212',
	text: '#FFFFFF',
	textSecondary: '#B0B0B0',
	cardBackground: '#1E1E1E',
	disabled: '#424242',
	border: '#333333',
	textOnPrimary: '#FFFFFF',
	sent: '#FF6B6B',
	received: '#66BB6A',
	success: '#34C759',
	successLight: '#66BB6A',
	error: '#FF6B6B',
	warning: '#FFA500',
	bitcoinOrange: '#F7931A',
	white: '#FFFFFF',
	shadowColor: '#000',
	inputBackground: '#2a2a2a',
	modalBackdrop: 'rgba(0, 0, 0, 0.85)',
	skeletonGray: '#2a2a2a',
};

export const themes = {
	lightPolished: { colors: lightColors },
	darkPolished: { colors: darkColors },
};

function setColorVars(colors: Record<string, string>) {
	const root = typeof document !== 'undefined' ? document.documentElement.style : null;
	if (!root) return;
	Object.entries(colors).forEach(([k, v]) => {
		root.setProperty(`--color-${k}`, v);
	});
}

function setLayoutAndFontVars() {
	const root = typeof document !== 'undefined' ? document.documentElement.style : null;
	if (!root) return;
	root.setProperty('--font-regular', fontFamilies.regular);
	root.setProperty('--font-medium', fontFamilies.medium);
	root.setProperty('--font-bold', fontFamilies.bold);
	root.setProperty('--font-mono', fontFamilies.monospace);
	root.setProperty('--font-size-xs', `${fontSizes.xs}px`);
	root.setProperty('--font-size-sm', `${fontSizes.sm}px`);
	root.setProperty('--font-size-base', `${fontSizes.base}px`);
	root.setProperty('--font-size-md', `${fontSizes.md}px`);
	root.setProperty('--font-size-lg', `${fontSizes.lg}px`);
	root.setProperty('--font-size-xl', `${fontSizes.xl}px`);
	root.setProperty('--font-size-2xl', `${fontSizes['2xl']}px`);
	root.setProperty('--font-size-3xl', `${fontSizes['3xl']}px`);
	root.setProperty('--font-weight-normal', fontWeights.normal);
	root.setProperty('--font-weight-medium', fontWeights.medium);
	root.setProperty('--font-weight-semibold', fontWeights.semibold);
	root.setProperty('--font-weight-bold', fontWeights.bold);
	root.setProperty('--space-small', `${spacing.small}px`);
	root.setProperty('--space-medium', `${spacing.medium}px`);
	root.setProperty('--space-large', `${spacing.large}px`);
	root.setProperty('--space-extraLarge', `${spacing.extraLarge}px`);
	root.setProperty('--radius-small', `${borderRadius.small}px`);
	root.setProperty('--radius-medium', `${borderRadius.medium}px`);
	root.setProperty('--radius-large', `${borderRadius.large}px`);
}

export type ThemeName = 'lightPolished' | 'darkPolished';

export const themeName = writable<ThemeName>('lightPolished');

export function applyTheme(name: ThemeName = 'lightPolished') {
	const theme = themes[name] ?? themes.lightPolished;
	setColorVars(theme.colors);
	setLayoutAndFontVars();
	if (typeof document !== 'undefined') {
		document.documentElement.setAttribute('data-theme', name);
	}
	themeName.set(name);
}

/** Resolve theme from preference: 'light' | 'dark' from storage, or system preference */
export function resolveThemePreference(stored: 'light' | 'dark' | null): ThemeName {
	if (stored === 'dark') return 'darkPolished';
	if (stored === 'light') return 'lightPolished';
	if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) {
		return 'darkPolished';
	}
	return 'lightPolished';
}
