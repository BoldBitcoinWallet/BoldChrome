/**
 * Blockchain Service
<<<<<<< HEAD
 * Fetches Bitcoin blockchain data from mempool.space API
 */

import { writable } from 'svelte/store';
=======
 * Fetches Bitcoin blockchain data via Esplora-compatible API (default mempool.space).
 * HTTP layer: mempoolClient (cache, dedup, optional failover).
 */

import { mempoolClient } from './mempoolClient';
import { normalizeMempoolApiRoot } from './mempoolApiBase';
import {
  DEFAULT_MAINNET_MEMPOOL_API_BASE,
  MAINNET_PUBLIC_MEMPOOL_MIRROR_ROOTS,
} from '../constants/mempoolPublicHosts';
>>>>>>> origin/main

export interface UTXO {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

export interface Transaction {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_address: string;
      scriptpubkey_type: string;
      value: number;
    };
    scriptsig: string;
    witness?: string[];
    is_coinbase: boolean;
    sequence: number;
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_address: string;
    scriptpubkey_type: string;
    value: number;
  }>;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

export interface AddressStats {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

export interface FeeEstimate {
<<<<<<< HEAD
  [blocks: string]: number; // blocks as key, fee rate as value
=======
  [blocks: string]: number;
>>>>>>> origin/main
}

/** Mempool.space /v1/fees/recommended response (sat/vB). */
export interface RecommendedFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee?: number;
  minimumFee?: number;
}

<<<<<<< HEAD
const DEFAULT_MAINNET_API = 'https://mempool.space/api';
const DEFAULT_TESTNET_API = 'https://mempool.space/testnet/api';
const FETCH_TIMEOUT_MS = 5000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId)
  );
}

class BlockchainService {
  private baseUrl = DEFAULT_MAINNET_API;
  private testnetUrl = DEFAULT_TESTNET_API;
  private network: 'mainnet' | 'testnet' = 'mainnet';

  // Cache
  private addressCache = new Map<string, { data: AddressStats; timestamp: number }>();
  private txCache = new Map<string, { data: Transaction; timestamp: number }>();
  private utxoCache = new Map<string, { data: UTXO[]; timestamp: number }>();
  private readonly CACHE_TTL = 30000; // 30 seconds

  setNetwork(network: 'mainnet' | 'testnet') {
    this.network = network;
    console.log(`[Blockchain] Network set to ${network}`);
  }

  /**
   * Set mainnet mempool API base URL. Pass '' or null to use default mempool.space.
   */
=======
const DEFAULT_MAINNET_API = DEFAULT_MAINNET_MEMPOOL_API_BASE;
const DEFAULT_TESTNET_API = 'https://mempool.space/testnet/api';
const FETCH_TIMEOUT_MS = 5000;

/** Minimum pause between uncached Esplora address calls (stats / utxo / txs). */
const ESPLORA_INTER_REQUEST_GAP_MS = 320;

const RATE_LIMIT_DEFAULT_BACKOFF_MS = 5_000;
const MAX_429_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function userFacingHttpError(status: number, apiKind: string): string {
  if (status === 429) {
    return `Too many requests (${apiKind}): explorer API asked us to slow down (HTTP 429). Wait a minute, then retry — or switch to your own mempool/explorer URL under settings if this keeps happening.`;
  }
  if (status === 503 || status === 502) {
    return `Explorer (${apiKind}) is temporarily unavailable (HTTP ${status}). Try again in a moment.`;
  }
  return `Explorer API (${apiKind}) failed (HTTP ${status}).`;
}

class BlockchainService {
  private baseUrl: string = DEFAULT_MAINNET_API;
  private testnetUrl = DEFAULT_TESTNET_API;
  private network: 'mainnet' | 'testnet' = 'mainnet';

  private exploraConcurrencyChain: Promise<void> = Promise.resolve();
  private exploraLastRequestDoneAt = 0;

  constructor() {
    this.syncPublicHostsFromBaseUrl();
  }

  /** Default mainnet pool: BoldWallet mirror list enables MempoolClient failover. Custom host stays single-origin (privacy). */
  private syncPublicHostsFromBaseUrl(): void {
    if (this.network === 'testnet') {
      mempoolClient.setPublicBases([]);
      return;
    }

    const userRoot = normalizeMempoolApiRoot(this.baseUrl);
    const defaultRoot = normalizeMempoolApiRoot(DEFAULT_MAINNET_API);

    if (
      userRoot &&
      defaultRoot &&
      userRoot.toLowerCase() === defaultRoot.toLowerCase()
    ) {
      mempoolClient.setPublicBases([...MAINNET_PUBLIC_MEMPOOL_MIRROR_ROOTS]);
      return;
    }

    mempoolClient.setPublicBases(userRoot ? [userRoot] : []);
  }

  private async withExploraAddressSerialized<T>(
    worker: () => Promise<T>,
  ): Promise<T> {
    const prev = this.exploraConcurrencyChain;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    this.exploraConcurrencyChain = gate;
    await prev;

    if (this.exploraLastRequestDoneAt > 0) {
      const gap = Math.max(
        0,
        ESPLORA_INTER_REQUEST_GAP_MS -
          (Date.now() - this.exploraLastRequestDoneAt),
      );
      if (gap > 0) await sleep(gap);
    }

    try {
      return await worker();
    } finally {
      this.exploraLastRequestDoneAt = Date.now();
      release();
    }
  }

  /**
   * Serialized Esplora address calls + 429 retries with backoff outside the mutex
   * (never sleep inside withExploraAddressSerialized).
   */
  private async fetchJsonEsploraWith429Retries<T>(
    url: string,
    apiKind: string,
  ): Promise<T> {
    let lastStatus = 0;
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      const res = await this.withExploraAddressSerialized(() =>
        mempoolClient.get<T>(url, { timeoutMs: FETCH_TIMEOUT_MS }),
      );

      if (res.ok) {
        return res.data;
      }

      lastStatus = res.status;

      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        const waitMs =
          res.retryAfterSeconds != null
            ? Math.min(120_000, Math.max(500, res.retryAfterSeconds * 1000))
            : RATE_LIMIT_DEFAULT_BACKOFF_MS;
        console.warn(
          `[Blockchain] ${apiKind} rate limited (429), waiting ${waitMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`,
        );
        await sleep(waitMs);
        continue;
      }

      throw new Error(userFacingHttpError(res.status, apiKind));
    }
    throw new Error(userFacingHttpError(lastStatus, apiKind));
  }

  setNetwork(network: 'mainnet' | 'testnet') {
    this.network = network;
    this.syncPublicHostsFromBaseUrl();
    console.log(`[Blockchain] Network set to ${network}`);
  }

>>>>>>> origin/main
  setMempoolMainnet(url: string | null | undefined): void {
    if (url && url.trim() !== '') {
      this.baseUrl = url.trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '') + '/api';
    } else {
      this.baseUrl = DEFAULT_MAINNET_API;
    }
    this.clearCache();
<<<<<<< HEAD
    console.log('[Blockchain] Mainnet API set to', this.baseUrl);
  }

  /** Human-readable provider label for UI (e.g. "mempool.space" or hostname). */
=======
    this.syncPublicHostsFromBaseUrl();
    console.log('[Blockchain] Mainnet API set to', this.baseUrl);
  }

>>>>>>> origin/main
  getMempoolDisplayName(): string {
    try {
      const u = this.network === 'testnet' ? this.testnetUrl : this.baseUrl;
      const url = new URL(u.replace(/\/api\/?$/, ''));
      return url.hostname || 'mempool.space';
    } catch {
      return 'mempool.space';
    }
  }

  private getBaseUrl(): string {
    return this.network === 'testnet' ? this.testnetUrl : this.baseUrl;
  }

<<<<<<< HEAD
  /**
   * Fetch address statistics
   */
  async getAddressStats(address: string): Promise<AddressStats> {
    // Check cache
    const cached = this.addressCache.get(address);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log('[Blockchain] Using cached address stats');
      return cached.data;
    }

    console.log('[Blockchain] Fetching address stats:', address);
    const url = `${this.getBaseUrl()}/address/${address}`;

    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache the result
      this.addressCache.set(address, { data, timestamp: Date.now() });
      
      return data;
=======
  async getAddressStats(address: string): Promise<AddressStats> {
    console.log('[Blockchain] Fetching address stats:', address);
    const url = `${this.getBaseUrl()}/address/${address}`;
    try {
      return await this.fetchJsonEsploraWith429Retries<AddressStats>(
        url,
        'address stats',
      );
>>>>>>> origin/main
    } catch (error) {
      console.error('[Blockchain] Error fetching address stats:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  /**
   * Get address balance in satoshis
   */
=======
>>>>>>> origin/main
  async getBalance(address: string): Promise<{
    confirmed: number;
    unconfirmed: number;
    total: number;
  }> {
    const stats = await this.getAddressStats(address);
<<<<<<< HEAD
    
    const confirmed = stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
    const unconfirmed = stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum;
    
    return {
      confirmed,
      unconfirmed,
      total: confirmed + unconfirmed
    };
  }

  /**
   * Fetch UTXOs for an address
   */
  async getUTXOs(address: string): Promise<UTXO[]> {
    // Check cache
    const cached = this.utxoCache.get(address);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log('[Blockchain] Using cached UTXOs');
      return cached.data;
    }

    console.log('[Blockchain] Fetching UTXOs for:', address);
    const url = `${this.getBaseUrl()}/address/${address}/utxo`;

    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache the result
      this.utxoCache.set(address, { data, timestamp: Date.now() });
      
      return data;
=======

    const confirmed =
      stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
    const unconfirmed =
      stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum;

    return {
      confirmed,
      unconfirmed,
      total: confirmed + unconfirmed,
    };
  }

  async getUTXOs(address: string): Promise<UTXO[]> {
    console.log('[Blockchain] Fetching UTXOs for:', address);
    const url = `${this.getBaseUrl()}/address/${address}/utxo`;
    try {
      return await this.fetchJsonEsploraWith429Retries<UTXO[]>(url, 'UTXOs');
>>>>>>> origin/main
    } catch (error) {
      console.error('[Blockchain] Error fetching UTXOs:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  /**
   * Fetch transactions for an address
   */
  async getTransactions(address: string, afterTxid?: string): Promise<Transaction[]> {
    console.log('[Blockchain] Fetching transactions for:', address);
    
=======
  async getTransactions(
    address: string,
    afterTxid?: string,
  ): Promise<Transaction[]> {
    console.log('[Blockchain] Fetching transactions for:', address);

>>>>>>> origin/main
    let url = `${this.getBaseUrl()}/address/${address}/txs`;
    if (afterTxid) {
      url += `/chain/${afterTxid}`;
    }

    try {
<<<<<<< HEAD
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
=======
      return await this.fetchJsonEsploraWith429Retries<Transaction[]>(
        url,
        'transactions',
      );
>>>>>>> origin/main
    } catch (error) {
      console.error('[Blockchain] Error fetching transactions:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  /**
   * Fetch a specific transaction
   */
  async getTransaction(txid: string): Promise<Transaction> {
    // Check cache
    const cached = this.txCache.get(txid);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log('[Blockchain] Using cached transaction');
      return cached.data;
    }

    console.log('[Blockchain] Fetching transaction:', txid);
    const url = `${this.getBaseUrl()}/tx/${txid}`;

    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache the result
      this.txCache.set(txid, { data, timestamp: Date.now() });
      
      return data;
=======
  async getTransaction(txid: string): Promise<Transaction> {
    console.log('[Blockchain] Fetching transaction:', txid);
    const url = `${this.getBaseUrl()}/tx/${txid}`;
    try {
      const res = await mempoolClient.get<Transaction>(url, {
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.data;
>>>>>>> origin/main
    } catch (error) {
      console.error('[Blockchain] Error fetching transaction:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  /**
   * Get transaction hex (raw transaction data)
   */
  async getTransactionHex(txid: string): Promise<string> {
    console.log('[Blockchain] Fetching transaction hex:', txid);
    const url = `${this.getBaseUrl()}/tx/${txid}/hex`;

    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const hex = await response.text();
      return hex;
=======
  async getTransactionHex(txid: string): Promise<string> {
    console.log('[Blockchain] Fetching transaction hex:', txid);
    const url = `${this.getBaseUrl()}/tx/${txid}/hex`;
    try {
      const res = await mempoolClient.getText(url, { timeoutMs: FETCH_TIMEOUT_MS });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.data;
>>>>>>> origin/main
    } catch (error) {
      console.error('[Blockchain] Error fetching transaction hex:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  /**
   * Get recommended fee estimates (economy, 1hr, 30m, fast) in sat/vB.
   */
  async getFeeEstimates(): Promise<RecommendedFees> {
    console.log('[Blockchain] Fetching fee estimates');
    const url = `${this.getBaseUrl()}/v1/fees/recommended`;

    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[Blockchain] Fee estimates:', data);
      return data as RecommendedFees;
=======
  async getFeeEstimates(): Promise<RecommendedFees> {
    console.log('[Blockchain] Fetching fee estimates');
    const url = `${this.getBaseUrl()}/v1/fees/recommended`;
    try {
      const res = await mempoolClient.get<RecommendedFees>(url, {
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      console.log('[Blockchain] Fee estimates:', res.data);
      return res.data;
>>>>>>> origin/main
    } catch (error) {
      console.error('[Blockchain] Error fetching fee estimates:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  /**
   * Broadcast a raw transaction
   */
  async broadcastTransaction(txHex: string): Promise<string> {
    console.log('[Blockchain] Broadcasting transaction');
    const url = `${this.getBaseUrl()}/tx`;

    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: txHex
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Broadcast failed: ${errorText}`);
      }

      const txid = await response.text();
      console.log('[Blockchain] Transaction broadcasted:', txid);
      
=======
  async broadcastTransaction(txHex: string): Promise<string> {
    console.log('[Blockchain] Broadcasting transaction');
    const url = `${this.getBaseUrl()}/tx`;
    try {
      const res = await mempoolClient.postPlain(url, txHex, {
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!res.ok) {
        throw new Error(`Broadcast failed: ${res.data || res.status}`);
      }
      const txid = res.data;
      console.log('[Blockchain] Transaction broadcasted:', txid);
>>>>>>> origin/main
      return txid;
    } catch (error) {
      console.error('[Blockchain] Error broadcasting transaction:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  /**
   * Get current block height
   */
  async getBlockHeight(): Promise<number> {
    console.log('[Blockchain] Fetching block height');
    const url = `${this.getBaseUrl()}/blocks/tip/height`;

    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const height = await response.json();
=======
  async getBlockHeight(): Promise<number> {
    console.log('[Blockchain] Fetching block height');
    const url = `${this.getBaseUrl()}/blocks/tip/height`;
    try {
      const res = await mempoolClient.getText(url, { timeoutMs: FETCH_TIMEOUT_MS });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const height = parseInt(res.data.trim(), 10);
      if (Number.isNaN(height)) {
        throw new Error('Invalid block height response');
      }
>>>>>>> origin/main
      return height;
    } catch (error) {
      console.error('[Blockchain] Error fetching block height:', error);
      throw error;
    }
  }

<<<<<<< HEAD
  /**
   * Get Bitcoin price in USD (single rate for backward compatibility)
   */
=======
>>>>>>> origin/main
  async getBitcoinPrice(): Promise<number> {
    const rates = await this.getBitcoinPrices();
    return rates.USD ?? 0;
  }

<<<<<<< HEAD
  /**
   * Get Bitcoin prices in multiple currencies (USD, EUR, GBP, etc.)
   */
  async getBitcoinPrices(): Promise<Record<string, number>> {
    const url = `${this.getBaseUrl()}/v1/prices`;

    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      // API returns { time, USD, EUR, GBP, ... }; drop 'time'
      const rates: Record<string, number> = {};
      for (const [k, v] of Object.entries(data)) {
        if (k !== 'time' && typeof v === 'number') rates[k] = v;
      }
      return Object.keys(rates).length ? rates : { USD: 0 };
    } catch (error) {
      console.error('[Blockchain] Error fetching Bitcoin prices:', error);
      try {
        const fallback = await fetchWithTimeout('https://api.coinbase.com/v2/prices/BTC-USD/spot');
        const fallbackData = await fallback.json();
        const usd = parseFloat(fallbackData?.data?.amount ?? 0);
        return usd ? { USD: usd } : {};
      } catch {
        return {};
      }
    }
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.addressCache.clear();
    this.txCache.clear();
    this.utxoCache.clear();
=======
  async getBitcoinPrices(): Promise<Record<string, number>> {
    const url = `${this.getBaseUrl()}/v1/prices`;
    try {
      const res = await mempoolClient.get<Record<string, unknown>>(url, {
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (res.ok) {
        const rates: Record<string, number> = {};
        for (const [k, v] of Object.entries(res.data)) {
          if (k !== 'time' && typeof v === 'number') rates[k] = v;
        }
        if (Object.keys(rates).length) {
          return rates;
        }
      }
    } catch (error) {
      console.error('[Blockchain] Error fetching Bitcoin prices:', error);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const fallback = await fetch(
        'https://api.coinbase.com/v2/prices/BTC-USD/spot',
        { signal: controller.signal },
      );
      clearTimeout(timeoutId);
      const fallbackData = await fallback.json();
      const usd = parseFloat(fallbackData?.data?.amount ?? 0);
      return usd ? { USD: usd } : {};
    } catch {
      return {};
    }
  }

  clearCache() {
    mempoolClient.invalidateAll();
>>>>>>> origin/main
    console.log('[Blockchain] Cache cleared');
  }
}

export const blockchain = new BlockchainService();
