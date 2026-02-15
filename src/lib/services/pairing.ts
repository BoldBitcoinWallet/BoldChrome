import { emit, on, off } from './socket';
import {
  requestPairingCode,
  setPairingCode,
  confirmPairing,
  setPairingError,
} from '../stores/device';
import type { Device } from '../stores/device';

export interface PairingResponse {
  pairingCode: string;
  webSocketId: string;
  expiresAt: string;
}

export interface ConfirmationData {
  webSocketId: string;
  mobileSocketId?: string;
  expiresAt?: string;
  status?: 'pending' | 'confirmed' | 'failed';
}

let pairingCodeTimeout: NodeJS.Timeout | null = null;

/**
 * Initiate pairing by requesting a code from the backend
 */
export function initiatePairing() {
  console.log('[Pairing] Initiating pairing...');

  requestPairingCode();
  // Request a pairing code from the backend (server expects 'requestPairingCode')
  emit('requestPairingCode');

  // Listen for pairing events from server
  on('pairingCode', handlePairingCode);
  on('pairingComplete', handlePairingComplete);
  on('pairingFailed', handlePairingFailed);
}

/**
 * Handle pairing code received from backend
 */
function handlePairingCode(data: PairingResponse) {
  console.log('[Pairing] Received code:', data.pairingCode);

  setPairingCode(data.pairingCode, data.expiresAt);

  // Set timeout to clear code when expired
  if (pairingCodeTimeout) clearTimeout(pairingCodeTimeout);

  const expiresAt = new Date(data.expiresAt).getTime();
  const timeUntilExpiry = expiresAt - Date.now();

  pairingCodeTimeout = setTimeout(() => {
    console.log('[Pairing] Code expired');
    setPairingError('Pairing code expired. Please request a new one.');
  }, timeUntilExpiry);
}

/**
 * Handle pairing confirmation from backend
 */
function handlePairingComplete(data: ConfirmationData) {
  console.log('[Pairing] Pairing complete!');

  if (pairingCodeTimeout) clearTimeout(pairingCodeTimeout);

  const pairedDevice: Device = {
    id: data.webSocketId,
    name: data.mobileSocketId ? 'Mobile Wallet' : 'Web App',
    type: data.mobileSocketId ? 'mobile' : 'chrome-extension',
    socketId: data.mobileSocketId,
    pairedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };

  confirmPairing(pairedDevice);

  // Clean up listeners
  cleanupListeners();
}

/**
 * Handle pairing failure
 */
function handlePairingFailed(data: { reason: string }) {
  console.error('[Pairing] Pairing failed:', data.reason);

  if (pairingCodeTimeout) clearTimeout(pairingCodeTimeout);

  setPairingError(data.reason);
  cleanupListeners();
}

/**
 * Submit pairing code (called from UI)
 */
export function submitPairingCode(code: string) {
  console.log('[Pairing] Submitting code...');
  // Server expects 'submitPairingCode' when mobile/web submits a code
  emit('submitPairingCode', { code });
}

/**
 * Cancel pairing
 */
export function cancelPairing() {
  console.log('[Pairing] Canceling pairing...');

  if (pairingCodeTimeout) clearTimeout(pairingCodeTimeout);
  cleanupListeners();
}

/**
 * Clean up event listeners
 */
function cleanupListeners() {
  off('pairingCode', handlePairingCode);
  off('pairingComplete', handlePairingComplete);
  off('pairingFailed', handlePairingFailed);
}
