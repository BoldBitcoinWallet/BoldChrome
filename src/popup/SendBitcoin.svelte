<script lang="ts">
  import { psbt } from '../lib/services/psbt';
  import { qr } from '../lib/services/qr';
  import { walletStore, getCurrentReceiveAddress } from '../lib/stores/wallet';

  const psbtSession = psbt.session;
  const qrSession = qr.session;

  function describeSendError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/radix2\.encode|Uint8Array|bech32/i.test(msg)) {
      return 'Failed to prepare a secure connection to your mobile device. Please try again — if this persists, re-pair your device.';
    }
    if (/HTTP 5\d\d|NetworkError|Failed to fetch|timed? ?out/i.test(msg)) {
      return 'Network error while preparing the transaction. Please check your connection and try again.';
    }
    return msg;
  }

  let recipientAddress = ''; 
  let amountBtc = '';
  let feeRate = 1;
  let sendMode: 'dkls' | 'psbt' = 'dkls';
  let qrCodeUrl = '';
  let lastPayload = '';
  import QRScanner from '$lib/components/QRScanner.svelte';

  let qrMode: 'psbt' | 'send' | null = null; // track which QR type we're showing
  let copyToast = '';
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let error = '';
  let showScanner = false;

  function handleShowScanner() {
    error = '';
    showScanner = true;
  }

  function handleScannerClose() {
    showScanner = false;
  }

  async function handleQRScanned(scannedData: string) {
    showScanner = false;
    try {
      const res = await qr.processScanedQR(scannedData);

      if (res.type === 'pairing_response') {
        copyToast = 'Paired with mobile device';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (copyToast = ''), 3000);
      } else if (res.type === 'psbt_signed') {
        // Pass through to PSBT handler if someone scanned a signed PSBT
        if ($psbtSession && $psbtSession.status === 'awaiting_signature') {
          // process via psbt handler
          psbt.handleSignedPsbt(res.data.signedPsbt || res.data);
          copyToast = 'Signed PSBT received';
          if (toastTimer) clearTimeout(toastTimer);
          toastTimer = setTimeout(() => (copyToast = ''), 3000);
        }
      } else if (res.type === 'bitcoin_address') {
        // Fill recipient field with scanned address
        recipientAddress = res.data.address;
        copyToast = 'Address scanned';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (copyToast = ''), 3000);
      } else {
        // Generic success
        copyToast = 'QR scanned: ' + res.type;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (copyToast = ''), 3000);
      }

    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // Use $psbtSession and $qrSession stores directly in the template and logic.

  async function createTransaction() {
    // Confirm on the extension: generate a "send-fill" QR automatically for mobile to scan
    error = '';

    try {
      const amountSats = Math.floor(parseFloat(amountBtc) * 100000000);

      if (!recipientAddress || amountSats <= 0) {
        error = 'Please enter valid recipient and amount';
        return;
      }

      // Paired via a live Nostr channel: request a native MPC send directly. The paired
      // mobile device signs with its own DKLS committee peer and broadcasts itself — no
      // PSBT should be built/sent here, since a populated psbtHex makes the mobile side
      // treat this as an externally co-signed PSBT needing a further peer QR handoff.
      const pairedNostrNpub = ($walletStore.pairedNostrNpub || '').trim();

      if (sendMode === 'dkls') {
        if (pairedNostrNpub) {
          const { qrDataUrl } = await psbt.requestNativeSend({ recipientAddress, amountSats, feeRate });
          // Strictly airgapped initiation: extension only shows QR for mobile scan.
          qrCodeUrl = qrDataUrl;
          lastPayload = '';
          qrMode = 'send';
          copyToast = 'Send QR generated — scan with your mobile to continue';
          if (toastTimer) clearTimeout(toastTimer);
          toastTimer = setTimeout(() => (copyToast = ''), 4000);
          return;
        }

        // No live Nostr channel yet: fall back to the plain send-fill QR (v5 format),
        // which mobile already recognizes as a native, non-PSBT send request.
        let feeRateUsed = feeRate;
        try {
          const { halfHourFee, hourFee, fastestFee } = await (await import('$lib/services/blockchain')).blockchain.getFeeEstimates();
          if (!feeRateUsed || feeRateUsed <= 0) {
            feeRateUsed = halfHourFee || hourFee || fastestFee || 5;
          }
        } catch (e) {
          feeRateUsed = feeRate || 5;
        }

        const estimatedVsize = 250; // conservative default
        const feeSats = Math.max(1, Math.round(feeRateUsed * estimatedVsize));
        const addressType = $walletStore.hdState?.addressType || 'segwit-native';
        const derivationPath = getCurrentReceiveAddress()?.path || '';
        const res = await qr.generateSendQR(recipientAddress, amountSats, feeSats, '', addressType, derivationPath, $walletStore.network);
        qrCodeUrl = res.dataUrl;
        lastPayload = res.payload;
        qrMode = 'send';

        copyToast = 'QR generated — scan with your mobile to complete the send';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (copyToast = ''), 3000);
        return;
      }

      // Standard PSBT Export: explicit user choice, regardless of pairing type.
      const { psbtBase64 } = await psbt.createPsbt({
        recipientAddress,
        amountSats,
        feeRate
      });

      // Request signing via QR
      await psbt.requestSigning(psbtBase64);

      qrMode = 'psbt';
      // Wait for qr session to update reactively and UI will pick it up
      copyToast = 'PSBT QR generated — scan with your mobile to sign';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (copyToast = ''), 3000);
    } catch (err) {
      error = describeSendError(err);
    }
  }

  async function copyPayload() {
    if (!lastPayload) return;
    try {
      await navigator.clipboard.writeText(lastPayload);
      // show toast
      copyToast = 'Payload copied to clipboard';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (copyToast = ''), 3000);
    } catch (e) {
      copyToast = 'Failed to copy payload';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (copyToast = ''), 3000);
    }
  }

  async function shareToMobile() {
    error = '';
    try {
      const amountSats = Math.floor(parseFloat(amountBtc) * 100000000);
      if (!recipientAddress || amountSats <= 0) {
        error = 'Please enter valid recipient and amount';
        return;
      }

      // Estimate fee in sats from feeRate (sat/vB) using a rough tx vsize estimate
      const estimatedVsize = 250; // conservative default
      const feeSats = Math.max(1, Math.round(feeRate * estimatedVsize));

      const addressType = $walletStore.hdState?.addressType || 'segwit-native';
      const derivationPath = getCurrentReceiveAddress()?.path || '';
      const res = await qr.generateSendQR(recipientAddress, amountSats, feeSats, '', addressType, derivationPath, $walletStore.network);
      qrCodeUrl = res.dataUrl;
      lastPayload = res.payload;
      qrMode = 'send';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function broadcastSigned() {
    if (!$psbtSession || $psbtSession.status !== 'signed') {
      error = 'No signed transaction available';
      return;
    }

    try {
      const txid = await psbt.broadcastTransaction();
      
      console.log('Transaction broadcasted:', txid);
      
      // Clear form
      recipientAddress = '';
      amountBtc = '';
      qrCodeUrl = '';
      
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="send-bitcoin">
  <h2>Send Bitcoin</h2>
  
  <div class="form">
    <label>
      Recipient Address
      <input type="text" bind:value={recipientAddress} placeholder="bc1..." />
    </label>

    <label>
      Amount (BTC)
      <input type="number" bind:value={amountBtc} step="0.00000001" />
    </label>

    <label>
      Fee Rate (sat/vB)
      <input type="number" bind:value={feeRate} min="1" />
    </label>

    <div>
      <span id="send-bitcoin-mode-label">Signing Mode</span>
      <div role="group" aria-labelledby="send-bitcoin-mode-label" style="display:flex;gap:8px;margin-top:4px;">
        <button
          type="button"
          on:click={() => (sendMode = 'dkls')}
          style={`flex:1;padding:8px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid ${sendMode === 'dkls' ? 'var(--color-primary)' : 'var(--color-border)'};background:${sendMode === 'dkls' ? 'rgba(247,147,26,0.1)' : 'transparent'};color:var(--color-text);`}
        >
          Regular DKLS MPC Transaction
        </button>
        <button
          type="button"
          on:click={() => (sendMode = 'psbt')}
          style={`flex:1;padding:8px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid ${sendMode === 'psbt' ? 'var(--color-primary)' : 'var(--color-border)'};background:${sendMode === 'psbt' ? 'rgba(247,147,26,0.1)' : 'transparent'};color:var(--color-text);`}
        >
          Standard PSBT Export
        </button>
      </div>
    </div>

    <div style="display:flex;gap:8px;align-items:center;">
      <button on:click={createTransaction} disabled={!recipientAddress || !amountBtc}>
        Confirm & Generate QR
      </button>
      <button on:click={handleShowScanner} style="background:transparent;border:1px solid var(--color-border);color:var(--color-text);padding:8px 10px;border-radius:8px;">Scan QR</button>
    </div>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if showScanner}
    <QRScanner onScan={handleQRScanned} onClose={handleScannerClose} />
  {/if}

  {#if qrCodeUrl}
    <div class="qr-section">
      {#if qrMode === 'psbt'}
        <h3>Scan with Mobile to Sign</h3>
        <p class="instruction">Scan this QR with your mobile wallet to sign the PSBT and return the signed PSBT to the extension.</p>
      {:else if qrMode === 'send'}
        <h3>Scan with Mobile to Fill Send</h3>
        <p class="instruction">Scan this QR with your mobile wallet to populate the send form (address, amount, fee) so you can send from your mobile device.</p>
      {/if}

      <img src={qrCodeUrl} alt="QR Code" />
      <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:8px;">
        <button on:click={copyPayload} style="padding:8px 12px;border-radius:8px;border:none;background:var(--color-subPrimary);color:var(--color-textOnPrimary);">Copy Payload</button>
        <button on:click={() => navigator.clipboard?.writeText(qrCodeUrl)} style="padding:8px 12px;border-radius:8px;border:1px solid var(--color-border);background:transparent;color:var(--color-text);">Copy Data URL</button>
      </div>
      {#if copyToast}
        <div class="copy-toast">{copyToast}</div>
      {/if}
      {#if qrMode === 'psbt'}
        <p class="status">PSBT Status: {$psbtSession?.status || 'ready'}</p>
      {:else if qrMode === 'send'}
        <p class="status">QR Status: {$qrSession?.status || 'ready'}</p>
      {/if}
    </div>
  {/if}

  {#if $psbtSession?.status === 'signed'}
    <button on:click={broadcastSigned} class="broadcast-btn">
      Broadcast Transaction
    </button>
  {/if}

  {#if $psbtSession?.txid}
    <div class="success">
      Transaction broadcasted! 
      <a href="https://mempool.space/tx/{$psbtSession.txid}" target="_blank">
        View on Mempool.space
      </a>
    </div>
  {/if}
</div>

<style>
  .send-bitcoin {
    padding: 1rem;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  input {
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
  }

  button {
    padding: 0.75rem;
    background: linear-gradient(135deg, var(--color-subPrimary) 0%, var(--color-primary) 100%);
    border: none;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
    color: var(--color-textOnPrimary);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .broadcast-btn {
    background: var(--color-success);
    color: var(--color-textOnPrimary);
  }

  .qr-section {
    margin-top: 2rem;
    text-align: center;
  }

  .qr-section img {
    max-width: 300px;
    margin: 1rem auto;
  }

  .status {
    font-weight: 600;
    color: var(--color-textSecondary);
  }

  .copy-toast {
    margin-top: 8px;
    background: rgba(0,0,0,0.75);
    color: #fff;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 13px;
    display: inline-block;
  }

  .error {
    color: var(--color-error);
    padding: 0.5rem;
    background: rgba(244,67,54,0.08);
    border-radius: 4px;
  }

  .success {
    color: var(--color-success);
    padding: 0.5rem;
    background: rgba(76,175,80,0.08);
    border-radius: 4px;
  }
</style>
