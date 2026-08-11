import { writable, derived } from 'svelte/store';
import { storage } from '../services/storage';
import { blockchain } from '../services/blockchain';
import { hdWallet, type DerivedAddress as HDDerivedAddress, type HdState, GAP_LIMIT } from '../services/hdwallet';
import {
  savePairedWalletForNetwork,
  getActiveAddressForNetwork,
  getPairedWalletState,
} from '../services/multiNetworkStorage';
import { setNetwork as setNetworkStore } from './network';

const HD_DISCOVERY_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface BrantaMerchant {
  merchantId?: string;
  merchantName: string;
  logoUrl?: string;
  verifyUrl?: string;
}

export interface Transaction {
  txid: string;
  timestamp: number;
  amount: number;
  fee: number;
  status: 'confirmed' | 'pending' | 'failed';
  type: 'send' | 'receive' | 'consolidation';
  address: string;
  from?: string;
  to?: string;
  brantaMerchant?: BrantaMerchant;
}

export interface DerivedAddress {
  address: string;
  path: string;
  index: number;
  type: 'legacy' | 'segwit-nested' | 'segwit-native';
  chain?: 'receive' | 'change';
  label?: string;
  balance?: string;
  lastUsed?: number;
}

export interface TaggedUTXO {
  txid: string;
  vout: number;
  value: number;
  address: string;
  derivationPath: string;
  status: { confirmed: boolean; block_height?: number };
}

export interface WalletState {
  address: string;
  addresses: DerivedAddress[];
  network: 'mainnet' | 'testnet';

  publicKey?: string;
  chainCode?: string;
  pairedNostrNpub?: string;

  // HD state
  hdState?: HdState;

  // Aggregate balance (across all HD addresses)
  btc: string;
  usd: string;
  lastBalanceUpdate: number;

  // Merged transactions from all addresses
  transactions: Transaction[];
  lastTxUpdate: number;
  hasMoreTransactions: boolean;

  // Tagged UTXOs (each knows its source address + derivation path)
  utxos: TaggedUTXO[];

  isLoading: boolean;
  isLoadingMoreTransactions: boolean;
  error?: string;

  isWatchOnly: boolean;
  pairedDevices?: string[];
}

const initialState: WalletState = {
  address: '',
  addresses: [],
  network: 'mainnet',
  btc: '0',
  usd: '0',
  lastBalanceUpdate: 0,
  transactions: [],
  lastTxUpdate: 0,
  hasMoreTransactions: true,
  utxos: [],
  isLoading: false,
  isLoadingMoreTransactions: false,
  isWatchOnly: true,
};

/**
 * Wallet store
 */
export const walletStore = writable<WalletState>(initialState);

// Derived stores
export const balance = derived(walletStore, $wallet => ({
  btc: $wallet.btc,
  usd: $wallet.usd
}));

export const transactionList = derived(walletStore, $wallet => $wallet.transactions);

/** While switching address script type, mirrors the target type so the UI highlights before hdState updates */
export type AddressTypeOption = 'segwit-native' | 'segwit-nested' | 'legacy';
export const addressTypeUISelection = writable<AddressTypeOption | null>(null);

/**
 * Reset wallet to unpaired state (clear pairing data from storage and store)
 */
export async function resetWallet() {
  await storage.remove([
    'publicKey',
    'chainCode',
    'address',
    'addresses',
    'hdState',
    'network',
    'testnetApiVariant',
    'pairedDevices',
    'pinHash'
  ]);
  walletStore.set({
    ...initialState,
    address: '',
    addresses: [],
    publicKey: undefined,
    chainCode: undefined,
    hdState: undefined,
    btc: '0',
    usd: '0',
    transactions: [],
    utxos: [],
    isLoading: false,
    error: undefined
  });
  addressTypeUISelection.set(null);
}

/**
 * Initialize wallet store from storage
 */
export async function initializeWalletStore() {
  const network = (await storage.get<string>('network') as 'mainnet' | 'testnet') || 'mainnet';

  // Try multi-network storage first
  const multi = await getPairedWalletState();
  let address = await storage.get<string>('address');
  let publicKey = await storage.get<string>('publicKey');
  let chainCode = await storage.get<string>('chainCode');
  const pairedNostrNpub = await storage.get<string>('pairedNostrNpub');

  if (multi) {
    if (network === 'testnet') {
      address = multi.addresses.testnet || multi.addresses.testnet4 || address;
      publicKey = multi.pubKeys.testnet || multi.pubKeys.testnet4 || publicKey;
      chainCode = multi.chainCodes.testnet || multi.chainCodes.testnet4 || chainCode;
    } else {
      address = multi.addresses.mainnet || address;
      publicKey = multi.pubKeys.mainnet || publicKey;
      chainCode = multi.chainCodes.mainnet || chainCode;
    }
  }

  const addressesJson = await storage.get<string>('addresses');
  const addresses: DerivedAddress[] = addressesJson ? JSON.parse(addressesJson) : [];
  const hdStateJson = await storage.get<string>('hdState');
  const hdState: HdState | undefined = hdStateJson ? JSON.parse(hdStateJson) : undefined;

  walletStore.update(state => ({
    ...state,
    address: address || '',
    publicKey: publicKey ?? undefined,
    chainCode: chainCode ?? undefined,
    pairedNostrNpub: pairedNostrNpub ?? undefined,
    addresses,
    hdState,
    network
  }));
}

/**
 * Update balance
 */
export function updateBalance(btc: string, usd: string) {
  walletStore.update(state => ({
    ...state,
    btc,
    usd,
    lastBalanceUpdate: Date.now()
  }));
}

/**
 * Update transactions
 */
export function updateTransactions(transactions: Transaction[]) {
  walletStore.update(state => ({
    ...state,
    transactions,
    lastTxUpdate: Date.now()
  }));
}

/**
 * Add new transaction
 */
export function addTransaction(tx: Transaction) {
  walletStore.update(state => ({
    ...state,
    transactions: [tx, ...state.transactions],
    lastTxUpdate: Date.now()
  }));
}

/**
 * Remove a transaction by txid (e.g. user dismissed a completed tx from the carousel).
 */
export function removeTransaction(txid: string) {
  walletStore.update(state => ({
    ...state,
    transactions: state.transactions.filter(t => t.txid !== txid),
    lastTxUpdate: Date.now()
  }));
}

/**
 * Set loading state
 */
export function setLoading(isLoading: boolean) {
  walletStore.update(state => ({
    ...state,
    isLoading
  }));
}

/**
 * Set error
 */
export function setError(error?: string) {
  walletStore.update(state => ({
    ...state,
    error
  }));
}

/**
 * Save address to storage and set as active
 */
export async function setAddress(address: string, network?: 'mainnet' | 'testnet') {
  walletStore.update(state => ({
    ...state,
    address,
    network: network || state.network
  }));

  await storage.set('address', address);
  if (network) {
    await storage.set('network', network);
  }

  // Refresh data for new address
  await refreshWalletData();
}

/**
 * Update addresses list from mobile wallet
 */
export async function updateAddresses(addresses: DerivedAddress[]) {
  walletStore.update(state => ({
    ...state,
    addresses
  }));

  await storage.set('addresses', JSON.stringify(addresses));

  // If no address is selected, select the first one
  const currentAddress = await storage.get<string>('address');
  if (!currentAddress && addresses.length > 0) {
    await setAddress(addresses[0].address);
  }
}

/**
 * Add or update a single address in the list
 */
export async function updateAddress(addressData: DerivedAddress) {
  walletStore.update(state => {
    const addresses = [...state.addresses];
    const index = addresses.findIndex(a => a.address === addressData.address);
    
    if (index >= 0) {
      addresses[index] = addressData;
    } else {
      addresses.push(addressData);
    }

    return {
      ...state,
      addresses
    };
  });

  // Persist to storage
  const addressesJson = await storage.get<string>('addresses');
  const addresses: DerivedAddress[] = addressesJson ? JSON.parse(addressesJson) : [];
  const index = addresses.findIndex(a => a.address === addressData.address);
  if (index >= 0) {
    addresses[index] = addressData;
  } else {
    addresses.push(addressData);
  }
  await storage.set('addresses', JSON.stringify(addresses));
}

/**
 * Set paired mobile devices
 */
export function setPairedDevices(devices: string[]) {
  walletStore.update(state => ({
    ...state,
    pairedDevices: devices
  }));
}

/**
 * Update wallet from pairing response data
 * Called when mobile device sends public key via QR
 * Supports both full pairing (with chain code) and simple pairing (just public key)
 */
export async function updateWalletFromPairing(data: {
  publicKey?: string;
  chainCode?: string;
  deviceId?: string;
  network?: 'mainnet' | 'testnet' | 'testnet4';
  address?: string;
  addresses?: { mainnet?: string; testnet?: string; testnet4?: string } | string;
  pubKeys?: { mainnet?: string; testnet?: string; testnet4?: string } | string;
  fingerprint?: string;
  nostr_npub?: string;
  isRawKey?: boolean;
}) {
  const normalizedPublicKey =
    data.publicKey ||
    ((data as any).pubKey as string | undefined) ||
    ((data as any).pk as string | undefined) ||
    ((data as any).pub_key as string | undefined);
  const normalizedChainCode =
    data.chainCode ||
    ((data as any).chain_code as string | undefined) ||
    ((data as any).cc as string | undefined) ||
    ((data as any).chainCodeHex as string | undefined) ||
    ((data as any).chain_code_hex as string | undefined);
  const normalizedAddresses =
    data.addresses ?? ((data as any).addrs as { mainnet?: string; testnet?: string; testnet4?: string } | string | undefined);
  const normalizedPubKeys =
    data.pubKeys ?? ((data as any).pub_keys as { mainnet?: string; testnet?: string; testnet4?: string } | string | undefined);

  const normalizedData = {
    ...data,
    publicKey: normalizedPublicKey,
    chainCode: normalizedChainCode,
    addresses: normalizedAddresses,
    pubKeys: normalizedPubKeys,
  };

  const inferAddressNetwork = (address: string): 'mainnet' | 'testnet' | 'unknown' => {
    const a = (address || '').trim().toLowerCase();
    if (!a) return 'unknown';
    if (a.startsWith('bc1') || a.startsWith('1') || a.startsWith('3')) return 'mainnet';
    if (a.startsWith('tb1') || a.startsWith('bcrt1') || a.startsWith('m') || a.startsWith('n') || a.startsWith('2')) return 'testnet';
    return 'unknown';
  };

  const pickAddressForNetwork = (
    network: 'mainnet' | 'testnet',
    value: unknown,
  ): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const addr = value.trim();
    if (!addr) return undefined;
    const inferred = inferAddressNetwork(addr);
    if (inferred === network || inferred === 'unknown') {
      return addr;
    }
    return undefined;
  };

  // Support both legacy single-address format and the new standardized PairingPayload.
  // If network is missing, infer it from provided addresses.
  const incomingNetwork = normalizedData.network;
  const addressesObj =
    normalizedData.addresses && typeof normalizedData.addresses === 'object'
      ? normalizedData.addresses
      : undefined;
  const candidateAddresses = [
    normalizedData.address,
    addressesObj?.mainnet,
    addressesObj?.testnet,
    addressesObj?.testnet4,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const hasMainnetCandidate = candidateAddresses.some(a => inferAddressNetwork(a) === 'mainnet');
  const hasTestnetCandidate = candidateAddresses.some(a => inferAddressNetwork(a) === 'testnet');

  let normalizedIncomingNetwork: 'mainnet' | 'testnet' =
    incomingNetwork === 'mainnet'
      ? 'mainnet'
      : incomingNetwork === 'testnet' || incomingNetwork === 'testnet4'
        ? 'testnet'
        : hasTestnetCandidate && !hasMainnetCandidate
          ? 'testnet'
          : 'mainnet';

  // Build a blank template if nothing exists yet (prevents null reference when merging)
  let walletState = await getPairedWalletState();
  if (!walletState) {
    walletState = {
      fingerprint: normalizedData.fingerprint || 'unknown',
      activeNetwork: normalizedIncomingNetwork,
      addresses: {},
      pubKeys: {},
      chainCodes: {},
    };
  }

  if (!walletState.activeNetwork) {
    walletState.activeNetwork = normalizedIncomingNetwork;
  }

  // Merge incoming structured fields (defensive for both object and flat-string shapes)
  const addrField = normalizedData.addresses;
  const pkField = normalizedData.pubKeys;

  if (addrField && typeof addrField === 'object') {
    const mainnetAddr = pickAddressForNetwork('mainnet', addrField.mainnet);
    if (mainnetAddr) {
      walletState.addresses.mainnet = mainnetAddr;
      walletState.pubKeys.mainnet = (pkField && typeof pkField === 'object' ? pkField.mainnet : undefined) || normalizedData.publicKey;
    }
    const testnetAddr =
      pickAddressForNetwork('testnet', addrField.testnet) ||
      pickAddressForNetwork('testnet', addrField.testnet4);
    if (testnetAddr) {
      walletState.addresses.testnet = testnetAddr;
      walletState.addresses.testnet4 = pickAddressForNetwork('testnet', addrField.testnet4) || testnetAddr;
      const testnetPk = (pkField && typeof pkField === 'object'
        ? (pkField.testnet || pkField.testnet4)
        : undefined) || normalizedData.publicKey;
      walletState.pubKeys.testnet = testnetPk;
      walletState.pubKeys.testnet4 = (pkField && typeof pkField === 'object' ? pkField.testnet4 : undefined) || testnetPk;
    }
  } else if (typeof addrField === 'string') {
    // Compatibility path: mobile is still sending flat strings
    const inferred = inferAddressNetwork(addrField);
    if (inferred === 'testnet' || (inferred === 'unknown' && normalizedIncomingNetwork === 'testnet')) {
      walletState.addresses.testnet = addrField.trim();
      walletState.addresses.testnet4 = walletState.addresses.testnet4 || addrField.trim();
      const testPk = typeof pkField === 'string' ? pkField : normalizedData.publicKey;
      walletState.pubKeys.testnet = testPk;
      walletState.pubKeys.testnet4 = walletState.pubKeys.testnet4 || testPk;
    } else if (inferred === 'mainnet' || (inferred === 'unknown' && normalizedIncomingNetwork === 'mainnet')) {
      walletState.addresses.mainnet = addrField.trim();
        walletState.pubKeys.mainnet = typeof pkField === 'string' ? pkField : normalizedData.publicKey;
    }
  }

  // Fallback: single address / publicKey at root level (legacy mobile payload)
  const singleAddr = normalizedData.address;
  const singlePk = normalizedData.publicKey;
  if (singleAddr && !normalizedData.addresses) {
    const inferred = inferAddressNetwork(singleAddr);
    if (inferred === 'testnet' || (inferred === 'unknown' && normalizedIncomingNetwork === 'testnet')) {
      walletState.addresses.testnet = singleAddr.trim();
      walletState.addresses.testnet4 = walletState.addresses.testnet4 || singleAddr.trim();
      walletState.pubKeys.testnet = singlePk;
      walletState.pubKeys.testnet4 = walletState.pubKeys.testnet4 || singlePk;
    } else if (inferred === 'mainnet' || (inferred === 'unknown' && normalizedIncomingNetwork === 'mainnet')) {
      walletState.addresses.mainnet = singleAddr.trim();
      walletState.pubKeys.mainnet = singlePk;
    }
  }

  // Validate testnet address when payload claims testnet. Allow continuing if we can derive from xpub+chainCode.
  if (
    normalizedIncomingNetwork === 'testnet' &&
    !walletState.addresses.testnet &&
    !walletState.addresses.testnet4 &&
    !(normalizedData.chainCode && (walletState.pubKeys.testnet || walletState.pubKeys.testnet4 || normalizedData.publicKey))
  ) {
    throw new Error('Payload missing Testnet address (tb1...)');
  }

  // Reconcile active network with actual available slots to avoid ending up on an empty key slot.
  if (
    normalizedIncomingNetwork === 'testnet' &&
    !walletState.addresses.testnet &&
    !walletState.addresses.testnet4 &&
    !walletState.pubKeys.testnet &&
    !walletState.pubKeys.testnet4 &&
    (walletState.addresses.mainnet || walletState.pubKeys.mainnet)
  ) {
    console.warn('[Wallet] Pairing payload declared testnet but only mainnet material was available; falling back active network to mainnet');
    normalizedIncomingNetwork = 'mainnet';
  }

  if (
    normalizedIncomingNetwork === 'mainnet' &&
    !walletState.addresses.mainnet &&
    !walletState.pubKeys.mainnet &&
    (walletState.addresses.testnet || walletState.addresses.testnet4 || walletState.pubKeys.testnet || walletState.pubKeys.testnet4)
  ) {
    console.warn('[Wallet] Pairing payload declared mainnet but only testnet material was available; falling back active network to testnet');
    normalizedIncomingNetwork = 'testnet';
  }

  walletState.activeNetwork = normalizedIncomingNetwork;

  // Persist merged state
  // Determine active network for UI / store
  const activeNetwork: 'mainnet' | 'testnet' = normalizedIncomingNetwork;

  // Keep legacy single-network keys for backward compatibility
  const activeAddrRaw =
    activeNetwork === 'testnet'
      ? (walletState.addresses.testnet || walletState.addresses.testnet4)
      : walletState.addresses.mainnet;
  const activeAddr = activeAddrRaw && inferAddressNetwork(activeAddrRaw) === activeNetwork
    ? activeAddrRaw
    : undefined;
  let activePk =
    activeNetwork === 'testnet'
      ? (walletState.pubKeys.testnet || walletState.pubKeys.testnet4)
      : walletState.pubKeys.mainnet;

  let activeChainCode =
    activeNetwork === 'testnet'
      ? (walletState.chainCodes.testnet || walletState.chainCodes.testnet4)
      : walletState.chainCodes.mainnet;

  if (!activePk && normalizedData.publicKey) {
    activePk = normalizedData.publicKey;
    if (activeNetwork === 'testnet') {
      walletState.pubKeys.testnet = walletState.pubKeys.testnet || normalizedData.publicKey;
      walletState.pubKeys.testnet4 = walletState.pubKeys.testnet4 || normalizedData.publicKey;
    } else {
      walletState.pubKeys.mainnet = walletState.pubKeys.mainnet || normalizedData.publicKey;
    }
  }

  if (normalizedData.chainCode) {
    if (activeNetwork === 'testnet') {
      walletState.chainCodes.testnet = walletState.chainCodes.testnet || normalizedData.chainCode;
      walletState.chainCodes.testnet4 = walletState.chainCodes.testnet4 || normalizedData.chainCode;
    } else {
      walletState.chainCodes.mainnet = walletState.chainCodes.mainnet || normalizedData.chainCode;
    }
    activeChainCode = normalizedData.chainCode;
  }

  if (!activeChainCode) {
    activeChainCode =
      activeNetwork === 'testnet'
        ? (walletState.chainCodes.testnet || walletState.chainCodes.testnet4)
        : walletState.chainCodes.mainnet;
  }

  await chrome.storage.local.set({ pairedWallets: JSON.stringify(walletState) });

  if (activePk) {
    await storage.set('publicKey', activePk);
  }
  if (activeChainCode) {
    await storage.set('chainCode', activeChainCode);
  }
  if (normalizedData.nostr_npub) await storage.set('pairedNostrNpub', normalizedData.nostr_npub);
  // Persist active network for legacy single-network consumers.
  const legacyNetwork = activeNetwork;
  await storage.set('network', legacyNetwork);
  if (legacyNetwork === 'testnet') {
    const variant: 'testnet' | 'testnet4' = incomingNetwork === 'testnet4' ? 'testnet4' : 'testnet';
    await storage.set('testnetApiVariant', variant);
    blockchain.setTestnetVariant(variant);
  }

  // Switch the reactive network store so balance refreshes on the correct chain
  await setNetworkStore(activeNetwork);

  // Add device to paired devices list
  const deviceId = normalizedData.deviceId || 'mobile-wallet';
  const pairedDevices = [deviceId];
  await storage.set('pairedDevices', JSON.stringify(pairedDevices));

  // Update wallet store (use active address / pubkey)
  walletStore.update(state => ({
    ...state,
    publicKey: activePk || normalizedData.publicKey,
    chainCode: activeChainCode,
    pairedNostrNpub: normalizedData.nostr_npub || state.pairedNostrNpub,
    network: legacyNetwork,
    pairedDevices
  }));

  const persistedPk = await storage.get<string>('publicKey');
  const persistedCc = await storage.get<string>('chainCode');

  // If a single address was provided (legacy path)
  if (activeAddr) {
    const addr: DerivedAddress = {
      address: activeAddr,
      path: activeNetwork === 'testnet' ? "m/84'/1'/0'/0/0" : "m/84'/0'/0'/0/0",
      index: 0,
      type: activeAddr.startsWith('bc1') || activeAddr.startsWith('tb1')
        ? 'segwit-native'
        : activeAddr.startsWith('3') || activeAddr.startsWith('2')
        ? 'segwit-nested'
        : 'legacy',
    };
    await updateAddresses([addr]);
    await setAddress(activeAddr);
    return;
  }

  // If we have chain code, derive addresses
  if (activeChainCode) {
    await deriveInitialAddresses();
  } else if (activePk) {
    console.warn('[Wallet] No chainCode in payload – attempting limited discovery from fingerprint only');
    // We still have a pubKey; try a minimal derivation so the UI shows something useful
    try {
      await deriveInitialAddresses();
    } catch (e) {
      console.log('[Wallet] deriveInitialAddresses failed (expected without chainCode)');
    }
  } else {
    console.log('[Wallet] No chain code provided - limited functionality (watch-only with provided addresses)');
  }
}

/**
 * Derive initial addresses from public key.
 * Exactly 3 addresses, each on first path (../0/0): native segwit, nested segwit, legacy.
 * Used as a quick bootstrap before full HD discovery completes.
 */
export async function deriveInitialAddresses() {
  const publicKey = await storage.get<string>('publicKey');
  const chainCode = await storage.get<string>('chainCode');
  const network = (await storage.get<string>('network') as 'mainnet' | 'testnet') || 'mainnet';

  if (!publicKey || !chainCode) {
    console.error('[Wallet] Cannot derive addresses: missing public key or chain code');
    return;
  }

  try {

    const derived = hdWallet.deriveAllTypes(
      { publicKey, chainCode, network },
      1
    );

    const addresses: DerivedAddress[] = [
      ...derived.segwitNative.map(addr => ({ ...addr, type: 'segwit-native' as const, chain: 'receive' as const })),
      ...derived.segwitNested.map(addr => ({ ...addr, type: 'segwit-nested' as const, chain: 'receive' as const })),
      ...derived.legacy.map(addr => ({ ...addr, type: 'legacy' as const, chain: 'receive' as const }))
    ];

    await updateAddresses(addresses);

    if (derived.segwitNative.length > 0) {
      await setAddress(derived.segwitNative[0].address);
    }

    // Kick off full HD discovery in the background
    runHdDiscovery().catch(err =>
      console.error('[Wallet] Background HD discovery error:', err)
    );
  } catch (error) {
    console.error('[Wallet] Address derivation error:', error);
    throw new Error(`Failed to derive addresses: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Run gap-limit HD discovery for the active address type.
 * Scans the blockchain for used addresses, updates hdState & address list.
 */
/**
 * @returns `true` if discovery actually ran (and refreshed data), `false` if skipped.
 */
export async function runHdDiscovery(force = false, overrideAddressType?: 'segwit-native' | 'segwit-nested' | 'legacy'): Promise<boolean> {
  const publicKey = await storage.get<string>('publicKey');
  const chainCode = await storage.get<string>('chainCode');
  const networkRaw = (await storage.get<string>('network') as 'mainnet' | 'testnet' | 'testnet4') || 'mainnet';
  const network: 'mainnet' | 'testnet' =
    networkRaw === 'testnet' || networkRaw === 'testnet4' ? 'testnet' : 'mainnet';
  const testnetVariant = await storage.get<'testnet' | 'testnet4'>('testnetApiVariant');
  if (testnetVariant === 'testnet' || testnetVariant === 'testnet4') {
    blockchain.setTestnetVariant(testnetVariant);
  }
  blockchain.setNetwork(network);
  if (!publicKey || !chainCode) return false;

  const hdStateJson = await storage.get<string>('hdState');
  const existing: HdState | null = hdStateJson ? JSON.parse(hdStateJson) : null;

  const addressType = overrideAddressType || existing?.addressType || 'segwit-native';

  if (!overrideAddressType && !force && existing?.discoveryDone) {
    const age = Date.now() - (existing.discoveryLastAt || 0);
    if (age < HD_DISCOVERY_STALE_MS) {
      return false;
    }
  }
  const config = { publicKey, chainCode, network };

  const getStats = async (address: string) => {
    const stats = await blockchain.getAddressStats(address);
    return { tx_count: stats.chain_stats.tx_count + stats.mempool_stats.tx_count };
  };

  const result = await hdWallet.discoverIndexes(config, addressType, getStats);

  const newHdState: HdState = {
    externalIndex: result.externalNext,
    changeIndex: result.changeNext,
    maxUsedExternal: result.maxUsedExternal,
    discoveryDone: true,
    discoveryLastAt: Date.now(),
    addressType,
  };

  await storage.set('hdState', JSON.stringify(newHdState));

  // Derive the full address set from discovered indexes
  const externalEnd = Math.max(result.externalNext, result.maxUsedExternal);
  const changeEnd = result.changeNext;
  const allAddrs = hdWallet.deriveHdAddresses(config, addressType, externalEnd, changeEnd > 0 ? changeEnd - 1 : -1);

  const addresses: DerivedAddress[] = allAddrs.map(a => ({
    ...a,
    type: addressType,
  }));

  await updateAddresses(addresses);

  // Set active address to current receive address (network-aware)
  if (result.externalNext >= 0) {
    const [receiveAddr] = hdWallet.deriveAddresses(config, addressType, 1, result.externalNext, 0);
    if (receiveAddr) {
      await storage.set('address', receiveAddr.address);
      walletStore.update(s => ({ ...s, address: receiveAddr.address }));
    }
  }

  walletStore.update(s => ({ ...s, hdState: newHdState }));

  // Re-aggregate balance/txs/UTXOs now that the full address set is known
  await refreshWalletData();
  return true;
}

/**
 * Switch the active address type, re-run HD discovery, and refresh wallet data.
 */
export async function switchAddressType(newType: AddressTypeOption): Promise<void> {
  const state = getStoreValue();
  if (!state.hdState || state.hdState.addressType === newType) return;

  addressTypeUISelection.set(newType);

  try {
    const ran = await runHdDiscovery(true, newType);
    if (!ran) {
      throw new Error('Could not switch address format right now.');
    }
  } catch (err) {
    console.error('[Wallet] switchAddressType failed:', err);
    throw err;
  } finally {
    addressTypeUISelection.set(null);
  }
}

/**
 * Get the current receive address (at externalIndex).
 */
export function getCurrentReceiveAddress(): DerivedAddress | null {
  const state = getStoreValue();
  if (!state.publicKey || !state.chainCode || !state.hdState) return null;
  const config = { publicKey: state.publicKey, chainCode: state.chainCode, network: state.network };
  const [addr] = hdWallet.deriveAddresses(config, state.hdState.addressType, 1, state.hdState.externalIndex, 0);
  return addr ? { ...addr, type: state.hdState.addressType, chain: 'receive' } : null;
}

/**
 * Get the next change address (at changeIndex).
 */
export function getNextChangeAddress(): DerivedAddress | null {
  const state = getStoreValue();
  if (!state.publicKey || !state.chainCode || !state.hdState) return null;
  const config = { publicKey: state.publicKey, chainCode: state.chainCode, network: state.network };
  const [addr] = hdWallet.deriveAddresses(config, state.hdState.addressType, 1, state.hdState.changeIndex, 1);
  return addr ? { ...addr, type: state.hdState.addressType, chain: 'change' } : null;
}

function getStoreValue(): WalletState {
  let val: WalletState = initialState;
  walletStore.subscribe(s => { val = s; })();
  return val;
}

/** Map raw mempool.space tx to our Transaction format (single-address, for fetchMore). */
function mapRawTxToTransaction(tx: any, currentAddress: string): Transaction {
  return mapRawTxMultiAddress(tx, new Set([currentAddress]));
}

/** Map raw mempool.space tx considering multiple wallet addresses. */
function mapRawTxMultiAddress(tx: any, walletAddresses: Set<string>): Transaction {
  const receivedByUs = tx.vout
    .filter((v: any) => walletAddresses.has(v.scriptpubkey_address))
    .reduce((sum: number, v: any) => sum + v.value, 0);

  const sentFromUs = tx.vin
    .filter((v: any) => walletAddresses.has(v.prevout?.scriptpubkey_address))
    .reduce((sum: number, v: any) => sum + (v.prevout?.value || 0), 0);

  const sentToOthers = tx.vout
    .filter((v: any) => v.scriptpubkey_address && !walletAddresses.has(v.scriptpubkey_address))
    .reduce((sum: number, v: any) => sum + v.value, 0);

  const netAmount = receivedByUs - sentFromUs;

  // If all inputs and outputs belong to us, it's a consolidation
  const allInputsOurs = tx.vin.every((v: any) => walletAddresses.has(v.prevout?.scriptpubkey_address));
  const allOutputsOurs = tx.vout.every((v: any) => walletAddresses.has(v.scriptpubkey_address));
  const isConsolidation = allInputsOurs && allOutputsOurs;

  const type: Transaction['type'] = isConsolidation
    ? 'consolidation'
    : netAmount > 0
      ? 'receive'
      : 'send';

  const amount =
    type === 'consolidation'
      ? receivedByUs
      : type === 'receive'
        ? receivedByUs
        : sentToOthers > 0
          ? sentToOthers
          : Math.abs(netAmount);

  const firstOurAddress = tx.vout?.find((v: any) => walletAddresses.has(v.scriptpubkey_address))?.scriptpubkey_address
    || Array.from(walletAddresses)[0];
  const recipientVout = tx.vout?.find((v: any) => v.scriptpubkey_address && !walletAddresses.has(v.scriptpubkey_address));
  const senderVin = tx.vin?.find((v: any) => v.prevout?.scriptpubkey_address && !walletAddresses.has(v.prevout.scriptpubkey_address));

  return {
    txid: tx.txid,
    timestamp: tx.status.block_time || Math.floor(Date.now() / 1000),
    amount,
    fee: tx.fee || 0,
    status: tx.status.confirmed ? 'confirmed' : 'pending',
    type,
    address: firstOurAddress,
    from: type === 'receive' ? senderVin?.prevout?.scriptpubkey_address : firstOurAddress,
    to: type === 'send' ? recipientVout?.scriptpubkey_address : firstOurAddress,
  };
}

type TransactionMetadata = { brantaMerchant?: BrantaMerchant };

type PendingBrantaMetadata = {
  recipientAddress: string;
  amountSats: number;
  createdAt: number;
  brantaMerchant: BrantaMerchant;
};

async function getTransactionMetadataMap(): Promise<Record<string, TransactionMetadata>> {
  try {
    const raw = await storage.get<string>('txMetadata');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, TransactionMetadata>;
  } catch (err) {
    console.warn('[Wallet] Failed to read tx metadata from storage', err);
    return {};
  }
}

async function getPendingBrantaMetadata(): Promise<PendingBrantaMetadata[]> {
  try {
    const raw = await storage.get<string>('pendingBrantaMetadata');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as PendingBrantaMetadata[]).filter(item => {
      if (!item || typeof item !== 'object') return false;
      if (!item.recipientAddress || !item.brantaMerchant) return false;
      if (typeof item.amountSats !== 'number' || typeof item.createdAt !== 'number') return false;
      return now - item.createdAt < 72 * 60 * 60 * 1000;
    });
  } catch (err) {
    console.warn('[Wallet] Failed to read pending Branta metadata from storage', err);
    return [];
  }
}

function applyTransactionMetadata(
  tx: Transaction,
  metadataMap: Record<string, TransactionMetadata>,
  pendingMetadata: PendingBrantaMetadata[],
): Transaction {
  const meta = metadataMap[tx.txid];
  if (meta?.brantaMerchant) {
    return { ...tx, brantaMerchant: meta.brantaMerchant };
  }

  if (tx.type !== 'send' || tx.brantaMerchant || !tx.to) return tx;

  const normalizedTxTo = tx.to.trim().toLowerCase();
  const txTimeMs = tx.timestamp * 1000;

  const candidates = pendingMetadata
    .filter(item =>
      item.recipientAddress.trim().toLowerCase() === normalizedTxTo &&
      txTimeMs >= item.createdAt - 5 * 60 * 1000 &&
      txTimeMs <= item.createdAt + 72 * 60 * 60 * 1000,
    )
    .sort((a, b) => {
      const amountDeltaA = Math.abs(a.amountSats - tx.amount);
      const amountDeltaB = Math.abs(b.amountSats - tx.amount);
      if (amountDeltaA !== amountDeltaB) return amountDeltaA - amountDeltaB;
      return Math.abs(txTimeMs - a.createdAt) - Math.abs(txTimeMs - b.createdAt);
    });

  const matchedPending = candidates.find(item => {
    const amountDelta = Math.abs(item.amountSats - tx.amount);
    const maxTolerance = Math.max(2500, Math.round(item.amountSats * 0.02));
    return amountDelta <= maxTolerance;
  }) || candidates[0];

  if (!matchedPending?.brantaMerchant) return tx;
  return { ...tx, brantaMerchant: matchedPending.brantaMerchant };
}

/**
 * Refresh wallet data from blockchain API.
 * Aggregates balance, transactions, and UTXOs across all HD addresses.
 */
export async function refreshWalletData() {
  let addresses: DerivedAddress[] = [];

  walletStore.update(state => {
    addresses = state.addresses;
    return { ...state, isLoading: true, error: undefined, hasMoreTransactions: true };
  });

  if (!addresses.length) {
    walletStore.update(state => ({
      ...state,
      isLoading: false,
      error: 'No wallet addresses configured'
    }));
    return;
  }

  // === Network guard: never send Mainnet addresses to Testnet Esplora ===
  const currentNetworkRaw = (await storage.get<'mainnet' | 'testnet' | 'testnet4'>('network')) || 'mainnet';
  const currentNetwork: 'mainnet' | 'testnet' =
    currentNetworkRaw === 'testnet' || currentNetworkRaw === 'testnet4'
      ? 'testnet'
      : 'mainnet';
  const testnetVariant = await storage.get<'testnet' | 'testnet4'>('testnetApiVariant');
  if (testnetVariant === 'testnet' || testnetVariant === 'testnet4') {
    blockchain.setTestnetVariant(testnetVariant);
  }
  blockchain.setNetwork(currentNetwork);
  walletStore.update(state => ({ ...state, network: currentNetwork }));
  const isTestnetFormat = (addr: string) => /^tb1q|^tb1p|^[mn2]/.test(addr);
  const isMainnetFormat = (addr: string) => /^bc1q|^bc1p|^[13]/.test(addr);

  addresses = addresses.filter(a => {
    if (currentNetwork === 'testnet') return isTestnetFormat(a.address);
    return isMainnetFormat(a.address);
  });

  if (!addresses.length) {
    walletStore.update(state => ({
      ...state,
      isLoading: false,
      error: currentNetwork === 'testnet'
        ? 'No Testnet-format addresses available. Pair a Testnet wallet (tb1q...) from the mobile app.'
        : 'No Mainnet addresses configured'
    }));
    return;
  }

  const allAddressStrings = new Set(addresses.map(a => a.address));
  const txMetadataMap = await getTransactionMetadataMap();
  const pendingBrantaMetadata = await getPendingBrantaMetadata();

  try {
    // Aggregate balance across all addresses
    let totalConfirmed = 0;
    let totalUnconfirmed = 0;
    for (const addr of addresses) {
      try {
        const stats = await blockchain.getAddressStats(addr.address);
        totalConfirmed += stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
        totalUnconfirmed += stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum;
      } catch {
        // Skip addresses that fail (rate limit, etc.)
      }
    }

    const balanceSats = totalConfirmed + totalUnconfirmed;
    const balanceBTC = (balanceSats / 100_000_000).toFixed(8);
    const price = await blockchain.getBitcoinPrice();
    const balanceUSD = (parseFloat(balanceBTC) * price).toFixed(2);

    // Aggregate transactions, dedup by txid
    const txMap = new Map<string, Transaction>();
    for (const addr of addresses) {
      try {
        const txHistory = await blockchain.getTransactions(addr.address);
        for (const rawTx of txHistory) {
          if (!txMap.has(rawTx.txid)) {
            const mapped = mapRawTxMultiAddress(rawTx, allAddressStrings);
            txMap.set(rawTx.txid, applyTransactionMetadata(mapped, txMetadataMap, pendingBrantaMetadata));
          }
        }
      } catch {
        // Skip on error
      }
    }
    const transactions = Array.from(txMap.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    // Aggregate UTXOs with address/path tagging
    const taggedUtxos: TaggedUTXO[] = [];
    for (const addr of addresses) {
      try {
        const utxos = await blockchain.getUTXOs(addr.address);
        for (const u of utxos) {
          taggedUtxos.push({
            txid: u.txid,
            vout: u.vout,
            value: u.value,
            address: addr.address,
            derivationPath: addr.path,
            status: u.status,
          });
        }
      } catch {
        // Skip
      }
    }

    walletStore.update(state => ({
      ...state,
      btc: balanceBTC,
      usd: balanceUSD,
      lastBalanceUpdate: Date.now(),
      transactions,
      lastTxUpdate: Date.now(),
      hasMoreTransactions: transactions.length > 0,
      utxos: taggedUtxos,
      isLoading: false,
      error: undefined
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch wallet data';
    console.error('[Wallet] Refresh error:', error);
    walletStore.update(state => ({
      ...state,
      isLoading: false,
      error: message
    }));
  }
}

/**
 * Fetch more transactions (paging), appending to the list.
 */
export async function fetchMoreTransactions() {
  let addresses: DerivedAddress[] = [];
  let lastTxid = '';

  walletStore.update(state => {
    addresses = state.addresses;
    const txs = state.transactions;
    lastTxid = txs.length > 0 ? txs[txs.length - 1].txid : '';
    return { ...state, isLoadingMoreTransactions: true };
  });

  if (!addresses.length || !lastTxid) {
    walletStore.update(state => ({ ...state, isLoadingMoreTransactions: false, hasMoreTransactions: false }));
    return;
  }

  const allAddressStrings = new Set(addresses.map(a => a.address));
  const txMetadataMap = await getTransactionMetadataMap();
  const pendingBrantaMetadata = await getPendingBrantaMetadata();

  try {
    const txMap = new Map<string, Transaction>();
    for (const addr of addresses) {
      try {
        const nextPage = await blockchain.getTransactions(addr.address, lastTxid);
        for (const rawTx of nextPage) {
          if (!txMap.has(rawTx.txid)) {
            const mapped = mapRawTxMultiAddress(rawTx, allAddressStrings);
            txMap.set(rawTx.txid, applyTransactionMetadata(mapped, txMetadataMap, pendingBrantaMetadata));
          }
        }
      } catch {
        // Skip on error
      }
    }

    const newTransactions = Array.from(txMap.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    walletStore.update(state => {
      const existingIds = new Set(state.transactions.map(t => t.txid));
      const appended = newTransactions.filter(t => !existingIds.has(t.txid));
      return {
        ...state,
        transactions: [...state.transactions, ...appended],
        lastTxUpdate: Date.now(),
        hasMoreTransactions: newTransactions.length > 0,
        isLoadingMoreTransactions: false
      };
    });
  } catch (error) {
    console.error('[Wallet] Fetch more transactions error:', error);
    walletStore.update(state => ({
      ...state,
      isLoadingMoreTransactions: false,
      hasMoreTransactions: false
    }));
  }
}
