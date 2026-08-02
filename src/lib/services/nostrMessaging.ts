import { writable, get } from 'svelte/store';
import { storage } from './storage';

export type NostrMessageType =
  | 'COSIGN_REQUEST'
  | 'COSIGN_RESPONSE'
  | 'CHAT_MESSAGE'
  | 'DEVICE_PING';

export interface NostrEnvelope<T = unknown> {
  id: string;
  type: NostrMessageType;
  senderFingerprint: string;
  recipientFingerprint: string;
  timestamp: number;
  payload: T;
}

export interface CoSignRequestPayload {
  txId: string;
  psbtHex: string;
  psbtBase64?: string;
  amountSats: number;
  feeSats: number;
  recipientAddress: string;
  network: 'mainnet' | 'testnet' | 'testnet4';
}

export interface CoSignResponsePayload {
  txId: string;
  signedPsbtHex?: string;
  signedPsbtBase64?: string;
  approved: boolean;
  reason?: string;
}

export type NostrConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'degraded';

export interface NostrIncomingMessage<T = unknown> {
  envelope: NostrEnvelope<T>;
  senderNpub: string;
  relayUrl: string;
  eventId: string;
}

type SubscriptionHandler = (event: any, relayUrl: string) => void;

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];
const KEY_TAG = 'bold-cosign-v1';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function base64ToHex(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytesToHex(bytes);
}

function hexToBase64(hex: string): string {
  const bytes = hexToBytes(hex);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function nip19DataToHex(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim();
  }
  if (data instanceof Uint8Array) {
    return bytesToHex(data);
  }
  if (Array.isArray(data)) {
    return bytesToHex(Uint8Array.from(data as number[]));
  }
  throw new Error('Unsupported nip19 payload format');
}

class NostrMessagingService {
  public readonly connectionState = writable<NostrConnectionState>('disconnected');
  public readonly inbound = writable<NostrIncomingMessage[]>([]);

  private tools: any | null = null;
  private sockets = new Map<string, WebSocket>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private subscriptions = new Map<string, { filter: any; handler: SubscriptionHandler }>();
  private messageListeners = new Set<(msg: NostrIncomingMessage) => void>();
  private relays: string[] = [...DEFAULT_RELAYS];
  private localNsec = '';
  private localNpub = '';
  private localPrivHex = '';
  private localPubHex = '';
  private stopped = false;

  getLocalNpub(): string {
    return this.localNpub;
  }

  async connect(relays?: string[]): Promise<void> {
    this.stopped = false;
    await this.ensureIdentity();

    const desired = Array.from(new Set((relays && relays.length ? relays : DEFAULT_RELAYS).map(r => r.trim()).filter(Boolean)));
    this.relays = desired;

    this.connectionState.set('connecting');

    for (const relay of desired) {
      if (!this.sockets.has(relay)) {
        this.openSocket(relay);
      }
    }

    for (const existing of Array.from(this.sockets.keys())) {
      if (!desired.includes(existing)) {
        this.closeSocket(existing);
      }
    }

    if (!this.subscriptions.has('dm-inbox')) {
      this.subscribeInternal(
        'dm-inbox',
        {
          kinds: [4],
          '#p': [this.localPubHex],
          since: Math.floor(Date.now() / 1000) - 30,
        },
        (event, relayUrl) => {
          void this.handleIncomingEvent(event, relayUrl);
        },
      );
    }

    this.refreshConnectionState();
  }

  disconnect(): void {
    this.stopped = true;
    for (const relay of Array.from(this.sockets.keys())) {
      this.closeSocket(relay);
    }
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.connectionState.set('disconnected');
  }

  onMessage(listener: (msg: NostrIncomingMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async sendEnvelope<T>(recipientNpub: string, envelope: NostrEnvelope<T>): Promise<void> {
    await this.ensureIdentity();
    const recipientHex = await this.npubToHex(recipientNpub);
    const plaintext = JSON.stringify(envelope);
    const encrypted = await this.encryptForRecipient(plaintext, recipientHex);
    const event = await this.signEvent(encrypted, recipientHex, envelope.type);

    let delivered = 0;
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['EVENT', event]));
        delivered += 1;
      }
    }

    if (delivered === 0) {
      throw new Error('No active Nostr relay connection');
    }
  }

  async sendCoSignRequest(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignRequestPayload,
  ): Promise<NostrEnvelope<CoSignRequestPayload>> {
    const envelope: NostrEnvelope<CoSignRequestPayload> = {
      id: randomId(),
      type: 'COSIGN_REQUEST',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    };

    await this.sendEnvelope(recipientNpub, envelope);
    return envelope;
  }

  async sendCoSignResponse(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
    payload: CoSignResponsePayload,
  ): Promise<NostrEnvelope<CoSignResponsePayload>> {
    const envelope: NostrEnvelope<CoSignResponsePayload> = {
      id: randomId(),
      type: 'COSIGN_RESPONSE',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload,
    };

    await this.sendEnvelope(recipientNpub, envelope);
    return envelope;
  }

  waitForCoSignResponse(txId: string, timeoutMs = 45000): Promise<NostrIncomingMessage<CoSignResponsePayload>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error('Timed out waiting for Nostr co-sign response'));
      }, timeoutMs);

      const off = this.onMessage(msg => {
        if (msg.envelope.type !== 'COSIGN_RESPONSE') return;
        const payload = msg.envelope.payload as CoSignResponsePayload;
        if (payload?.txId !== txId) return;
        clearTimeout(timeout);
        off();
        resolve(msg as NostrIncomingMessage<CoSignResponsePayload>);
      });
    });
  }

  async sendChatMessage(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
    text: string,
  ): Promise<void> {
    await this.sendEnvelope(recipientNpub, {
      id: randomId(),
      type: 'CHAT_MESSAGE',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload: { text },
    });
  }

  async sendDevicePing(
    recipientNpub: string,
    senderFingerprint: string,
    recipientFingerprint: string,
  ): Promise<void> {
    await this.sendEnvelope(recipientNpub, {
      id: randomId(),
      type: 'DEVICE_PING',
      senderFingerprint,
      recipientFingerprint,
      timestamp: Date.now(),
      payload: { online: true },
    });
  }

  psbtBase64ToHex(psbtBase64: string): string {
    return base64ToHex(psbtBase64);
  }

  psbtHexToBase64(psbtHex: string): string {
    return hexToBase64(psbtHex);
  }

  private async ensureTools(): Promise<any> {
    if (!this.tools) {
      this.tools = await import('nostr-tools');
    }
    return this.tools;
  }

  private async ensureIdentity(): Promise<void> {
    if (this.localNsec && this.localNpub && this.localPrivHex && this.localPubHex) {
      return;
    }

    const tools = await this.ensureTools();

    let nsec = (await storage.get<string>('nostrNsec')) || '';
    let npub = (await storage.get<string>('nostrNpub')) || '';

    if (!nsec) {
      const secret = tools.generateSecretKey();
      const secretHex = bytesToHex(secret);
      nsec = tools.nip19.nsecEncode(secretHex);
      npub = tools.nip19.npubEncode(tools.getPublicKey(secret));
      await storage.set('nostrNsec', nsec);
      await storage.set('nostrNpub', npub);
    }

    this.localNsec = nsec;
    this.localPrivHex = await this.nsecToHex(nsec);
    this.localPubHex = tools.getPublicKey(hexToBytes(this.localPrivHex));
    this.localNpub = npub || tools.nip19.npubEncode(this.localPubHex);

    if (!npub) {
      await storage.set('nostrNpub', this.localNpub);
    }
  }

  private async nsecToHex(nsec: string): Promise<string> {
    if (!nsec.startsWith('nsec1')) return nsec;
    const tools = await this.ensureTools();
    const decoded = tools.nip19.decode(nsec);
    return nip19DataToHex(decoded.data);
  }

  private async npubToHex(npub: string): Promise<string> {
    if (!npub.startsWith('npub1')) return npub;
    const tools = await this.ensureTools();
    const decoded = tools.nip19.decode(npub);
    return nip19DataToHex(decoded.data);
  }

  private async hexToNpub(pubHex: string): Promise<string> {
    const tools = await this.ensureTools();
    return tools.nip19.npubEncode(pubHex);
  }

  private openSocket(relayUrl: string): void {
    const ws = new WebSocket(relayUrl);
    this.sockets.set(relayUrl, ws);

    ws.onopen = () => {
      for (const [subId, sub] of this.subscriptions.entries()) {
        ws.send(JSON.stringify(['REQ', subId, sub.filter]));
      }
      this.refreshConnectionState();
    };

    ws.onmessage = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(String(evt.data));
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'EVENT') {
          const subId = String(msg[1] || '');
          const event = msg[2];
          const sub = this.subscriptions.get(subId);
          if (sub) sub.handler(event, relayUrl);
        }
      } catch (err) {
        console.warn('[NostrMessaging] Failed to parse relay frame', err);
      }
    };

    ws.onerror = () => {
      this.refreshConnectionState();
    };

    ws.onclose = () => {
      this.sockets.delete(relayUrl);
      this.refreshConnectionState();
      if (!this.stopped) {
        const t = setTimeout(() => this.openSocket(relayUrl), 2500);
        this.reconnectTimers.set(relayUrl, t);
      }
    };
  }

  private closeSocket(relayUrl: string): void {
    const ws = this.sockets.get(relayUrl);
    if (ws) {
      try {
        ws.close();
      } catch {
        // no-op
      }
      this.sockets.delete(relayUrl);
    }
    const timer = this.reconnectTimers.get(relayUrl);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(relayUrl);
    }
  }

  private refreshConnectionState(): void {
    const open = Array.from(this.sockets.values()).filter(ws => ws.readyState === WebSocket.OPEN).length;
    if (open === 0) {
      this.connectionState.set(this.sockets.size ? 'connecting' : 'disconnected');
      return;
    }
    this.connectionState.set(open === this.relays.length ? 'connected' : 'degraded');
  }

  private subscribeInternal(subId: string, filter: any, handler: SubscriptionHandler): void {
    this.subscriptions.set(subId, { filter, handler });
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['REQ', subId, filter]));
      }
    }
  }

  private async signEvent(content: string, recipientHex: string, type: NostrMessageType): Promise<any> {
    const tools = await this.ensureTools();
    const draft = {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientHex],
        ['x', KEY_TAG],
        ['t', type],
      ],
      content,
    };
    return tools.finalizeEvent(draft, hexToBytes(this.localPrivHex));
  }

  private async encryptForRecipient(plaintext: string, recipientHex: string): Promise<string> {
    const tools = await this.ensureTools();

    const nip44 = tools.nip44 as any;
    if (nip44?.v2?.utils?.getConversationKey && nip44?.v2?.encrypt) {
      try {
        const conv = nip44.v2.utils.getConversationKey(this.localPrivHex, recipientHex);
        return `nip44:${nip44.v2.encrypt(plaintext, conv)}`;
      } catch {
        // fall back
      }
    }

    if (!tools.nip04?.encrypt) {
      throw new Error('NIP-04 encryption is unavailable in nostr-tools');
    }

    const enc = await tools.nip04.encrypt(this.localPrivHex, recipientHex, plaintext);
    return `nip04:${enc}`;
  }

  private async decryptFromSender(ciphertext: string, senderHex: string): Promise<string> {
    const tools = await this.ensureTools();

    if (ciphertext.startsWith('nip44:')) {
      const nip44 = tools.nip44 as any;
      if (nip44?.v2?.utils?.getConversationKey && nip44?.v2?.decrypt) {
        const conv = nip44.v2.utils.getConversationKey(this.localPrivHex, senderHex);
        return nip44.v2.decrypt(ciphertext.slice(6), conv);
      }
    }

    const raw = ciphertext.startsWith('nip04:') ? ciphertext.slice(6) : ciphertext;
    if (!tools.nip04?.decrypt) {
      throw new Error('NIP-04 decryption is unavailable in nostr-tools');
    }
    return tools.nip04.decrypt(this.localPrivHex, senderHex, raw);
  }

  private async handleIncomingEvent(event: any, relayUrl: string): Promise<void> {
    if (!event || typeof event !== 'object') return;
    if (event.kind !== 4 || typeof event.content !== 'string' || typeof event.pubkey !== 'string') return;

    const tags = Array.isArray(event.tags) ? event.tags : [];
    const hasClientTag = tags.some((t: any) => Array.isArray(t) && t[0] === 'x' && t[1] === KEY_TAG);
    if (!hasClientTag) return;

    try {
      const plaintext = await this.decryptFromSender(event.content, event.pubkey);
      const envelope = JSON.parse(plaintext) as NostrEnvelope;
      if (!envelope?.type || !envelope?.id) return;

      const senderNpub = await this.hexToNpub(event.pubkey);
      const incoming: NostrIncomingMessage = {
        envelope,
        senderNpub,
        relayUrl,
        eventId: String(event.id || ''),
      };

      this.inbound.update(items => [incoming, ...items].slice(0, 200));
      for (const listener of this.messageListeners) listener(incoming);
    } catch (err) {
      console.warn('[NostrMessaging] Failed to decrypt/parse incoming event', err);
    }
  }
}

export const nostrMessaging = new NostrMessagingService();
