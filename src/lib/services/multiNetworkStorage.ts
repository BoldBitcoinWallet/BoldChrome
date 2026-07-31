/**
 * Multi-Network Paired Wallet Storage
 * Allows the extension to store Mainnet and Testnet credentials independently.
 */

export interface PairedWalletState {
  fingerprint: string;
  addresses: {
    mainnet?: string;
    testnet?: string;
  };
  pubKeys: {
    mainnet?: string;
    testnet?: string;
  };
  chainCodes: {
    mainnet?: string;
    testnet?: string;
  };
}

/**
 * Save or update paired wallet data for a specific network.
 */
export async function savePairedWalletForNetwork(
  network: 'mainnet' | 'testnet',
  data: {
    address: string;
    publicKey: string;
    chainCode: string;
    fingerprint?: string;
  }
): Promise<void> {
  const existing = await getPairedWalletState();
  const fingerprint = data.fingerprint || existing?.fingerprint || 'unknown';

  const updated: PairedWalletState = {
    fingerprint,
    addresses: {
      ...existing?.addresses,
      [network]: data.address,
    },
    pubKeys: {
      ...existing?.pubKeys,
      [network]: data.publicKey,
    },
    chainCodes: {
      ...existing?.chainCodes,
      [network]: data.chainCode,
    },
  };

  await chrome.storage.local.set({ pairedWallets: JSON.stringify(updated) });
}

/**
 * Retrieve the full paired wallet state.
 */
export async function getPairedWalletState(): Promise<PairedWalletState | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['pairedWallets'], (items) => {
      const raw = items.pairedWallets;
      if (typeof raw !== 'string' || raw.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Get the active address for the current network.
 */
export async function getActiveAddressForNetwork(
  network: 'mainnet' | 'testnet'
): Promise<string | null> {
  const state = await getPairedWalletState();
  if (!state) return null;
  return state.addresses[network] || null;
}

/**
 * Get the active public key for the current network.
 */
export async function getActivePubKeyForNetwork(
  network: 'mainnet' | 'testnet'
): Promise<string | null> {
  const state = await getPairedWalletState();
  if (!state) return null;
  return state.pubKeys[network] || null;
}
