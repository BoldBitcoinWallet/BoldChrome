/**
 * Public mainnet mempool.space-compatible API mirror roots (protocol + hostname only).
 * Kept aligned with BoldBitcoinWallet/mempool-space-hosts README; requires matching
 * `host_permissions` in static/manifest.json.
 *
 * Failover applies only while the wallet uses the default mempool.space mainnet pool
 * (same behavior as BoldWallet getMainnetAPIList fallback semantics).
 */

export const DEFAULT_MAINNET_MEMPOOL_API_BASE: string =
  'https://mempool.space/api';

/** Mirrors for round-robin failover (BoldWallet mempool-space-hosts list). */
export const MAINNET_PUBLIC_MEMPOOL_MIRROR_ROOTS: readonly string[] = [
  'https://mempool.space',
  'https://strategy.mempool.space',
  'https://benpool.mempool.space',
  'https://mempool.emzy.de',
  'https://mempool.guide',
  'https://metaplanet.mempool.space',
  'https://mempool.orangefren.com',
];
