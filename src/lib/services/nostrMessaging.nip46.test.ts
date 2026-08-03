import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nostrMessaging,
  type Nip46IncomingRequest,
  type Nip46IncomingResponse,
} from './nostrMessaging';

describe('nostrMessaging NIP-46 (extension)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses incoming NIP-46 sign_event request and notifies listeners', async () => {
    const callbacks: Nip46IncomingRequest[] = [];
    const off = nostrMessaging.onNip46Request(msg => {
      callbacks.push(msg);
    });

    vi.spyOn(nostrMessaging as any, 'decryptFromSender').mockResolvedValueOnce(
      JSON.stringify({
        id: 'req-123',
        method: 'sign_event',
        params: [{ kind: 24133, content: '{"txId":"abc"}' }],
        secret: 's1',
      }),
    );
    vi.spyOn(nostrMessaging as any, 'hexToNpub').mockResolvedValueOnce('npub1peer');

    await (nostrMessaging as any).handleIncomingNip46Event(
      {
        id: 'evt-1',
        pubkey: 'f'.repeat(64),
        tags: [['x', 'bold-nip46-v1']],
        content: 'ciphertext',
      },
      'wss://relay.damus.io',
    );

    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].request.id).toBe('req-123');
    expect(callbacks[0].request.method).toBe('sign_event');
    expect(callbacks[0].senderNpub).toBe('npub1peer');

    off();
  });

  it('resolves waitForNip46Response when matching response id is received', async () => {
    vi.spyOn(nostrMessaging as any, 'decryptFromSender').mockResolvedValue(
      JSON.stringify({
        id: 'req-match',
        result: { signedPsbtBase64: 'cHNidA==' },
      }),
    );
    vi.spyOn(nostrMessaging as any, 'hexToNpub').mockResolvedValue('npub1peer');

    const waitPromise = nostrMessaging.waitForNip46Response('req-match', 2000);

    await (nostrMessaging as any).handleIncomingNip46Event(
      {
        id: 'evt-2',
        pubkey: 'e'.repeat(64),
        tags: [['x', 'bold-nip46-v1']],
        content: 'ciphertext',
      },
      'wss://nos.lol',
    );

    const resolved: Nip46IncomingResponse = await waitPromise;
    expect(resolved.response.id).toBe('req-match');
    expect((resolved.response.result as any).signedPsbtBase64).toBe('cHNidA==');
  });
});
