import { writable } from 'svelte/store';
import { storage } from '../services/storage';
import { blockchain } from '../services/blockchain';

/**
 * Network store for Mainnet / Testnet (Developer Mode) toggle.
 * Persists selection to chrome.storage.local so it survives popup close/reopen.
 */

export type Network = 'mainnet' | 'testnet';

interface NetworkState {
  network: Network;
  isTestnet: boolean;
}

const initialState: NetworkState = {
  network: 'mainnet',
  isTestnet: false,
};

export const networkStore = writable<NetworkState>(initialState);

/**
 * Initialize network from storage (called once on app startup).
 */
export async function initializeNetworkStore(): Promise<void> {
  const stored = await storage.get<'mainnet' | 'testnet'>('network');
  const network: Network = stored === 'testnet' ? 'testnet' : 'mainnet';

  // Update blockchain service
  blockchain.setNetwork(network);

  networkStore.set({
    network,
    isTestnet: network === 'testnet',
  });
}

/**
 * Switch network and persist choice.
 * Triggers reactive updates in UI + blockchain client.
 */
export async function setNetwork(network: Network): Promise<void> {
  // Update blockchain service (changes API base URL)
  blockchain.setNetwork(network);

  // Persist
  await storage.set('network', network);

  // Update store (reactive)
  networkStore.set({
    network,
    isTestnet: network === 'testnet',
  });
}

/**
 * Toggle between mainnet and testnet.
 */
export async function toggleNetwork(): Promise<void> {
  const current = await storage.get<'mainnet' | 'testnet'>('network');
  const next: Network = current === 'testnet' ? 'mainnet' : 'testnet';
  await setNetwork(next);
}
