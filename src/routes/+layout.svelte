<script lang="ts">
	import { onMount } from 'svelte';
	import { applyTheme, resolveThemePreference } from '$lib/styles/theme';
	import { storage } from '$lib/services/storage';

	let { children } = $props();

	onMount(async () => {
		const stored = await storage.get<'light' | 'dark'>('theme');
		const themeName = resolveThemePreference(stored);
		applyTheme(themeName);
	});
</script>

<svelte:head>
	<title>Bold Wallet</title>
	<!-- Same assets as extension manifest (generated from bold-icon.png) — correct tab icon in full-window / tab mode -->
	<link rel="icon" type="image/png" sizes="16x16" href="/icons/icon16.png" />
	<link rel="icon" type="image/png" sizes="48x48" href="/icons/icon48.png" />
</svelte:head>

{@render children()}
