<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade, scale, slide } from 'svelte/transition';
  import { mempoolClient } from '$lib/services/mempoolClient';
  import type { MempoolResponse } from '$lib/services/mempoolClient';

  // Props
  export let txid: string | null = null;
  export let initialPhase: 'idle' | 'signing' | 'broadcasting' | 'mempool' | 'confirmed' = 'idle';
  export let network: 'mainnet' | 'testnet' = 'mainnet';
  export let explorerBaseUrl: string | null = null;
  export let onPhaseChange: (phase: string) => void = () => {};
  export let compact = false; // allows reuse in different containers

  type Phase = 'idle' | 'signing' | 'broadcasting' | 'mempool' | 'confirmed';

  let phase: Phase = initialPhase;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let animationFrame: number | null = null;

  // Visual state flags (drive CSS classes / transforms)
  let sig1Active = false;
  let sig2Active = false;
  let packetLaunched = false;
  let packetInCube = false;
  let cubePulsing = false;
  let chainDocked = false;
  let confirmedGlow = false;

  // Real-time tx data
  let confirmations = 0;
  let txStatus: any = null;
  let confirmedBlockHeight: number | null = null;
  let errorMessage: string | null = null;
  let isPolling = false;
  let pollAttempts = 0;
  let progressPercent = 0;
  let statusTransitionKey = 'idle:none:0:0:';
  const MAX_POLL_ATTEMPTS = 40; // ~4.3 minutes at 6.5s interval
  const POLL_INTERVAL_MS = 6500;
  const FETCH_TIMEOUT_MS = 8000;

  let lastTrackedTxid: string | null = null;

  function getMempoolApiBase(): string {
    return network === 'testnet'
      ? 'https://mempool.space/testnet/api'
      : 'https://mempool.space/api';
  }

  function getExplorerBase(): string {
    if (explorerBaseUrl && explorerBaseUrl.trim()) {
      return explorerBaseUrl.trim().replace(/\/+$/, '');
    }
    return getMempoolApiBase().replace(/\/api\/?$/i, '');
  }

  function openTxOnExplorer(): void {
    if (!txid) return;
    const url = `${getExplorerBase()}/tx/${txid}`;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url });
      return;
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function setPhase(newPhase: Phase) {
    if (phase === newPhase) return;
    phase = newPhase;
    onPhaseChange(phase);

    // Reset visual flags
    resetVisualFlags();

    switch (phase) {
      case 'signing':
        startDualSigAnimation();
        break;
      case 'broadcasting':
        startBroadcastAnimation();
        break;
      case 'mempool':
        startMempoolAnimation();
        break;
      case 'confirmed':
        startConfirmedAnimation();
        break;
    }
  }

  function resetVisualFlags() {
    sig1Active = false;
    sig2Active = false;
    packetLaunched = false;
    packetInCube = false;
    cubePulsing = false;
    chainDocked = false;
    confirmedGlow = false;
  }

  // GPU-accelerated animation helpers (translate3d + opacity only)
  function startDualSigAnimation() {
    sig1Active = true;
    setTimeout(() => {
      sig2Active = true;
      // After both signatures, auto-advance to broadcasting if still in signing
      setTimeout(() => {
        if (phase === 'signing') setPhase('broadcasting');
      }, 1200);
    }, 900);
  }

  function startBroadcastAnimation() {
    packetLaunched = true;
    // Packet flies toward mempool cube
    setTimeout(() => {
      if (phase === 'broadcasting') setPhase('mempool');
    }, 1400);
  }

  function startMempoolAnimation() {
    cubePulsing = true;
    packetInCube = true;

    // Poll real mempool API for confirmation status
    if (txid) startPolling(txid);
  }

  function startConfirmedAnimation() {
    cubePulsing = false;
    chainDocked = true;
    confirmedGlow = true;
    packetInCube = true;

    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    // Auto-hide or notify parent after a few seconds (optional)
    setTimeout(() => {
      if (phase === 'confirmed') {
        // Component can stay visible showing final state
      }
    }, 4000);
  }

  async function pollTxStatus(currentTxid: string) {
    if (isPolling) return;
    isPolling = true;
    pollAttempts++;

    // Hard timeout guard
    if (pollAttempts > MAX_POLL_ATTEMPTS) {
      errorMessage = 'Transaction status timeout — please check mempool.space';
      isPolling = false;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      return;
    }

    try {
      const url = `${getMempoolApiBase()}/tx/${currentTxid}/status`;

      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const res: MempoolResponse<any> = await mempoolClient.get(url, {
        ttl: 4000,
        signal: controller.signal,
        timeoutMs: FETCH_TIMEOUT_MS,
      });

      clearTimeout(timeoutId);

      if (res.ok && res.data) {
        errorMessage = null;
        txStatus = res.data;
        confirmedBlockHeight =
          txStatus?.confirmed && Number.isFinite(Number(txStatus?.block_height))
            ? Number(txStatus.block_height)
            : null;
        confirmations = txStatus?.confirmed ? (confirmedBlockHeight ? 1 : 0) : 0;

        if (txStatus.confirmed && phase !== 'confirmed') {
          setPhase('confirmed');
        }
      } else if (!res.ok) {
        // Transient error — keep polling unless we hit max attempts
        console.debug('[ActiveTxVisualizer] non-OK response', res.status);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        errorMessage = 'Network timeout contacting mempool';
      } else {
        errorMessage = 'Failed to fetch transaction status';
        console.debug('[ActiveTxVisualizer] poll error', e);
      }

      // If we keep failing, eventually give up
      if (pollAttempts >= MAX_POLL_ATTEMPTS) {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    } finally {
      isPolling = false;
    }
  }

  function startPolling(currentTxid: string) {
    if (pollInterval) clearInterval(pollInterval);
    pollAttempts = 0;
    errorMessage = null;
    isPolling = false;

    // immediate first poll
    pollTxStatus(currentTxid);

    pollInterval = setInterval(() => {
      pollTxStatus(currentTxid);
    }, POLL_INTERVAL_MS);
  }

  // Public API for parent to drive state machine
  export function advanceToSigning() { setPhase('signing'); }
  export function advanceToBroadcasting() { setPhase('broadcasting'); }
  export function advanceToMempool() { setPhase('mempool'); }
  export function advanceToConfirmed() { setPhase('confirmed'); }
  export function reset() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    pollAttempts = 0;
    isPolling = false;
    errorMessage = null;
    phase = 'idle';
    resetVisualFlags();
  }

  onMount(() => {
    if (initialPhase !== 'idle') {
      setPhase(initialPhase);
    }
    // If a txid is already supplied, assume we are at least in mempool
    if (txid && phase === 'idle') {
      setPhase('mempool');
    }
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
    if (animationFrame) cancelAnimationFrame(animationFrame);
  });

  // Reactive: only restart visualization when txid actually changes.
  $: if (txid && txid !== lastTrackedTxid) {
    lastTrackedTxid = txid;
    confirmations = 0;
    txStatus = null;
    confirmedBlockHeight = null;
    errorMessage = null;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    startPolling(txid);
    if (phase !== 'mempool' && phase !== 'broadcasting') {
      setPhase('mempool');
    }
  }

  $: progressPercent =
    phase === 'idle'
      ? 0
      : phase === 'signing'
        ? 35
        : phase === 'broadcasting'
          ? 62
          : phase === 'mempool'
            ? 86
            : 100;

  $: statusTransitionKey = `${phase}:${txid || 'none'}:${confirmedBlockHeight || 0}:${confirmations}:${errorMessage || ''}`;
</script>

<div class="tx-visualizer card-container transaction-card" class:compact style="--phase:{phase}">
  <div class="progress-track-container" aria-hidden="true">
    <div class="track-label-row">
      <div class="wallet-labels"><span class="track-label wallet-label">WALLET</span></div>
      <div class="validated-label-slot">
        <span class="track-label" class:validated={phase === 'confirmed'}>
          {phase === 'confirmed' ? 'VALIDATED' : 'BLOCKCHAIN'}
        </span>
      </div>
    </div>

    <div class="visual-track">
      <div class="sig-group">
        {#if phase !== 'idle'}
          <div class="sig-circle" class:active={sig1Active} transition:scale={{ duration: 280, start: 0.82 }}>
            <span>SIG 1</span>
          </div>
        {/if}
        {#if phase === 'signing' || phase === 'broadcasting' || phase === 'mempool' || phase === 'confirmed'}
          <div class="sig-circle" class:active={sig2Active} transition:scale={{ duration: 300, start: 0.82 }}>
            <span>SIG 2</span>
          </div>
        {/if}
      </div>

      <div class="connecting-line progress-line-wrapper">
        <div
          class="progress-fill"
          class:launched={packetLaunched}
          class:in-cube={packetInCube}
          style={`width: ${progressPercent}%`}
        ></div>
      </div>

      <div class="cube-graphic" class:docked={chainDocked}>
        {#if phase !== 'confirmed'}
          <div class="node-row" transition:fade={{ duration: 220 }}>
            <div class="chain-node" transition:scale={{ duration: 220, start: 0.86 }}></div>
            <div class="chain-node" transition:scale={{ duration: 220, start: 0.86, delay: 40 }}></div>
            <div class="chain-node hot" class:pulsing={cubePulsing} transition:scale={{ duration: 220, start: 0.86, delay: 80 }}></div>
          </div>
        {:else}
          <div class="validated-block" in:scale={{ duration: 320, start: 0.86 }} out:fade={{ duration: 180 }}>
            <div class="block-cube-wrapper" class:confirmed-glow={confirmedGlow}>
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="cube-svg">
                <path d="M32 8L52 18L32 28L12 18L32 8Z" stroke="#00ffaa" stroke-width="2" stroke-linejoin="round" class="cube-edge" />
                <path d="M12 18V42L32 52V28L12 18Z" stroke="#00ffaa" stroke-width="2" stroke-linejoin="round" class="cube-edge" />
                <path d="M52 18V42L32 52V28L52 18Z" stroke="#00ffaa" stroke-width="2" stroke-linejoin="round" class="cube-edge" />
                <circle cx="32" cy="30" r="5" fill="#ffb700" class="pulsing-payload" />
              </svg>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Status Panel -->
  <div class="status-panel">
    <div class="status-stack">
      {#key statusTransitionKey}
        {#if errorMessage}
          <div class="status-phase" in:fade={{ duration: 200 }} out:fade={{ duration: 180 }}>
            <div class="status-text error">{errorMessage}</div>
            <button class="retry-btn" on:click={() => { if (txid) { pollAttempts = 0; errorMessage = null; startPolling(txid); } }}>
              Retry
            </button>
          </div>
        {:else if phase === 'idle'}
          <div class="status-phase" in:fade={{ duration: 200 }} out:fade={{ duration: 180 }}>
            <div class="status-text">Awaiting transaction</div>
          </div>
        {:else if phase === 'signing'}
          <div class="status-phase" in:fade={{ duration: 200 }} out:fade={{ duration: 180 }}>
            <div class="status-text">Dual-signing in progress…</div>
          </div>
        {:else if phase === 'broadcasting'}
          <div class="status-phase" in:fade={{ duration: 200 }} out:fade={{ duration: 180 }}>
            <div class="status-text">Broadcasting to network</div>
          </div>
        {:else if phase === 'mempool'}
          <div class="status-phase" in:fade={{ duration: 200 }} out:fade={{ duration: 180 }}>
            <div class="status-text">
              In mempool
              {#if confirmations > 0}
                <span class="confirmations" transition:slide={{ duration: 200 }}>• {confirmations} confirmation{confirmations > 1 ? 's' : ''}</span>
              {/if}
            </div>
          </div>
        {:else if phase === 'confirmed'}
          <div class="status-phase" in:fade={{ duration: 200 }} out:fade={{ duration: 180 }}>
            <div class="status-text confirmed">
              {#if confirmedBlockHeight}
                Confirmed in Block #{confirmedBlockHeight}
              {:else}
                Confirmed on-chain ✓
              {/if}
            </div>
          </div>
        {/if}
      {/key}
    </div>

    <div class="txid-stage">
      {#if txid && !errorMessage}
        {#key txid}
          <div class="txid-wrapper" in:fade={{ duration: 220 }} out:fade={{ duration: 160 }}>
            <button
              type="button"
              class="txid-pill"
              on:click={openTxOnExplorer}
              on:keydown={(e) => e.key === 'Enter' && openTxOnExplorer()}
              title="Open transaction in explorer"
              aria-label="Open transaction in explorer"
            >
              {txid.slice(0, 8)}…{txid.slice(-6)}
            </button>
          </div>
        {/key}
      {/if}
    </div>
  </div>
</div>

<style>
  .tx-visualizer {
    width: 100%;
    flex: 1 1 auto;
    min-height: 240px;
    background: #090a0f;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: stretch;
    gap: 6px;
    padding: 20px;
    box-sizing: border-box;
    isolation: isolate;
  }

  .tx-visualizer.compact {
    min-height: 214px;
    gap: 5px;
    padding: 14px;
  }

  .tx-visualizer.compact .visual-track {
    gap: 10px;
  }

  .progress-track-container {
    display: grid;
    grid-template-rows: auto auto;
    width: 100%;
    gap: 8px;
  }

  .track-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: 12px;
    padding: 0 20px;
    box-sizing: border-box;
  }

  .wallet-labels,
  .validated-label-slot {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 72px;
  }

  .track-label {
    font-size: 8px;
    letter-spacing: 1.2px;
    color: #7b7b7b;
    font-weight: 600;
  }

  .track-label.wallet-label {
    color: #ffd700;
  }

  .track-label.validated {
    color: #22ff88;
  }

  .visual-track {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 10px 20px;
    box-sizing: border-box;
    gap: 12px;
  }

  .sig-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .sig-circle {
    width: clamp(32px, 9vw, 42px);
    height: clamp(32px, 9vw, 42px);
    border: 1px solid #00ffcc;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    background: #000000;
    color: #00ffcc;
    font-size: clamp(8px, 1.8vw, 9px);
    font-weight: 600;
    transition: transform 180ms ease, box-shadow 180ms ease, color 180ms ease, border-color 180ms ease;
    box-shadow: 0 0 4px rgba(0, 255, 204, 0.3);
  }

  .sig-circle.active {
    border-color: #ffd700;
    color: #ffd700;
    box-shadow: 0 0 12px #00ffcc, 0 0 24px rgba(0, 255, 204, 0.6);
    transform: translateY(-1px) scale(1.04);
  }

  .progress-line-wrapper {
    flex: 1;
    min-width: 20px;
    margin: 0;
    height: 4px;
    background: rgba(0, 255, 170, 0.15);
    border-radius: 2px;
    overflow: hidden;
  }

  .connecting-line {
    flex: 1;
  }

  .progress-fill {
    height: 100%;
    width: 0;
    background: linear-gradient(to right, rgba(0, 255, 170, 0.85), rgba(0, 255, 204, 0.3));
    border-radius: inherit;
    transition: width 420ms cubic-bezier(0.2, 0.85, 0.3, 1);
  }

  .progress-fill.launched {
    box-shadow: 0 0 8px rgba(0, 255, 170, 0.4);
  }

  .progress-fill.in-cube {
    box-shadow: 0 0 10px rgba(0, 255, 204, 0.45);
  }

  .cube-graphic {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: clamp(32px, 10vw, 50px);
    flex-shrink: 1;
    max-width: 40%;
    min-width: 68px;
  }

  .cube-graphic.docked {
    transform: scale(1.01);
  }

  .node-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }

  .chain-node {
    width: clamp(16px, 5vw, 24px);
    aspect-ratio: 1;
    border: 1px solid #2f3a3a;
    background: linear-gradient(145deg, #161616, #0a0a0a);
    border-radius: 4px;
    box-shadow: 0 0 4px rgba(0, 255, 204, 0.2);
  }

  .chain-node.hot {
    border-color: #00ffcc;
    box-shadow: 0 0 8px rgba(0, 255, 204, 0.45);
  }

  .chain-node.hot.pulsing {
    animation: chain-pulse 1.5s ease-in-out infinite;
  }

  .validated-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
  }

  .block-cube-wrapper {
    position: relative;
    width: clamp(42px, 13vw, 64px);
    height: clamp(42px, 13vw, 64px);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cube-svg {
    width: 100%;
    height: 100%;
    overflow: visible;
    filter: drop-shadow(0 0 8px rgba(0, 255, 170, 0.4));
  }

  .block-cube-wrapper.confirmed-glow .cube-svg {
    filter: drop-shadow(0 0 10px rgba(34, 255, 136, 0.55));
  }

  .cube-edge {
    vector-effect: non-scaling-stroke;
  }

  .pulsing-payload {
    transform-box: fill-box;
    transform-origin: center;
    animation: payload-pulse 1.3s ease-in-out infinite;
  }

  /* Status */
  .status-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    width: 100%;
    height: 84px;
    min-height: 84px;
    padding: 0 12px;
    box-sizing: border-box;
    text-align: center;
  }

  .tx-visualizer.compact .status-panel {
    height: 78px;
    min-height: 78px;
  }

  .status-stack {
    position: relative;
    width: 100%;
    height: 50px;
    min-height: 50px;
  }

  .status-phase {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .txid-stage {
    position: relative;
    width: 100%;
    height: 28px;
    min-height: 28px;
  }

  .txid-wrapper {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .status-text {
    font-family: "Segoe UI", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    letter-spacing: 0.02em;
    color: #888888;
    margin: 0;
    text-align: center;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-text.confirmed {
    color: #22ff88;
    text-shadow: 0 0 6px rgba(34, 255, 136, 0.6);
  }

  .confirmations {
    display: inline-block;
  }

  .txid-pill {
    border: 1px solid rgba(0, 255, 204, 0.35);
    font-family: monospace;
    font-size: 9px;
    background: rgba(255, 255, 255, 0.06);
    color: #00ffcc;
    padding: 1px 8px;
    border-radius: 9999px;
    cursor: pointer;
    user-select: none;
    transition: background 120ms ease, border-color 120ms ease;
    line-height: 1.4;
    white-space: nowrap;
  }

  @media (max-width: 340px) {
    .tx-visualizer.compact {
      min-height: 148px;
      gap: 8px;
      padding: 10px;
    }

    .tx-visualizer.compact .track-label-row {
      padding: 0 10px;
    }

    .tx-visualizer.compact .track-label {
      font-size: 7px;
      letter-spacing: 1px;
    }

    .tx-visualizer.compact .visual-track {
      gap: 8px;
      padding: 8px 10px;
    }

    .tx-visualizer.compact .sig-group {
      gap: 7px;
    }

    .tx-visualizer.compact .sig-circle {
      width: 28px;
      height: 28px;
      font-size: 7px;
    }

    .tx-visualizer.compact .progress-line-wrapper {
      min-width: 16px;
      margin: 0 6px;
      height: 3px;
    }

    .tx-visualizer.compact .cube-graphic {
      min-width: 58px;
      max-width: 42%;
    }

    .tx-visualizer.compact .node-row {
      gap: 4px;
    }

    .tx-visualizer.compact .chain-node {
      width: 14px;
      border-radius: 3px;
    }

    .tx-visualizer.compact .block-cube-wrapper {
      width: 36px;
      height: 36px;
    }

    .tx-visualizer.compact .status-panel {
      height: 70px;
      min-height: 70px;
      padding: 0 8px;
      gap: 3px;
    }

    .tx-visualizer.compact .status-stack {
      height: 42px;
      min-height: 42px;
    }

    .tx-visualizer.compact .txid-stage {
      height: 24px;
      min-height: 24px;
    }

    .tx-visualizer.compact .status-text {
      font-size: 10px;
      line-height: 1.25;
    }

    .tx-visualizer.compact .txid-pill {
      font-size: 8px;
      padding: 1px 6px;
    }
  }

  .txid-pill:hover {
    background: rgba(0, 255, 204, 0.15);
    border-color: rgba(0, 255, 204, 0.65);
  }

  .txid-pill:focus-visible {
    outline: 2px solid rgba(0, 255, 204, 0.7);
    outline-offset: 1px;
  }

  .retry-btn {
    border: 1px solid rgba(255, 215, 0, 0.35);
    border-radius: 999px;
    background: rgba(255, 215, 0, 0.1);
    color: #ffd700;
    font-size: 10px;
    line-height: 1.35;
    padding: 2px 10px;
    cursor: pointer;
  }

  @keyframes chain-pulse {
    0%,
    100% {
      box-shadow: 0 0 8px rgba(0, 255, 204, 0.45);
    }
    50% {
      box-shadow: 0 0 14px rgba(0, 255, 204, 0.75);
    }
  }

  @keyframes payload-pulse {
    0%,
    100% {
      transform: scale(0.9);
      opacity: 0.65;
    }
    50% {
      transform: scale(1.14);
      opacity: 1;
    }
  }
</style>