/**
 * PSBT (Partially Signed Bitcoin Transaction) Service
 * Handles transaction creation and signing coordination with mobile devices
 */

import * as bitcoin from 'bitcoinjs-lib';
import { Point, getPublicKey, sign as ecdsaSign, verify as ecdsaVerify, schnorr, etc, hashes } from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { writable, get } from 'svelte/store';
import { walletStore } from '../stores/wallet';
import { blockchain } from './blockchain';
import { qr } from './qr';

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
}

export interface CreatePsbtParams {
  recipientAddress: string;
  amountSats: number;
  feeRate?: number; // sats per vByte
}

class PsbtService {
  private currentSession = writable<PsbtSession | null>(null);
  public session = { subscribe: this.currentSession.subscribe };

  /**
   * Create a PSBT for spending Bitcoin
   */
  async createPsbt(params: CreatePsbtParams): Promise<{ psbtBase64: string; feeSats: number; psbtId: string }> {
    const { recipientAddress, amountSats, feeRate = 5 } = params;

    console.log('[PSBT] Creating PSBT:', {
      recipient: recipientAddress,
      amount: amountSats,
      feeRate
    });

    const wallet = get(walletStore);
    if (!wallet.address) {
      throw new Error('No active wallet address');
    }

    const network = wallet.network === 'testnet' 
      ? bitcoin.networks.testnet 
      : bitcoin.networks.bitcoin;

    // Fetch UTXOs for the current address
    const utxos = await blockchain.getUTXOs(wallet.address);
    if (!utxos || utxos.length === 0) {
      throw new Error('No UTXOs available for spending');
    }

    console.log('[PSBT] Found', utxos.length, 'UTXOs');

    // Create PSBT
    const psbt = new bitcoin.Psbt({ network });

    // Select UTXOs to cover amount + estimated fee
    const estimatedSize = 250; // Rough estimate for 1-in, 2-out transaction
    const estimatedFee = Math.ceil(estimatedSize * feeRate);
    const targetAmount = amountSats + estimatedFee;

    let totalInput = 0;
    const selectedUtxos: UTXO[] = [];

    // Simple UTXO selection - use largest first
    const sortedUtxos = [...utxos].sort((a, b) => b.value - a.value);
    
    for (const utxo of sortedUtxos) {
      if (totalInput >= targetAmount) break;
      
      selectedUtxos.push(utxo);
      totalInput += utxo.value;

      // Fetch the full transaction hex for this UTXO
      const txHex = await blockchain.getTransactionHex(utxo.txid);
      
      // Add input to PSBT (use browser-friendly Uint8Array from hex)
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

    // Calculate actual fee based on selected inputs
    const actualSize = this.estimateTransactionSize(selectedUtxos.length, 2);
    const actualFee = Math.ceil(actualSize * feeRate);
    const changeAmount = totalInput - amountSats - actualFee;

    // Add recipient output
    psbt.addOutput({
      address: recipientAddress,
      value: amountSats,
    });

    // Add change output if significant (> dust threshold)
    if (changeAmount > 546) {
      psbt.addOutput({
        address: wallet.address,
        value: changeAmount,
      });
    }

    console.log('[PSBT] Transaction details:', {
      inputs: selectedUtxos.length,
      totalInput,
      recipient: amountSats,
      change: changeAmount,
      fee: actualFee,
      feeRate
    });

    const psbtBase64 = psbt.toBase64();
    
    // Create session
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

    return { psbtBase64, feeSats: actualFee, psbtId };
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
   * Request mobile device to sign PSBT via QR code
   */
  async requestSigning(psbtBase64: string): Promise<string> {
    const session = get(this.currentSession);
    
    if (!session) {
      throw new Error('No active PSBT session');
    }

    this.currentSession.update(s => s ? { ...s, status: 'awaiting_signature' } : null);

    // Generate QR code for mobile to scan
    await qr.generatePsbtQR(psbtBase64);
    
    console.log('[PSBT] QR code generated - waiting for mobile to scan and sign');

    return session.psbtId;
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
   * Get current session
   */
  getSession(): PsbtSession | null {
    return get(this.currentSession);
  }
}

export const psbt = new PsbtService();
