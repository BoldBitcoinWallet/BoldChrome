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

class BlockchainService {
  private baseUrl = 'https://mempool.space/api';
  private testnetUrl = 'https://mempool.space/testnet/api';
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
      const response = await fetch(url);
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
      const response = await fetch(url);
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
      const response = await fetch(url);
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
      const response = await fetch(url);
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
      const response = await fetch(url);
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
   * Get fee estimates
   */
  async getFeeEstimates(): Promise<FeeEstimate> {
    console.log('[Blockchain] Fetching fee estimates');
    const url = `${this.getBaseUrl()}/v1/fees/recommended`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
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
      const response = await fetch(url, {
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
      const response = await fetch(url);
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
   * Get Bitcoin price in USD
   */
  async getBitcoinPrice(): Promise<number> {
    console.log('[Blockchain] Fetching Bitcoin price');
    const url = `${this.getBaseUrl()}/v1/prices`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.USD || 0;
    } catch (error) {
      console.error('[Blockchain] Error fetching Bitcoin price:', error);
      // Fallback to a public API if mempool.space doesn't work
      try {
        const fallbackResponse = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
        const fallbackData = await fallbackResponse.json();
        return parseFloat(fallbackData.data.amount);
      } catch {
        console.error('[Blockchain] Fallback price fetch also failed');
        return 0;
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
