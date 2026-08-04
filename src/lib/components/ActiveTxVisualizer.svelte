<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
</script>

<div class="tx-visualizer" class:compact style="--phase:{phase}">
  <!-- Wallet / Dual-Sig Node -->
  <div class="wallet-node">
    <div class="wallet-label">WALLET</div>
    <div class="sig-nodes">
      <div class="sig-node" class:active={sig1Active}>
        <div class="sig-glow"></div>
        <span>SIG 1</span>
      </div>
      <div class="sig-node" class:active={sig2Active}>
        <div class="sig-glow"></div>
        <span>SIG 2</span>
      </div>
    </div>
  </div>

  <!-- Launch Path / Packet -->
  <div class="launch-path">
    <div class="data-packet" class:launched={packetLaunched} class:in-cube={packetInCube}>
      <div class="packet-core"></div>
      <div class="packet-glow"></div>
    </div>
  </div>

  <!-- Mempool Validation Cube -->
  <div class="mempool-cube" class:pulsing={cubePulsing} class:docked={chainDocked}>
    <div class="cube-face front"></div>
    <div class="cube-face back"></div>
    <div class="cube-face right"></div>
    <div class="cube-face left"></div>
    <div class="cube-face top"></div>
    <div class="cube-face bottom"></div>

    {#if packetInCube}
      <div class="packet-inside"></div>
    {/if}

    <div class="cube-label">
      {phase === 'mempool' ? 'MEMPOOL' : phase === 'confirmed' ? 'VALIDATED' : ''}
    </div>
  </div>

  <!-- Blockchain Chain -->
  <div class="blockchain-chain" class:docked={chainDocked}>
    <div class="chain-block" class:locked={chainDocked}>
      <div class="block-inner"></div>
    </div>
    <div class="chain-block" class:locked={chainDocked}>
      <div class="block-inner"></div>
    </div>
    <div class="chain-block final" class:locked={chainDocked} class:confirmed-glow={confirmedGlow}>
      <div class="block-inner"></div>
    </div>
    <div class="chain-label">BLOCKCHAIN</div>
  </div>

  <!-- Status Panel -->
  <div class="status-panel">
    {#if errorMessage}
      <div class="status-text error">{errorMessage}</div>
      <button class="retry-btn" on:click={() => { if (txid) { pollAttempts = 0; errorMessage = null; startPolling(txid); } }}>
        Retry
      </button>
    {:else if phase === 'idle'}
      <div class="status-text">Awaiting transaction</div>
    {:else if phase === 'signing'}
      <div class="status-text">Dual-signing in progress…</div>
    {:else if phase === 'broadcasting'}
      <div class="status-text">Broadcasting to network</div>
    {:else if phase === 'mempool'}
      <div class="status-text">
        In mempool
        {#if confirmations > 0}
          • {confirmations} confirmation{confirmations > 1 ? 's' : ''}
        {/if}
      </div>
    {:else if phase === 'confirmed'}
      <div class="status-text confirmed">
        {#if confirmedBlockHeight}
          Confirmed in Block #{confirmedBlockHeight}
        {:else}
          Confirmed on-chain ✓
        {/if}
      </div>
    {/if}

    {#if txid && !errorMessage}
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
    {/if}
  </div>
</div>

<style>
  .tx-visualizer {
    position: relative;
    width: 100%;
    flex: 1 1 auto;
    min-height: 220px;
    max-height: 280px;
    background: #000000;
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 16px 12px;
    box-sizing: border-box;
    isolation: isolate;
    /* GPU hints */
    will-change: transform;
    transform: translate3d(0, 0, 0);
  }

  .tx-visualizer.compact {
    min-height: 160px;
    max-height: 200px;
    gap: 16px;
  }

  .tx-visualizer > :global(*) {
    flex-shrink: 0;
  }

  /* Wallet Node */
  .wallet-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    z-index: 2;
  }

  .wallet-label {
    font-size: 9px;
    letter-spacing: 1.5px;
    color: #ffd700;
    margin-bottom: 6px;
    font-weight: 600;
  }

  .sig-nodes {
    display: flex;
    gap: 12px;
  }

  .sig-node {
    width: 42px;
    height: 42px;
    border: 1px solid #00ffcc;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    background: #000000;
    color: #00ffcc;
    font-size: 9px;
    font-weight: 600;
    transition: all 180ms ease-out;
    box-shadow: 0 0 4px rgba(0, 255, 204, 0.3);
    will-change: transform, opacity;
    transform: translate3d(0, 0, 0);
  }

  .sig-node.active {
    border-color: #ffd700;
    color: #ffd700;
    box-shadow: 0 0 12px #00ffcc, 0 0 24px rgba(0, 255, 204, 0.6);
    transform: translate3d(0, -1px, 0) scale(1.05);
  }

  .sig-glow {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0, 255, 204, 0.35) 0%, transparent 70%);
    opacity: 0;
    transition: opacity 200ms ease;
    pointer-events: none;
  }

  .sig-node.active .sig-glow {
    opacity: 1;
    animation: neon-pulse 1.4s ease-in-out infinite;
  }

  /* Launch Path & Data Packet */
  .launch-path {
    position: relative;
    width: 70px;
    height: 4px;
    background: linear-gradient(to right, #00ffcc, transparent);
    border-radius: 2px;
    overflow: visible;
  }

  .data-packet {
    position: absolute;
    top: 50%;
    left: 0;
    width: 14px;
    height: 14px;
    background: #ffd700;
    border-radius: 3px;
    transform: translate3d(-50%, -50%, 0);
    box-shadow: 0 0 8px #ffd700, 0 0 16px rgba(255, 215, 0, 0.6);
    transition: transform 900ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms ease;
    will-change: transform;
    z-index: 3;
  }

  .data-packet.launched {
    transform: translate3d(92px, -50%, 0);
    opacity: 0.9;
  }

  .data-packet.in-cube {
    transform: translate3d(92px, -50%, 0);
    opacity: 0;
  }

  .packet-core {
    position: absolute;
    inset: 2px;
    background: #000000;
    border-radius: 2px;
  }

  .packet-glow {
    position: absolute;
    inset: -6px;
    background: radial-gradient(circle, rgba(255, 215, 0, 0.5) 20%, transparent 75%);
    border-radius: 50%;
    animation: packet-glow-anim 800ms ease-in-out infinite;
  }

  /* Mempool Cube (wireframe 3D) */
  .mempool-cube {
    position: relative;
    width: 78px;
    height: 78px;
    transform-style: preserve-3d;
    transform: translate3d(0, 0, 0) rotateX(-12deg) rotateY(28deg);
    transition: transform 600ms cubic-bezier(0.23, 1, 0.32, 1);
    z-index: 4;
    will-change: transform;
  }

  .mempool-cube.pulsing {
    animation: cube-pulse 1.8s ease-in-out infinite;
  }

  .mempool-cube.docked {
    transform: translate3d(92px, 0, 0) rotateX(-12deg) rotateY(28deg);
  }

  .cube-face {
    position: absolute;
    width: 78px;
    height: 78px;
    border: 1px solid #00ffcc;
    background: rgba(0, 255, 204, 0.04);
    box-shadow: 0 0 6px rgba(0, 255, 204, 0.5);
    backface-visibility: hidden;
  }

  .cube-face.front { transform: translateZ(39px); }
  .cube-face.back { transform: rotateY(180deg) translateZ(39px); }
  .cube-face.right { transform: rotateY(90deg) translateZ(39px); }
  .cube-face.left { transform: rotateY(-90deg) translateZ(39px); }
  .cube-face.top { transform: rotateX(90deg) translateZ(39px); }
  .cube-face.bottom { transform: rotateX(-90deg) translateZ(39px); }

  .packet-inside {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 18px;
    height: 18px;
    background: #ffd700;
    border-radius: 3px;
    transform: translate3d(-50%, -50%, 42px);
    box-shadow: 0 0 10px #ffd700;
    z-index: 10;
    animation: packet-locked 1.2s ease-in-out forwards;
  }

  .cube-label {
    position: absolute;
    bottom: -18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 8px;
    letter-spacing: 1px;
    color: #00ffcc;
    white-space: nowrap;
  }

  /* Blockchain */
  .blockchain-chain {
    display: flex;
    align-items: center;
    gap: 4px;
    z-index: 2;
    transition: transform 600ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .blockchain-chain.docked {
    transform: translate3d(-12px, 0, 0);
  }

  .chain-block {
    width: 26px;
    height: 26px;
    background: #111111;
    border: 1px solid #333333;
    position: relative;
    transition: all 300ms ease;
  }

  .chain-block.locked {
    border-color: #00ffcc;
    box-shadow: 0 0 6px rgba(0, 255, 204, 0.4);
  }

  .chain-block.final.locked {
    border-color: #22ff88;
    box-shadow: 0 0 10px #22ff88;
  }

  .chain-block.final.confirmed-glow {
    animation: confirmed-final-glow 2.4s ease-in-out infinite;
  }

  .block-inner {
    position: absolute;
    inset: 3px;
    background: linear-gradient(145deg, #222222, #0a0a0a);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .chain-label {
    position: absolute;
    bottom: -18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 8px;
    letter-spacing: 1.5px;
    color: #666666;
    white-space: nowrap;
  }

  /* Status */
  .status-panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 8px;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 12px;
    box-sizing: border-box;
    pointer-events: auto;
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

  /* Keyframe animations — all GPU friendly */
  @keyframes neon-pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }

  @keyframes cube-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(0, 255, 204, 0.4); }
    50% { box-shadow: 0 0 22px rgba(0, 255, 204, 0.9), 0 0 36px rgba(0, 255, 204, 0.5); }
  }

  @keyframes packet-glow-anim {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.3); }
  }

  @keyframes packet-locked {
    to { box-shadow: 0 0 14px #ffd700, 0 0 26px rgba(255, 215, 0, 0.8); }
  }

  @keyframes confirmed-final-glow {
    0%, 100% { box-shadow: 0 0 10px #22ff88; }
    50% { box-shadow: 0 0 26px #22ff88, 0 0 40px rgba(34, 255, 136, 0.6); }
  }
</style>