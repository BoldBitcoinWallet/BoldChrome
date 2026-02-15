/**
 * Blockchain Service
 * Fetches Bitcoin blockchain data from mempool.space API
 */

import { writable } from 'svelte/store';

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
  [blocks: string]: number; // blocks as key, fee rate as value
}

/** Mempool.space /v1/fees/recommended response (sat/vB). */
export interface RecommendedFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee?: number;
  minimumFee?: number;
}

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
  setMempoolMainnet(url: string | null | undefined): void {
    if (url && url.trim() !== '') {
      this.baseUrl = url.trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '') + '/api';
    } else {
      this.baseUrl = DEFAULT_MAINNET_API;
    }
    this.clearCache();
    console.log('[Blockchain] Mainnet API set to', this.baseUrl);
  }

  /** Human-readable provider label for UI (e.g. "mempool.space" or hostname). */
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
    } catch (error) {
      console.error('[Blockchain] Error fetching address stats:', error);
      throw error;
    }
  }

  /**
   * Get address balance in satoshis
   */
  async getBalance(address: string): Promise<{
    confirmed: number;
    unconfirmed: number;
    total: number;
  }> {
    const stats = await this.getAddressStats(address);
    
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
    } catch (error) {
      console.error('[Blockchain] Error fetching UTXOs:', error);
      throw error;
    }
  }

  /**
   * Fetch transactions for an address
   */
  async getTransactions(address: string, afterTxid?: string): Promise<Transaction[]> {
    console.log('[Blockchain] Fetching transactions for:', address);
    
    let url = `${this.getBaseUrl()}/address/${address}/txs`;
    if (afterTxid) {
      url += `/chain/${afterTxid}`;
    }

    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[Blockchain] Error fetching transactions:', error);
      throw error;
    }
  }

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
    } catch (error) {
      console.error('[Blockchain] Error fetching transaction:', error);
      throw error;
    }
  }

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
    } catch (error) {
      console.error('[Blockchain] Error fetching transaction hex:', error);
      throw error;
    }
  }

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
    } catch (error) {
      console.error('[Blockchain] Error fetching fee estimates:', error);
      throw error;
    }
  }

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
      
      return txid;
    } catch (error) {
      console.error('[Blockchain] Error broadcasting transaction:', error);
      throw error;
    }
  }

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
      return height;
    } catch (error) {
      console.error('[Blockchain] Error fetching block height:', error);
      throw error;
    }
  }

  /**
   * Get Bitcoin price in USD (single rate for backward compatibility)
   */
  async getBitcoinPrice(): Promise<number> {
    const rates = await this.getBitcoinPrices();
    return rates.USD ?? 0;
  }

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
    console.log('[Blockchain] Cache cleared');
  }
}

export const blockchain = new BlockchainService();
