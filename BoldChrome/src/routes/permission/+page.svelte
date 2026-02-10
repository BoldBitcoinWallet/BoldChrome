<script lang="ts">
	import { onMount } from 'svelte';

	let status = 'Requesting camera permission...';
	let hasError = false;

	onMount(async () => {
		try {
			// Request camera permission
			const stream = await navigator.mediaDevices.getUserMedia({ video: true });
			
			// Success! Stop the stream immediately
			stream.getTracks().forEach(track => track.stop());
			
			status = 'Success! Camera permission granted.';
			hasError = false;
			
			// Notify popup that permission was granted
			chrome.storage.local.set({ cameraPermissionGranted: true });
			
			// Close this tab after a short delay
			setTimeout(() => {
				window.close();
			}, 1500);
		} catch (err) {
			console.error('Permission error:', err);
			hasError = true;
			status = 'Permission denied. Please allow camera access and try again.';
		}
	});
</script>

<div class="permission-page">
	<div class="content">
		<h1>Camera Permission Setup</h1>
		<p class="status" class:error={hasError}>{status}</p>
		
		{#if !hasError}
			<p class="instructions">Please click <strong>"Allow"</strong> when your browser asks for camera access.</p>
		{:else}
			<p class="instructions">You can close this tab and try again from the extension popup.</p>
		{/if}
	</div>
</div>

<style>
	.permission-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		padding: 24px;
	}

	.content {
		background: white;
		padding: 48px;
		border-radius: 16px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
		text-align: center;
		max-width: 500px;
	}

	h1 {
		font-size: 28px;
		font-weight: 700;
		color: #000000;
		margin: 0 0 16px 0;
	}

	.status {
		font-size: 16px;
		font-weight: 600;
		color: #374151;
		margin: 0 0 24px 0;
	}

	.status.error {
		color: #dc2626;
	}

	.instructions {
		font-size: 14px;
		color: #6b7280;
		line-height: 1.6;
		margin: 0;
	}
</style>
