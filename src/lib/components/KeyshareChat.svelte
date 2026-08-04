<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { walletStore } from '$lib/stores/wallet';
  import { keyshareFingerprint } from '$lib/services/keyshareFingerprint';
  import { nostrMessaging, type NostrIncomingMessage, type NostrMessageType } from '$lib/services/nostrMessaging';

  type ChatFilter = 'All' | 'Co-Signs' | 'Peeps' | 'Bots';

  interface ChatThread {
    id: string;
    npub: string;
    title: string;
    preview: string;
    timestamp: number;
    unreadCount: number;
    pinned: boolean;
    online: boolean;
    category: Exclude<ChatFilter, 'All'>;
    lastType: NostrMessageType;
  }

  interface StoryBubble {
    id: string;
    label: string;
    npub: string;
    unread: boolean;
    live: boolean;
    pending: boolean;
    fallback?: boolean;
  }

  const FILTER_TABS: ChatFilter[] = ['All', 'Co-Signs', 'Peeps', 'Bots'];
  const THREAD_TYPES: NostrMessageType[] = [
    'COSIGN_REQUEST',
    'COSIGN_RESPONSE',
    'COSIGN_READY',
    'CHAT_MESSAGE',
    'DEVICE_PING',
  ];
  const STORY_PLACEHOLDERS = ['16Bit Team', 'Dog', 'Pepe', 'Cat'];

  let peerNpub = '';
  let text = '';
  let error = '';
  let activeFilter: ChatFilter = 'All';
  let activeThreadId = '';
  let composerInput: HTMLTextAreaElement | null = null;

  const connectionState = nostrMessaging.connectionState;
  const inbound = nostrMessaging.inbound;

  $: wallet = $walletStore;
  $: senderFingerprint = keyshareFingerprint(wallet.publicKey);
  $: if (!peerNpub && wallet.pairedNostrNpub) peerNpub = wallet.pairedNostrNpub;
  $: threadMessages = $inbound.filter(msg => THREAD_TYPES.includes(msg.envelope.type));
  $: threads = buildThreads(threadMessages);
  $: storyBubbles = buildStories(threads);
  $: filteredThreads = threads.filter(thread => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'Co-Signs') return thread.category === 'Co-Signs';
    if (activeFilter === 'Peeps') return thread.category === 'Peeps';
    return thread.category === 'Bots';
  });
  $: if (activeThreadId && !threads.some(thread => thread.id === activeThreadId)) {
    activeThreadId = '';
  }
  $: selectedThread = threads.find(thread => thread.id === activeThreadId) ?? null;
  $: activeConversationNpub = selectedThread?.npub || peerNpub.trim();
  $: conversationMessages = activeConversationNpub
    ? threadMessages
        .filter(msg => msg.senderNpub === activeConversationNpub)
        .sort((a, b) => b.envelope.timestamp - a.envelope.timestamp)
    : [];

  onMount(async () => {
    try {
      await nostrMessaging.connect();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  async function sendChat() {
    const target = activeConversationNpub || peerNpub.trim();
    if (!target || !text.trim()) return;
    error = '';
    try {
      await nostrMessaging.sendChatMessage(
        target,
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
    const target = activeConversationNpub || peerNpub.trim();
    if (!target) return;
    error = '';
    try {
      await nostrMessaging.sendDevicePing(target, senderFingerprint, 'mobile-wallet');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function openThread(thread: ChatThread | StoryBubble) {
    if (!thread.npub) {
      error = 'No npub is linked for this session yet.';
      return;
    }
    error = '';
    peerNpub = thread.npub;
    activeThreadId = thread.id;
    await tick();
    composerInput?.focus();
  }

  function openFromFilter(thread: ChatThread) {
    void openThread(thread);
  }

  function buildThreads(messages: NostrIncomingMessage[]): ChatThread[] {
    const grouped = new Map<string, NostrIncomingMessage[]>();
    for (const msg of messages) {
      if (!grouped.has(msg.senderNpub)) grouped.set(msg.senderNpub, []);
      grouped.get(msg.senderNpub)?.push(msg);
    }

    return Array.from(grouped.entries())
      .map(([npub, group]) => {
        group.sort((a, b) => b.envelope.timestamp - a.envelope.timestamp);
        const latest = group[0];
        const latestType = latest.envelope.type;
        const title = formatPeerTitle(npub);
        const unreadCount = group.filter(msg => msg.envelope.type !== 'DEVICE_PING').length;
        const category = resolveCategory(title, latestType);

        return {
          id: npub,
          npub,
          title,
          preview: previewLabel(latest),
          timestamp: latest.envelope.timestamp,
          unreadCount,
          pinned: latestType === 'COSIGN_REQUEST' || latestType === 'COSIGN_READY',
          online: latestType === 'DEVICE_PING' || Date.now() / 1000 - latest.envelope.timestamp < 180,
          category,
          lastType: latestType,
        };
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.timestamp - a.timestamp;
      });
  }

  function buildStories(sourceThreads: ChatThread[]): StoryBubble[] {
    if (sourceThreads.length > 0) {
      return sourceThreads.slice(0, 12).map(thread => ({
        id: thread.id,
        label: thread.title,
        npub: thread.npub,
        unread: thread.unreadCount > 0,
        live: thread.online,
        pending: thread.lastType === 'COSIGN_REQUEST' || thread.lastType === 'COSIGN_READY',
      }));
    }

    return STORY_PLACEHOLDERS.map((label, index) => ({
      id: `story-${index}`,
      label,
      npub: wallet.pairedNostrNpub ?? '',
      unread: index % 2 === 0,
      live: index === 1,
      pending: index === 0,
      fallback: true,
    }));
  }

  function resolveCategory(title: string, type: NostrMessageType): Exclude<ChatFilter, 'All'> {
    if (type === 'COSIGN_REQUEST' || type === 'COSIGN_RESPONSE' || type === 'COSIGN_READY') {
      return 'Co-Signs';
    }
    if (/bot|agent|assistant/i.test(title)) return 'Bots';
    return 'Peeps';
  }

  function formatPeerTitle(npub: string): string {
    if (!npub) return 'Unknown Peer';
    return `${npub.slice(0, 8)}...${npub.slice(-4)}`;
  }

  function previewLabel(message: NostrIncomingMessage): string {
    const { type, payload } = message.envelope;
    if (type === 'CHAT_MESSAGE') {
      if (payload && typeof payload === 'object' && 'text' in payload) {
        const value = String((payload as { text?: unknown }).text ?? '').trim();
        return value ? value : 'New encrypted message';
      }
      return 'New encrypted message';
    }
    if (type === 'COSIGN_REQUEST') {
      const txId = payload && typeof payload === 'object' && 'txId' in payload
        ? String((payload as { txId?: unknown }).txId ?? '')
        : '';
      return txId ? `Co-sign request for ${txId.slice(0, 8)}...` : 'New co-sign request';
    }
    if (type === 'COSIGN_RESPONSE') {
      return 'Co-sign response received';
    }
    if (type === 'COSIGN_READY') {
      return 'Peer is ready to co-sign';
    }
    return 'Peer pinged your wallet';
  }

  function messageTypeLabel(type: NostrMessageType): string {
    if (type === 'CHAT_MESSAGE') return 'Message';
    if (type === 'DEVICE_PING') return 'Ping';
    if (type === 'COSIGN_REQUEST') return 'Co-Sign Request';
    if (type === 'COSIGN_RESPONSE') return 'Co-Sign Response';
    return 'Co-Sign Ready';
  }

  function initials(label: string): string {
    const words = label.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  function formatTimestamp(tsSeconds: number): string {
    const date = new Date(tsSeconds * 1000);
    const now = new Date();
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    if (sameDay) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
    <span class="status">Relay {stateLabel()}</span>
  </header>

  <div class="stories" role="list" aria-label="Active sessions">
    {#each storyBubbles as bubble}
      <button
        class="story {bubble.pending ? 'is-pending' : ''} {bubble.live ? 'is-live' : ''} {bubble.unread ? 'has-unread' : ''}"
        class:is-active={activeThreadId === bubble.id}
        on:click={() => openThread(bubble)}
        aria-label={`Open ${bubble.label}`}
      >
        <span class="ring">
          <span class="avatar">{initials(bubble.label)}</span>
        </span>
        {#if bubble.unread}
          <span class="dot"></span>
        {/if}
        <span class="story-label">{bubble.label}</span>
      </button>
    {/each}
  </div>

  <nav class="filters" aria-label="Thread filters">
    {#each FILTER_TABS as tab}
      <button
        class="filter-chip"
        class:is-selected={activeFilter === tab}
        on:click={() => (activeFilter = tab)}
      >
        {tab}
      </button>
    {/each}
  </nav>

  <div class="chat-list" role="list" aria-label="Keyshare threads">
    {#if filteredThreads.length === 0}
      <p class="empty">No threads in {activeFilter}.</p>
    {:else}
      {#each filteredThreads as thread}
        <button class="chat-row" class:is-active={activeThreadId === thread.id} on:click={() => openFromFilter(thread)}>
          <span class="row-avatar-wrap">
            <span class="row-avatar">{initials(thread.title)}</span>
            <span class="online-pill" class:is-online={thread.online}></span>
          </span>
          <span class="row-main">
            <span class="row-title-line">
              <span class="title">{thread.title}</span>
              <span class="time">{formatTimestamp(thread.timestamp)}</span>
            </span>
            <span class="row-preview-line">
              <span class="preview">{thread.preview}</span>
              <span class="badges">
                {#if thread.pinned}
                  <span class="pin" title="Pinned">PIN</span>
                {/if}
                {#if thread.unreadCount > 0}
                  <span class="badge">{thread.unreadCount}</span>
                {/if}
              </span>
            </span>
          </span>
        </button>
      {/each}
    {/if}
  </div>

  <div class="peer-row">
    <label for="peer">Peer npub</label>
    <input id="peer" bind:value={peerNpub} placeholder="npub1..." />
    <button class="ping-btn" on:click={pingPeer}>Ping</button>
  </div>

  <div class="history">
    {#if conversationMessages.length === 0}
      <p class="empty">Select a thread to view activity.</p>
    {:else}
      {#each conversationMessages as msg}
        <div class="item">
          <div class="meta">
            <span>{messageTypeLabel(msg.envelope.type)}</span>
            <span>{formatTimestamp(msg.envelope.timestamp)}</span>
          </div>
          <div class="msg-header">
            <span>{formatPeerTitle(msg.senderNpub)}</span>
            <span class="relay">{msg.relayUrl.replace('wss://', '')}</span>
          </div>
          <pre>{JSON.stringify(msg.envelope.payload, null, 2)}</pre>
        </div>
      {/each}
    {/if}
  </div>

  <div class="composer">
    <textarea bind:this={composerInput} bind:value={text} placeholder="Encrypted message..." rows="3"></textarea>
    <div class="composer-actions">
      <button class="send-btn" on:click={sendChat}>Send Message</button>
      {#if selectedThread}
        <span class="target">To {selectedThread.title}</span>
      {:else if peerNpub}
        <span class="target">To {formatPeerTitle(peerNpub)}</span>
      {/if}
    </div>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}
</section>

<style>
  .chat-wrap {
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 18px;
    padding: 14px;
    background: linear-gradient(180deg, #15171d 0%, #101217 100%);
    color: #f2f4f8;
    display: grid;
    gap: 12px;
  }

  .chat-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
  }

  .chat-head h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .status {
    font-size: 12px;
    color: #9da6b3;
  }

  .stories {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: thin;
  }

  .story {
    position: relative;
    min-width: 68px;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: grid;
    gap: 6px;
    justify-items: center;
    padding: 2px 0;
    transition: transform 0.16s ease;
  }

  .story:active {
    transform: scale(0.97);
  }

  .story .ring {
    width: 58px;
    height: 58px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #5f6575, #444a59);
  }

  .story.is-pending .ring {
    background: linear-gradient(135deg, #45c3ff, #6ef2ba);
  }

  .story.has-unread .ring {
    background: linear-gradient(135deg, #6ca8ff, #74d7ff);
  }

  .story.is-active .ring {
    box-shadow: 0 0 0 2px rgba(129, 190, 255, 0.32);
  }

  .avatar {
    width: 52px;
    height: 52px;
    border-radius: 999px;
    background: linear-gradient(160deg, #1d2430, #12151d);
    color: #ecf2ff;
    display: grid;
    place-items: center;
    font-size: 13px;
    font-weight: 700;
  }

  .dot {
    position: absolute;
    top: 2px;
    right: 6px;
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: #5fdfff;
    border: 1px solid #111318;
  }

  .story-label {
    max-width: 70px;
    font-size: 11px;
    color: #c6ced8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .filters {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .filter-chip {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.03);
    color: #aab3bf;
    font-size: 12px;
    padding: 6px 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
  }

  .filter-chip.is-selected {
    background: #2d7ef7;
    border-color: #2d7ef7;
    color: #f4f8ff;
  }

  .chat-list {
    display: grid;
    gap: 6px;
    max-height: 280px;
    overflow-y: auto;
    padding-right: 2px;
  }

  .chat-row {
    border: 0;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.02);
    color: inherit;
    padding: 10px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    align-items: center;
    text-align: left;
    cursor: pointer;
    transition: background 0.16s ease, transform 0.16s ease;
  }

  .chat-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .chat-row:active {
    transform: scale(0.992);
  }

  .chat-row.is-active {
    background: rgba(45, 126, 247, 0.24);
  }

  .row-avatar-wrap {
    position: relative;
  }

  .row-avatar {
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background: linear-gradient(150deg, #2a3240, #161b24);
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 12px;
    color: #e5ecfa;
  }

  .online-pill {
    position: absolute;
    right: 1px;
    bottom: 1px;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    border: 1px solid #12151c;
    background: #5f6470;
  }

  .online-pill.is-online {
    background: #58d49a;
  }

  .row-main {
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  .row-title-line,
  .row-preview-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .title {
    color: #f4f8ff;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .time {
    color: #9aa5b2;
    font-size: 11px;
    white-space: nowrap;
  }

  .preview {
    color: #bcc6d3;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badges {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .pin {
    font-size: 12px;
    opacity: 0.9;
  }

  .badge {
    min-width: 20px;
    height: 20px;
    border-radius: 999px;
    background: #2d7ef7;
    color: #f4f8ff;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    padding: 0 6px;
  }

  .peer-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    margin-top: 2px;
  }

  .peer-row label {
    grid-column: 1 / -1;
    font-size: 12px;
    color: #a9b2bd;
  }

  .peer-row input,
  textarea {
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 10px;
    padding: 9px 10px;
    background: rgba(255, 255, 255, 0.02);
    color: #f4f8ff;
  }

  .peer-row input::placeholder,
  textarea::placeholder {
    color: #8f9bab;
  }

  .ping-btn,
  .send-btn {
    border: 0;
    border-radius: 10px;
    padding: 8px 12px;
    background: #2d7ef7;
    color: #f4f8ff;
    cursor: pointer;
    transition: opacity 0.14s ease;
  }

  .ping-btn:active,
  .send-btn:active {
    opacity: 0.82;
  }

  .history {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 10px;
    min-height: 120px;
    max-height: 240px;
    overflow: auto;
  }

  .item {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding: 8px 0;
  }

  .item:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .meta,
  .msg-header {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    color: #9eabbb;
    margin-bottom: 4px;
  }

  .relay {
    opacity: 0.8;
  }

  pre {
    margin: 0;
    font-size: 11px;
    color: #d8e0ea;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .composer {
    display: grid;
    gap: 8px;
  }

  .composer-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .target {
    font-size: 11px;
    color: #9fa9b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    color: #97a2b0;
    font-size: 13px;
    margin: 0;
    padding: 8px 2px;
  }

  .error {
    color: #ff8a8a;
    margin: 0;
    font-size: 12px;
  }

  @media (max-width: 540px) {
    .chat-wrap {
      border-radius: 14px;
      padding: 12px;
    }

    .chat-list {
      max-height: 240px;
    }

    .story .ring {
      width: 54px;
      height: 54px;
    }

    .avatar {
      width: 48px;
      height: 48px;
    }
  }
</style>
