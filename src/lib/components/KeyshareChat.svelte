<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { walletStore } from '$lib/stores/wallet';
  import { keyshareFingerprint } from '$lib/services/keyshareFingerprint';
  import { nostrMessaging } from '$lib/services/nostrMessaging';

  let peerNpub = '';
  let text = '';
  let error = '';

  const connectionState = nostrMessaging.connectionState;
  const inbound = nostrMessaging.inbound;

  $: wallet = $walletStore;
  $: senderFingerprint = keyshareFingerprint(wallet.publicKey);
  $: if (!peerNpub && wallet.pairedNostrNpub) peerNpub = wallet.pairedNostrNpub;

  onMount(async () => {
    try {
      await nostrMessaging.connect();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  async function sendChat() {
    if (!peerNpub.trim() || !text.trim()) return;
    error = '';
    try {
      await nostrMessaging.sendChatMessage(
        peerNpub.trim(),
        senderFingerprint,
        'mobile-wallet',
        text.trim(),
      );
      text = '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function pingPeer() {
    if (!peerNpub.trim()) return;
    error = '';
    try {
      await nostrMessaging.sendDevicePing(peerNpub.trim(), senderFingerprint, 'mobile-wallet');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function stateLabel() {
    const state = get(connectionState);
    if (state === 'connected') return 'Connected';
    if (state === 'degraded') return 'Partially Connected';
    if (state === 'connecting') return 'Connecting';
    return 'Disconnected';
  }
</script>

<section class="chat-wrap">
  <header class="chat-head">
    <h3>Keyshare Chat</h3>
    <span class="status">Relay: {stateLabel()}</span>
  </header>

  <div class="peer-row">
    <label for="peer">Peer npub</label>
    <input id="peer" bind:value={peerNpub} placeholder="npub1..." />
    <button on:click={pingPeer}>Ping</button>
  </div>

  <div class="history">
    {#if $inbound.length === 0}
      <p class="empty">No messages yet.</p>
    {:else}
      {#each $inbound as msg}
        {#if msg.envelope.type === 'CHAT_MESSAGE' || msg.envelope.type === 'DEVICE_PING'}
          <div class="item">
            <div class="meta">
              <span>{msg.envelope.type}</span>
              <span>{msg.senderNpub.slice(0, 18)}...</span>
            </div>
            <pre>{JSON.stringify(msg.envelope.payload, null, 2)}</pre>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <div class="composer">
    <textarea bind:value={text} placeholder="Encrypted message..." rows="3"></textarea>
    <button on:click={sendChat}>Send Message</button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}
</section>

<style>
  .chat-wrap {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 14px;
    background: var(--color-card, #121212);
  }
  .chat-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .status {
    font-size: 12px;
    opacity: 0.85;
  }
  .peer-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    margin-bottom: 12px;
  }
  .peer-row label {
    grid-column: 1 / -1;
    font-size: 12px;
    opacity: 0.8;
  }
  .peer-row input,
  textarea {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 8px;
    background: transparent;
    color: var(--color-text);
  }
  button {
    border: 0;
    border-radius: 8px;
    padding: 8px 12px;
    background: var(--color-subPrimary);
    color: var(--color-textOnPrimary);
    cursor: pointer;
  }
  .history {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 10px;
    min-height: 140px;
    max-height: 260px;
    overflow: auto;
    margin-bottom: 12px;
  }
  .item {
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding: 8px 0;
  }
  .item:last-child {
    border-bottom: 0;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    opacity: 0.75;
    margin-bottom: 4px;
  }
  .composer {
    display: grid;
    gap: 8px;
  }
  .empty {
    opacity: 0.7;
    font-size: 13px;
  }
  .error {
    color: #ff7e7e;
    margin-top: 8px;
    font-size: 12px;
  }
</style>
