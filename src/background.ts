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

const service = new BrantaService({
  baseUrl: BrantaServerBaseUrl.Production,
  privacy: 'strict',
});

// Message listener to interface with Svelte components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VERIFY_BRANTA_ADDRESS') {
    lookupBranta(message.address)
      .then((data) => sendResponse({ success: true, data }))
      .catch(() => sendResponse({ success: false, data: null }));

    return true; // Keep async response channel open
  }
});

async function lookupBranta(input: string, isQrCode = false) {
  try {
    const result = isQrCode
      ? await service.getPaymentsByQrCode(input)
      : await service.getPayments(input);

    if (!result || !result.payments || result.payments.length === 0) {
      return null;
    }

    // Return the first matched merchant payment profile and verification link
    return {
      payment: result.payments[0],
      verifyUrl: result.verifyUrl,
    };
  } catch (error) {
    // Silent fail for unverified or unknown addresses
    return null;
  }
}