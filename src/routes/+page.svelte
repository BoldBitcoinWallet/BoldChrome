<script lang="ts">
  import { onMount } from 'svelte';
  import { walletStore, initializeWalletStore, refreshWalletData, updateWalletFromPairing } from '$lib/stores/wallet';
  import QRScanner from '$lib/components/QRScanner.svelte';
  import SendTransaction from '$lib/components/SendTransaction.svelte';
  import ActiveTxVisualizer from '$lib/components/ActiveTxVisualizer.svelte';
  import { qr } from '$lib/services/qr';
  import logo from '$lib/assets/logo.png';
  import { keyshareFingerprint as computeKeyshareFingerprint } from '$lib/services/keyshareFingerprint';

  // Type for visualizer phase (kept in sync with component)
  type TxVisualizerPhase = 'idle' | 'signing' | 'broadcasting' | 'mempool' | 'confirmed';

  let showPairingQR = false;
  let showScanner = false;
  let showSendModal = false;
  let pairingQRData = '';
  let pairingStatus = 'Click logo to start pairing';

  // Active transaction visualizer state
  let activeTxVisualizerTxid: string | null = null;
  let activeTxVisualizerPhase: 'idle' | 'signing' | 'broadcasting' | 'mempool' | 'confirmed' = 'idle';

  // Reactive: Check if wallet is paired based on store
  $: isPaired = !!$walletStore.publicKey && $walletStore.publicKey.trim() !== '';

  $: keyshareFingerprintDisplay = computeKeyshareFingerprint($walletStore.publicKey);

  let walletIdCopyHint = '';

  async function copyWalletFingerprint() {
    const id = keyshareFingerprintDisplay;
    if (!id || id === 'N/A') return;
    try {
      await navigator.clipboard.writeText(id);
      walletIdCopyHint = 'Copied!';
    } catch {
      walletIdCopyHint = 'Could not copy';
    }
    setTimeout(() => {
      walletIdCopyHint = '';
    }, 2000);
  }

  // Debug logging
  $: console.log('[+page] Wallet state:', {
    publicKey: $walletStore.publicKey?.substring(0, 20) + '...',
    address: $walletStore.address,
    isPaired
  });

  onMount(async () => {
    console.log('[+page] onMount - initializing wallet store');
    // Initialize wallet store from storage
    await initializeWalletStore();
    
    console.log('[+page] After init - isPaired:', isPaired);
    
    // If paired, refresh wallet data
    if (isPaired) {
      console.log('[+page] Wallet is paired, refreshing data');
      await refreshWalletData();
    } else {
      console.log('[+page] Wallet not paired, showing pairing UI');
    }
  });

  async function handlePairDevice() {
    try {
      // Generate pairing QR code requesting public key
      pairingQRData = await qr.generatePairingQR();
      pairingStatus = 'Scan this QR with your mobile wallet';
      showPairingQR = true;
    } catch (error) {
      console.error('Failed to generate pairing QR:', error);
      pairingStatus = 'Failed to generate QR code';
      alert('Failed to generate pairing QR code');
    }
  }

  function handleScanResponse() {
    showPairingQR = false;
    showScanner = true;
    pairingStatus = 'Now scan the QR code from your mobile wallet';
  }

  async function handleQRScanned(qrData: string) {
    showScanner = false;
    
    try {
      pairingStatus = 'Processing scanned data...';
      const result = await qr.processScanedQR(qrData);
      
      // Handle different QR types
      if (result.type === 'pairing_response' || result.type === 'public_key') {
        // Public key pairing - reinitialize wallet
        await initializeWalletStore();
        isPaired = $walletStore.publicKey !== undefined && $walletStore.publicKey !== '';
        
        if (isPaired) {
          pairingStatus = 'Paired successfully!';
          await refreshWalletData();
        }
      } else if (result.type === 'bitcoin_address') {
        // Bitcoin address scanned - could be for sending
        pairingStatus = `Address scanned: ${result.data.address.substring(0, 20)}...`;
        // If already paired, could prompt to send to this address
        if (isPaired) {
          alert(`Bitcoin address detected:\n${result.data.address}\n\nYou can use this for sending.`);
        }
      } else if (result.type === 'payment_request') {
        // BIP21 payment request
        pairingStatus = 'Payment request received';
        const { address, amount } = result.data;
        if (isPaired) {
          alert(`Payment Request:\nTo: ${address}\nAmount: ${amount || 'Not specified'} BTC`);
        }
      } else {
        pairingStatus = 'QR processed successfully';
      }
    } catch (error) {
      console.error('Failed to process QR code:', error);
      pairingStatus = 'Failed to process QR. Please try again.';
      alert('Failed to process QR code: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  function handleScannerClose() {
    // Close scanner and return to pairing QR view so user can try again
    showScanner = false;
    showPairingQR = true;
    pairingStatus = 'Scan this QR with your mobile wallet';
  }

  function handleSendClick() {
    showSendModal = true;
  }

  function handleSendClose() {
    showSendModal = false;
  }

  function handleSendSuccess(txid: string) {
    showSendModal = false;

    // Start the visual transaction tracker for the new tx
    activeTxVisualizerTxid = txid;
    activeTxVisualizerPhase = 'broadcasting'; // start from broadcast (after signing)

    // Auto-clear visualizer after confirmation (or keep it visible)
    // The visualizer itself will transition to 'confirmed' via polling.

    // Refresh wallet to show updated balance
    refreshWalletData();
  }

  function handleVisualizerPhaseChange(phase: string) {
    // Optional: react to phase changes (e.g. log or update UI)
    if (phase === 'confirmed') {
      // Keep the visualizer visible for a while so user sees success state
      setTimeout(() => {
        // Optionally clear after confirmation to show real tx list:
        // activeTxVisualizerTxid = null;
      }, 8000);
    }
  }

  function formatBTC(btc: string): string {
    return parseFloat(btc).toFixed(8);
  }

  function formatUSD(usd: string): string {
    return parseFloat(usd).toFixed(2);
  }
</script>

<div class="wallet-container">
  <header>
    <h1>Bold Bitcoin Wallet</h1>
    <p class="subtitle">Watch-Only Chrome Extension</p>
  </header>

  {#if !isPaired}
    <!-- Unpaired State: Show logo -->
    <div class="pairing-section">
      {#if !showPairingQR}
        <div class="logo-container" on:click={handlePairDevice} on:keypress={handlePairDevice} role="button" tabindex="0">
          <img src={logo} alt="Bold Bitcoin Logo" class="app-logo" />
          <p class="logo-hint">{pairingStatus}</p>
        </div>
      {/if}

      {#if showPairingQR}
        <div class="qr-display">
          <p class="pairing-status">{pairingStatus}</p>
          <p class="instruction"><strong>Chrome Extension Pairing</strong></p>
          <p class="instruction">Open <strong>Chrome Extension Pairing</strong> on your mobile app</p>
          <p class="instruction" style="font-size: 0.9em; opacity: 0.8;">NOT Web App Pairing - this is specifically for the Chrome Extension</p>
          <div class="qr-code">
            <img src={pairingQRData} alt="Pairing QR Code" />
          </div>
          <button class="btn-primary" on:click={handleScanResponse}>
            I've Scanned - Now Scan Mobile QR
          </button>
          <button class="btn-text" on:click={() => { showPairingQR = false; }}>
            Cancel
          </button>
        </div>
      {/if}

      {#if showScanner}
        <div class="scanner-container">
          <p class="instruction">{pairingStatus}</p>
          <QRScanner onScan={handleQRScanned} onClose={handleScannerClose} />
        </div>
      {/if}
    </div>
  {:else}
    <!-- Paired State: Show wallet information -->
    <div class="wallet-info">
      {#if $walletStore.isLoading}
        <div class="loading">Loading wallet data...</div>
      {:else if $walletStore.error}
        <div class="error">{$walletStore.error}</div>
      {:else}
        <div class="balance-section">
          <div class="balance-main">
            <span class="btc-amount">{formatBTC($walletStore.btc)}</span>
            <span class="btc-label">BTC</span>
          </div>
          <div class="balance-usd">
            ${formatUSD($walletStore.usd)} USD
          </div>
          <div
            class="wallet-id-row"
            title="Short id for this wallet keyshare (first 8 characters of SHA-256 of the public key)."
          >
            <span class="wallet-id-label">Fingerprint</span>
            <span class="wallet-id-sep" aria-hidden="true">·</span>
            <span class="wallet-id-value">{keyshareFingerprintDisplay}</span>
            <button
              type="button"
              class="wallet-id-copy"
              on:click={copyWalletFingerprint}
              disabled={keyshareFingerprintDisplay === 'N/A'}
              title="Copy Fingerprint"
              aria-label="Copy Fingerprint"
            >Copy</button>
          </div>
          {#if walletIdCopyHint}
            <span
              class="wallet-id-copy-hint"
              class:error={walletIdCopyHint === 'Could not copy'}
            >{walletIdCopyHint}</span>
          {/if}
        </div>

        <div class="address-section">
          <div class="address-label">Active Address:</div>
          <div class="address">{$walletStore.address}</div>
          
          {#if $walletStore.addresses.length > 0}
            <details class="address-list">
              <summary>All Addresses ({$walletStore.addresses.length})</summary>
              <div class="addresses-container">
                {#each $walletStore.addresses as addr}
                  <div class="address-item" class:active={addr.address === $walletStore.address}>
                    <div class="addr-type-badge {addr.type}">{addr.type}</div>
                    <div class="addr-text">{addr.address}</div>
                    <div class="addr-path">{addr.path}</div>
                  </div>
                {/each}
              </div>
            </details>
          {/if}
        </div>

        <div class="transactions-section">
          <h3>Recent Transactions</h3>

          {#if activeTxVisualizerTxid}
            <!-- Active transaction visualizer (replaces empty state during lifecycle) -->
            <ActiveTxVisualizer
              txid={activeTxVisualizerTxid}
              initialPhase={activeTxVisualizerPhase}
              compact={true}
              onPhaseChange={handleVisualizerPhaseChange}
            />
          {:else if $walletStore.transactions.length === 0}
            <p class="no-transactions">No transactions yet</p>
          {:else}
            <div class="transaction-list">
              {#each $walletStore.transactions.slice(0, 5) as tx}
                <div class="transaction-item">
                  <div class="tx-info">
                    <span class="tx-type {tx.type}">{tx.type}</span>
                    <span class="tx-amount">{(tx.amount / 100_000_000).toFixed(8)} BTC</span>
                  </div>
                  <div class="tx-date">
                    {new Date(tx.timestamp * 1000).toLocaleDateString()}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="actions">
          <button class="btn-send" on:click={handleSendClick}>
            Send Bitcoin
          </button>
          <button class="btn-secondary" on:click={refreshWalletData}>
            Refresh
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if showSendModal}
    <div class="modal-overlay" role="button" tabindex="0" on:click={handleSendClose} on:keydown={(e) => e.key === 'Escape' && handleSendClose()}>
      <div class="modal-content" role="dialog" aria-modal="true" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
        <SendTransaction onClose={handleSendClose} onSuccess={handleSendSuccess} />
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideIn {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  :global(body) {
    margin: 0;
    padding: 0;
    width: 380px;
    min-height: 580px;
    overflow-x: hidden;
    background: #ffffff;
    color: #111827;
  }

  :global(html) {
    width: 380px;
    min-height: 580px;
    background: #ffffff;
  }

  .wallet-container {
    width: 380px;
    min-height: 580px;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: #ffffff;
    color: #111827;
    box-sizing: border-box;
  }

  header {
    display: none;
  }

  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    color: #f7931a;
  }

  .subtitle {
    margin: 5px 0 0 0;
    font-size: 12px;
    color: #71717a;
  }

  .pairing-section {
    min-height: 360px; /* reduced to avoid scroll on small popup */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 0; /* reduce vertical padding */
    animation: fadeIn 0.3s ease-out;
    /* Ensure full centering inside the popup */
    height: 100vh;
    box-sizing: border-box;
  }

  /* Center the logo container and add hover/focus bounce */
  .logo-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.2s ease;
    padding: 24px;
    border-radius: 20px;
    background: #ffffff;
    border: 1px solid rgba(0,0,0,0.04);
    box-shadow: 0 6px 18px rgba(0,0,0,0.04);
  }

  .logo-container:focus,
  .logo-container:hover {
    outline: none;
    transform: translateY(-4px);
  }

  .app-logo {
    width: 120px;
    height: 120px;
    margin-bottom: 20px;
    animation: pulse 2s ease-in-out infinite;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.08));
    transition: transform 200ms ease;
  }

  .logo-container:hover .app-logo,
  .logo-container:focus .app-logo {
    animation: bounce 600ms;
  }

  @keyframes bounce {
    0% { transform: translateY(0); }
    30% { transform: translateY(-12px); }
    50% { transform: translateY(0); }
    65% { transform: translateY(-6px); }
    100% { transform: translateY(0); }
  }

  .pairing-section p {
    margin: 0 0 24px 0;
    font-size: 14px;
    color: #a1a1aa;
    line-height: 1.6;
  }

  .logo-container {
    text-align: center;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 32px;
    border-radius: 20px;
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.06);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
  }

  .logo-container:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .app-logo {
    width: 120px;
    height: 120px;
    margin-bottom: 20px;
    animation: pulse 2s ease-in-out infinite;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.08));
  }

  .logo-hint {
    color: #111827;
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    letter-spacing: 0.3px;
  }

  .qr-display {
    margin-top: 20px;
    text-align: center;
    animation: slideIn 0.4s ease-out;
  }

  .qr-display p {
    color: #111827;
    margin-bottom: 16px;
  }

  .pairing-status {
    font-size: 16px;
    font-weight: 600;
    color: #111827;
  }

  .instruction {
    font-size: 14px;
    color: #374151;
    line-height: 1.6;
  }

  .instruction strong {
    color: #111827;
    font-weight: 700;
  }

  .qr-code {
    background: #ffffff;
    padding: 16px;
    border-radius: 12px;
    display: inline-block;
    margin: 16px 0;
    border: 1px solid rgba(0, 0, 0, 0.06);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
    max-width: 220px;
    box-sizing: border-box;
  }

  .qr-code img {
    display: block;
    width: 180px;
    height: 180px;
    max-width: 100%;
    object-fit: contain;
  }

  .scanner-container {
    margin-top: 20px;
    animation: fadeIn 0.3s ease-out;
  }

  .wallet-info {
    background: #ffffff;
    border-radius: 16px;
    padding: 24px;
    border: 1px solid rgba(0, 0, 0, 0.06);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
    animation: fadeIn 0.4s ease-out;
  }

  .balance-section {
    text-align: center;
    margin-bottom: 32px;
    padding: 28px;
    background: #ffffff;
    border-radius: 16px;
    border: 1px solid rgba(0,0,0,0.06);
  }

  .balance-main {
    font-size: 42px;
    font-weight: 700;
    margin-bottom: 8px;
    background: linear-gradient(135deg, #f7931a 0%, #ffd93d 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    text-shadow: none;
  }

  .btc-label {
    font-size: 18px;
    color: #f7931a;
    margin-left: 8px;
    font-weight: 500;
    -webkit-text-fill-color: #f7931a;
  }

  .balance-usd {
    font-size: 20px;
    color: #a1a1aa;
    font-weight: 500;
  }

  .wallet-id-row {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px 8px;
    margin-top: 20px;
    padding: 10px 12px;
    background: #f9fafb;
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 10px;
    font-size: 12px;
    color: #71717a;
  }

  .wallet-id-label {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 11px;
  }

  .wallet-id-sep {
    opacity: 0.45;
    user-select: none;
  }

  .wallet-id-value {
    font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: #111827;
  }

  .wallet-id-copy {
    margin-left: 2px;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: #ffffff;
    color: #71717a;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .wallet-id-copy:hover:not(:disabled) {
    border-color: #f7931a;
    color: #111827;
  }

  .wallet-id-copy:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .wallet-id-copy-hint {
    display: block;
    margin-top: 8px;
    font-size: 12px;
    color: #22c55e;
    font-weight: 600;
  }

  .wallet-id-copy-hint.error {
    color: #ef4444;
  }

  .address-section {
    margin-bottom: 24px;
  }

  .address-label {
    display: block;
    font-size: 11px;
    color: #71717a;
    font-weight: 600;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .address {
    background: #f3f4f6;
    padding: 14px;
    border-radius: 10px;
    font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
    font-size: 11px;
    word-break: break-all;
    color: #111827;
    border: 1px solid rgba(0, 0, 0, 0.06);
  }

  .address-list {
    margin-top: 16px;
  }

  .address-list summary {
    cursor: pointer;
    font-size: 13px;
    color: #a1a1aa;
    padding: 10px;
    user-select: none;
    border-radius: 8px;
    transition: all 0.2s;
    font-weight: 500;
  }

  .address-list summary:hover {
    background: rgba(247, 147, 26, 0.1);
    color: #f7931a;
  }

  .addresses-container {
    margin-top: 12px;
    max-height: 300px;
    overflow-y: auto;
  }

  .address-item {
    background: rgba(0, 0, 0, 0.2);
    padding: 12px;
    border-radius: 10px;
    margin-bottom: 8px;
    font-size: 11px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    transition: all 0.2s;
  }

  .address-item:hover {
    background: rgba(0, 0, 0, 0.3);
    border-color: rgba(247, 147, 26, 0.2);
  }

  .address-item.active {
    background: rgba(247, 147, 26, 0.1);
    border: 1px solid rgba(247, 147, 26, 0.3);
  }

  .addr-type-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    margin-bottom: 6px;
    letter-spacing: 0.5px;
  }

  .addr-type-badge.legacy {
    background: rgba(156, 163, 175, 0.2);
    color: #9ca3af;
  }

  .addr-type-badge.segwit-nested {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
  }

  .addr-type-badge.segwit-native {
    background: rgba(247, 147, 26, 0.2);
    color: #f7931a;
  }

  .addr-text {
    font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
    word-break: break-all;
    margin: 6px 0;
    color: #111827;
  }

  .addr-path {
    font-size: 9px;
    color: #6b7280;
    font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
    margin-top: 4px;
  }

  .transactions-section h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
    font-weight: 700;
    color: #111827;
  }

  .transaction-list {
    max-height: 200px;
    overflow-y: auto;
  }

  .transaction-item {
    background: #f3f4f6;
    padding: 14px;
    border-radius: 10px;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid rgba(0, 0, 0, 0.06);
    transition: all 0.2s;
  }

  .transaction-item:hover {
    background: #ffffff;
    transform: translateX(2px);
    border-color: rgba(0, 0, 0, 0.08);
  }

  .tx-info {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .tx-type {
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tx-type.receive {
    background: rgba(34, 197, 94, 0.12);
    color: var(--color-secondary);
  }

  .tx-type.send {
    background: rgba(239, 68, 68, 0.12);
    color: var(--color-bitcoinOrange);
  }

  .tx-amount {
    font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
    font-size: 13px;
    color: #111827;
    font-weight: 500;
  }

  .tx-date {
    font-size: 12px;
    color: #6b7280;
  }

  .no-transactions {
    text-align: center;
    color: #6b7280;
    font-size: 14px;
    padding: 24px;
  }

  .actions {
    margin-top: 24px;
    display: flex;
    gap: 12px;
  }

  .btn-send {
    flex: 1;
    background: linear-gradient(135deg, #f7931a 0%, #e8820f 100%);
    border: none;
    color: #000000;
    padding: 14px 24px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 16px rgba(247, 147, 26, 0.3);
  }

  .btn-send:hover {
    background: linear-gradient(135deg, #ffaa33 0%, #f7931a 100%);
    transform: translateY(-2px);
    box-shadow: 0 6px 24px rgba(247, 147, 26, 0.4);
  }

  .btn-send:active {
    transform: translateY(0);
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid rgba(247, 147, 26, 0.4);
    color: #f7931a;
    padding: 14px 24px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-secondary:hover {
    background: rgba(247, 147, 26, 0.1);
    border-color: rgba(247, 147, 26, 0.6);
    transform: translateY(-2px);
  }

  .btn-secondary:active {
    transform: translateY(0);
  }

  .btn-primary {
    width: 100%;
    background: linear-gradient(135deg, #111827 0%, #374151 100%);
    border: none;
    color: #ffffff;
    padding: 12px 20px;
    height: 44px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 6px 18px rgba(16, 24, 40, 0.08);
    margin-top: 12px;
  }

  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(16, 24, 40, 0.12);
  }

  .btn-primary:active {
    transform: translateY(0);
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid rgba(0,0,0,0.08);
    color: #111827;
    padding: 10px 18px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-secondary:hover {
    background: #f3f4f6;
    border-color: rgba(0,0,0,0.12);
  }

  .btn-text:hover {
    color: #f7931a;
  }

  .loading,
  .error {
    text-align: center;
    padding: 40px 20px;
    font-size: 14px;
  }

  .loading {
    color: #a1a1aa;
    animation: pulse 2s ease-in-out infinite;
  }

  .error {
    background: rgba(239, 68, 68, 0.1);
    border-radius: 12px;
    color: #f87171;
    font-weight: 500;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease-out;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    background: #ffffff;
    border-radius: 20px;
    max-width: 90%;
    max-height: 90%;
    overflow-y: auto;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    border: 1px solid rgba(0,0,0,0.06);
    animation: slideIn 0.3s ease-out;
  }
</style>
