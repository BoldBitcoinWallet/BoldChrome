<script lang="ts">
	import logoSmall from '$lib/assets/Icon-App-40x40@2x.png';
	import logo from '$lib/assets/logo.png';
	import bitcoinLogo from '$lib/assets/bitcoin-logo.png';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { walletStore, refreshWalletData, setAddress, initializeWalletStore } from '$lib/stores/wallet';
	import { qr } from '$lib/services/qr';
	import QRScannerPopup from '$lib/components/QRScannerPopup.svelte';
	import { goto } from '$app/navigation';

	// Pairing state
	// Steps: 0=Start/Logo, 1=Instructions, 2=QR, 3=ResponseChoice, 4=Scanner, 5=ManualInput
	let pairingStep = 0; 
	// Removed redundant booleans: showPairingQR, showManualInput, showScanner
	// use computed properties if needed for transition classes, otherwise strict steps
	
	let pairingQRData = '';
	let pairingPayload = '';
	let pairingStatus = 'Click logo to start pairing';
	let manualPublicKey = '';
	let processingPairing = false;
	
	// Reactive: Check if wallet is paired based on store
	$: isPaired = !!$walletStore.publicKey && $walletStore.publicKey.trim() !== '';
	
	// Debug logging
	$: console.log('[popup.html] Wallet state:', {
		publicKey: $walletStore.publicKey?.substring(0, 20) + '...',
		address: $walletStore.address,
		isPaired
	});

	type Tx = {
		id: string;
		type: 'in' | 'out';
		amount: number;
		unit?: string;
		date: string;
		status?: 'confirmed' | 'pending';
		description?: string;
	};

	let balance = 0; // Will be populated from store
	let fiat = 0; // Will be populated from store
	let showBalance = true; // toggle to hide/show balance
	let isRefreshing = false;
	let showAddressDropdown = false;
	let requestingAddresses = false;

	// Subscribe to wallet store
	$: {
		balance = parseFloat($walletStore.btc) || 0;
		fiat = parseFloat($walletStore.usd) || 0;
	}

	// Convert wallet transactions to UI format
	$: transactions = $walletStore.transactions.map(tx => ({
		id: tx.txid,
		type: tx.type === 'receive' ? 'in' : 'out' as 'in' | 'out',
		amount: tx.amount / 100_000_000, // Convert sats to BTC
		unit: 'BTC' as const,
		date: new Date(tx.timestamp * 1000).toISOString().slice(0, 10),
		status: tx.status,
		description: tx.type === 'receive' 
			? `Received from ${tx.from?.slice(0, 6) || 'unknown'}...`
			: `Sent to ${tx.to?.slice(0, 6) || 'unknown'}...`
	}));

// When pairing sets the status to fetching, trigger an automatic refresh and show spinner
$: if (pairingStatus === 'Fetching wallet data...' && !isRefreshing) {
	(async () => {
		try {
			await fetchWalletDataAndHandleStatus();
		} catch (err) {
			// error already handled by helper
		}
	})();
}

	let showSend = false;
	let showReceive = false;
	let sendAmount = '';
	let sendAddress = '';
	let receiveAddress = ''; // Will be populated from store
	let sending = false;
	let message = '';

// Toast notification state
let toastMessage = '';
let toastType: 'success' | 'error' | '' = '';
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function triggerToast(msg: string, type: 'success' | 'error' = 'success') {
	// Clear previous timer
	if (toastTimer) {
		clearTimeout(toastTimer);
		toastTimer = null;
	}
	toastMessage = msg;
	toastType = type;
	// Auto-clear after 3s
	toastTimer = setTimeout(() => {
		toastMessage = '';
		toastType = '';
		toastTimer = null;
	}, 3000);
}
	let showQRModal = false;
	let qrCodeDataUrl = '';
	let qrModalTitle = '';

	// Update receive address from wallet store
	$: receiveAddress = $walletStore.address || 'No address configured';
	
	// Pairing functions
	async function handlePairDevice() {
		try {
			// Generate pairing QR code requesting public key
			const res = await qr.generatePairingQR();
			pairingQRData = res.dataUrl;
			pairingPayload = res.payload;
			pairingStatus = '';
			pairingStep = 1;
		} catch (error) {
			console.error('Failed to generate pairing QR:', error);
			pairingStatus = 'Failed to generate QR code';
			alert('Failed to generate pairing QR code');
		}
	} 

	function nextStep() {
		pairingStep++;
	}

	function prevStep() {
		if (pairingStep > 1) {
			pairingStep--;
		} else {
			// Cancel pairing if back from step 1
			pairingStep = 0;
			pairingStatus = 'Click logo to start pairing';
		}
	}

	function handleStartScanner() {
		pairingStep = 4;
	} 
	
	function handleCloseScanner() {
		// Close scanner and return to pairing options (step 3)
		pairingStep = 3;
		pairingStatus = '';
	} 

	function handleScanResponse() {
		// Move to Manual Input (Step 5)
		pairingStep = 5;
		pairingStatus = 'Enter the response from your mobile wallet';
	} 

	async function handleQRScanFromCamera(qrData: string) {
		// Hide scanner immediately by setting a temp step or loading step, keeping 4 for now until success
		// But logically we process it.
		
		try {
			pairingStatus = 'Processing scanned response...';
			console.log('[popup.html] Processing scanned QR from camera');
			const result = await qr.processScanedQR(qrData);
			// If we got a short numeric pairing code, instruct the user and show manual input
			if (result && result.type === 'pairing_code') {
				pairingStatus = `Received pairing code: ${result.data.code}. Please export full pairing response.`;
				pairingStep = 5; // Go to manual input
				return;
			}
			
			// Refresh local wallet state
			await initializeWalletStore();

			const latestWallet = get(walletStore);
			const paired = !!latestWallet.publicKey?.trim();

			if (paired) {
				pairingStatus = 'Paired successfully!';
				pairingStep = 0; // Or keep it hidden, component will unmount/navigate
				
				// ... [Navigation logic same as before] ...
				
				if (!latestWallet.address) {
					pairingStatus = 'Paired (watch-only). No addresses available to fetch balance';
					triggerToast('Paired (watch-only)', 'success');
					setTimeout(() => {
						if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
							const popupUrl = chrome.runtime.getURL('popup.html');
							if (typeof window !== 'undefined' && location.href !== popupUrl) {
								location.href = popupUrl;
							}
						} else if (typeof window !== 'undefined' && location.pathname !== '/popup.html') {
							goto('/popup.html');
						}
					}, 700);
				} else {
					try {
						pairingStatus = 'Fetching wallet data...';
						await fetchWalletDataAndHandleStatus();
						pairingStatus = 'Wallet updated';
					} catch (err) {
						console.error('Failed to refresh wallet data after pairing:', err);
						pairingStatus = 'Paired but failed to fetch wallet data';
					}
				}
			} else {
				pairingStatus = 'Pairing response received but no key was stored';
				// Stay on scanner or go back? Go back to options
				pairingStep = 3; 
			}
		} catch (error) {
			console.error('Failed to process scanned QR code:', error);
			pairingStatus = 'Failed to pair. Please try again.';
			pairingStep = 3; // Go back to options
			alert('Failed to process QR code: ' + (error instanceof Error ? error.message : 'Unknown error'));
		}
	}

	async function handleManualSubmit() {
		if (!manualPublicKey.trim()) {
			alert('Please enter the public key from your mobile wallet');
			return;
		}
		
		processingPairing = true;
		
		try {
			pairingStatus = 'Processing public key...';
			await qr.processScanedQR(manualPublicKey.trim());
			
			// Refresh local wallet state
			await initializeWalletStore();

			const latestWallet = get(walletStore);
			const paired = !!latestWallet.publicKey?.trim();

			if (paired) {
				pairingStatus = 'Paired successfully!';
				pairingStep = 0; // hide UI
				if (!latestWallet.address) {
					pairingStatus = 'Paired (watch-only). No addresses available to fetch balance';
				} else {
					try {
						pairingStatus = 'Fetching wallet data...';
						await fetchWalletDataAndHandleStatus();
						pairingStatus = 'Wallet updated';
					} catch (err) {
						console.error('Failed to refresh wallet data after manual pairing:', err);
						pairingStatus = 'Paired but failed to fetch wallet data';
					}
				}
			}
		} catch (error) {
			console.error('Failed to process public key:', error);
			pairingStatus = 'Failed to pair. Please try again.';
			alert('Failed to process: ' + (error instanceof Error ? error.message : 'Unknown error'));
		} finally {
			processingPairing = false;
		}
	}

	async function handleQRScanned(qrData: string) {
        // Redundant legacy handler? Let's alias it to handleQRScanFromCamera or just remove usage
        await handleQRScanFromCamera(qrData);
	}

	async function handleRefresh() {
		if (isRefreshing) return;
		isRefreshing = true;
		try {
			await fetchWalletDataAndHandleStatus();
		} finally {
			// Add small delay for visual feedback
			setTimeout(() => {
				isRefreshing = false;
			}, 500);
		}
	}

	function toggleBalance() {
		showBalance = !showBalance;
	}

	function toggleAddressDropdown() {
		showAddressDropdown = !showAddressDropdown;
	}

	async function selectAddress(address: string) {
		showAddressDropdown = false;
		if (address !== $walletStore.address) {
			await setAddress(address);
		}
	}

/**
 * Attempt to fetch wallet data (balance, txs) with local status handling
 */
async function fetchWalletDataAndHandleStatus() {
		isRefreshing = true;
		try {
			await refreshWalletData();
			pairingStatus = 'Wallet updated';
			pairingStep = 0;
			// Show success toast and redirect to main wallet page after short delay
			triggerToast('Paired and wallet updated', 'success');
			setTimeout(() => {
				// Ensure navigation only happens when needed and use a robust extension URL fallback
				console.log('[popup.html] Navigating to popup.html after fetchWalletDataAndHandleStatus (using location fallback)');
				pairingStep = 0;
				if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
					const popupUrl = chrome.runtime.getURL('popup.html');
					if (typeof window !== 'undefined' && location.href !== popupUrl) {
						console.log('[popup.html] location.href ->', popupUrl);
						location.href = popupUrl;
					}
				} else if (typeof window !== 'undefined' && location.pathname !== '/popup.html') {
					// Fallback to client navigation if chrome.runtime not available
					goto('/popup.html');
				}
			}, 700);
		} catch (err) {
			console.error('Failed to refresh wallet data:', err);
			pairingStatus = 'Paired but failed to fetch wallet data';
			triggerToast('Paired but failed to fetch wallet data', 'error');
			throw err;
		} finally {
			isRefreshing = false;
		}
	}
	async function handleRequestAddresses() {
		requestingAddresses = true;
		try {
			// Generate QR code for mobile to scan
			const dataUrl = await qr.requestAddresses();
			qrCodeDataUrl = dataUrl;
			qrModalTitle = 'Scan with Mobile Wallet';
			showQRModal = true;
		} catch (error) {
			console.error('Failed to generate address request QR:', error);
			alert('Failed to generate QR code');
		} finally {
			requestingAddresses = false;
		}
	}


	function closeQRModal() {
		showQRModal = false;
		qrCodeDataUrl = '';
		qr.clearSession();
	}

	async function retryFetchWalletData() {
		if (isRefreshing) return;
		pairingStatus = 'Retrying wallet data fetch...';
		try {
			await fetchWalletDataAndHandleStatus();
		} catch (err) {
			// error handled by helper
		}
	}

	function openSend() {
		sendAmount = '';
		sendAddress = '';
		showSend = true;
	}

	function openReceive() {
		showReceive = true;
	}

	function closeModals() {
		showSend = false;
		showReceive = false;
		message = '';
	}

	async function confirmSend() {
		sending = true;
		message = '';
		// Small UI delay
		await new Promise((r) => setTimeout(r, 400));
		const amount = parseFloat(sendAmount || '0');
		if (!amount || !sendAddress) {
			message = 'Please enter amount and address.';
			sending = false;
			return;
		}

		try {
			const amountSats = Math.round(amount * 1e8);

			// Extension is watch-only: always generate a send-fill QR for the mobile wallet to complete the send
			// Try to fetch fee estimates, otherwise use conservative defaults
			let feeRateUsed = 5; // sats/vB default
			try {
				const { halfHourFee, hourFee, fastestFee } = await (await import('$lib/services/blockchain')).blockchain.getFeeEstimates();
				feeRateUsed = halfHourFee || hourFee || fastestFee || feeRateUsed;
			} catch (e) {
				// Safely stringify unknown error types to avoid TypeScript errors accessing e.message
				console.warn('[popup.html] Failed to fetch fee estimates, using default', e instanceof Error ? e.message : String(e));
			}

			const estimatedVsize = 250; // conservative vsize estimate
			const feeSats = Math.max(1, Math.round(feeRateUsed * estimatedVsize));

			const { dataUrl, payload } = await qr.generateSendQR(sendAddress, amountSats, feeSats, '');
			qrCodeDataUrl = dataUrl;
			qrModalTitle = 'Scan with Mobile Wallet to Send';
			showQRModal = true;
			message = 'Open your mobile wallet and scan this QR to complete the send.';
			triggerToast(`Send QR generated (fee ${feeSats} sats). Scan with mobile to complete.`, 'success');

			// Keep modal open; do not queue/broadcast locally - mobile will perform the send
			setTimeout(() => closeModals(), 1200);
		} catch (err) {
			console.error('Failed to prepare/send transaction:', err);
			// If PSBT creation failed because there are no UTXOs and we are paired, show a clear message
			// Safely extract message from unknown error types
			const errMsg = err instanceof Error ? err.message : (typeof err === 'string' ? err : '');
			if (/No UTXOs available/.test(errMsg)) {
				message = 'No UTXOs available for spending on this address. Please fund the wallet or use your mobile wallet to send.';
				triggerToast(message, 'error');
			} else {
				triggerToast('Failed to prepare transaction', 'error');
				message = 'Failed to prepare transaction.';
			}
		} finally {
			sending = false;
		}
	}

	function mockReceive() {
		const amount = 0.0025;
		balance = +(balance + amount).toFixed(8);
		transactions = [{ id: Math.random().toString(36).slice(2), type: 'in', amount, unit: 'BTC', date: new Date().toISOString().slice(0, 10), status: 'confirmed', description: 'Mock receive' }, ...transactions];
		message = 'Received!';
		setTimeout(() => closeModals(), 1000);
	}

	onMount(async () => {
		console.log('[popup.html] onMount - initializing wallet store');
		// Initialize wallet store from storage
		await initializeWalletStore();
		
		console.log('[popup.html] After init - isPaired:', isPaired);
		
		// If paired, refresh wallet data
		if (isPaired) {
			console.log('[popup.html] Wallet is paired, refreshing data');
			await fetchWalletDataAndHandleStatus();
		} else {
			console.log('[popup.html] Wallet not paired, showing pairing UI');
		}
	});
</script>


<div class="popup-root" class:unpaired={!isPaired}>
{#if !isPaired}
	<!-- Unpaired State: Show pairing UI -->
	<div class="pairing-container">
	{#if pairingStep === 0}
		<div class="pairing-logo">
			<img src={logo} alt="Bold Bitcoin Logo" class="app-logo" width="120" height="120" />
		</div>
		<button class="btn-open" on:click={handlePairDevice}>
			Open
		</button>
	{/if}

		{#if pairingStep > 0}
			{#if pairingStep !== 4}
				<div class="qr-display">
					<p class="pairing-status">
							{#if isRefreshing}
								<span class="spinner" aria-hidden="true" title="Fetching wallet data"></span>
							{/if}
							{pairingStatus}
						</p>
						{#if toastMessage}
							<div class="toast {toastType}">{toastMessage}</div>
						{/if}
						
						{#if pairingStep === 1}
							<div class="step-container">
								<p class="instruction">Scan this QR with your mobile wallet</p>
								<p class="instruction"><strong>Step 1: Chrome Extension Pairing</strong></p>
								<p class="instruction">Open <strong>Chrome Extension Pairing</strong> on your mobile app and scan this QR code</p>
								<p class="instruction" style="font-size: 0.85em; opacity: 0.6;">NOT Web App Pairing - this is specifically for the Chrome Extension</p>
								<div class="button-row">
									<button class="btn-secondary" on:click={prevStep}>Cancel</button>
									<button class="btn-primary" on:click={nextStep}>Next</button>
								</div>
							</div>
						{:else if pairingStep === 2}
							<div class="step-container">
								<div class="qr-code">
									<img src={pairingQRData} alt="Pairing QR Code" />
								</div>
								<div class="button-row">
									<button class="btn-secondary" on:click={prevStep}>Back</button>
									<button class="btn-primary" on:click={nextStep}>Next</button>
								</div>
							</div>
						{:else if pairingStep === 3}
							<div class="response-options">
								<p class="instruction"><strong>Step 3: Capture Response</strong></p>
								<div class="button-row">
									<button class="btn-primary" on:click={handleStartScanner}>
										📷 Scan Response
									</button>
									<button class="btn-secondary" on:click={handleScanResponse}>
										📝 Enter Manually
									</button>
								</div>
								<div class="cancel-row">
									<button class="btn-text" on:click={prevStep}>
										Back
									</button>
								</div>
							</div>
						{:else if pairingStep === 5}
							<div class="step-container">
								<p class="instruction"><strong>Enter Response</strong></p>
								<p class="instruction">Copy the response from your mobile wallet and paste it below:</p>
								
								<textarea 
									class="public-key-input"
									bind:value={manualPublicKey}
									placeholder='Paste the JSON response from your mobile wallet here...'
									rows="4"
									disabled={processingPairing}
								></textarea>
								
								<button 
									class="btn-primary" 
									on:click={handleManualSubmit}
									disabled={!manualPublicKey.trim() || processingPairing}
								>
									{processingPairing ? 'Processing...' : 'Complete Pairing'}
								</button>
		
								<button class="btn-text" on:click={() => { pairingStep = 3; pairingStatus = ''; }}>
									Back
								</button>
							</div>
						{/if}

						{#if pairingStatus === 'Paired but failed to fetch wallet data'}
							<div class="fetch-retry">
								<p class="instruction">Failed to fetch wallet data. You can retry fetching balances and transactions.</p>
								<button class="btn-retry-fetch" on:click={retryFetchWalletData} disabled={isRefreshing}>
									{#if isRefreshing}Retrying...{/if}
									{#if !isRefreshing}Retry fetch{/if}
								</button>
							</div>
						{/if}
				</div>
			{/if}
		{/if}

		{#if pairingStep === 4}
			<div class="scanner-overlay">
				<QRScannerPopup 
					onScan={handleQRScanFromCamera}
					onClose={handleCloseScanner}
				/>
			</div>
		{/if}
	</div>
{:else}
	<!-- Paired State: Show wallet -->
<div class="wallet">
	<header class="wallet-header">
		<img src={logoSmall} alt="Logo" class="logo" width="44" height="44" class:spinning={!showBalance} />
		<div class="header-content">
			<h1>Bold Bitcoin Wallet</h1>
			<p class="network">{$walletStore.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</p>
		</div>
		<div class="header-actions">
			<button 
				class="refresh-btn" 
				on:click={handleRefresh} 
				disabled={isRefreshing}
				title="Refresh wallet data"
				class:spinning={isRefreshing}
			>
				🔄
			</button>
			<button 
				class="bitcoin-toggle" 
				on:click={toggleBalance} 
				class:hidden={!showBalance} 
				title={showBalance ? 'Hide balance' : 'Show balance'}
			>
				<img src={bitcoinLogo} alt="Bitcoin" class="bitcoin-icon" />
			</button>
		</div>
	</header>

	<section class="balance">
		<div class="balance-content">
			{#if $walletStore.isLoading}
				<div class="amount fade-in">Loading...</div>
				<div class="fiat fade-in">Fetching from blockchain...</div>
			{:else if $walletStore.error}
				<div class="amount error fade-in">Error</div>
				<div class="fiat error fade-in">{$walletStore.error}</div>
			{:else if showBalance}
				<div class="amount fade-in">{balance.toFixed(8)} <span class="unit">BTC</span></div>
				<div class="fiat fade-in">~ ${fiat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
			{:else}
				<div class="amount placeholder fade-in">●●●●●●●●</div>
				<div class="fiat placeholder fade-in">●●●●●●●</div>
			{/if}
		</div>
	</section>

	<section class="address-selector">
		<div class="selector-header">
			<span class="selector-label">Wallet Address:</span>
			{#if $walletStore.addresses.length > 0}
				<button class="dropdown-toggle" on:click={toggleAddressDropdown}>
					<span class="address-display">
						{#if $walletStore.address}
							{$walletStore.address.slice(0, 8)}...{$walletStore.address.slice(-6)}
						{:else}
							Select Address
						{/if}
					</span>
					<span class="dropdown-arrow" class:open={showAddressDropdown}>▼</span>
				</button>
			{:else}
				<button class="sync-addresses" on:click={handleRequestAddresses} disabled={requestingAddresses}>
					{requestingAddresses ? 'Requesting...' : 'Sync from Mobile'}
				</button>
			{/if}
		</div>

		{#if showAddressDropdown}
			<div class="address-dropdown">
				<div class="dropdown-header">
					<span>Select Address ({$walletStore.addresses.length})</span>
					<button class="sync-btn-small" on:click={handleRequestAddresses} disabled={requestingAddresses}>
						{requestingAddresses ? '⟳' : '🔄'}
					</button>
				</div>
				<ul class="address-list">
					{#each $walletStore.addresses as addr}
						<button
							class="address-item" 
							class:active={addr.address === $walletStore.address}
							on:click={() => selectAddress(addr.address)}
						>
							<div class="address-info">
								<div class="address-text">
									{addr.label || `Address ${addr.index}`}
								</div>
								<div class="address-value">
									{addr.address.slice(0, 12)}...{addr.address.slice(-8)}
								</div>
								<div class="address-path">{addr.path}</div>
							</div>
							{#if addr.balance}
								<div class="address-balance">{parseFloat(addr.balance).toFixed(8)} BTC</div>
							{/if}
						</button>
					{/each}
				</ul>
			</div>
		{/if}
	</section>

	<section class="actions">
		<button class="btn send" on:click={openSend}>⬆️ Send</button>
		<button class="btn receive" on:click={openReceive}>⬇️ Receive</button>
	</section>

	{#if showBalance}
		<section class="tx-list fade-in">
			<h2>Recent Transactions</h2>
			{#if transactions.length === 0}
				<p class="empty">No transactions yet</p>
			{:else}
				<ul>
					{#each transactions as tx}
						<li class={"tx " + tx.type}>
							<div class="tx-left">
								<span class="tx-type">{tx.type === 'in' ? 'IN' : 'OUT'}</span>
								<div class="tx-meta">
									<div class="tx-desc">{tx.description}</div>
									<div class="tx-date">{tx.date}</div>
								</div>
							</div>
							<div class="tx-right">
								<div class="tx-amount">{tx.amount} <span class="unit">BTC</span></div>
								<div class="tx-status">{tx.status}</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{:else}
		<section class="tx-list-hidden fade-in">
			<p class="empty">Balance hidden</p>
		</section>
	{/if}

	<footer class="footer">
		<small>All rights reserved free and open source.</small>
	</footer>

	{#if showSend}
		<div class="modal">
			<div class="modal-card">
				<h3>Send BTC</h3>
				<label for="send-amount">Amount</label>
				<input id="send-amount" placeholder="0.001" bind:value={sendAmount} />
				<label for="send-address">Address</label>
				<input id="send-address" placeholder="bc1..." bind:value={sendAddress} />
				<div class="modal-actions">
					<button class="btn" on:click={closeModals}>Cancel</button>
					<button class="btn primary" on:click={confirmSend} disabled={sending}>{sending ? 'Sending...' : 'Confirm'}</button>
				</div>
				{#if message}
					<div class="msg">{message}</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if showReceive}
		<div class="modal">
			<div class="modal-card">
				<h3>Receive BTC</h3>
				<p class="address">{receiveAddress}</p>
				<button class="btn" on:click={() => navigator.clipboard?.writeText(receiveAddress)}>Copy</button>
				<button class="btn primary" on:click={mockReceive}>Simulate Receive</button>
				<div class="modal-actions">
					<button class="btn" on:click={closeModals}>Close</button>
				</div>
				{#if message}
					<div class="msg">{message}</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if showQRModal}
		<div class="modal">
			<div class="modal-card qr-modal">
				<h3>{qrModalTitle}</h3>
				{#if qrCodeDataUrl}
					<div class="qr-container">
						<img src={qrCodeDataUrl} alt="QR Code" class="qr-code" />
					</div>
					<p class="qr-instructions">
						Open your mobile wallet and scan this QR code
					</p>
				{:else}
					<p>Generating QR code...</p>
				{/if}
				<div class="modal-actions">
					<button class="btn" on:click={closeQRModal}>Close</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes slideInUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.6;
		}
	}

	@keyframes shimmer {
		0% {
			background-position: -1000px 0;
		}
		100% {
			background-position: 1000px 0;
		}
	}

	@keyframes rotate {
		from {
			transform: rotateY(0deg);
		}
		to {
			transform: rotateY(360deg);
		}
	}

	@keyframes rotateHidden {
		from {
			transform: rotateY(360deg);
		}
		to {
			transform: rotateY(0deg);
		}
	}

	:global(body) {
		margin: 0;
		padding: 0;
		height: 100%;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
		width: 380px;
		min-height: 580px;
		background: var(--color-background);
		overflow-x: hidden;
		color: var(--color-text);
	} 

	:global(html) {
		width: 380px;
		min-height: 580px;
		background: var(--color-background);
	}

	.popup-root {
		width: 100%;
		min-height: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		background: var(--color-background);
	}

	.popup-root.unpaired {
		justify-content: center;
	}

	.wallet {
		display: flex;
		flex-direction: column;
		width: 380px;
		min-height: 580px;
		color: var(--color-text);
		background: var(--color-background);
	}

	.wallet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
		gap: 8px;
		border-bottom: 1px solid rgba(0,0,0,0.04);
	}

	.header-content {
		flex: 1;
	}

	.logo {
		width: 44px;
		height: 44px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.08);
		object-fit: contain;
		margin-right: 12px;
		transition: transform 0.3s ease, background 0.3s ease;
		will-change: transform;
	}

	.logo:hover {
		background: rgba(255, 255, 255, 0.15);
	}

	.logo.spinning {
		animation: rotate 0.6s ease-out;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.refresh-btn {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 6px;
		border-radius: 6px;
		transition: all 0.3s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 36px;
		width: 36px;
		font-size: 18px;
		color: var(--color-text);
		opacity: 0.8;
	}

	.refresh-btn:hover {
		background: rgba(0, 0, 0, 0.05);
		opacity: 1;
		transform: scale(1.1);
	}

	.refresh-btn:active {
		transform: scale(0.95);
	}

	.refresh-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.refresh-btn.spinning {
		animation: rotate 0.6s linear infinite;
	}

	.bitcoin-toggle {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 6px;
		border-radius: 6px;
		transition: all 0.3s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 36px;
		width: 36px;
		color: var(--color-accent);
		opacity: 1;
	}

	.bitcoin-toggle:hover {
		background: rgba(0, 0, 0, 0.05);
		transform: scale(1.15);
	}

	.bitcoin-toggle:active {
		transform: scale(0.95);
	}

	.bitcoin-toggle.hidden {
		opacity: 0.4;
		color: var(--color-disabled);
	}

	.bitcoin-toggle.hidden:hover {
		background: rgba(0, 0, 0, 0.05);
	}

	.bitcoin-icon {
		width: 24px;
		height: 24px;
		object-fit: contain;
		transition: opacity 0.3s ease;
	}

	.bitcoin-toggle.hidden .bitcoin-icon {
		opacity: 0.4;
	}

	.wallet-header h1 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0.3px;
	}

	.wallet-header .network {
		font-size: 12px;
		opacity: 0.8;
		margin-top: 2px;
	}

	.balance {
		padding: 20px 16px;
		background: var(--color-cardBackground);
		border-bottom: 1px solid var(--color-border);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.balance-content {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.amount {
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.5px;
		color: var(--color-text);
	}

	.amount.placeholder {
		letter-spacing: 2px;
		color: var(--color-disabled);
		animation: pulse 1.5s ease-in-out infinite;
	}

	.amount.error {
		color: var(--color-error);
		font-size: 18px;
	}

	.unit {
		font-size: 14px;
		margin-left: 8px;
		color: var(--color-textSecondary);
		font-weight: 500;
	}

	.fiat {
		color: var(--color-textSecondary);
		font-size: 14px;
	}

	.fiat.placeholder {
		color: var(--color-disabled);
		animation: pulse 1.5s ease-in-out infinite;
	}

	.fiat.error {
		color: var(--color-error);
		font-size: 12px;
	}

	.fade-in {
		animation: fadeIn 0.4s ease-out;
	}

	.address-selector {
		padding: 12px 16px;
		background: var(--color-cardBackground);
		border-bottom: 1px solid var(--color-border);
		position: relative;
	}

	.selector-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.address-selector {
		position: relative;
	}

	.selector-label {
		font-size: 12px;
		color: var(--color-textSecondary);
		font-weight: 500;
	}

	.dropdown-toggle {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 13px;
		font-family: monospace;
	}

	.dropdown-toggle:hover {
		background: var(--color-background);
		filter: brightness(0.95);
		border-color: var(--color-textSecondary);
	}

	.address-display {
		color: var(--color-text);
		font-weight: 500;
	}

	.dropdown-arrow {
		font-size: 10px;
		color: var(--color-textSecondary);
		transition: transform 0.2s ease;
	}

	.dropdown-arrow.open {
		transform: rotate(180deg);
	}

	.sync-addresses {
		padding: 8px 16px;
		background: var(--color-primary);
		color: var(--color-textOnPrimary);
		border: none;
		border-radius: 8px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 500;
		transition: all 0.2s ease;
	}

	.sync-addresses:hover:not(:disabled) {
		filter: brightness(0.9);
	}

	.sync-addresses:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.address-dropdown {
		position: absolute;
		top: 100%;
		left: 16px;
		right: 16px;
		background: var(--color-cardBackground);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
		z-index: 1000;
		margin-top: 4px;
		max-height: 300px;
		overflow: hidden;
		animation: slideInUp 0.2s ease-out;
	}

	.dropdown-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		background: var(--color-background);
		border-bottom: 1px solid var(--color-border);
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text);
	}

	.sync-btn-small {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 4px;
		font-size: 14px;
		opacity: 0.6;
		transition: opacity 0.2s ease;
	}

	.sync-btn-small:hover:not(:disabled) {
		opacity: 1;
	}

	.sync-btn-small:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.address-list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 250px;
		overflow-y: auto;
	}

	.address-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px;
		cursor: pointer;
		transition: background 0.2s ease;
		border-bottom: 1px solid var(--color-border);
		border: none;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-cardBackground);
		width: 100%;
		text-align: left;
	}

	.address-item:last-child {
		border-bottom: none;
	}

	.address-item:hover {
		background: var(--color-background);
	}

	.address-item.active {
		background: var(--color-background);
		border-left: 3px solid var(--color-primary);
	}

	.address-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.address-text {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
	}

	.address-value {
		font-size: 11px;
		font-family: monospace;
		color: var(--color-textSecondary);
	}

	.address-path {
		font-size: 10px;
		color: var(--color-textSecondary);
		font-family: monospace;
	}

	.address-balance {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-success);
		font-family: monospace;
	}

	.actions {
		display: flex;
		gap: 10px;
		padding: 14px 16px;
		background: var(--color-cardBackground);
		border-bottom: 1px solid var(--color-border);
	}

	.btn {
		flex: 1;
		padding: 12px 16px;
		border-radius: 10px;
		border: none;
		cursor: pointer;
		background: var(--color-background);
		color: var(--color-text);
		font-weight: 500;
		transition: all 0.3s ease;
		font-size: 14px;
	}

	.btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.btn:active {
		transform: translateY(0);
	}

	.btn.primary {
		background: var(--color-primary);
		color: var(--color-textOnPrimary);
	}

	.btn.primary:hover {
		background: var(--color-subPrimary);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
	}

	.btn.send {
		background: var(--color-accent);
		color: var(--color-text);
	}

	.btn.send:hover {
		filter: brightness(0.95);
	}

	.btn.receive {
		background: var(--color-secondary);
		color: var(--color-textOnPrimary);
	}

	.btn.receive:hover {
		filter: brightness(0.95);
	}

	.tx-list {
		padding: 16px;
		flex: 1;
		overflow-y: auto;
	}

	.tx-list-hidden {
		padding: 16px;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow-y: auto;
	}

	.tx-list h2 {
		margin: 0 0 12px 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-textSecondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.tx {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--color-border);
		transition: all 0.2s ease;
		animation: slideInUp 0.4s ease-out;
	}

	.tx:hover {
		background: var(--color-background);
		padding: 12px 8px;
		border-radius: 6px;
		margin: 0 -8px;
	}

	.tx-left {
		display: flex;
		gap: 12px;
		align-items: center;
	}

	.tx-type {
		font-weight: 700;
		font-size: 11px;
		color: white;
		padding: 4px 6px;
		border-radius: 4px;
		background: var(--color-disabled);
		min-width: 28px;
		text-align: center;
	}

	.tx.in .tx-type {
		background: var(--color-success);
	}

	.tx.out .tx-type {
		background: var(--color-error);
	}

	.tx-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tx-desc {
		font-size: 13px;
		color: var(--color-text);
		font-weight: 500;
	}

	.tx-date {
		font-size: 12px;
		color: var(--color-textSecondary);
	}

	.tx-right {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}

	.tx-amount {
		font-weight: 700;
		font-size: 14px;
	}

	.tx.in .tx-amount {
		color: var(--color-success);
	}

	.tx.out .tx-amount {
		color: var(--color-error);
	}

	.tx-status {
		font-size: 11px;
		color: var(--color-textSecondary);
		text-transform: capitalize;
	}

	.footer {
		padding: 12px 16px;
		font-size: 12px;
		color: var(--color-textSecondary);
		text-align: center;
		background: var(--color-background);
		border-top: 1px solid var(--color-border);
	}

	.modal {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		animation: fadeIn 0.3s ease-out;
		z-index: 1000;
	}

	.modal-card {
		background: white;
		padding: 20px;
		border-radius: 14px;
		width: 320px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
		animation: slideInUp 0.4s ease-out;
	}

	.modal-card h3 {
		margin: 0 0 16px 0;
		font-size: 16px;
		font-weight: 700;
		color: #000;
	}

	.modal-card label {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: #374151;
		margin-bottom: 6px;
		text-transform: uppercase;
		letter-spacing: 0.3px;
	}

	.modal-card input {
		width: 100%;
		padding: 10px 12px;
		margin: 0 0 12px 0;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		font-size: 14px;
		transition: all 0.3s ease;
		box-sizing: border-box;
	}

	.modal-card input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.modal-actions {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		margin-top: 16px;
	}

	.msg {
		margin-top: 12px;
		padding: 10px 12px;
		background: #f0fdf4;
		color: #15803d;
		border-radius: 6px;
		font-size: 12px;
		animation: slideInUp 0.3s ease-out;
	}

	.address {
		font-family: 'Courier New', monospace;
		background: #f9fafb;
		padding: 12px;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		word-break: break-all;
		margin: 12px 0;
		font-size: 12px;
	}

	.empty {
		text-align: center;
		color: #9ca3af;
		padding: 20px 0;
		font-size: 14px;
	}

	.qr-modal {
		max-width: 400px;
	}

	.qr-container {
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 20px;
		background: white;
		border-radius: 8px;
		margin: 16px 0;
	}

	.qr-code {
		max-width: 100%;
		height: auto;
		border-radius: 8px;
	}

	.qr-instructions {
		text-align: center;
		color: #6b7280;
		font-size: 14px;
		margin: 12px 0;
	}

	/* Pairing UI styles */
	.pairing-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		max-width: 380px; /* constrain to popup width */
		min-height: 100%;
		height: 100%; /* use parent body height so attribute-based body styles don't break centering */
		flex: 1;
		padding: 24px 16px;
		margin: 0 auto;
		background: var(--color-background);
		color: var(--color-text);
		position: relative;
		overflow: hidden;
		box-sizing: border-box;
		gap: 16px;
	}  

	.scanner-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(255, 255, 255, 0.98);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 16px;
	}

	/* Removed gradient animation for clean white background */

	:global(body) {
		/* Popup should enforce themed background in this route; no !important needed */
		background: var(--color-background);
		color: var(--color-text);
		height: 100%;
		margin: 0;
	}

	:global(html) {
		/* Popup should enforce themed background in this route; no !important needed */
		background: var(--color-background);
		height: 100%;
	}  

	:global(body[data-sveltekit-preload-data="hover"]) {
		/* Explicitly target the SvelteKit-preloaded body attribute so popup sizing and background
		   match our layout rules and don't interfere with centering */
		width: 380px;
		min-height: 100%;
		height: 100%;
		background: var(--color-background);
	}

	/* Enforce modal styles to match white theme */
	.scanner-overlay {
		background: rgba(255,255,255,0.98);
	} 


	/* Center and animate logo */
	.pairing-logo {
		display: flex; /* use flex so child aligns properly */
		flex-direction: column;
		align-items: center;
		justify-content: center;
		align-self: center; /* ensure it is centered in parent */
		transition: transform 0.2s ease, box-shadow 0.2s ease;
		position: relative; /* z-index will take effect */
		margin: 0 auto 20px; /* horizontal centering fallback, add bottom margin for button */
		z-index: 10;
		background: var(--color-cardBackground);
		padding: 24px;
		border-radius: 16px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
		border: 1px solid var(--color-border);
		width: max-content; /* shrink to contents */
		max-width: 320px;
	} 

	.app-logo {
		width: 120px;
		height: 120px;
		margin-bottom: 12px;
		transition: transform 200ms ease;
	}


	@keyframes bounce {
		0% { transform: translateY(0); }
		30% { transform: translateY(-12px); }
		50% { transform: translateY(0); }
		65% { transform: translateY(-6px); }
		100% { transform: translateY(0); }
	}


	.app-logo {
		display: block; /* ensure it centers inside its container */
		margin: 0 auto 24px; /* center horizontally and keep spacing */
		width: 120px;
		height: 120px;
		transform-origin: center;
		will-change: transform;
		filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
	}

	/* Only pulse when not hovered/focused so bounce can take precedence */
	.pairing-logo:not(:hover):not(:focus) .app-logo {
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { 
			opacity: 1; 
			transform: scale(1);
		}
		50% { 
			opacity: 0.8; 
			transform: scale(1.05);
		}
	}

	.pairing-hint {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-textSecondary);
		text-align: center;
		margin-top: 8px;
		letter-spacing: 0.3px;
	}

	.btn-open {
		background: var(--color-primary);
		color: var(--color-textOnPrimary);
		border: none;
		padding: 14px 32px;
		border-radius: 12px;
		font-size: 16px;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
		letter-spacing: 0.3px;
		min-width: 140px;
	}

	.btn-open:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
		filter: brightness(0.95);
	}

	.btn-open:active {
		transform: translateY(0);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
	}

	.qr-display {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
		background: var(--color-cardBackground);
		padding: 28px 24px;
		border-radius: 16px;
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
		border: 1px solid var(--color-border);
		position: relative;
		z-index: 1;
		animation: slideIn 0.4s ease-out;
		width: 100%;
		max-width: 360px;
		box-sizing: border-box;
		transition: all 0.3s ease;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.pairing-status {
		font-size: 18px;
		font-weight: 700;
		color: var(--color-text);
		text-align: center;
		margin: 0;
		letter-spacing: -0.025em;
	}

	.instruction {
		font-size: 14px;
		color: var(--color-textSecondary);
		text-align: center;
		line-height: 1.6;
		margin: 0;
		max-width: 320px;
	}

	.instruction strong {
		color: var(--color-text);
		font-weight: 700;
	}

	.qr-code {
		background: var(--color-cardBackground);
		padding: 10px;
		border-radius: 16px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06), inset 0 1px 2px rgba(255, 255, 255, 0.8);
		border: 1px solid rgba(0, 0, 0, 0.08);
		animation: fadeIn 0.5s ease-out 0.2s both;
		transition: transform 0.2s ease;
		max-width: 100%;
	}

	.qr-code:hover {
		transform: scale(1.02);
	}

	.qr-code img {
		display: block;
		width: 160px;
		height: 160px;
		max-width: 100%;
		border-radius: 12px;
		filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.btn-primary {
		background: var(--color-primary);
		color: var(--color-textOnPrimary);
		border: none;
		padding: 12px 20px;
		height: 44px;
		border-radius: 10px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
		transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		letter-spacing: 0.01em;
		text-transform: none;
		width: 100%;
		max-width: 280px;
	}

	.btn-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.14);
		filter: brightness(0.95);
	}

	.btn-primary:active {
		transform: translateY(0);
		box-shadow: 0 4px 10px rgba(0, 0, 0, 0.12);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.btn-text {
		background: none;
		border: none;
		color: var(--color-textSecondary);
		cursor: pointer;
		font-size: 13px;
		font-weight: 600;
		padding: 8px 14px;
		transition: all 0.2s ease;
		border-radius: 8px;
		margin-top: 12px;
	}

	.btn-text:hover {
		background: rgba(0, 0, 0, 0.05);
		color: var(--color-text);
		transform: translateY(-1px);
	}

	/* Uniform button row styles for steppers */
	.step-container .button-row,
	.response-options .button-row {
		display: flex;
		gap: 12px;
		width: 100%;
		justify-content: center;
		align-items: center;
		margin-top: 16px;
	}

	.step-container .button-row button,
	.response-options .button-row button {
		flex: 1;
		width: auto;
		max-width: 160px;
		min-width: 110px;
		height: 44px;
		padding: 0 12px;
		font-size: 14px;
		margin: 0;
		border-radius: 10px;
	}


	/* Scoped pairing button styles (avoid global overrides) */
	.qr-display .btn-primary {
		width: 100%;
		background: var(--color-primary);
		color: var(--color-textOnPrimary);
		border: none;
		padding: 12px 18px;
		height: 44px;
		border-radius: 10px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
		box-shadow: 0 6px 16px rgba(0,0,0,0.08);
		margin: 0;
	}

	.qr-display .btn-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 8px 20px rgba(0,0,0,0.12);
		filter: brightness(0.95);
	}

	.qr-display .btn-secondary {
		background: var(--color-cardBackground);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		padding: 12px 16px;
		border-radius: 10px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
		box-shadow: 0 4px 12px rgba(16,24,40,0.05);
		margin: 0;
	}

	.qr-display .btn-secondary:hover {
		transform: translateY(-1px);
		background: rgba(0, 0, 0, 0.02);
		border-color: var(--color-border);
		box-shadow: 0 6px 16px rgba(16,24,40,0.08);
	}

	.btn-secondary:hover {
		background: rgba(0, 0, 0, 0.02);
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
	}

	.btn-secondary:active {
		transform: translateY(0);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	/* Response options - modern layout */
	.response-options {
		display: flex;
		flex-direction: column;
		gap: 14px;
		width: 100%;
		margin-top: 20px;
		padding-top: 18px;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		box-sizing: border-box;
	}

	/* Pairing stepper styles */
	.pairing-stepper {
		width: 100%;
		max-width: 360px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: center;
	}

	.steps-indicator {
		display: flex;
		gap: 8px;
		justify-content: center;
	}

	.steps-indicator button {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 1px solid var(--color-border);
		background: var(--color-cardBackground);
		color: var(--color-text);
		font-weight: 600;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.steps-indicator button[aria-selected="true"],
	.steps-indicator button.active {
		background: var(--color-primary);
		color: var(--color-textOnPrimary);
		border-color: transparent;
	}

	.step-controls,
	.button-row {
		display: flex;
		gap: 8px;
		justify-content: center;
		margin-top: 8px;
	}

	.scanner-inline {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: center;
	}

	/* keep instructions tight above controls */
	.response-options .instruction {
		margin: 0;
		padding-bottom: 6px;
		font-size: 13px;
		color: var(--color-textSecondary);
	}

	/* center QR and ensure it doesn't get pushed by wide controls */
	.qr-display {
		align-items: center; /* ensure qr and controls are centered */
	}

	.qr-code {
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 6px 0 0 0;
	}

	.qr-code img {
		display: block;
		margin: 0 auto;
		width: 160px;
		height: 160px;
		object-fit: contain;
	}

	/* button row: side-by-side, visually balanced */
	.response-options .button-row {
		display: flex;
		gap: 12px;
		width: 100%;
		align-items: center;
		justify-content: center;
	}

	/* make these local overrides more specific to beat any global button rules */
	.response-options .button-row .btn-primary,
	.response-options .button-row .btn-secondary {
		flex: 1 1 0;
		min-width: 120px;
		max-width: 180px;
		height: 44px;
		border-radius: 10px;
		padding: 0 18px;
		font-size: 14px;
		font-weight: 600;
		text-transform: none;
		box-shadow: 0 4px 12px rgba(16,24,40,0.06);
	}

	/* slightly stronger primary tone for contrast */
	.response-options .button-row .btn-primary {
		background: var(--color-primary);
		color: var(--color-textOnPrimary);
	}

	.response-options .button-row .btn-primary:hover {
		filter: brightness(0.9);
	}

	.response-options .button-row .btn-secondary {
		background: var(--color-cardBackground);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	.response-options .cancel-row {
		display: flex;
		justify-content: center;
		margin-top: 6px;
	}

	.response-options .cancel-row .btn-text {
		padding: 8px 14px;
		font-size: 13px;
		color: var(--color-textSecondary);
		background: transparent;
	}

	@media (max-width: 420px) {
		.response-options .button-row {
			flex-direction: column;
		}
		.response-options .button-row .btn-primary,
		.response-options .button-row .btn-secondary {
			width: 100%;
			max-width: none;
		}
	}

	/* Spinner for fetch state */
	.spinner {
		display: inline-block;
		width: 18px;
		height: 18px;
		border: 2px solid rgba(0, 0, 0, 0.12);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-right: 8px;
		vertical-align: middle;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Retry fetch UI */
	.fetch-retry {
		text-align: center;
		margin-top: 12px;
	}

	.btn-retry-fetch {
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.2);
		color: var(--color-text);
		padding: 8px 16px;
		border-radius: 10px;
		cursor: pointer;
		font-weight: 600;
	}

	.btn-retry-fetch[disabled] {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Toast notification */
	.toast {
		position: absolute;
		top: 12px;
		right: 12px;
		background: #111827;
		color: #fff;
		padding: 8px 12px;
		border-radius: 10px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
		z-index: 1200;
		font-weight: 600;
	}

	.toast.error {
		background: var(--color-error);
	}

	.toast.success {
		background: var(--color-success);
	}

	/* Manual Input Container - removed, now using qr-display */

	.public-key-input {
		width: 100%;
		padding: 16px;
		border: 2px solid var(--color-border);
		border-radius: 12px;
		font-family: 'SF Mono', Monaco, 'Courier New', monospace;
		font-size: 13px;
		resize: none;
		transition: all 0.3s ease;
		box-sizing: border-box;
		background: var(--color-inputBackground);
		color: var(--color-text);
		line-height: 1.5;
		min-height: 120px;
	}

	.public-key-input:focus {
		outline: none;
		border-color: var(--color-primary);
		background: var(--color-cardBackground);
		box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1), 0 4px 12px rgba(0, 0, 0, 0.08); /* Keep shadow for now */
		transform: translateY(-1px);
	}

	.public-key-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		background: var(--color-background);
	}

	.public-key-input::placeholder {
		color: var(--color-textSecondary);
		font-style: italic;
	}

	.scanner-container {
		width: 100%;
		max-width: 400px;
		background: var(--color-cardBackground);
		padding: 24px;
		border-radius: 24px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
		border: 1px solid rgba(0, 0, 0, 0.06);
		position: relative;
		z-index: 1;
		animation: slideIn 0.4s ease-out;
	}

	.scanner-container .instruction {
		margin-bottom: 16px;
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text);
	}

	.scanner-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		background: var(--color-cardBackground);
		padding: 24px 20px;
		border-radius: 16px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
		border: 1px solid rgba(0, 0, 0, 0.06);
		position: relative;
		z-index: 1;
		animation: slideIn 0.4s ease-out;
		width: 100%;
		max-width: 340px;
		box-sizing: border-box;
	}

	.btn-secondary {
		background: var(--color-cardBackground);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		padding: 10px 18px;
		border-radius: 10px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
		transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
		letter-spacing: 0.01em;
		width: 100%;
		max-width: 280px;
	}

	.btn-secondary:hover {
		background: rgba(0, 0, 0, 0.02);
		border-color: var(--color-border);
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
	}

	.btn-secondary:active {
		transform: translateY(0);
		box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
	}
	.step-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		text-align: center;
		gap: 16px;
	}

	/* Global fallback styles for pairing stepper (ensures styling even if scoped CSS is not applied) */
	:global(.popup-root .pairing-container) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		max-width: 380px;
		min-height: 100%;
		height: 100%;
		flex: 1;
		padding: 24px 16px;
		margin: 0 auto;
		background: var(--color-background);
		color: var(--color-text);
		box-sizing: border-box;
		gap: 16px;
	}

	:global(.popup-root .pairing-logo) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		background: var(--color-cardBackground);
		padding: 24px;
		border-radius: 16px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
		border: 1px solid var(--color-border);
	}

	:global(.popup-root .qr-display) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
		background: var(--color-cardBackground);
		padding: 28px 24px;
		border-radius: 16px;
		border: 1px solid var(--color-border);
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
		width: 100%;
		max-width: 360px;
		box-sizing: border-box;
	}

	:global(.popup-root .pairing-status) {
		font-size: 18px;
		font-weight: 700;
		color: var(--color-text);
		text-align: center;
		margin: 0;
	}

	:global(.popup-root .instruction) {
		font-size: 14px;
		color: var(--color-textSecondary);
		text-align: center;
		line-height: 1.6;
		margin: 0;
	}

	:global(.popup-root .button-row) {
		display: flex;
		gap: 12px;
		width: 100%;
		justify-content: center;
		align-items: center;
		margin-top: 16px;
	}

	:global(.popup-root .btn-primary) {
		background: var(--color-primary);
		color: var(--color-textOnPrimary);
		border: none;
		padding: 12px 20px;
		height: 44px;
		border-radius: 10px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
	}

	:global(.popup-root .btn-secondary) {
		background: var(--color-cardBackground);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		padding: 10px 18px;
		border-radius: 10px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	:global(.popup-root .btn-text) {
		background: none;
		border: none;
		color: var(--color-textSecondary);
		cursor: pointer;
		font-size: 13px;
		font-weight: 600;
		padding: 8px 14px;
	}
</style>
{/if}
</div>