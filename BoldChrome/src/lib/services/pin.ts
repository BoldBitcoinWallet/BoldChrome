/**
 * PIN helpers for extension lock.
 * We only ever store/compare a hash of the PIN, never the raw PIN.
 */

import CryptoJS from 'crypto-js';

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 8;

export function hashPin(pin: string): string {
  return CryptoJS.SHA256(pin.trim()).toString();
}

export function verifyPin(pin: string, storedHash: string): boolean {
  if (!storedHash || !pin) return false;
  return hashPin(pin) === storedHash;
}

export function isPinValid(pin: string): boolean {
  const p = pin.trim();
  return /^\d+$/.test(p) && p.length >= PIN_MIN_LENGTH && p.length <= PIN_MAX_LENGTH;
}

export { PIN_MIN_LENGTH, PIN_MAX_LENGTH };
