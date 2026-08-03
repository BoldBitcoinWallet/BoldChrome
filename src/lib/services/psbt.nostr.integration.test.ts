import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./qr', () => ({
  qr: {
    generatePsbtQR: vi.fn().mockResolvedValue('data:image/png;base64,qr'),
  },
}));

vi.mock('./storage', () => ({
  storage: {
    get: vi.fn().mockResolvedValue('testnet'),
  },
}));

vi.mock('./nostrMessaging', () => ({
  nostrMessaging: {
    connect: vi.fn().mockResolvedValue(undefined),
    sendNip46Connect: vi.fn().mockResolvedValue('req-connect-1'),
    sendNip46SignEvent: vi.fn().mockResolvedValue('req-sign-1'),
    waitForNip46Response: vi.fn().mockRejectedValue(new Error('NIP-46 not available')),
    sendCoSignRequest: vi.fn().mockResolvedValue(undefined),
    waitForCoSignResponse: vi.fn(),
    psbtBase64ToHex: vi.fn().mockReturnValue('70736274'),
    psbtHexToBase64: vi.fn().mockReturnValue('c2lnbmVkLXBzYnQ='),
  },
}));

import { psbt } from './psbt';
import { qr } from './qr';
import { nostrMessaging } from './nostrMessaging';
import { walletStore } from '../stores/wallet';

describe('PSBT Nostr integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    walletStore.set({
      address: '',
      addresses: [],
      network: 'testnet',
      publicKey: '03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainCode: undefined,
      pairedNostrNpub: 'npub1peerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      btc: '0',
      usd: '0',
      lastBalanceUpdate: 0,
      transactions: [],
      lastTxUpdate: 0,
      hasMoreTransactions: true,
      utxos: [],
      isLoading: false,
      isLoadingMoreTransactions: false,
      isWatchOnly: true,
      pairedDevices: ['mobile-wallet'],
    });

    (psbt as any).currentSession.set({
      psbtId: 'tx-1',
      psbt: 'cHNidP8BAA==',
      status: 'creating',
      createdAt: Date.now(),
      recipientAddress: 'tb1qpeeraddressxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      amountSats: 1000,
      feeSats: 12,
    });
  });

  it('falls back to QR when COSIGN_REQUEST response times out', async () => {
    vi.mocked(nostrMessaging.waitForCoSignResponse).mockRejectedValueOnce(
      new Error('Timed out waiting for Nostr co-sign response'),
    );

    await psbt.requestSigning('cHNidP8BAA==');

    expect(qr.generatePsbtQR).toHaveBeenCalledWith('cHNidP8BAA==');

    await vi.waitFor(() => {
      const session = psbt.getSession();
      expect(session?.deliveryMode).toBe('nostr+qr');
      expect(session?.nostrState).toBe('timeout');
      expect(session?.status).toBe('awaiting_signature');
    });
  });

  it('marks session failed when COSIGN_RESPONSE is rejected', async () => {
    vi.mocked(nostrMessaging.waitForCoSignResponse).mockResolvedValueOnce({
      envelope: {
        id: 'resp-1',
        type: 'COSIGN_RESPONSE',
        senderFingerprint: 'peer',
        recipientFingerprint: 'self',
        timestamp: Date.now(),
        payload: {
          txId: 'tx-1',
          approved: false,
          reason: 'User rejected co-sign request on peer device',
        },
      },
      senderNpub: 'npub1peer',
      relayUrl: 'wss://relay.damus.io',
      eventId: 'evt-1',
    } as any);

    await psbt.requestSigning('cHNidP8BAA==');

    await vi.waitFor(() => {
      const session = psbt.getSession();
      expect(session?.nostrState).toBe('failed');
      expect(session?.error).toContain('rejected');
      expect(session?.status).toBe('awaiting_signature');
    });
  });

  it('auto-broadcasts after approved COSIGN_RESPONSE with signed PSBT payload', async () => {
    vi.mocked(nostrMessaging.waitForCoSignResponse).mockResolvedValueOnce({
      envelope: {
        id: 'resp-2',
        type: 'COSIGN_RESPONSE',
        senderFingerprint: 'peer',
        recipientFingerprint: 'self',
        timestamp: Date.now(),
        payload: {
          txId: 'tx-1',
          approved: true,
          signedPsbtBase64: 'c2lnbmVkLXBzYnQ=',
        },
      },
      senderNpub: 'npub1peer',
      relayUrl: 'wss://relay.damus.io',
      eventId: 'evt-2',
    } as any);

    const broadcastSpy = vi
      .spyOn(psbt, 'broadcastTransaction')
      .mockResolvedValueOnce('txid-from-nostr');

    await psbt.requestSigning('cHNidP8BAA==');

    await vi.waitFor(() => {
      const session = psbt.getSession();
      expect(session?.nostrState).toBe('delivered');
      expect(session?.status).toBe('signed');
      expect(broadcastSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('uses NIP-46 happy path and skips legacy COSIGN flow when response is successful', async () => {
    vi.mocked(nostrMessaging.waitForNip46Response).mockResolvedValueOnce({
      response: {
        id: 'req-sign-1',
        result: {
          signedPsbtBase64: 'c2lnbmVkLXBzYnQ=',
        },
      },
      senderNpub: 'npub1peer',
      senderPubHex: 'c'.repeat(64),
      relayUrl: 'wss://relay.damus.io',
      eventId: 'evt-nip46-1',
    } as any);

    const broadcastSpy = vi
      .spyOn(psbt, 'broadcastTransaction')
      .mockResolvedValueOnce('txid-from-nip46');

    await psbt.requestSigning('cHNidP8BAA==');

    await vi.waitFor(() => {
      const session = psbt.getSession();
      expect(session?.nostrState).toBe('delivered');
      expect(session?.status).toBe('signed');
      expect(nostrMessaging.sendNip46Connect).toHaveBeenCalledTimes(1);
      expect(nostrMessaging.sendNip46SignEvent).toHaveBeenCalledTimes(1);
      expect(nostrMessaging.sendCoSignRequest).not.toHaveBeenCalled();
      expect(nostrMessaging.waitForCoSignResponse).not.toHaveBeenCalled();
      expect(broadcastSpy).toHaveBeenCalledTimes(1);
    });
  });
});
