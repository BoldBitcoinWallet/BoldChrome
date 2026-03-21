<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
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
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
