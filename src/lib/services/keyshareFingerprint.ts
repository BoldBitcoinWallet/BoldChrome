import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Keyshare fingerprint shown alongside "Recent Transactions" — aligned with mobile:
 * SHA256 of `pub_key` string (UTF-8 bytes), first 8 hex characters, lowercase.
 */
export function keyshareFingerprint(pubKey?: string | null): string {
  const pk = (pubKey ?? '').trim();
  if (!pk) return 'N/A';
  try {
    const hash = bytesToHex(sha256(utf8ToBytes(pk)));
    return hash.substring(0, 8).toLowerCase();
  } catch {
    return 'N/A';
  }
}
