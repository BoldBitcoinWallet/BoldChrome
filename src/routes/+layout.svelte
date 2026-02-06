<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { applyTheme } from '$lib/styles/theme';

	let { children } = $props();

	onMount(() => {
		// Apply the light polished theme by default for the popup
		applyTheme('lightPolished');
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
