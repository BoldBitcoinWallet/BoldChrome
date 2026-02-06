/**
 * HD Wallet Service
 * Handles BIP32/BIP44/BIP84 address derivation from extended public key
 */

import * as bitcoin from 'bitcoinjs-lib';
import { Point, getPublicKey, sign as ecdsaSign, verify as ecdsaVerify, schnorr, etc, hashes } from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import BIP32Factory, { type BIP32Interface } from 'bip32';

// Set up sync hashes for @noble/secp256k1
hashes.sha256 = (msg: Uint8Array) => sha256(msg);
hashes.hmacSha256 = (key: Uint8Array, msg: Uint8Array) => hmac(sha256, key, msg);

// Utility: convert hex string to Uint8Array (browser-friendly substitute for Buffer.from(hex, 'hex'))
function hexToU8(hex: string): Uint8Array {
  const clean = (hex || '').replace(/^0x/, '').replace(/\s+/g, '');
  const len = Math.ceil(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const byte = clean.substr(i * 2, 2);
    out[i] = parseInt(byte || '00', 16);
  }
  return out;
}

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
  xOnlyPointAddTweak: (p: Uint8Array, tweak: Uint8Array): { parity: 0 | 1; xOnlyPubkey: Uint8Array } | null => {
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
      const parity = (affine.y % 2n === 0n ? 0 : 1) as 0 | 1;
      
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

// Lazy initialization
let eccInitialized = false;
function ensureEccInitialized() {
  if (eccInitialized) return;
  console.log('[ECC] Initializing ecc library...');
  console.log('[ECC] Testing ecc methods:');
  try {
    // Test key methods before validation
    const testPriv = new Uint8Array(32).fill(1);
    testPriv[31] = 1; // Valid private key
    const testPub = ecc.pointFromScalar(testPriv, true);
    console.log('[ECC] pointFromScalar:', testPub?.length, 'bytes');
    const testAdd = ecc.privateAdd(testPriv, testPriv);
    console.log('[ECC] privateAdd:', testAdd?.length, 'bytes');
    const testNeg = ecc.privateNegate(testPriv);
    console.log('[ECC] privateNegate:', testNeg?.length, 'bytes');
    
    bitcoin.initEccLib(ecc);
    console.log('[ECC] ✓ ecc library initialized successfully');
    eccInitialized = true;
  } catch (error) {
    console.error('[ECC] ✗ Failed to initialize ecc library:', error);
    console.error('[ECC] Error details:', error instanceof Error ? error.stack : error);
    throw new Error(`ecc library initialization failed: ${error}`);
  }
}

// Initialize on first module load
ensureEccInitialized();

// Create BIP32 factory
const bip32 = BIP32Factory(ecc);

export interface DerivedAddress {
  address: string;
  path: string;
  index: number;
  type: 'legacy' | 'segwit-nested' | 'segwit-native';
}

export interface HDWalletConfig {
  publicKey: string; // Extended public key (base58)
  chainCode: string; // Chain code in hex
  network: 'mainnet' | 'testnet';
}

class HDWalletService {
  /**
   * Derive addresses from extended public key
   */
  deriveAddresses(
    config: HDWalletConfig,
    addressType: 'legacy' | 'segwit-nested' | 'segwit-native',
    count: number = 20,
    startIndex: number = 0
  ): DerivedAddress[] {
    const network = config.network === 'mainnet' 
      ? bitcoin.networks.bitcoin 
      : bitcoin.networks.testnet;

    // Get the base derivation path based on address type
    const basePath = this.getBasePath(addressType);
    
    const addresses: DerivedAddress[] = [];

    try {
      // Parse public key and chain code to create BIP32 node
      const pubKeyBuffer = hexToU8(config.publicKey);
      const chainCodeBuffer = hexToU8(config.chainCode);
      
      // Create root node from public key and chain code
      const node = bip32.fromPublicKey(pubKeyBuffer, chainCodeBuffer, network);

      for (let i = startIndex; i < startIndex + count; i++) {
        // Derive child key at index i
        // Path is relative to the root we created (which is already at m/44'/0'/0' or similar)
        const child = node.derive(0).derive(i); // External chain (0), then address index
        
        const address = this.getAddress(child, addressType, network);
        
        addresses.push({
          address,
          path: `${basePath}/0/${i}`,
          index: i,
          type: addressType
        });
      }
    } catch (error) {
      console.error('[HD Wallet] Derivation error:', error);
      throw new Error(`Failed to derive addresses: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return addresses;
  }

  /**
   * Derive a single address at specific index
   */
  deriveAddress(
    config: HDWalletConfig,
    addressType: 'legacy' | 'segwit-nested' | 'segwit-native',
    index: number
  ): DerivedAddress {
    const addresses = this.deriveAddresses(config, addressType, 1, index);
    return addresses[0];
  }

  /**
   * Get base derivation path for address type (BIP44/49/84)
   */
  private getBasePath(addressType: 'legacy' | 'segwit-nested' | 'segwit-native'): string {
    switch (addressType) {
      case 'legacy':
        return "m/44'/0'/0'"; // BIP44
      case 'segwit-nested':
        return "m/49'/0'/0'"; // BIP49
      case 'segwit-native':
        return "m/84'/0'/0'"; // BIP84
    }
  }

  /**
   * Generate address from BIP32 node based on type
   */
  private getAddress(
    node: BIP32Interface,
    addressType: 'legacy' | 'segwit-nested' | 'segwit-native',
    network: bitcoin.Network
  ): string {
    const pubkey = node.publicKey;

    switch (addressType) {
      case 'legacy': {
        // P2PKH (1...)
        const { address } = bitcoin.payments.p2pkh({ pubkey, network });
        if (!address) throw new Error('Failed to generate legacy address');
        return address;
      }
      
      case 'segwit-nested': {
        // P2SH-P2WPKH (3...)
        const { address } = bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({ pubkey, network }),
          network
        });
        if (!address) throw new Error('Failed to generate nested segwit address');
        return address;
      }
      
      case 'segwit-native': {
        // P2WPKH (bc1...)
        const { address } = bitcoin.payments.p2wpkh({ pubkey, network });
        if (!address) throw new Error('Failed to generate native segwit address');
        return address;
      }
    }
  }

  /**
   * Derive multiple address types at once
   */
  deriveAllTypes(
    config: HDWalletConfig,
    countPerType: number = 5
  ): {
    legacy: DerivedAddress[];
    segwitNested: DerivedAddress[];
    segwitNative: DerivedAddress[];
  } {
    return {
      legacy: this.deriveAddresses(config, 'legacy', countPerType),
      segwitNested: this.deriveAddresses(config, 'segwit-nested', countPerType),
      segwitNative: this.deriveAddresses(config, 'segwit-native', countPerType)
    };
  }
}

export const hdWallet = new HDWalletService();
