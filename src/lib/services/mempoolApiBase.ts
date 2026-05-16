/**
 * Mempool REST base URL normalization (aligned with BoldWallet mempoolApiBase.ts).
 */

export function normalizeMempoolApiRoot(url: string): string {
  return (url || '').trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '');
}

/**
 * Normalize user-entered mempool API to end with `/api`.
 */
export function normalizeUserMempoolApiInput(url: string): string {
  if (!url || url.trim() === '') {
    return url;
  }
  let normalized = url.trim().replace(/\/+$/, '');
  if (!/\/api$/i.test(normalized)) {
    normalized = normalized + '/api';
  }
  return normalized;
}
