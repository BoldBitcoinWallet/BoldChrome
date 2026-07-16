import { writable, derived } from 'svelte/store';
import { storage } from '../services/storage';
import { blockchain } from '../services/blockchain';
import { hdWallet, type DerivedAddress as HDDerivedAddress, type HdState, GAP_LIMIT } from '../services/hdwallet';

const HD_DISCOVERY_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

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
  const address = await storage.get<string>('address');
  const publicKey = await storage.get<string>('publicKey');
  const chainCode = await storage.get<string>('chainCode');
  const addressesJson = await storage.get<string>('addresses');
  const addresses: DerivedAddress[] = addressesJson ? JSON.parse(addressesJson) : [];
  const network = await storage.get<string>('network') as 'mainnet' | 'testnet';
  const hdStateJson = await storage.get<string>('hdState');
  const hdState: HdState | undefined = hdStateJson ? JSON.parse(hdStateJson) : undefined;

  walletStore.update(state => ({
    ...state,
    address: address || '',
    publicKey: publicKey ?? undefined,
    chainCode: chainCode ?? undefined,
    addresses,
    hdState,
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
 * Used as a quick bootstrap before full HD discovery completes.
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

    const derived = hdWallet.deriveAllTypes(
      { publicKey, chainCode, network },
      1
    );

    const addresses: DerivedAddress[] = [
      ...derived.segwitNative.map(addr => ({ ...addr, type: 'segwit-native' as const, chain: 'receive' as const })),
      ...derived.segwitNested.map(addr => ({ ...addr, type: 'segwit-nested' as const, chain: 'receive' as const })),
      ...derived.legacy.map(addr => ({ ...addr, type: 'legacy' as const, chain: 'receive' as const }))
    ];

    console.log('[Wallet] Derived', addresses.length, 'addresses');
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
  const network = (await storage.get<string>('network') as 'mainnet' | 'testnet') || 'mainnet';
  if (!publicKey || !chainCode) return false;

  const hdStateJson = await storage.get<string>('hdState');
  const existing: HdState | null = hdStateJson ? JSON.parse(hdStateJson) : null;

  const addressType = overrideAddressType || existing?.addressType || 'segwit-native';

  if (!overrideAddressType && !force && existing?.discoveryDone) {
    const age = Date.now() - (existing.discoveryLastAt || 0);
    if (age < HD_DISCOVERY_STALE_MS) {
      console.log('[Wallet] HD discovery still fresh, skipping');
      return false;
    }
  }
  const config = { publicKey, chainCode, network };

  console.log('[Wallet] Running HD discovery for', addressType);

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

  // Set active address to current receive address
  if (result.externalNext >= 0) {
    const [receiveAddr] = hdWallet.deriveAddresses(config, addressType, 1, result.externalNext, 0);
    if (receiveAddr) {
      await storage.set('address', receiveAddr.address);
      walletStore.update(s => ({ ...s, address: receiveAddr.address }));
    }
  }

  walletStore.update(s => ({ ...s, hdState: newHdState }));
  console.log('[Wallet] HD discovery complete:', newHdState);

  // Re-aggregate balance/txs/UTXOs now that the full address set is known
  await refreshWalletData();
  return true;
}

/**
 * Switch the active address type, re-run HD discovery, and refresh wallet data.
 */
<<<<<<< HEAD
export async function switchAddressType(newType: 'segwit-native' | 'segwit-nested' | 'legacy'): Promise<void> {
  const state = getStoreValue();
  if (state.hdState?.addressType === newType) return;
  await runHdDiscovery(true, newType);
=======
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
>>>>>>> origin/main
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

  const allAddressStrings = new Set(addresses.map(a => a.address));

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
            txMap.set(rawTx.txid, mapRawTxMultiAddress(rawTx, allAddressStrings));
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

  try {
    const txMap = new Map<string, Transaction>();
    for (const addr of addresses) {
      try {
        const nextPage = await blockchain.getTransactions(addr.address, lastTxid);
        for (const rawTx of nextPage) {
          if (!txMap.has(rawTx.txid)) {
            txMap.set(rawTx.txid, mapRawTxMultiAddress(rawTx, allAddressStrings));
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
