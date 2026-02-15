/**
 * Extension-side Bold bind parsing (swimlanes.io spec).
 * Aligned with mobile app: utils/extensionBind.ts (BoldWallet).
 *
 * When the extension scans the mobile response QR (base64, 67 bytes):
 * - cipher = response[0:65], checksum = response[65:67]
 * - pairing_key = sha256(pairing_code)
 * - payload = cipher XOR pairing_key
 * - pub_key = payload_hex[0:66], chain_code = payload_hex[66:130]
 * - valid = (sha256(pub_key+chain_code+pairing_code)[0:4] === checksum)
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const RESPONSE_BYTES_LEN = 67;
const CIPHER_BYTES_LEN = 65;
const PAYLOAD_HEX_LEN = 130;

function sha256Hex(data: string): string {
  return bytesToHex(sha256(utf8ToBytes(data)));
}

/** XOR two byte arrays (key repeated if shorter). */
function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

/** Base64 decode to Uint8Array (browser-safe). */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export type ParseExtensionResponseResult = {
  pubKey: string;
  chainCode: string;
  valid: boolean;
};

/**
 * Parse the mobile response QR (base64, 67 bytes), decipher, extract pub_key/chain_code, validate checksum.
 */
export function parseExtensionResponse(
  responseBase64: string,
  pairingCode: string
): ParseExtensionResponseResult {
  const responseBytes = base64ToBytes(responseBase64.trim());
  if (responseBytes.length !== RESPONSE_BYTES_LEN) {
    throw new Error(
      `Invalid response length: expected ${RESPONSE_BYTES_LEN} bytes, got ${responseBytes.length}`
    );
  }
  const cipherBytes = responseBytes.subarray(0, CIPHER_BYTES_LEN);
  const checksumBytes = responseBytes.subarray(CIPHER_BYTES_LEN, RESPONSE_BYTES_LEN);

  const pairingKeyHex = sha256Hex(pairingCode);
  const pairingKeyBytes = hexToBytes(pairingKeyHex);
  const payloadBytes = xorBytes(cipherBytes, pairingKeyBytes);
  const payloadHex = bytesToHex(payloadBytes);
  if (payloadHex.length !== PAYLOAD_HEX_LEN) {
    throw new Error(
      `Invalid payload hex length: expected ${PAYLOAD_HEX_LEN}, got ${payloadHex.length}`
    );
  }
  const pubKey = payloadHex.slice(0, 66);
  const chainCode = payloadHex.slice(66, 130);

  const integrityHash = sha256Hex(`${pubKey}${chainCode}${pairingCode}`);
  const expectedChecksumHex = integrityHash.slice(0, 4);
  const expectedChecksumBytes = hexToBytes(expectedChecksumHex);
  const valid =
    expectedChecksumBytes.length === checksumBytes.length &&
    expectedChecksumBytes.every((b, i) => b === checksumBytes[i]);

  return { pubKey, chainCode, valid };
}

/**
 * Returns true if the scanned string looks like a Bold bind response (base64 decoding to 67 bytes).
 */
export function isBoldBindResponse(qrText: string): boolean {
  const s = qrText.trim();
  if (s.length < 80 || s.length > 200) return false;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(s)) return false;
  try {
    const bytes = base64ToBytes(s);
    return bytes.length === RESPONSE_BYTES_LEN;
  } catch {
    return false;
  }
}

const BOLD_BIND_PAIRING_CODE_KEY = 'boldBindPairingCode';

export function getBoldBindPairingCodeStorageKey(): string {
  return BOLD_BIND_PAIRING_CODE_KEY;
}
