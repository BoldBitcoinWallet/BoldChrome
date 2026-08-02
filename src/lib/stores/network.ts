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
  const stored = await storage.get<'mainnet' | 'testnet' | 'testnet4'>('network');
  const testnetVariant = await storage.get<'testnet' | 'testnet4'>('testnetApiVariant');
  // Normalize legacy 'testnet4' value to the canonical 'testnet'
  const network: Network = stored === 'testnet' || stored === 'testnet4' ? 'testnet' : 'mainnet';

  if (testnetVariant === 'testnet' || testnetVariant === 'testnet4') {
    blockchain.setTestnetVariant(testnetVariant);
  }

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

  // Persist (always store canonical 'testnet', never 'testnet4')
  const persistValue: 'mainnet' | 'testnet' = network;
  await storage.set('network', persistValue);

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
  const current = await storage.get<'mainnet' | 'testnet' | 'testnet4'>('network');
  const next: Network = current === 'testnet' || current === 'testnet4' ? 'mainnet' : 'testnet';
  await setNetwork(next);
}
