/**
 * Background service worker for the Bold Wallet Chrome extension.
 */

import { BrantaServerBaseUrl } from "@branta-ops/branta";
import { BrantaService } from "@branta-ops/branta/v2";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: Error) =>
    console.error('[Bold] Failed to set side panel behavior:', error)
  );

const STAGING_BRANTA_BASE_URL = 'https://staging.guardrail.branta.pro';
const PRODUCTION_BRANTA_BASE_URL = 'https://guardrail.branta.pro';
const LOCALHOST_BRANTA_BASE_URL = 'http://localhost:3000';

const BRANTA_SERVER_TO_URL: Record<string, string> = {
  [BrantaServerBaseUrl.Staging]: STAGING_BRANTA_BASE_URL,
  [BrantaServerBaseUrl.Production]: PRODUCTION_BRANTA_BASE_URL,
  [BrantaServerBaseUrl.Localhost]: LOCALHOST_BRANTA_BASE_URL,
};

const brantaServiceCache = new Map<string, BrantaService>();
type BrantaPrivacyMode = 'strict' | 'loose';

function inferNetworkFromAddress(address: string): 'mainnet' | 'testnet' {
  const value = (address || '').trim().toLowerCase();
  if (value.startsWith('tb1') || value.startsWith('m') || value.startsWith('n') || value.startsWith('2')) {
    return 'testnet';
  }
  return 'mainnet';
}

function resolveBrantaBaseUrl(network: 'mainnet' | 'testnet'): string {
  if (network === 'testnet') {
    return BrantaServerBaseUrl.Staging;
  }
  return BrantaServerBaseUrl.Production;
}

function getCandidateBrantaBaseUrls(network: 'mainnet' | 'testnet'): string[] {
  // Strict environment routing: never cross-fallback between testnet and mainnet.
  return [resolveBrantaBaseUrl(network)];
}

function resolveBrantaHttpBaseUrl(serverOrUrl: string): string {
  const trimmed = (serverOrUrl || '').trim();
  if (!trimmed) return STAGING_BRANTA_BASE_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return BRANTA_SERVER_TO_URL[trimmed] || trimmed;
}

function getBrantaServiceForBaseUrl(baseUrl: string, privacy: BrantaPrivacyMode = 'strict'): BrantaService {
  const cacheKey = `${baseUrl}::${privacy}`;
  const cached = brantaServiceCache.get(cacheKey);
  if (cached) return cached;

  const service = new BrantaService({
    baseUrl: baseUrl as unknown as BrantaServerBaseUrl,
    privacy,
  });
  brantaServiceCache.set(cacheKey, service);
  return service;
}

function summarizePayloadShape(value: unknown): { kind: string; keys?: string[]; length?: number } {
  if (Array.isArray(value)) {
    return { kind: 'array', length: value.length };
  }
  if (value && typeof value === 'object') {
    return { kind: 'object', keys: Object.keys(value as Record<string, unknown>).slice(0, 16) };
  }
  return { kind: typeof value };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function pickFirstPaymentLike(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) {
    const first = raw.find((item) => item && typeof item === 'object');
    return asRecord(first);
  }

  const root = asRecord(raw);
  if (!root) return null;

  const paymentsValue = root.payments;
  if (Array.isArray(paymentsValue) && paymentsValue.length > 0) {
    const first = paymentsValue.find((item) => item && typeof item === 'object');
    return asRecord(first);
  }

  // Some environments may return merchant/profile fields at root instead of payments[].
  const merchant = asRecord(root.merchant);
  const profile = asRecord(root.profile);
  if (merchant || profile || root.logo || root.logoUrl || root.platformLogoUrl || root.name || root.merchantName || root.platform) {
    return root;
  }

  return null;
}

function normalizePaymentLike(rawPayment: Record<string, unknown>): Record<string, unknown> {
  const merchant = asRecord(rawPayment.merchant);
  const profile = asRecord(rawPayment.profile);
  const metadata = asRecord(rawPayment.metadata);

  return {
    merchantId: firstString(
      rawPayment.merchantId,
      rawPayment.id,
      rawPayment._id,
      merchant?.merchantId,
      merchant?.id,
      merchant?._id,
      profile?.merchantId,
      profile?.id,
      profile?._id,
    ),
    merchantName: firstString(
      rawPayment.merchantName,
      rawPayment.name,
      rawPayment.displayName,
      rawPayment.platform,
      merchant?.merchantName,
      merchant?.name,
      merchant?.displayName,
      merchant?.brandName,
      profile?.merchantName,
      profile?.name,
      profile?.displayName,
      profile?.brandName,
      'Verified Merchant',
    ),
    logoUrl: firstString(
      rawPayment.logoUrl,
      rawPayment.platformLogoUrl,
      rawPayment.logo,
      rawPayment.icon,
      rawPayment.image,
      rawPayment.imageUrl,
      merchant?.logoUrl,
      merchant?.platformLogoUrl,
      merchant?.logo,
      merchant?.icon,
      merchant?.image,
      merchant?.imageUrl,
      profile?.logoUrl,
      profile?.platformLogoUrl,
      profile?.logo,
      profile?.icon,
      profile?.image,
      profile?.imageUrl,
      metadata?.logoUrl,
      metadata?.logo,
    ),
    status: firstString(rawPayment.status, merchant?.status, profile?.status),
    riskLevel: firstString(rawPayment.riskLevel, rawPayment.risk, merchant?.riskLevel, profile?.riskLevel),
  };
}

async function fetchBrantaRawLookup(
  baseUrl: string,
  input: string,
): Promise<{ payment: Record<string, unknown>; verifyUrl?: string } | null> {
  const resolvedBaseUrl = resolveBrantaHttpBaseUrl(baseUrl);
  const trimmedBase = resolvedBaseUrl.replace(/\/+$/, '');
  const encodedInput = encodeURIComponent(input);
  const endpointName = '/v2/payments/{address}';
  const url = `${trimmedBase}/v2/payments/${encodedInput}`;

  try {
    console.log('[Branta] Raw API request', {
      baseUrl,
      resolvedBaseUrl: trimmedBase,
      endpoint: endpointName,
      encodedAddress: encodedInput,
      url,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const contentType = response.headers.get('content-type') || '';
    const bodyText = await response.text();
    const parsed = bodyText.trim() && contentType.toLowerCase().includes('application/json')
      ? (JSON.parse(bodyText) as unknown)
      : null;

    if (!response.ok) {
      const errorMessage = firstString(asRecord(parsed)?.error) || response.statusText;
      console.warn('[Branta] Raw API lookup non-ok response', {
        endpoint: endpointName,
        status: response.status,
        statusText: response.statusText,
        reason: errorMessage,
        url,
      });
      return null;
    }

    if (!bodyText.trim()) {
      console.log('[Branta] Raw API response empty body', {
        endpoint: endpointName,
        url,
      });
      return null;
    }

    if (!contentType.toLowerCase().includes('application/json') || parsed == null) {
      console.log('[Branta] Raw API response skipped (non-JSON)', {
        endpoint: endpointName,
        url,
        contentType,
        preview: bodyText.slice(0, 180),
      });
      return null;
    }

    console.log('[Branta] Raw API response payload', {
      endpoint: endpointName,
      url,
      shape: summarizePayloadShape(parsed),
      payload: parsed,
    });

    const paymentLike = pickFirstPaymentLike(parsed);
    if (!paymentLike) {
      return null;
    }

    const root = asRecord(parsed);
    const verifyUrl = firstString(root?.verifyUrl, paymentLike.verifyUrl);
    const normalized = normalizePaymentLike(paymentLike);
    return { payment: normalized, verifyUrl };
  } catch (error) {
    console.warn('[Branta] Raw API lookup failed', {
      endpoint: endpointName,
      reason: error instanceof Error ? error.message : String(error),
      url,
    });
    return null;
  }
}

function getBrantaService(
  network: 'mainnet' | 'testnet',
  privacy: BrantaPrivacyMode = 'strict',
): BrantaService {
  const baseUrl = resolveBrantaBaseUrl(network);
  const cacheKey = `${baseUrl}::${privacy}`;
  const cached = brantaServiceCache.get(cacheKey);
  if (cached) return cached;

  const service = new BrantaService({
    baseUrl: baseUrl as unknown as BrantaServerBaseUrl,
    privacy,
  });
  brantaServiceCache.set(cacheKey, service);
  return service;
}

// Message listener to interface with Svelte components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VERIFY_BRANTA_ADDRESS') {
    console.log('[Branta] VERIFY_BRANTA_ADDRESS received', {
      from: sender?.url || sender?.origin || 'unknown',
      networkHint: message.network,
      isQrCode: message.isQrCode === true,
      inputPreview: typeof message.address === 'string'
        ? `${message.address.slice(0, 6)}...${message.address.slice(-4)}`
        : 'invalid-input',
    });

    lookupBranta(message.address, message.network, message.isQrCode === true)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => {
        console.warn('[Branta] Message handler lookup failure', {
          reason: error instanceof Error ? error.message : String(error),
        });
        sendResponse({ success: false, data: null });
      });

    return true; // Keep async response channel open
  }
});

async function lookupBranta(
  input: string,
  networkHint?: 'mainnet' | 'testnet' | 'testnet4',
  isQrCode = false,
) {
  try {
    console.log('[Branta] Lookup start', {
      networkHint,
      isQrCode,
      inputPreview: `${input.slice(0, 6)}...${input.slice(-4)}`,
    });

    const network = networkHint === 'testnet' || networkHint === 'testnet4'
      ? 'testnet'
      : inferNetworkFromAddress(input);
    const privacy: BrantaPrivacyMode = isQrCode ? 'strict' : 'loose';
    const baseUrlsToTry = isQrCode
      ? [resolveBrantaBaseUrl(network)]
      : getCandidateBrantaBaseUrls(network);

    for (const baseUrl of baseUrlsToTry) {
      const service = getBrantaServiceForBaseUrl(baseUrl, privacy);
      const result = isQrCode
        ? await service.getPaymentsByQrCode(input)
        : await service.getPayments(input);
      const paymentsCount = Array.isArray(result?.payments) ? result.payments.length : 0;

      console.log('[Branta] Lookup attempt completed', {
        network,
        isQrCode,
        baseUrl,
        resolvedBaseUrl: resolveBrantaHttpBaseUrl(baseUrl),
        paymentsFound: paymentsCount,
        firstPaymentKeys: result?.payments?.[0] ? Object.keys(result.payments[0]).slice(0, 12) : [],
      });

      if (paymentsCount > 0) {
        // Return the first matched merchant payment profile and verification link
        return {
          payment: result!.payments[0],
          verifyUrl: result!.verifyUrl,
        };
      }

      // SDK currently expects an array payload for /v2/payments/{value};
      // if staging returns an object shape, run a raw fallback extractor.
      if (!isQrCode) {
        const rawFallback = await fetchBrantaRawLookup(baseUrl, input);
        if (rawFallback?.payment) {
          console.log('[Branta] Raw fallback produced merchant profile', {
            baseUrl,
            merchantName: rawFallback.payment.merchantName,
            hasLogo: !!rawFallback.payment.logoUrl,
          });
          return rawFallback;
        }
      }
    }

    console.log('[Branta] Lookup completed with no matching merchant profile', {
      network,
      isQrCode,
      attempts: baseUrlsToTry.length,
    });
    return null;
  } catch (error) {
    console.warn('[Branta] Lookup failed', {
      reason: error instanceof Error ? error.message : String(error),
      inputPreview: `${input.slice(0, 6)}...${input.slice(-4)}`,
    });
    // Silent fail for unverified or unknown addresses
    return null;
  }
}