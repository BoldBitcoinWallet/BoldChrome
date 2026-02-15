<script lang="ts">
	import { onMount } from 'svelte';
	import { Html5Qrcode } from 'html5-qrcode';

	let scanner: Html5Qrcode | null = null;
	let scannerStatus = 'Click "Start Camera" to begin scanning';
	let hasError = false;
	let isScanning = false;
	let isStarted = false;

	async function startScanner() {
		try {
			hasError = false;
			isStarted = true;
			scannerStatus = 'Requesting camera access...';

			scanner = new Html5Qrcode('qr-reader');

			const config = {
				fps: 10,
				qrbox: { width: 250, height: 250 }
			};

			await scanner.start(
				{ facingMode: 'environment' },
				config,
				(decodedText) => {
					console.log('QR Code scanned:', decodedText);
					scannerStatus = 'QR Code detected!';

					// Send result back to popup via chrome.storage
					chrome.storage.local.set({ scannedQR: decodedText });

					// Close this window after a short delay
					setTimeout(() => {
						window.close();
					}, 500);
				},
				() => {
					// Error callback - normal when no QR in view
				}
			);

			isScanning = true;
			scannerStatus = 'Point camera at QR code';
		} catch (err) {
			console.error('Camera error:', err);
			hasError = true;
			isScanning = false;

			if (err instanceof Error) {
				if (err.name === 'NotAllowedError') {
					scannerStatus = 'Camera permission denied. Please allow camera access and try again.';
				} else if (err.name === 'NotFoundError') {
					scannerStatus = 'No camera found on this device.';
				} else {
					scannerStatus = 'Unable to start camera. Please try again.';
				}
			}
		}
	}

	function handleCancel() {
		window.close();
	}

	onMount(() => {
		return () => {
			if (scanner && isScanning) {
				scanner.stop().catch((err) => console.error('Stop error:', err));
			}
		};
	});
</script>

<div class="scanner-page">
	<div class="scanner-header">
		<h1>QR Code Scanner</h1>
		<p class="status" class:error={hasError}>{scannerStatus}</p>
	</div>

	{#if !isStarted}
		<div class="start-container">
			<p class="instructions">Ready to scan the response QR code from your mobile wallet</p>
			<button class="btn-start" on:click={startScanner}>Start Camera</button>
		</div>
	{:else}
		<div id="qr-reader" class="qr-reader"></div>
	{/if}

	{#if hasError && isStarted}
		<button class="btn-retry" on:click={startScanner}>🔄 Try Again</button>
	{/if}

	<div class="actions">
		<button class="btn-cancel" on:click={handleCancel}>Cancel</button>
	</div>
</div>

<style>
	.scanner-page {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: #ffffff;
	}

	.scanner-header {
		text-align: center;
		margin-bottom: 24px;
	}

	h1 {
		font-size: 24px;
		font-weight: 700;
		color: #000000;
		margin: 0 0 12px 0;
	}

	.status {
		font-size: 14px;
		font-weight: 500;
		color: #374151;
		margin: 0;
	}

	.status.error {
		color: #dc2626;
	}

	.start-container {
		text-align: center;
		padding: 32px;
		background: #f9fafb;
		border-radius: 16px;
		border: 2px dashed #d1d5db;
		max-width: 400px;
	}

	.instructions {
		font-size: 14px;
		color: #6b7280;
		margin: 0 0 20px 0;
		line-height: 1.5;
	}

	.qr-reader {
		width: 100%;
		max-width: 500px;
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.btn-start {
		background: #000000;
		color: white;
		border: none;
		padding: 14px 28px;
		border-radius: 12px;
		cursor: pointer;
		font-size: 16px;
		font-weight: 600;
		transition: all 0.2s;
	}

	.btn-start:hover {
		background: #1a1a1a;
		transform: translateY(-2px);
	}

	.btn-retry {
		background: #000000;
		color: white;
		border: none;
		padding: 12px 24px;
		border-radius: 10px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
		margin-top: 16px;
		transition: all 0.2s;
	}

	.btn-retry:hover {
		background: #1a1a1a;
	}

	.actions {
		margin-top: 24px;
	}

	.btn-cancel {
		background: transparent;
		border: 1px solid #d1d5db;
		color: #374151;
		padding: 10px 24px;
		border-radius: 10px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 500;
		transition: all 0.2s;
	}

	.btn-cancel:hover {
		background: #f3f4f6;
		border-color: #9ca3af;
	}
</style>
