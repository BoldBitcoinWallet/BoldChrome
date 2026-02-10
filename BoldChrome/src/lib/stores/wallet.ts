import { writable, derived } from 'svelte/store';
import { storage } from '../services/storage';
import { blockchain } from '../services/blockchain';
import { hdWallet, type DerivedAddress as HDDerivedAddress } from '../services/hdwallet';

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
}

export interface DerivedAddress {
  address: string;
  path: string; // BIP44 derivation path (e.g., m/84'/0'/0'/0/0)
  index: number; // Address index
  type: 'legacy' | 'segwit-nested' | 'segwit-native'; // Address type
  label?: string; // Optional user-defined label
  balance?: string; // Cached balance in BTC
  lastUsed?: number; // Timestamp of last transaction
}

export interface WalletState {
  // Identity
  address: string; // Currently selected address
  addresses: DerivedAddress[]; // All derived addresses from public key
  network: 'mainnet' | 'testnet';

  // HD Wallet Public Key (for address derivation)
  publicKey?: string; // Extended public key (xpub/ypub/zpub)
  chainCode?: string; // Chain code for HD derivation

  // Balance
  btc: string;
  usd: string;
  lastBalanceUpdate: number;

  // Transactions
  transactions: Transaction[];
  lastTxUpdate: number;
  hasMoreTransactions: boolean;

  // UI state
  isLoading: boolean;
  isLoadingMoreTransactions: boolean;
  error?: string;

  // Watch-only configuration
  isWatchOnly: boolean;
  pairedDevices?: string[]; // Mobile device IDs that can sign
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
  isLoading: false,
  isLoadingMoreTransactions: false,
  isWatchOnly: true, // Chrome extension is always watch-only
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

/**
 * Reset wallet to unpaired state (clear pairing data from storage and store)
 */
export async function resetWallet() {
  await storage.remove([
    'publicKey',
    'chainCode',
    'address',
    'addresses',
    'network',
    'pairedDevices',
    'pinHash'
  ]);
  walletStore.set({
    ...initialState,
    address: '',
    addresses: [],
    publicKey: undefined,
    chainCode: undefined,
    btc: '0',
    usd: '0',
    transactions: [],
    isLoading: false,
    error: undefined
  });
}

/**
 * Initialize wallet store from storage
 */
export async function initializeWalletStore() {
  const address = await storage.get<string>('address');
  const publicKey = await storage.get<string>('publicKey');
  const chainCode = await storage.get<string>('chainCode');
  const addressesJson = await storage.get<string>('addresses');
  const addresses: DerivedAddress[] = addressesJson ? JSON.parse(addressesJson) : [];
  const network = await storage.get<string>('network') as 'mainnet' | 'testnet';

  walletStore.update(state => ({
    ...state,
    address: address || '',
    publicKey: publicKey ?? undefined,
    chainCode: chainCode ?? undefined,
    addresses,
    network: network || 'mainnet'
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
  publicKey: string;
  chainCode?: string;
  deviceId?: string;
  network?: 'mainnet' | 'testnet';
  address?: string;
  addresses?: DerivedAddress[];
  isRawKey?: boolean;
}) {
  // Validate data
  if (!data.publicKey) {
    throw new Error('No public key provided in pairing response');
  }

  // Store public key
  await storage.set('publicKey', data.publicKey);

  // Store chain code if provided
  if (data.chainCode) {
    await storage.set('chainCode', data.chainCode);
  }

  // Set network if provided
  const network = data.network || 'mainnet';
  await storage.set('network', network);

  // Add device to paired devices list
  const deviceId = data.deviceId || 'mobile-wallet';
  const pairedDevices = [deviceId];
  await storage.set('pairedDevices', JSON.stringify(pairedDevices));

  // Update wallet store
  walletStore.update(state => ({
    ...state,
    publicKey: data.publicKey,
    chainCode: data.chainCode,
    network: network as 'mainnet' | 'testnet',
    pairedDevices
  }));

  console.log('[Wallet] Paired with device:', deviceId);
  
  // If addresses were provided directly, use them
  if (data.addresses && data.addresses.length > 0) {
    await updateAddresses(data.addresses);
    if (data.address) {
      await setAddress(data.address);
    } else {
      await setAddress(data.addresses[0].address);
    }
    return;
  }

  // If a single address was provided
  if (data.address) {
    const addr: DerivedAddress = {
      address: data.address,
      path: "m/84'/0'/0'/0/0",
      index: 0,
      type: data.address.startsWith('bc1') ? 'segwit-native' : 
            data.address.startsWith('3') ? 'segwit-nested' : 'legacy'
    };
    await updateAddresses([addr]);
    await setAddress(data.address);
    return;
  }

  // If we have chain code, derive addresses
  if (data.chainCode) {
    await deriveInitialAddresses();
  } else {
    console.log('[Wallet] No chain code provided - limited functionality (watch-only with provided addresses)');
  }
}

/**
 * Derive initial addresses from public key.
 * Exactly 3 addresses, each on first path (../0/0): native segwit, nested segwit, legacy.
 */
export async function deriveInitialAddresses() {
  const publicKey = await storage.get<string>('publicKey');
  const chainCode = await storage.get<string>('chainCode');
  const network = await storage.get<string>('network') as 'mainnet' | 'testnet' || 'mainnet';

  if (!publicKey || !chainCode) {
    console.error('[Wallet] Cannot derive addresses: missing public key or chain code');
    return;
  }

  try {
    console.log('[Wallet] Deriving 3 addresses (first derivation: native segwit, nested segwit, legacy)...');

    // One address per type at index 0
    const derived = hdWallet.deriveAllTypes(
      { publicKey, chainCode, network },
      1 // 1 address per type (index 0 only)
    );

    // Order: 1) native segwit (default), 2) nested segwit, 3) legacy
    const addresses: DerivedAddress[] = [
      ...derived.segwitNative.map(addr => ({ ...addr, type: 'segwit-native' as const })),
      ...derived.segwitNested.map(addr => ({ ...addr, type: 'segwit-nested' as const })),
      ...derived.legacy.map(addr => ({ ...addr, type: 'legacy' as const }))
    ];

    console.log('[Wallet] Derived', addresses.length, 'addresses');

    await updateAddresses(addresses);

    // Default to native segwit (first in list)
    if (derived.segwitNative.length > 0) {
      await setAddress(derived.segwitNative[0].address);
    }
  } catch (error) {
    console.error('[Wallet] Address derivation error:', error);
    throw new Error(`Failed to derive addresses: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/** Map raw mempool.space tx to our Transaction format (shared by refresh and fetchMore). */
function mapRawTxToTransaction(tx: any, currentAddress: string): Transaction {
  const receivedByUs = tx.vout
    .filter((v: any) => v.scriptpubkey_address === currentAddress)
    .reduce((sum: number, v: any) => sum + v.value, 0);

  const sentFromUs = tx.vin
    .filter((v: any) => v.prevout?.scriptpubkey_address === currentAddress)
    .reduce((sum: number, v: any) => sum + (v.prevout?.value || 0), 0);

  const sentToOthers = tx.vout
    .filter((v: any) => v.scriptpubkey_address && v.scriptpubkey_address !== currentAddress)
    .reduce((sum: number, v: any) => sum + v.value, 0);

  const netAmount = receivedByUs - sentFromUs;
  const type: Transaction['type'] = netAmount > 0 ? 'receive' : 'send';

  const amount =
    type === 'receive'
      ? receivedByUs
      : sentToOthers > 0
        ? sentToOthers
        : Math.abs(netAmount);

  const recipientVout = tx.vout?.find((v: any) => v.scriptpubkey_address && v.scriptpubkey_address !== currentAddress);
  const senderVin = tx.vin?.find((v: any) => v.prevout?.scriptpubkey_address && v.prevout.scriptpubkey_address !== currentAddress);

  return {
    txid: tx.txid,
    timestamp: tx.status.block_time || Math.floor(Date.now() / 1000),
    amount,
    fee: tx.fee || 0,
    status: tx.status.confirmed ? 'confirmed' : 'pending',
    type,
    address: currentAddress,
    from: type === 'receive' ? senderVin?.prevout?.scriptpubkey_address : currentAddress,
    to: type === 'send' ? recipientVout?.scriptpubkey_address : currentAddress,
  };
}

/**
 * Refresh wallet data from blockchain API
 */
export async function refreshWalletData() {
  let currentAddress = '';

  walletStore.update(state => {
    currentAddress = state.address;
    return { ...state, isLoading: true, error: undefined, hasMoreTransactions: true };
  });

  if (!currentAddress) {
    walletStore.update(state => ({
      ...state,
      isLoading: false,
      error: 'No wallet address configured'
    }));
    return;
  }

  try {
    const [addressStats, txHistory] = await Promise.all([
      blockchain.getAddressStats(currentAddress),
      blockchain.getTransactions(currentAddress)
    ]);

    const balanceSats = addressStats.chain_stats.funded_txo_sum - addressStats.chain_stats.spent_txo_sum;
    const balanceBTC = (balanceSats / 100_000_000).toFixed(8);

    const price = await blockchain.getBitcoinPrice();
    const balanceUSD = (parseFloat(balanceBTC) * price).toFixed(2);

    const transactions: Transaction[] = txHistory.map((tx: any) => mapRawTxToTransaction(tx, currentAddress));

    walletStore.update(state => ({
      ...state,
      btc: balanceBTC,
      usd: balanceUSD,
      lastBalanceUpdate: Date.now(),
      transactions,
      lastTxUpdate: Date.now(),
      hasMoreTransactions: txHistory.length > 0,
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
 * Fetch more transactions (paging), appending to the list. Uses last txid in list and /chain/:txid.
 */
export async function fetchMoreTransactions() {
  let currentAddress = '';
  let lastTxid = '';

  walletStore.update(state => {
    currentAddress = state.address;
    const txs = state.transactions;
    lastTxid = txs.length > 0 ? txs[txs.length - 1].txid : '';
    return { ...state, isLoadingMoreTransactions: true };
  });

  if (!currentAddress || !lastTxid) {
    walletStore.update(state => ({ ...state, isLoadingMoreTransactions: false, hasMoreTransactions: false }));
    return;
  }

  try {
    const nextPage = await blockchain.getTransactions(currentAddress, lastTxid);
    const newTransactions = nextPage.map((tx: any) => mapRawTxToTransaction(tx, currentAddress));

    walletStore.update(state => {
      const existingIds = new Set(state.transactions.map(t => t.txid));
      const appended = newTransactions.filter(t => !existingIds.has(t.txid));
      return {
        ...state,
        transactions: [...state.transactions, ...appended],
        lastTxUpdate: Date.now(),
        hasMoreTransactions: nextPage.length > 0,
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
