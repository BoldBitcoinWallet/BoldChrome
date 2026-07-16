/**
 * Background service worker for the Bold Wallet Chrome extension.
 *
 * Configures the Native Side Panel API so clicking the toolbar icon
 * opens the wallet in Chrome's side panel instead of a floating popup.
 */

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: Error) =>
    console.error('[Bold] Failed to set side panel behavior:', error)
  );
