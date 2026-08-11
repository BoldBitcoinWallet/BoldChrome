/**
 * PSBT (Partially Signed Bitcoin Transaction) Service
 * Handles transaction creation and signing coordination with mobile devices
 */

import * as bitcoin from 'bitcoinjs-lib';
import { Point, getPublicKey, sign as ecdsaSign, verify as ecdsaVerify, schnorr, etc, hashes } from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { writable, get } from 'svelte/store';
import { walletStore, getNextChangeAddress, getCurrentReceiveAddress, type TaggedUTXO } from '../stores/wallet';
import { blockchain } from './blockchain';
import { qr } from './qr';
import { storage } from './storage';
import {
  nostrMessaging,
  type CoSignRequestPayload,
  type CoSignResponsePayload,
} from './nostrMessaging';
import { keyshareFingerprint } from './keyshareFingerprint';

// Set up sync hashes for @noble/secp256k1
hashes.sha256 = (msg: Uint8Array) => sha256(msg);
hashes.hmacSha256 = (key: Uint8Array, msg: Uint8Array) => hmac(sha256, key, msg);

// Modular exponentiation helper
function powMod(base: bigint, exp: bigint, mod: bigint): bigint {
  if (exp === 0n) return 1n;
  let result = 1n;
  base = etc.mod(base, mod);
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = etc.mod(result * base, mod);
    }
    exp = exp / 2n;
    base = etc.mod(base * base, mod);
  }
  return result;
}

// Adapter for @noble/secp256k1 to work with bitcoinjs-lib
const ecc = {
  isPoint: (p: Uint8Array): boolean => {
    try {
      Point.fromBytes(p);
      return true;
    } catch {
      return false;
    }
  },
  isPrivate: (d: Uint8Array): boolean => {
    if (d.length !== 32) return false;
    const scalar = etc.bytesToNumberBE(d);
    return scalar > 0n && scalar < Point.CURVE().n;
  },
  isXOnlyPoint: (p: Uint8Array): boolean => {
    if (p.length !== 32) return false;
    try {
      const px = etc.bytesToNumberBE(p);
      const CURVE = Point.CURVE();
      if (px === 0n || px >= CURVE.p) return false;
      
      // Check if point can be constructed (x is on curve)
      const y2 = etc.mod(px ** 3n + CURVE.b, CURVE.p); // secp256k1: a=0, so x³+b
      
      // For secp256k1, p ≡ 3 (mod 4), so we can use formula y = y2^((p+1)/4) mod p
      const y = powMod(y2, (CURVE.p + 1n) / 4n, CURVE.p);
      
      // Verify that y² = y2 (mod p)
      return etc.mod(y ** 2n, CURVE.p) === y2;
    } catch {
      return false;
    }
  },
  pointFromScalar: (d: Uint8Array, compressed?: boolean): Uint8Array | null => {
    try {
      return getPublicKey(d, compressed !== false);
    } catch {
      return null;
    }
  },
  pointAddScalar: (p: Uint8Array, tweak: Uint8Array, compressed?: boolean): Uint8Array | null => {
    try {
      const point = Point.fromBytes(p);
      const tweakPoint = Point.BASE.multiply(etc.bytesToNumberBE(tweak));
      const added = point.add(tweakPoint);
      return added.toBytes(compressed !== false);
    } catch {
      return null;
    }
  },
  pointMultiply: (p: Uint8Array, tweak: Uint8Array, compressed?: boolean): Uint8Array | null => {
    try {
      const point = Point.fromBytes(p);
      const scalar = etc.bytesToNumberBE(tweak);
      const multiplied = point.multiply(scalar);
      return multiplied.toBytes(compressed !== false);
    } catch {
      return null;
    }
  },
  xOnlyPointAddTweak: (p: Uint8Array, tweak: Uint8Array): { parity: number; xOnlyPubkey: Uint8Array } | null => {
    try {
      const px = etc.bytesToNumberBE(p);
      const CURVE = Point.CURVE();
      
      // Compute y from x (secp256k1: a=0)
      const y2 = etc.mod(px ** 3n + CURVE.b, CURVE.p);
      let y = powMod(y2, (CURVE.p + 1n) / 4n, CURVE.p);
      
      // Use even y (parity 0)
      if (y % 2n !== 0n) {
        y = CURVE.p - y;
      }
      
      const point = Point.fromAffine({ x: px, y });
      const tweakPoint = Point.BASE.multiply(etc.bytesToNumberBE(tweak));
      const added = point.add(tweakPoint);
      
      if (added.equals(Point.ZERO)) return null;
      
      const affine = added.toAffine();
      const parity = affine.y % 2n === 0n ? 0 : 1;
      
      // Ensure 32-byte x coordinate with proper padding
      const xBytes = etc.numberToBytesBE(affine.x);
      let xOnlyPubkey: Uint8Array;
      if (xBytes.length === 32) {
        xOnlyPubkey = xBytes;
      } else if (xBytes.length < 32) {
        xOnlyPubkey = new Uint8Array(32);
        xOnlyPubkey.set(xBytes, 32 - xBytes.length);
      } else {
        xOnlyPubkey = xBytes.slice(-32);
      }
      
      return {
        parity,
        xOnlyPubkey
      };
    } catch {
      return null;
    }
  },
  privateAdd: (d: Uint8Array, tweak: Uint8Array): Uint8Array | null => {
    try {
      const CURVE = Point.CURVE();
      const dNum = etc.bytesToNumberBE(d);
      const tweakNum = etc.bytesToNumberBE(tweak);
      const result = etc.mod(dNum + tweakNum, CURVE.n);
      const resultBytes = etc.numberToBytesBE(result);
      // Ensure 32-byte return value
      if (resultBytes.length === 32) return resultBytes;
      if (resultBytes.length > 32) return resultBytes.slice(-32);
      const padded = new Uint8Array(32);
      padded.set(resultBytes, 32 - resultBytes.length);
      return padded;
    } catch {
      return null;
    }
  },
  privateNegate: (d: Uint8Array): Uint8Array => {
    const CURVE = Point.CURVE();
    const dNum = etc.bytesToNumberBE(d);
    const result = etc.mod(CURVE.n - dNum, CURVE.n);
    const resultBytes = etc.numberToBytesBE(result);
    // Ensure 32-byte return value
    if (resultBytes.length === 32) return resultBytes;
    if (resultBytes.length > 32) return resultBytes.slice(-32);
    const padded = new Uint8Array(32);
    padded.set(resultBytes, 32 - resultBytes.length);
    return padded;
  },
  sign: (h: Uint8Array, d: Uint8Array, e?: Uint8Array): Uint8Array => {
    return ecdsaSign(h, d, { prehash: false, extraEntropy: e });
  },
  signSchnorr: (h: Uint8Array, d: Uint8Array, e?: Uint8Array): Uint8Array => {
    return schnorr.sign(h, d, e);
  },
  verify: (h: Uint8Array, Q: Uint8Array, signature: Uint8Array, strict?: boolean): boolean => {
    try {
      return ecdsaVerify(signature, h, Q, { prehash: false, lowS: strict });
    } catch {
      return false;
    }
  },
  verifySchnorr: (h: Uint8Array, Q: Uint8Array, signature: Uint8Array): boolean => {
    try {
      // Extract x-only pubkey based on input format
      let xOnly: Uint8Array;
      if (Q.length === 32) {
        xOnly = Q; // Already x-only
      } else if (Q.length === 33) {
        xOnly = Q.slice(1); // Compressed: skip prefix byte
      } else if (Q.length === 65) {
        xOnly = Q.slice(1, 33); // Uncompressed: take x coordinate
      } else {
        return false;
      }
      return schnorr.verify(signature, h, xOnly);
    } catch {
      return false;
    }
  },
};

// ecc is already initialized by hdwallet.ts - skip redundant call

export interface UTXO {
  txid: string;
  vout: number;
  value: number; // satoshis
  status: {
    confirmed: boolean;
    block_height?: number;
  };
}

export interface BrantaMerchant {
  merchantId?: string;
  merchantName: string;
  logoUrl?: string;
  verifyUrl?: string;
}

export interface PsbtSession {
  psbtId: string;
  psbt: string; // Base64 encoded PSBT
  status: 'creating' | 'awaiting_signature' | 'signed' | 'broadcasting' | 'broadcasted' | 'failed';
  createdAt: number;
  recipientAddress?: string;
  amountSats?: number;
  feeSats?: number;
  txid?: string;
  error?: string;
  deliveryMode?: 'qr' | 'nostr+qr';
  nostrState?: 'idle' | 'pending' | 'acknowledged' | 'delivered' | 'timeout' | 'failed';
  brantaMerchant?: BrantaMerchant;
}

export interface CreatePsbtParams {
  recipientAddress: string;
  amountSats: number;
  feeRate?: number; // sats per vByte
}

// Keep legacy fallback enabled during rollout; set false to enforce strict NIP-46.
const ENABLE_LEGACY_COSIGN_FALLBACK = true;

class PsbtService {
  private currentSession = writable<PsbtSession | null>(null);
  public session = { subscribe: this.currentSession.subscribe };

  private canonicalPsbtBytes(psbtBase64: string): Uint8Array {
    const compact = (psbtBase64 || '').trim().replace(/\s+/g, '');
    const bytes = new Uint8Array(Buffer.from(compact, 'base64'));
    if (
      bytes.length < 4 ||
      bytes[0] !== 0x70 ||
      bytes[1] !== 0x73 ||
      bytes[2] !== 0x62 ||
      bytes[3] !== 0x74
    ) {
      throw new Error('Invalid PSBT payload (missing psbt magic bytes)');
    }
    return bytes;
  }

  private buildPsbtDebugSnapshot(psbtBase64: string): {
    base64: string;
    hex: string;
    sha256Hex: string;
  } {
    const bytes = this.canonicalPsbtBytes(psbtBase64);
    const base64 = Buffer.from(bytes).toString('base64');
    const hex = Buffer.from(bytes).toString('hex');
    const sha256Hex = Buffer.from(sha256(bytes)).toString('hex');
    return { base64, hex, sha256Hex };
  }

  private classifyScriptType(scriptHex: string): 'p2wpkh' | 'p2sh' | 'p2pkh' | 'p2tr' | 'unknown' {
    if (scriptHex.startsWith('0014') && scriptHex.length === 44) return 'p2wpkh';
    if (scriptHex.startsWith('a914') && scriptHex.endsWith('87') && scriptHex.length === 46) return 'p2sh';
    if (scriptHex.startsWith('76a914') && scriptHex.endsWith('88ac') && scriptHex.length === 50) return 'p2pkh';
    if (scriptHex.startsWith('5120') && scriptHex.length === 68) return 'p2tr';
    return 'unknown';
  }

  private p2wpkhScriptCode(scriptHex: string): Uint8Array {
    const witnessProgram = scriptHex.slice(4); // drop OP_0 + push-20 prefix
    return new Uint8Array(Buffer.from(`1976a914${witnessProgram}88ac`, 'hex'));
  }

  private logExtensionPreSignDiagnostics(
    psbt: bitcoin.Psbt,
    selectedUtxos: TaggedUTXO[],
    prevOuts: Array<{ value: number; scriptHex: string }>,
  ): void {
    const unsignedTx = (psbt as any)?.__CACHE?.__TX as bitcoin.Transaction | undefined;
    if (!unsignedTx) {
      console.warn('[PSBT_SIGN_DEBUG][EXT] Unable to access unsigned transaction cache for diagnostics');
      return;
    }

    selectedUtxos.forEach((utxo, inputIndex) => {
      const prevOut = prevOuts[inputIndex];
      if (!prevOut) return;

      const psbtInput = (psbt.data.inputs[inputIndex] as { sighashType?: number }) || {};
      const sighashType = psbtInput.sighashType || bitcoin.Transaction.SIGHASH_ALL;
      const scriptType = this.classifyScriptType(prevOut.scriptHex);

      let sighashHex = 'unavailable';
      try {
        if (scriptType === 'p2wpkh') {
          const scriptCode = this.p2wpkhScriptCode(prevOut.scriptHex);
          sighashHex = Buffer.from(
            unsignedTx.hashForWitnessV0(inputIndex, scriptCode, BigInt(prevOut.value), sighashType),
          ).toString('hex');
        } else if (scriptType === 'p2pkh') {
          const script = new Uint8Array(Buffer.from(prevOut.scriptHex, 'hex'));
          sighashHex = Buffer.from(
            unsignedTx.hashForSignature(inputIndex, script, sighashType),
          ).toString('hex');
        }
      } catch (error) {
        sighashHex = `error:${error instanceof Error ? error.message : String(error)}`;
      }

      console.warn('[PSBT_SIGN_DEBUG][EXT]', {
        input: inputIndex,
        txid: utxo.txid,
        vout: utxo.vout,
        derivationPath: utxo.derivationPath,
        witnessUtxoValue: prevOut.value,
        scriptType,
        sighashType: `0x${sighashType.toString(16)}`,
        sighashHex,
      });
    });
  }

  /**
   * Create a PSBT for spending Bitcoin using tagged UTXOs from all HD addresses.
   * Change goes to a fresh HD change address (not the sending address).
   */
  async createPsbt(params: CreatePsbtParams): Promise<{ psbtBase64: string; feeSats: number; psbtId: string; utxosJson: string; changeAddress: string }> {
    const { recipientAddress, amountSats, feeRate = 5 } = params;

    console.log('[PSBT] Creating PSBT:', {
      recipient: recipientAddress,
      amount: amountSats,
      feeRate
    });

    const wallet = get(walletStore);
    if (!wallet.utxos || wallet.utxos.length === 0) {
      throw new Error('No UTXOs available for spending');
    }

    const network = wallet.network === 'testnet' 
      ? bitcoin.networks.testnet 
      : bitcoin.networks.bitcoin;

    console.log('[PSBT] Found', wallet.utxos.length, 'tagged UTXOs across all addresses');

    const psbt = new bitcoin.Psbt({ network });

    const estimatedSize = 250;
    const estimatedFee = Math.ceil(estimatedSize * feeRate);
    const targetAmount = amountSats + estimatedFee;

    let totalInput = 0;
    const selectedUtxos: TaggedUTXO[] = [];
    const prevOuts: Array<{ value: number; scriptHex: string }> = [];

    // Largest-first coin selection from the aggregated tagged UTXO set
    const sortedUtxos = [...wallet.utxos].sort((a, b) => b.value - a.value);
    
    for (const utxo of sortedUtxos) {
      if (totalInput >= targetAmount) break;
      
      selectedUtxos.push(utxo);
      totalInput += utxo.value;

      const txHex = await blockchain.getTransactionHex(utxo.txid);
      const prevTx = bitcoin.Transaction.fromHex(txHex);
      const prevOutput = prevTx.outs[utxo.vout];
      if (!prevOutput) {
        throw new Error(`Missing prevout ${utxo.txid}:${utxo.vout} while building PSBT`);
      }
      prevOuts.push({
        value: Number(prevOutput.value),
        scriptHex: Buffer.from(prevOutput.script).toString('hex'),
      });
      
      const txBytes = (function hexToU8Local(hex: string) {
        const clean = (hex || '').replace(/^0x/, '').replace(/\s+/g, '');
        const len = Math.ceil(clean.length / 2);
        const out = new Uint8Array(len);
        for (let i = 0; i < len; i++) out[i] = parseInt(clean.substr(i * 2, 2) || '00', 16);
        return out;
      })(txHex);

      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        nonWitnessUtxo: txBytes,
      });
    }

    if (totalInput < targetAmount) {
      throw new Error(`Insufficient funds. Have ${totalInput} sats, need ${targetAmount} sats`);
    }

    const actualSize = this.estimateTransactionSize(selectedUtxos.length, 2);
    const actualFee = Math.ceil(actualSize * feeRate);
    const changeAmount = totalInput - amountSats - actualFee;

    // Recipient output
    psbt.addOutput({
      address: recipientAddress,
      value: BigInt(amountSats),
    });

    // Change goes to a fresh HD change address
    const changeAddr = getNextChangeAddress();
    if (changeAmount > 546 && changeAddr) {
      psbt.addOutput({
        address: changeAddr.address,
        value: BigInt(changeAmount),
      });
    }

    // Build utxosJson matching mobile's expected format:
    // [{txid, vout, value, derivationPath, address}]
    const utxosJson = JSON.stringify(selectedUtxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
      derivationPath: u.derivationPath,
      address: u.address,
    })));

    console.log('[PSBT] Transaction details:', {
      inputs: selectedUtxos.length,
      totalInput,
      recipient: amountSats,
      change: changeAmount,
      changeAddress: changeAddr?.address?.slice(0, 12),
      fee: actualFee,
      feeRate
    });

    const psbtBase64 = psbt.toBase64();
    this.logExtensionPreSignDiagnostics(psbt, selectedUtxos, prevOuts);
    
    const psbtId = `psbt-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.currentSession.set({
      psbtId,
      psbt: psbtBase64,
      status: 'creating',
      createdAt: Date.now(),
      recipientAddress,
      amountSats,
      feeSats: actualFee
    });

    return { psbtBase64, feeSats: actualFee, psbtId, utxosJson, changeAddress: changeAddr?.address || '' };
  }

  /**
   * Estimate transaction size in vBytes
   */
  private estimateTransactionSize(numInputs: number, numOutputs: number): number {
    // Rough estimation for P2WPKH inputs and outputs
    const baseSize = 10; // version, locktime, etc.
    const inputSize = 68; // per input (witness)
    const outputSize = 31; // per output
    
    return baseSize + (numInputs * inputSize) + (numOutputs * outputSize);
  }

  /**
   * Request a native (PSBT-less) MPC send: this device's paired mobile wallet performs
   * the actual DKLS keysign with its own committee peer and broadcasts the transaction
   * itself. This initiation path is strictly airgapped from the extension side: we only
   * encode/send details via QR, and never push COSIGN_REQUEST over Nostr from Chrome.
   * Building/sending a PSBT here instead would make the mobile side treat this watch-only
   * request as an externally co-signed PSBT needing a further peer-to-peer QR handoff
   * (see `requestSigning`).
   */
  async requestNativeSend(params: CreatePsbtParams): Promise<{ psbtId: string; qrDataUrl: string }> {
    const wallet = get(walletStore);

    const { recipientAddress, amountSats, feeRate = 5 } = params;
    const estimatedFee = Math.ceil(this.estimateTransactionSize(1, 2) * feeRate);
    const psbtId = `send-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Always generate a scannable fallback QR up front so the user has a manual path
    // if the concurrent Nostr push fails or no relay connects in time.
    const addressType = wallet.hdState?.addressType || 'segwit-native';
    // Mobile needs the full path (not just the account level) to derive the exact
    // pubkey for this keyshare during MPC signing.
    const derivationPath = getCurrentReceiveAddress()?.path || '';
    const network = await this.resolveSessionNetwork();
    const { dataUrl: qrDataUrl } = await qr.generateSendQR(
      recipientAddress,
      amountSats,
      estimatedFee,
      '',
      addressType,
      derivationPath,
      network,
      '',
      '',
      psbtId,
    );

    this.currentSession.set({
      psbtId,
      psbt: '',
      status: 'awaiting_signature',
      createdAt: Date.now(),
      recipientAddress,
      amountSats,
      feeSats: estimatedFee,
      deliveryMode: 'qr',
      nostrState: 'idle',
    });

    return { psbtId, qrDataUrl };
  }

  /**
   * Request mobile device to sign PSBT via QR code
   */
  async requestSigning(psbtBase64: string): Promise<string> {
    const session = get(this.currentSession);
    
    if (!session) {
      throw new Error('No active PSBT session');
    }

    const outbound = this.buildPsbtDebugSnapshot(psbtBase64);
    console.warn('[PSBT_SIGN_DEBUG][EXT][OUTBOUND]', {
      txId: session.psbtId,
      base64Len: outbound.base64.length,
      hexLen: outbound.hex.length,
      sha256Hex: outbound.sha256Hex,
      base64Head: outbound.base64.slice(0, 32),
      base64Tail: outbound.base64.slice(-32),
      hexHead: outbound.hex.slice(0, 64),
      hexTail: outbound.hex.slice(-64),
    });

    this.currentSession.update(s => s ? {
      ...s,
      status: 'awaiting_signature',
      deliveryMode: 'qr',
      nostrState: 'idle',
    } : null);

    const wallet = get(walletStore);
    const pairedNostrNpub = (wallet.pairedNostrNpub || '').trim();

    if (pairedNostrNpub) {
      this.currentSession.update(s => s ? {
        ...s,
        deliveryMode: 'nostr+qr',
        nostrState: 'pending',
      } : null);
      void this.tryNostrCoSignDelivery(pairedNostrNpub, outbound.base64, session.psbtId);
    }

    // Keep QR as the universal fallback path.
    await qr.generatePsbtQR(outbound.base64);

    console.log('[PSBT] QR code generated. Nostr delivery state:', pairedNostrNpub ? 'pending' : 'disabled');

    return session.psbtId;
  }

  private async resolveSessionNetwork(): Promise<'mainnet' | 'testnet' | 'testnet4'> {
    const wallet = get(walletStore);
    if (wallet.network === 'mainnet') {
      return 'mainnet';
    }
    const variant = await storage.get<'testnet' | 'testnet4'>('testnetApiVariant');
    return variant === 'testnet4' ? 'testnet4' : 'testnet';
  }

  private async tryNostrCoSignDelivery(recipientNpub: string, psbtBase64: string, txId: string): Promise<void> {
    try {
      await nostrMessaging.connect();

      const wallet = get(walletStore);
      const network = await this.resolveSessionNetwork();
      const snapshot = this.buildPsbtDebugSnapshot(psbtBase64);
      const psbtHex = nostrMessaging.psbtBase64ToHex(snapshot.base64);
      const roundTripBase64 = nostrMessaging.psbtHexToBase64(psbtHex);
      const roundTripSnapshot = this.buildPsbtDebugSnapshot(roundTripBase64);

      console.warn('[PSBT_SIGN_DEBUG][EXT][SERDE]', {
        txId,
        outboundSha256Hex: snapshot.sha256Hex,
        roundTripSha256Hex: roundTripSnapshot.sha256Hex,
        base64Equal: snapshot.base64 === roundTripSnapshot.base64,
        hexEqual: snapshot.hex === roundTripSnapshot.hex,
      });

      if (snapshot.hex !== roundTripSnapshot.hex) {
        throw new Error('PSBT serialization mismatch before Nostr delivery (base64<->hex round-trip changed bytes)');
      }

      const payload: CoSignRequestPayload = {
        txId,
        psbtHex,
        psbtBase64: snapshot.base64,
        amountSats: Number(get(this.currentSession)?.amountSats || 0),
        feeSats: Number(get(this.currentSession)?.feeSats || 0),
        recipientAddress: String(get(this.currentSession)?.recipientAddress || ''),
        network,
        requestMode: 'psbt',
      };

      const senderFingerprint = keyshareFingerprint(wallet.publicKey);
      const nip46Secret = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
      const requestId = `nip46-sign-${txId}-${Date.now()}`;

      let signedPsbtBase64 = '';

      try {
        await nostrMessaging.sendNip46Connect(recipientNpub, nip46Secret, ['sign_event']);

        const signEventPayload = {
          kind: 24133,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['x', 'bold-nip46-v1'],
            ['txid', txId],
            ['psbt_base64', psbtBase64],
            ['psbt', payload.psbtHex],
          ],
          content: JSON.stringify(payload),
        };

        await nostrMessaging.sendNip46SignEvent(
          recipientNpub,
          signEventPayload,
          nip46Secret,
          requestId,
        );

        const incomingNip46 = await nostrMessaging.waitForNip46Response(requestId, 45000);
        if (incomingNip46.response.error) {
          throw new Error(incomingNip46.response.error);
        }

        const result = incomingNip46.response.result;
        if (result && typeof result === 'object') {
          const r = result as { signedPsbtBase64?: string; signedPsbtHex?: string };
          signedPsbtBase64 =
            (r.signedPsbtBase64 || '').trim() ||
            (r.signedPsbtHex ? nostrMessaging.psbtHexToBase64(r.signedPsbtHex) : '');
        } else if (typeof result === 'string') {
          signedPsbtBase64 = result;
        }
      } catch (nip46Err) {
        console.warn('[PSBT] NIP-46 path failed, falling back to legacy flow:', nip46Err);

        if (!ENABLE_LEGACY_COSIGN_FALLBACK) {
          throw nip46Err;
        }

        await nostrMessaging.sendCoSignRequest(
          recipientNpub,
          senderFingerprint,
          'mobile-wallet',
          payload,
        );

        const incoming = await nostrMessaging.waitForCoSignResponse(txId, 45000);
        const response = incoming.envelope.payload as CoSignResponsePayload;
        if (!response.approved) {
          this.currentSession.update(s =>
            s
              ? {
                  ...s,
                  nostrState: 'failed',
                  error: response.reason || 'Peer rejected co-sign request over Nostr',
                }
              : null,
          );
          return;
        }

        signedPsbtBase64 = response.signedPsbtBase64
          ? response.signedPsbtBase64
          : response.signedPsbtHex
          ? nostrMessaging.psbtHexToBase64(response.signedPsbtHex)
          : '';
      }

      if (!signedPsbtBase64) {
        this.currentSession.update(s =>
          s
            ? {
                ...s,
                nostrState: 'failed',
                error: 'Nostr response did not include a signed PSBT payload',
              }
            : null,
        );
        return;
      }

      this.currentSession.update(s => (s ? { ...s, nostrState: 'delivered' } : null));
      this.handleSignedPsbt(signedPsbtBase64);
      await this.broadcastTransaction();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = /timed out/i.test(message);
      this.currentSession.update(s =>
        s
          ? {
              ...s,
              nostrState: timedOut ? 'timeout' : 'failed',
            }
          : null,
      );
      console.warn('[PSBT] Nostr co-sign delivery failed:', message);
    }
  }

  /**
   * Handle signed PSBT received via QR scan
   */
  handleSignedPsbt(signedPsbtBase64: string) {
    console.log('[PSBT] Received signed PSBT via QR');
    
    this.currentSession.update((s): PsbtSession | null => {
      if (s && s.status === 'awaiting_signature') {
        return {
          ...s,
          psbt: signedPsbtBase64,
          status: 'signed'
        };
      }
      return s;
    });
  }

  /**
   * Extract final transaction and broadcast
   */
  async broadcastTransaction(): Promise<string> {
    const session = get(this.currentSession);
    
    if (!session || session.status !== 'signed') {
      throw new Error('No signed PSBT available for broadcasting');
    }

    console.log('[PSBT] Extracting and broadcasting transaction');

    this.currentSession.update(s => s ? { ...s, status: 'broadcasting' } : null);

    try {
      // Parse the signed PSBT
      const psbt = bitcoin.Psbt.fromBase64(session.psbt);
      
      // Finalize all inputs
      psbt.finalizeAllInputs();
      
      // Extract final transaction
      const tx = psbt.extractTransaction();
      const txHex = tx.toHex();
      
      console.log('[PSBT] Transaction hex:', txHex.substring(0, 100) + '...');
      
      // Broadcast using mempool.space API
      const txid = await blockchain.broadcastTransaction(txHex);
      
      this.currentSession.update((s): PsbtSession | null => {
        if (!s) return null;
        return {
          ...s,
          status: 'broadcasted',
          txid
        };
      });

      // Persist any Branta merchant metadata alongside this transaction so it
      // can be rendered in the transaction history.
      if (session.brantaMerchant) {
        await this.setTransactionMetadata(txid, { brantaMerchant: session.brantaMerchant });
      }

      console.log('[PSBT] Transaction broadcasted:', txid);
      return txid;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Broadcast failed';
      
      this.currentSession.update((s): PsbtSession | null => {
        if (!s) return null;
        return {
          ...s,
          status: 'failed',
          error: errorMessage
        };
      });
      
      console.error('[PSBT] Broadcast error:', error);
      throw error;
    }
  }

  /**
   * Clear current session
   */
  clearSession() {
    this.currentSession.set(null);
  }

  /**
   * Attach Branta merchant metadata to the active session so it can be persisted
   * with the transaction once it is broadcast.
   */
  setBrantaMerchant(merchant: BrantaMerchant | null) {
    this.currentSession.update(s => s && merchant ? { ...s, brantaMerchant: merchant } : s);
  }

  /**
   * Persist metadata for a specific transaction.
   */
  private async setTransactionMetadata(
    txid: string,
    metadata: { brantaMerchant?: BrantaMerchant },
  ): Promise<void> {
    try {
      const raw = await storage.get<string>('txMetadata');
      const existing: Record<string, { brantaMerchant?: BrantaMerchant }> = raw
        ? JSON.parse(raw)
        : {};
      existing[txid] = {...existing[txid], ...metadata};
      await storage.set('txMetadata', JSON.stringify(existing));
    } catch (err) {
      console.warn('[PSBT] Failed to persist transaction metadata', err);
    }
  }

  /**
   * Get current session
   */
  getSession(): PsbtSession | null {
    return get(this.currentSession);
  }
}

export const psbt = new PsbtService();
