import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool, nip04, nip19, nip44 } from 'nostr-tools';
import * as bitcoin from 'bitcoinjs-lib';

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function decodeNpubToHex(npub) {
  const decoded = nip19.decode(npub);
  if (!decoded || decoded.type !== 'npub') {
    throw new Error('RECIPIENT_NPUB is not a valid npub');
  }
  if (typeof decoded.data === 'string') return decoded.data;
  if (decoded.data instanceof Uint8Array) return bytesToHex(decoded.data);
  if (Array.isArray(decoded.data)) return bytesToHex(Uint8Array.from(decoded.data));
  throw new Error('Unsupported npub payload format');
}

async function encryptForRecipient(plaintext, localPrivHex, recipientPubHex) {
  if (nip44?.v2?.utils?.getConversationKey && nip44?.v2?.encrypt) {
    try {
      const conversationKey = nip44.v2.utils.getConversationKey(localPrivHex, recipientPubHex);
      return `nip44:${nip44.v2.encrypt(plaintext, conversationKey)}`;
    } catch {
      // fall back to nip04
    }
  }
  const ciphertext = await nip04.encrypt(localPrivHex, recipientPubHex, plaintext);
  return `nip04:${ciphertext}`;
}

async function decryptFromSender(ciphertext, localPrivHex, senderPubHex) {
  if (typeof ciphertext !== 'string') {
    throw new Error('Unexpected ciphertext type');
  }
  if (ciphertext.startsWith('nip44:') && nip44?.v2?.utils?.getConversationKey && nip44?.v2?.decrypt) {
    const conversationKey = nip44.v2.utils.getConversationKey(localPrivHex, senderPubHex);
    return nip44.v2.decrypt(ciphertext.slice(6), conversationKey);
  }
  const raw = ciphertext.startsWith('nip04:') ? ciphertext.slice(6) : ciphertext;
  return nip04.decrypt(localPrivHex, senderPubHex, raw);
}

function createNip46Event(localSk, recipientPubHex, payload) {
  return finalizeEvent(
    {
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientPubHex],
        ['x', 'bold-nip46-v1'],
      ],
      content: payload,
    },
    localSk,
  );
}

function createCosignDmEvent(localSk, recipientPubHex, payload) {
  return finalizeEvent(
    {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientPubHex],
        ['x', 'bold-cosign-v1'],
      ],
      content: payload,
    },
    localSk,
  );
}

function buildValidProbePsbt(networkName) {
  const network = networkName === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const psbt = new bitcoin.Psbt({ network });

  // Use a synthetic SegWit input/output so parsers can decode fields without EOF.
  psbt.addInput({
    hash: '00'.repeat(32),
    index: 0,
    witnessUtxo: {
      script: Buffer.from(`0014${'11'.repeat(20)}`, 'hex'),
      value: 2000n,
    },
  });

  psbt.addOutput({
    script: Buffer.from(`0014${'22'.repeat(20)}`, 'hex'),
    value: 1900n,
  });

  return {
    psbtBase64: psbt.toBase64(),
    psbtHex: psbt.toHex(),
  };
}

async function publishWithAck(pool, relays, event, label) {
  const publishPromises = pool.publish(relays, event);
  const settled = await Promise.allSettled(publishPromises);

  const okRelays = [];
  const failedRelays = [];

  settled.forEach((result, index) => {
    const relay = relays[index] || `relay-${index}`;
    if (result.status === 'fulfilled') {
      okRelays.push(relay);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failedRelays.push(`${relay}: ${reason}`);
    }
  });

  if (okRelays.length > 0) {
    console.log(`${label}_ACK_OK`, okRelays.join(', '));
  }
  if (failedRelays.length > 0) {
    console.log(`${label}_ACK_FAIL`, failedRelays.join(' | '));
  }

  return { okRelays, failedRelays };
}

async function main() {
  const recipientNpub = (process.env.RECIPIENT_NPUB || '').trim();
  if (!recipientNpub) {
    throw new Error('Missing RECIPIENT_NPUB env var');
  }

  const relays = (process.env.RELAYS || 'wss://relay.damus.io,wss://nos.lol')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  const timeoutMs = Number(process.env.TIMEOUT_MS || 120000);

  const localSk = generateSecretKey();
  const localPrivHex = bytesToHex(localSk);
  const localPubHex = getPublicKey(localSk);
  const localNpub = nip19.npubEncode(localPubHex);
  const recipientPubHex = decodeNpubToHex(recipientNpub);

  const requestId = randomId('cosign-req');
  const txId = randomId('tx');

  const networkName = process.env.NETWORK || 'testnet';
  const probePsbt = buildValidProbePsbt(networkName);

  const coSignPayload = {
    txId,
    psbtHex: probePsbt.psbtHex,
    psbtBase64: probePsbt.psbtBase64,
    amountSats: Number(process.env.AMOUNT_SATS || 1234),
    feeSats: Number(process.env.FEE_SATS || 12),
    recipientAddress: process.env.RECIPIENT_ADDRESS || 'tb1qexamplexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    network: networkName,
    partialSignedBy: localNpub,
    stage: 'awaiting-peer-cosign',
  };

  const cosignEnvelope = {
    id: requestId,
    type: 'COSIGN_REQUEST',
    senderFingerprint: 'mobile-signer-1',
    recipientFingerprint: 'peer-group',
    timestamp: Date.now(),
    payload: coSignPayload,
  };

  const pool = new SimplePool();
  let finished = false;
  let cosignEcho = false;

  console.log('Peer COSIGN live probe start');
  console.log('requester npub:', localNpub);
  console.log('requester pubhex:', localPubHex);
  console.log('recipient npub:', recipientNpub);
  console.log('recipient pubhex:', recipientPubHex);
  console.log('relays:', relays.join(', '));
  console.log('request id:', requestId);
  console.log('probe psbt base64 len:', coSignPayload.psbtBase64.length);
  console.log('probe psbt base64 prefix:', coSignPayload.psbtBase64.slice(0, 24));

  const finish = code => {
    if (finished) return;
    finished = true;
    try {
      pool.close(relays);
    } catch {
      // no-op
    }
    process.exit(code);
  };

  pool.subscribeMany(
    relays,
    [
      {
        kinds: [4],
        authors: [localPubHex],
        since: Math.floor(Date.now() / 1000) - 30,
      },
      {
        kinds: [4],
        '#p': [localPubHex],
        since: Math.floor(Date.now() / 1000) - 30,
      },
    ],
    {
      onevent: async event => {
        if (event?.id === requestEventId) {
          cosignEcho = true;
          console.log('RELAY_ECHO_COSIGN_OK', event.id);
          return;
        }

        try {
          const plaintext = await decryptFromSender(event.content, localPrivHex, event.pubkey);
          const parsed = JSON.parse(plaintext);

          if (!parsed || typeof parsed !== 'object') return;
          if (parsed.type !== 'COSIGN_RESPONSE') return;
          const payload = parsed.payload || {};
          if (payload.txId !== txId) return;

          if (!payload.approved) {
            console.log('COSIGN_RESPONSE_REJECTED', payload.reason || 'peer rejected');
            finish(3);
            return;
          }

          const signedLen = typeof payload.signedPsbtBase64 === 'string' ? payload.signedPsbtBase64.length : 0;
          const broadcastTxId = typeof payload.broadcastTxId === 'string' ? payload.broadcastTxId : '';
          console.log('COSIGN_RESPONSE_OK', JSON.stringify({ signedPsbtLen: signedLen, broadcastTxId }));
          finish(0);
        } catch {
          // ignore unrelated or undecodable frames
        }
      },
      oneose: () => {},
    },
  );

  const encryptedRequest = await encryptForRecipient(JSON.stringify(cosignEnvelope), localPrivHex, recipientPubHex);
  const requestEvent = createCosignDmEvent(localSk, recipientPubHex, encryptedRequest);
  const requestEventId = requestEvent.id;
  const requestPublish = await publishWithAck(pool, relays, requestEvent, 'COSIGN_REQUEST');
  if (requestPublish.okRelays.length === 0) {
    console.log('COSIGN_PUBLISH_ABORT', 'co-sign request event was rejected by all relays');
    finish(5);
    return;
  }
  console.log('COSIGN_REQUEST_SENT', requestId);
  console.log('Awaiting peer co-sign response...');

  setTimeout(() => {
    if (!cosignEcho) {
      console.log('RELAY_ECHO_COSIGN_MISSING', requestEventId);
    }
  }, 8000);

  setTimeout(() => {
    console.log('COSIGN_RESPONSE_TIMEOUT');
    finish(2);
  }, timeoutMs);
}

main().catch(err => {
  console.error('NIP46_LIVE_PROBE_FAILED', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
