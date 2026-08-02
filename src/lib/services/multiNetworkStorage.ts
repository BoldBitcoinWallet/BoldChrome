/**
 * Multi-Network Paired Wallet Storage
 * Allows the extension to store Mainnet and Testnet credentials independently.
 */

export interface PairedWalletState {
  fingerprint: string;
  activeNetwork: 'mainnet' | 'testnet';
  addresses: {
    mainnet?: string;
    testnet?: string;
    testnet4?: string;
  };
  pubKeys: {
    mainnet?: string;
    testnet?: string;
    testnet4?: string;
  };
  chainCodes: {
    mainnet?: string;
    testnet?: string;
    testnet4?: string;
  };
}

function normalizeNetwork(network: 'mainnet' | 'testnet' | 'testnet4'): 'mainnet' | 'testnet' {
  return network === 'mainnet' ? 'mainnet' : 'testnet';
}

function networkKeys(network: 'mainnet' | 'testnet'): Array<'mainnet' | 'testnet' | 'testnet4'> {
  return network === 'mainnet' ? ['mainnet'] : ['testnet', 'testnet4'];
}

/**
 * Save or update paired wallet data for a specific network.
 */
export async function savePairedWalletForNetwork(
  network: 'mainnet' | 'testnet' | 'testnet4',
  data: {
    address: string;
    publicKey: string;
    chainCode: string;
    fingerprint?: string;
  }
): Promise<void> {
  const existing = await getPairedWalletState();
  const fingerprint = data.fingerprint || existing?.fingerprint || 'unknown';
  const normalizedNetwork = normalizeNetwork(network);

  const updated: PairedWalletState = {
    fingerprint,
    activeNetwork: normalizedNetwork,
    addresses: {
      ...existing?.addresses,
      [normalizedNetwork]: data.address,
    },
    pubKeys: {
      ...existing?.pubKeys,
      [normalizedNetwork]: data.publicKey,
    },
    chainCodes: {
      ...existing?.chainCodes,
      [normalizedNetwork]: data.chainCode,
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
        const parsed = JSON.parse(raw) as Partial<PairedWalletState>;
        const normalized: PairedWalletState = {
          fingerprint: parsed.fingerprint || 'unknown',
          activeNetwork: parsed.activeNetwork === 'testnet' ? 'testnet' : 'mainnet',
          addresses: {
            mainnet: parsed.addresses?.mainnet,
            testnet: parsed.addresses?.testnet || parsed.addresses?.testnet4,
            testnet4: parsed.addresses?.testnet4,
          },
          pubKeys: {
            mainnet: parsed.pubKeys?.mainnet,
            testnet: parsed.pubKeys?.testnet || parsed.pubKeys?.testnet4,
            testnet4: parsed.pubKeys?.testnet4,
          },
          chainCodes: {
            mainnet: parsed.chainCodes?.mainnet,
            testnet: parsed.chainCodes?.testnet || parsed.chainCodes?.testnet4,
            testnet4: parsed.chainCodes?.testnet4,
          },
        };
        if (!parsed.activeNetwork && normalized.addresses.testnet && !normalized.addresses.mainnet) {
          normalized.activeNetwork = 'testnet';
        }
        resolve(normalized);
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
  for (const key of networkKeys(network)) {
    const value = state.addresses[key];
    if (value) return value;
  }
  return null;
}

/**
 * Get the active public key for the current network.
 */
export async function getActivePubKeyForNetwork(
  network: 'mainnet' | 'testnet'
): Promise<string | null> {
  const state = await getPairedWalletState();
  if (!state) return null;
  for (const key of networkKeys(network)) {
    const value = state.pubKeys[key];
    if (value) return value;
  }
  return null;
}
