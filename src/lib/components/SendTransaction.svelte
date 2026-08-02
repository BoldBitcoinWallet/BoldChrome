<script lang="ts">
  import { onMount } from 'svelte';
  import { psbt } from '$lib/services/psbt';
  import { walletStore, refreshWalletData } from '$lib/stores/wallet';
  import QRScanner from './QRScanner.svelte';
  import { qr } from '$lib/services/qr';

  export let onClose: () => void;
  export let onSuccess: (txid: string) => void;

  let recipientAddress = '';
  let amountBTC = '';
  let feeRate = 5; // sats/vByte
  let isCreating = false;
  let showPsbtQR = false;
  let showScanner = false;
  let psbtQRData = '';
  let lastPayload = '';
  let qrMode: 'psbt' | 'send' | null = null;
  let copyToast = '';
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let error = '';
  let step: 'form' | 'qr' | 'scanning' | 'broadcasting' = 'form';
  const psbtSession = psbt.session;
  let lastCompletedTxid = '';

  $: if ($psbtSession?.status === 'broadcasted' && $psbtSession.txid && $psbtSession.txid !== lastCompletedTxid) {
    lastCompletedTxid = $psbtSession.txid;
    onSuccess($psbtSession.txid);
  }

  // Subscribe to QR session updates
  $: qrSession = qr.session;

  $: amountSats = amountBTC ? Math.floor(parseFloat(amountBTC) * 100_000_000) : 0;
  $: estimatedFee = Math.ceil(250 * feeRate); // Rough estimate
  $: totalSats = amountSats + estimatedFee;
  $: totalBTC = (totalSats / 100_000_000).toFixed(8);

  async function handleCreatePsbt() {
    if (!recipientAddress || !amountBTC || parseFloat(amountBTC) <= 0) {
      error = 'Please fill in all fields';
      return;
    }

    // Validate address format
    if (!recipientAddress.match(/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}$/)) {
      error = 'Invalid Bitcoin address';
      return;
    }

    // Check if we have enough balance — warn but allow QR generation so mobile can decide
    const balanceSats = Math.floor(parseFloat($walletStore.btc) * 100_000_000);
    if (totalSats > balanceSats) {
      error = `Warning: Address balance (${$walletStore.btc} BTC) may be insufficient for this transaction. Mobile will confirm before sending.`;
    }

    isCreating = true;
    error = '';

    try {
      // Create PSBT (returns base64 and feeSats)
      const { psbtBase64, feeSats } = await psbt.createPsbt({
        recipientAddress,
        amountSats,
        feeRate
      });

      // Update UI to show the actual fee calculated
      if (typeof feeSats === 'number') {
        estimatedFee = feeSats; // reactive variable bound in parent scope (amount/fee/total display)
      }

      // If this wallet is paired with a mobile device, request signing via PSBT QR
      if ($walletStore.pairedDevices && $walletStore.pairedDevices.length > 0) {
        await psbt.requestSigning(psbtBase64);

        // Get QR data from QR service (qrSession is reactive)
        if ($qrSession && $qrSession.qrCodeDataUrl) {
          psbtQRData = $qrSession.qrCodeDataUrl;
        }

        qrMode = 'psbt';
        step = 'qr';
        showPsbtQR = true;
        return;
      }

      // Not paired: generate a send-fill QR payload that the mobile will scan and perform the send
      const res = await qr.generateSendQR(recipientAddress, amountSats, feeSats, '');
      psbtQRData = res.dataUrl;
      lastPayload = res.payload;
      qrMode = 'send';
      step = 'qr';
      showPsbtQR = true;

      // toast
      copyToast = 'QR generated — scan with your mobile to complete the send';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (copyToast = ''), 3000);
    } catch (err) {
      console.error('Error creating PSBT:', err);
      error = err instanceof Error ? err.message : 'Failed to create transaction';
    } finally {
      isCreating = false;
    }
  }

  function handleShowScanner() {
    showPsbtQR = false;
    step = 'scanning';
    showScanner = true;
  }

  async function handleSignedPsbtScanned(signedPsbtData: string) {
    showScanner = false;
    step = 'broadcasting';

    try {
      // Parse the signed PSBT QR response
      const response = JSON.parse(signedPsbtData);
      
      if (response.type !== 'psbt_signed') {
        throw new Error('Invalid QR code - expected signed PSBT');
      }

      // Process the signed PSBT
      psbt.handleSignedPsbt(response.data.signedPsbt);

      // Broadcast the transaction
      const txid = await psbt.broadcastTransaction();

      // Success!
      onSuccess(txid);
    } catch (err) {
      console.error('Error broadcasting transaction:', err);
      error = err instanceof Error ? err.message : 'Failed to broadcast transaction';
      step = 'form';
    }
  }

  function handleScannerClose() {
    showScanner = false;
    step = 'qr';
    showPsbtQR = true;
  }

  // Back handler to refresh wallet data and close modal
  async function handleBack() {
    try {
      await refreshWalletData();
    } catch (e) {
      console.warn('Refresh on back failed', e);
    }
    onClose();
  }
</script>

<div class="send-container">
  <div class="header">
    <button class="back-btn" on:click={handleBack} aria-label="Back to transactions">← Back</button>
    <h2>Send Bitcoin</h2>
    <button class="close-btn" on:click={onClose}>✕</button>
  </div>

  {#if step === 'form'}
    <div class="form">
      <div class="field">
        <label for="recipient">Recipient Address</label>
        <input
          id="recipient"
          type="text"
          bind:value={recipientAddress}
          placeholder="bc1q... or 1... or 3..."
          class="input"
        />
      </div>

      <div class="field">
        <label for="amount">Amount (BTC)</label>
        <input
          id="amount"
          type="number"
          step="0.00000001"
          bind:value={amountBTC}
          placeholder="0.00000000"
          class="input"
        />
      </div>

      <div class="field">
        <label for="fee">Fee Rate (sat/vB)</label>
        <input
          id="fee"
          type="number"
          step="1"
          bind:value={feeRate}
          class="input"
        />
        <p class="hint">Recommended: 5-10 sat/vB for normal priority</p>
      </div>

      <div class="summary">
        <div class="summary-row">
          <span>Amount:</span>
          <span>{amountBTC || '0.00000000'} BTC</span>
        </div>
        <div class="summary-row">
          <span>Est. Fee:</span>
          <span>{(estimatedFee / 100_000_000).toFixed(8)} BTC</span>
        </div>
        <div class="summary-row total">
          <span>Total:</span>
          <span>{totalBTC} BTC</span>
        </div>
      </div>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <button 
        class="btn-primary" 
        on:click={handleCreatePsbt}
        disabled={isCreating}
      >
        {isCreating ? 'Creating Transaction...' : 'Create Transaction'}
      </button>
    </div>
  {:else if step === 'qr'}
    <div class="qr-section">
      {#if qrMode === 'psbt'}
        <p class="instruction">Scan this QR code with your mobile wallet to sign the transaction</p>
        {#if $psbtSession?.deliveryMode === 'nostr+qr'}
          <p class="instruction" style="margin-top: 6px; opacity: 0.9;">
            Awaiting peer approval over Nostr… QR fallback stays available.
            {#if $psbtSession?.nostrState === 'timeout'}
              Nostr delivery timed out.
            {:else if $psbtSession?.nostrState === 'failed'}
              Nostr delivery failed.
            {:else if $psbtSession?.nostrState === 'delivered'}
              Signed PSBT received over Nostr.
            {/if}
          </p>
        {/if}
      {:else}
        <p class="instruction">Scan this QR code with your mobile wallet to populate the send form (address, amount, fee) and complete the send from your mobile device.</p>
      {/if}
      <img src={psbtQRData} alt="QR Code" />

      <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:8px;">
        <button on:click={async () => { if (lastPayload) { await navigator.clipboard.writeText(lastPayload); copyToast = 'Payload copied'; if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(() => (copyToast = ''), 3000); } }} style="padding:8px 12px;border-radius:8px;border:none;background:var(--color-subPrimary);color:var(--color-textOnPrimary);">Copy Payload</button>
        <button on:click={async () => { if (psbtQRData) { await navigator.clipboard.writeText(psbtQRData); copyToast = 'Data URL copied'; if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(() => (copyToast = ''), 3000); } }} style="padding:8px 12px;border-radius:8px;border:1px solid var(--color-border);background:transparent;color:var(--color-text);">Copy Data URL</button>
      </div>

      {#if copyToast}
        <div class="copy-toast">{copyToast}</div>
      {/if}
      
      {#if psbtQRData}
        <div class="qr-code">
          <img src={psbtQRData} alt="PSBT QR Code" />
        </div>
      {/if}

      <button class="btn-primary" on:click={handleShowScanner}>
        I've Scanned - Now Scan Signed PSBT
      </button>
      
      <button class="btn-text" on:click={() => { step = 'form'; psbt.clearSession(); }}>
        Cancel
      </button>
    </div>
  {:else if step === 'scanning'}
    <div class="scanner-section">
      <p class="instruction">Scan the signed PSBT QR code from your mobile wallet</p>
      <QRScanner onScan={handleSignedPsbtScanned} onClose={handleScannerClose} />
    </div>
  {:else if step === 'broadcasting'}
    <div class="broadcasting">
      <div class="spinner"></div>
      <p>Broadcasting transaction...</p>
    </div>
  {/if}
</div>

<style>
  .send-container {
    padding: 24px;
    max-width: 400px;
    background: #ffffff;
    color: #111827;
    border: 1px solid rgba(0,0,0,0.06);
    box-shadow: 0 8px 24px rgba(0,0,0,0.06);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: #111827;
  }

  .close-btn {
    background: rgba(0, 0, 0, 0.04);
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #374151;
    border-radius: 10px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    color: #f7931a;
    background: rgba(247, 147, 26, 0.1);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  label {
    font-size: 13px;
    font-weight: 600;
    color: #a1a1aa;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .input {
    padding: 14px;
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 10px;
    font-size: 14px;
    font-family: inherit;
    background: #ffffff;
    color: #111827;
    transition: all 0.2s;
  }

  .input:focus {
    outline: none;
    border-color: rgba(247, 147, 26, 0.5);
    box-shadow: 0 0 8px rgba(247, 147, 26, 0.12);
  }

  .input::placeholder {
    color: #9ca3af;
  }

  .hint {
    font-size: 12px;
    color: #71717a;
    margin: 0;
  }

  .summary {
    background: rgba(0, 0, 0, 0.2);
    padding: 16px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    font-size: 14px;
    color: #a1a1aa;
  }

  .summary-row.total {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin-top: 8px;
    padding-top: 12px;
    font-weight: 600;
    font-size: 16px;
    color: #f7931a;
  }

  .error {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
    padding: 12px;
    border-radius: 10px;
    font-size: 14px;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .btn-primary {
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

  .btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #ffaa33 0%, #f7931a 100%);
    transform: translateY(-2px);
    box-shadow: 0 6px 24px rgba(247, 147, 26, 0.4);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-text {
    background: transparent;
    border: none;
    color: #71717a;
    padding: 12px;
    font-size: 14px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .btn-text:hover {
    color: #f7931a;
  }

  .qr-section,
  .scanner-section {
    text-align: center;
  }

  .instruction {
    margin-bottom: 20px;
    font-size: 14px;
    line-height: 1.6;
    color: #a1a1aa;
  }

  .qr-code {
    background: #ffffff;
    padding: 20px;
    border-radius: 16px;
    display: inline-block;
    margin: 20px 0;
    border: 2px solid rgba(247, 147, 26, 0.3);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3),
                0 0 40px rgba(247, 147, 26, 0.15);
  }

  .qr-code img {
    display: block;
    width: 280px;
    height: 280px;
  }

  .broadcasting {
    text-align: center;
    padding: 40px 20px;
  }

  .spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 20px;
    border: 4px solid rgba(255, 255, 255, 0.1);
    border-top-color: #f7931a;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    box-shadow: 0 0 20px rgba(247, 147, 26, 0.3);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .broadcasting p {
    font-size: 16px;
    color: #a1a1aa;
  }
</style>
