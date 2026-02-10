import { writable, derived } from 'svelte/store';
import { storage } from '../services/storage';

export interface Device {
  id: string;
  name: string;
  type: 'mobile' | 'chrome-extension';
  socketId?: string;
  pairedAt?: string;
  lastSeen?: string;
}

export interface PairingState {
  isPaired: boolean;
  pairingCode?: string;
  pairingCodeExpiresAt?: string;
  pairingStatus: 'idle' | 'requesting' | 'waiting' | 'confirmed' | 'failed';
  pairingError?: string;
}

interface DeviceStore {
  // Current device
  id: string;
  name: string;

  // Paired devices
  pairedDevices: Device[];

  // Pairing state
  pairing: PairingState;
}

const initialStore: DeviceStore = {
  id: '',
  name: 'Chrome Extension Wallet',
  pairedDevices: [],
  pairing: {
    isPaired: false,
    pairingStatus: 'idle',
  }
};

// Main store
export const deviceStore = writable<DeviceStore>(initialStore);

// Derived stores for convenience
export const isPaired = derived(deviceStore, $device => $device.pairing.isPaired);
export const pairingCode = derived(deviceStore, $device => $device.pairing.pairingCode);
export const pairedDevices = derived(deviceStore, $device => $device.pairedDevices);

/**
 * Load device store from storage on app start
 */
export async function initializeDeviceStore() {
  const deviceId = await storage.get<string>('deviceId');
  const deviceName = await storage.get<string>('deviceName') || 'Chrome Wallet';
  const pairedDevicesStr = await storage.get<string>('pairedDevices');

  const pairedDevices: Device[] = pairedDevicesStr
    ? JSON.parse(pairedDevicesStr)
    : [];

  deviceStore.set({
    id: deviceId || '',
    name: deviceName,
    pairedDevices,
    pairing: {
      isPaired: pairedDevices.length > 0,
      pairingStatus: 'idle',
    }
  });
}

/**
 * Request pairing code from backend
 */
export function requestPairingCode() {
  deviceStore.update(store => ({
    ...store,
    pairing: {
      ...store.pairing,
      pairingStatus: 'requesting'
    }
  }));
}

/**
 * Set pairing code (received from backend)
 */
export function setPairingCode(code: string, expiresAt: string) {
  deviceStore.update(store => ({
    ...store,
    pairing: {
      ...store.pairing,
      pairingCode: code,
      pairingCodeExpiresAt: expiresAt,
      pairingStatus: 'waiting'
    }
  }));
}

/**
 * Confirm pairing (called when backend confirms)
 */
export async function confirmPairing(pairedDevice: Device) {
  deviceStore.update(store => ({
    ...store,
    pairing: {
      ...store.pairing,
      isPaired: true,
      pairingStatus: 'confirmed',
      pairingCode: undefined,
    },
    pairedDevices: [...store.pairedDevices, pairedDevice]
  }));

  // Save to storage
  const newStore = (await new Promise(resolve =>
    deviceStore.subscribe(resolve)
  )) as DeviceStore;

  await storage.set('pairedDevices', JSON.stringify(newStore.pairedDevices));
}

/**
 * Pairing failed
 */
export function setPairingError(error: string) {
  deviceStore.update(store => ({
    ...store,
    pairing: {
      ...store.pairing,
      pairingStatus: 'failed',
      pairingError: error,
      pairingCode: undefined,
    }
  }));
}

/**
 * Reset pairing state
 */
export function resetPairingState() {
  deviceStore.update(store => ({
    ...store,
    pairing: {
      isPaired: store.pairing.isPaired,
      pairingStatus: 'idle',
      pairingError: undefined,
      pairingCode: undefined,
    }
  }));
}
