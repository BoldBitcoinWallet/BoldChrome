/**
 * MempoolClient — HTTP cache + in-flight deduplication + optional public-host failover.
 * Ported from BoldWallet/services/MempoolClient.ts (RN → extension: no session abort by default).
 *
 * Cache keys are host-independent (path + query + optional body) so mirrors can share entries
 * when failover is enabled via setPublicBases().
 */

// ---------------------------------------------------------------------------
// Config (BoldWallet HdOptionsConfig defaults, inlined for extension)
// ---------------------------------------------------------------------------

const DEFAULT_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_MEMPOOL_TTL_MS = 15_000;
const TRANSACTION_DB_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function combineSignals(
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): AbortSignal {
  if (!callerSignal) {
    return timeoutSignal;
  }
  const combined = new AbortController();

  if (callerSignal.aborted || timeoutSignal.aborted) {
    combined.abort();
    return combined.signal;
  }

  callerSignal.addEventListener('abort', () => combined.abort(), { once: true });
  timeoutSignal.addEventListener('abort', () => combined.abort(), { once: true });
  return combined.signal;
}

function parseRetryAfter(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const trimmed = value.trim();
  const asNum = parseInt(trimmed, 10);
  if (!Number.isNaN(asNum) && asNum > 0) return asNum;
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const seconds = Math.ceil((asDate - Date.now()) / 1000);
    return seconds > 0 ? seconds : null;
  }
  return null;
}

function stripHost(url: string): string {
  const m = url.match(/^https?:\/\/[^/]+(\/.*)/);
  return m ? m[1] : url;
}

function extractHost(url: string): string {
  const m = url.match(/^(https?:\/\/[^/]+)/);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MempoolResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  /** Present when status === 429 and server sent Retry-After (clamped 1–120 s). */
  retryAfterSeconds?: number;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const ADDRESS_TXS_TTL_PATTERN = /\/address\/[^/]+\/txs/;

const TTL_RULES: ReadonlyArray<[RegExp, number]> = [
  [/\/tx\/[a-fA-F0-9]{64}\/hex$/, 300_000],
  [/\/tx\/[a-fA-F0-9]{64}$/, 300_000],
  [/\/blocks\/tip\/height$/, 15_000],
  [/\/v1\/fees\/recommended/, 30_000],
  [/\/v1\/prices/, 60_000],
];

function ttlForUrl(url: string): number {
  if (ADDRESS_TXS_TTL_PATTERN.test(url)) {
    return TRANSACTION_DB_TTL_MS;
  }
  for (const [pattern, ttl] of TTL_RULES) {
    if (pattern.test(url)) {
      return ttl;
    }
  }
  return DEFAULT_MEMPOOL_TTL_MS;
}

function buildKey(url: string, body?: string): string {
  const path = stripHost(url);
  return body ? `${path}\x00${body}` : path;
}

const dbg = (...args: unknown[]) => {
  if (import.meta.env?.DEV) {
    console.debug('[MempoolClient]', ...args);
  }
};

// ---------------------------------------------------------------------------
// MempoolClient
// ---------------------------------------------------------------------------

class MempoolClient {
  private static _instance: MempoolClient;

  private readonly _cache = new Map<string, CacheEntry>();
  private readonly _inflight = new Map<string, Promise<MempoolResponse<unknown>>>();
  private _publicHosts: string[] = [];
  private _rrIndex = 0;

  private constructor() {}

  static getInstance(): MempoolClient {
    if (!MempoolClient._instance) {
      MempoolClient._instance = new MempoolClient();
    }
    return MempoolClient._instance;
  }

  setPublicBases(bases: string[]): void {
    const hosts = [
      ...new Set(
        bases
          .map(b => b.replace(/\/+$/, '').replace(/\/api\/?$/, ''))
          .filter(Boolean),
      ),
    ];
    this._publicHosts = hosts;
    dbg(
      'public hosts updated —',
      hosts.length ? hosts : '(cleared — no round-robin failover)',
    );
  }

  private _getUrlsToTryRoundRobin(url: string): string[] | null {
    if (this._publicHosts.length <= 1) return null;
    if (url.includes('/testnet/')) return null;

    const host = extractHost(url);
    if (!host || !this._publicHosts.includes(host)) return null;

    const path = url.slice(host.length);
    const urls: string[] = [];
    for (let i = 0; i < this._publicHosts.length; i++) {
      const idx = (this._rrIndex + i) % this._publicHosts.length;
      urls.push(this._publicHosts[idx] + path);
    }
    this._rrIndex = (this._rrIndex + 1) % this._publicHosts.length;
    return urls;
  }

  /**
   * GET JSON with cache + dedup + optional failover.
   */
  async get<T = unknown>(
    url: string,
    init?: RequestInit & { ttl?: number; timeoutMs?: number },
  ): Promise<MempoolResponse<T>> {
    const bodyStr = init?.body != null ? String(init.body) : undefined;
    const key = buildKey(url, bodyStr);
    const now = Date.now();

    const cached = this._cache.get(key);
    if (cached && cached.expiresAt > now) {
      dbg('cache hit', url.slice(-80));
      return { ok: true, status: 200, data: cached.data as T };
    }

    const existing = this._inflight.get(key);
    if (existing) {
      dbg('dedup in-flight', url.slice(-80));
      return existing as Promise<MempoolResponse<T>>;
    }

    const ttl = init?.ttl ?? ttlForUrl(url);
    const { ttl: _ttl, timeoutMs: timeoutOverride, signal: callerSignal, ...restInit } =
      (init ?? {}) as RequestInit & { ttl?: number; timeoutMs?: number };
    const fetchTimeoutMs = timeoutOverride ?? DEFAULT_FETCH_TIMEOUT_MS;

    const urls = this._getUrlsToTryRoundRobin(url) ?? [url];

    const promise = (async (): Promise<MempoolResponse<unknown>> => {
      let lastResult: MempoolResponse<unknown> | null = null;
      let lastError: unknown = null;

      try {
        for (let attempt = 0; attempt < urls.length; attempt++) {
          const tryUrl = urls[attempt];
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(
            () => timeoutController.abort(),
            fetchTimeoutMs,
          );
          const timeAndCaller = combineSignals(
            callerSignal as AbortSignal | undefined,
            timeoutController.signal,
          );

          try {
            const res = await fetch(tryUrl, { ...restInit, signal: timeAndCaller });
            clearTimeout(timeoutId);

            if (res.ok) {
              const data = (await res.json()) as unknown;
              this._cache.set(key, { data, expiresAt: Date.now() + ttl });
              dbg('fetched and cached', tryUrl.slice(-80), `(ttl ${ttl / 1000}s)`);
              return { ok: true, status: res.status, data };
            }

            dbg('non-ok response', res.status, tryUrl.slice(-80));
            await res.text().catch(() => {});
            const out: MempoolResponse<unknown> = {
              ok: false,
              status: res.status,
              data: null as unknown,
            };
            if (res.status === 429) {
              const raw = res.headers.get('Retry-After');
              const seconds = parseRetryAfter(raw);
              if (seconds != null) {
                out.retryAfterSeconds = Math.min(120, Math.max(1, seconds));
                dbg('429 Retry-After', raw, '→', out.retryAfterSeconds, 's');
              }
            }
            lastResult = out;

            if (attempt < urls.length - 1) {
              const doFailover =
                res.status >= 500 ||
                res.status === 429 ||
                (urls.length > 1 && !res.ok);
              if (doFailover) {
                dbg('failover →', urls[attempt + 1].slice(-80));
                continue;
              }
            }
            return out;
          } catch (err) {
            clearTimeout(timeoutId);
            lastError = err;
            dbg('fetch error', tryUrl.slice(-80), err);

            if ((callerSignal as AbortSignal | undefined)?.aborted) {
              throw err;
            }

            if (attempt < urls.length - 1) {
              dbg('failover →', urls[attempt + 1].slice(-80));
              continue;
            }
          }
        }

        if (lastResult) return lastResult;
        throw lastError;
      } finally {
        this._inflight.delete(key);
      }
    })();

    this._inflight.set(key, promise);
    return promise as Promise<MempoolResponse<T>>;
  }

  /**
   * GET plaintext (e.g. /tx/:id/hex, /blocks/tip/height).
   */
  async getText(
    url: string,
    init?: RequestInit & { ttl?: number; timeoutMs?: number },
  ): Promise<MempoolResponse<string>> {
    const bodyStr = init?.body != null ? String(init.body) : undefined;
    const key = `\x02TEXT\x02${buildKey(url, bodyStr)}`;
    const now = Date.now();

    const cached = this._cache.get(key);
    if (cached && cached.expiresAt > now) {
      dbg('cache hit text', url.slice(-80));
      return { ok: true, status: 200, data: String(cached.data) };
    }

    const existing = this._inflight.get(key);
    if (existing) {
      return existing as Promise<MempoolResponse<string>>;
    }

    const ttl = init?.ttl ?? ttlForUrl(url);
    const { ttl: _ttl, timeoutMs: timeoutOverride, signal: callerSignal, ...restInit } =
      (init ?? {}) as RequestInit & { ttl?: number; timeoutMs?: number };
    const fetchTimeoutMs = timeoutOverride ?? DEFAULT_FETCH_TIMEOUT_MS;
    const urls = this._getUrlsToTryRoundRobin(url) ?? [url];

    const promise = (async (): Promise<MempoolResponse<string>> => {
      let lastResult: MempoolResponse<string> | null = null;
      let lastError: unknown = null;

      try {
        for (let attempt = 0; attempt < urls.length; attempt++) {
          const tryUrl = urls[attempt];
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(
            () => timeoutController.abort(),
            fetchTimeoutMs,
          );
          const timeAndCaller = combineSignals(
            callerSignal as AbortSignal | undefined,
            timeoutController.signal,
          );

          try {
            const res = await fetch(tryUrl, { ...restInit, signal: timeAndCaller });
            clearTimeout(timeoutId);

            if (res.ok) {
              const data = await res.text();
              this._cache.set(key, { data, expiresAt: Date.now() + ttl });
              dbg('fetched text and cached', tryUrl.slice(-80));
              return { ok: true, status: res.status, data };
            }

            await res.text().catch(() => {});
            const out: MempoolResponse<string> = {
              ok: false,
              status: res.status,
              data: '',
            };
            if (res.status === 429) {
              const raw = res.headers.get('Retry-After');
              const seconds = parseRetryAfter(raw);
              if (seconds != null) {
                out.retryAfterSeconds = Math.min(120, Math.max(1, seconds));
              }
            }
            lastResult = out;

            if (attempt < urls.length - 1) {
              const doFailover =
                res.status >= 500 ||
                res.status === 429 ||
                (urls.length > 1 && !res.ok);
              if (doFailover) continue;
            }
            return out;
          } catch (err) {
            clearTimeout(timeoutId);
            lastError = err;
            if ((callerSignal as AbortSignal | undefined)?.aborted) {
              throw err;
            }
            if (attempt < urls.length - 1) continue;
          }
        }

        if (lastResult) return lastResult;
        throw lastError;
      } finally {
        this._inflight.delete(key);
      }
    })();

    this._inflight.set(key, promise);
    return promise;
  }

  /**
   * POST plaintext body (broadcast). Uncached.
   */
  async postPlain(
    url: string,
    body: string,
    init?: RequestInit & { timeoutMs?: number },
  ): Promise<MempoolResponse<string>> {
    const { timeoutMs: timeoutOverride, signal: callerSignal, ...restInit } =
      (init ?? {}) as RequestInit & { timeoutMs?: number };
    const fetchTimeoutMs = timeoutOverride ?? DEFAULT_FETCH_TIMEOUT_MS;
    const urls = this._getUrlsToTryRoundRobin(url) ?? [url];

    let lastResult: MempoolResponse<string> | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < urls.length; attempt++) {
      const tryUrl = urls[attempt];
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(
        () => timeoutController.abort(),
        fetchTimeoutMs,
      );
      const timeAndCaller = combineSignals(
        callerSignal as AbortSignal | undefined,
        timeoutController.signal,
      );

      try {
        const res = await fetch(tryUrl, {
          ...restInit,
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            ...restInit.headers,
          },
          body,
          signal: timeAndCaller,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.text();
          return { ok: true, status: res.status, data };
        }

        const errText = await res.text().catch(() => '');
        const out: MempoolResponse<string> = {
          ok: false,
          status: res.status,
          data: errText,
        };
        lastResult = out;

        if (attempt < urls.length - 1) {
          const doFailover =
            res.status >= 500 ||
            res.status === 429 ||
            (urls.length > 1 && !res.ok);
          if (doFailover) continue;
        }
        return out;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
        if ((callerSignal as AbortSignal | undefined)?.aborted) {
          throw err;
        }
        if (attempt < urls.length - 1) continue;
      }
    }

    if (lastResult) return lastResult;
    throw lastError;
  }

  invalidate(urlPrefix: string): void {
    const prefix = stripHost(urlPrefix);
    let count = 0;
    for (const key of [...this._cache.keys()]) {
      const pathKey = key.startsWith('\x02TEXT\x02') ? key.slice(7) : key;
      if (pathKey.startsWith(prefix)) {
        this._cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      dbg('invalidated', count, 'entries matching', prefix);
    }
  }

  invalidateAll(): void {
    const count = this._cache.size;
    this._cache.clear();
    dbg('full cache clear —', count, 'entries removed');
  }

  get cacheSize(): number {
    return this._cache.size;
  }

  get inflightCount(): number {
    return this._inflight.size;
  }
}

export const mempoolClient = MempoolClient.getInstance();
export default mempoolClient;
