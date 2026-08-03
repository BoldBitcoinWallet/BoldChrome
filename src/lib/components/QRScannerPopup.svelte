<script lang="ts">
  /// <reference types="chrome" />
  import { onMount, onDestroy, tick } from 'svelte';
  import { Html5Qrcode } from 'html5-qrcode';
  
  export let onScan: (data: string) => void | Promise<any>;
  export let onClose: () => void;
  
  let scanner: Html5Qrcode | null = null;
  let scannerStatus = 'Checking camera permission...';
  let hasError = false;
  let isScanning = false;
  let needsPermission = false;
  let permissionCheckComplete = false;

  async function checkCameraPermission(): Promise<boolean> {
    try {
      // Check if Permissions API is available
      if ('permissions' in navigator && navigator.permissions) {
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        return result.state === 'granted';
      }
      
      // Fallback: try to enumerate devices
      const nav = navigator as Navigator;
      if (nav.mediaDevices) {
        const devices = await nav.mediaDevices.enumerateDevices();
        const hasCamera = devices.some((device: MediaDeviceInfo) => device.kind === 'videoinput');
        
        if (!hasCamera) {
          return false;
        }
      }
      
      // If devices exist but we can't check permission, assume we need to request
      return false;
    } catch (err) {
      console.error('Permission check error:', err);
      return false;
    }
  }

  async function initializeScanner() {
    permissionCheckComplete = false;
    const hasPermission = await checkCameraPermission();
    permissionCheckComplete = true;
    
    if (hasPermission) {
      // Permission already granted, start scanner immediately
      startScanner();
    } else {
      // Need to request permission
      needsPermission = true;
      scannerStatus = 'Camera permission required';
    }
  }

  function requestPermission() {
    // Open permission page in new tab (using static HTML file)
    chrome.tabs.create({ 
      url: chrome.runtime.getURL('permission-grant.html'),
      active: true
    });
    
    // Listen for permission grant
    chrome.storage.onChanged.addListener(handlePermissionGranted);
  }

  function handlePermissionGranted(changes: any, namespace: string) {
    if (namespace === 'local' && changes.cameraPermissionGranted) {
      // Permission was granted, remove listener and start scanner
      chrome.storage.onChanged.removeListener(handlePermissionGranted);
      chrome.storage.local.remove('cameraPermissionGranted');
      
      needsPermission = false;
      startScanner();
    }
  }
  
  let videoObserver: MutationObserver | null = null;

  async function waitForScannerHost(maxAttempts = 6): Promise<HTMLElement | null> {
    for (let i = 0; i < maxAttempts; i++) {
      await tick();
      const host = document.getElementById('qr-reader');
      if (host) return host;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return null;
  }

  async function stopScanner() {
    if (!scanner) return;

    try {
      // stop() may throw synchronously or return a rejecting promise
      const maybePromise = scanner.stop();
      if (maybePromise && typeof (maybePromise as any).catch === 'function') {
        await (maybePromise as Promise<void>).catch(err => console.error('Stop error:', err));
      }
    } catch (err) {
      console.error('Stop sync error:', err);
    } finally {
      // clean up any observer we created to enforce video sizing
      if (videoObserver) {
        try { videoObserver.disconnect(); } catch (e) { /* ignore */ }
        videoObserver = null;
      }

      isScanning = false;
      scanner = null;
    }
  }

  async function startScanner() {
    hasError = false;
    scannerStatus = 'Starting camera...';

    await tick();

    try {
      if (scanner) {
        await stopScanner();
      }

      const scannerHost = await waitForScannerHost();
      if (!scannerHost) {
        console.warn('Scanner host not ready yet; skipping start attempt');
        return;
      }

      scanner = new Html5Qrcode(scannerHost.id);

      const config = {
        fps: 15,
        qrbox: { width: 280, height: 280 },
        aspectRatio: 1.0,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        },
        videoConstraints: {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      await scanner.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          console.log('QR Code scanned:', decodedText);
          scannerStatus = 'QR Code detected!';

          await stopScanner();

          // Indicate we're processing and handle any errors from the parent handler
          scannerStatus = 'Processing scanned QR...';
          try {
            const result = onScan && onScan(decodedText);
            // If the parent handler returned a promise, wait for it to finish
            if (result && typeof (result as Promise<any>).then === 'function') {
              await (result as Promise<any>);
            }
            scannerStatus = 'Processing complete';
          } catch (err) {
            console.error('Error handling scanned QR in parent handler:', err);
            hasError = true;
            scannerStatus = 'Failed to process QR code';
          }
        },
        () => {
          // Normal per-frame errors when no QR in view
        }
      );

      isScanning = true;
      scannerStatus = 'Point camera at QR code';

      // Ensure the library-inserted <video> doesn't get constrained by inline styles
      // The html5-qrcode library may set element.style.width/height; enforce the correct sizing
      await tick();

      const enforceVideoSizing = (video: HTMLVideoElement | null) => {
        if (!video) return;
        // remove attribute-based width/height if present
        try { video.removeAttribute('width'); video.removeAttribute('height'); } catch (e) {}
        // explicitly set to fill (these are inline but intentional)
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.position = 'absolute';
        video.style.top = '0';
        video.style.left = '0';
        video.style.objectFit = 'cover';
        video.style.borderRadius = 'inherit';
      };

      // Apply immediately if the element exists now
      const currentVideo = document.querySelector('#qr-reader video') as HTMLVideoElement | null;
      enforceVideoSizing(currentVideo);

      // Watch for any attribute/style changes and re-apply sizing if the library mutates them
      if (currentVideo) {
        videoObserver = new MutationObserver(muts => {
          for (const m of muts) {
            if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'width' || m.attributeName === 'height')) {
              enforceVideoSizing(currentVideo);
            }
          }
        });
        try {
          videoObserver.observe(currentVideo, { attributes: true, attributeFilter: ['style', 'width', 'height'] });
        } catch (e) {
          // keep going if observe fails in some environments
          console.error('Observer error:', e);
        }
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (/qr-reader not found/i.test(errMsg)) {
        console.warn('Scanner start deferred: qr-reader host missing during mount transition');
        return;
      }
      console.error('Scanner camera start error:', err);
      hasError = true;
      scannerStatus = 'Unable to start camera';
    }
  }
  
  onMount(() => {
    initializeScanner();
  });
  
  onDestroy(() => {
    // Ensure we stop the scanner when the component is destroyed
    stopScanner().catch(err => console.error('Cleanup stop error:', err));
  });

  function handleRetry() {
    startScanner();
  }

  function handleStartCamera() {
    startScanner();
  }

  async function handleCancel() {
    // Stop scanner safely and notify parent
    await stopScanner();
    onClose();
  }
  
  function openChromeSettings() {
    // Open chrome settings for the extension
    window.open('chrome://settings/content/camera', '_blank');
  }
</script>

<div class="qr-popup-root">
  <div class="scanner-container" role="region" aria-label="QR scanner">
    <div class="scanner-header">
      <p class="status" class:error={hasError}>{scannerStatus}</p>
    </div>
  
  {#if !permissionCheckComplete}
    <div class="loading">
      <p class="loading-text">Checking camera permission...</p>
    </div>
  {:else if needsPermission}
    <div class="permission-prompt">
      <p class="prompt-text">📷 Camera Permission Required</p>
      <p class="prompt-hint">A new tab will open to request camera access. After granting permission, close the tab and the scanner will start automatically.</p>
      <button class="btn-permission" on:click={requestPermission}>Grant Camera Permission</button>
    </div>
  {:else}
    <div id="qr-reader" class="qr-reader"></div>
    
    {#if hasError}
      <button class="btn-retry" on:click={handleRetry}>🔄 Retry Camera</button>
    {/if}
  {/if}
  
  <div class="scanner-footer">
    <button class="btn-cancel" on:click={handleCancel}>Cancel</button>
  </div>
</div>
</div>

<style>
  .qr-popup-root {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .scanner-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 100%;
    padding: 0;
    background: transparent;
    border-radius: 12px;
    box-sizing: border-box;
  }
  
  .scanner-header {
    text-align: center;
    width: 100%;
    padding: 0;
  }
  
  .status {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text);
  }
  
  .status.error {
    color: var(--color-error);
  }
  
  /* Override html5-qrcode default styles */
  :global(#qr-reader video) {
    border-radius: inherit;
  }

  /* Ensure #qr-reader fills available width within the popup and has a sensible min-height */
  .qr-reader {
    width: 100%;
    max-width: 280px;
    aspect-ratio: 1 / 1;
    height: auto;
    border-radius: 12px;
    overflow: hidden;
    background: var(--color-cardBackground, #f3f4f6);
    display: block;
    margin: 0 auto;
    border: 1px solid var(--color-border, rgba(0, 0, 0, 0.1));
    box-sizing: border-box;
  }

  :global(#qr-reader) {
    width: 100%;
    max-width: none;
    height: 100%;
    display: block;
    box-sizing: border-box;
    position: relative;
  }

  :global(#qr-reader__scan_region) {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden; /* ensure anything outside bounds is clipped */
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Force the inserted <video> to absolutely fill its scan region and match container shape */
  :global(#qr-reader video),
  :global(#qr-reader__scan_region video),
  :global(#qr-reader .scanner-video) {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    object-fit: cover;
    display: block;
    border-radius: inherit;
    transform: none !important; /* neutralize any transform-based centering */
  }

  /* Hide html5-qrcode UI elements we don't want */
  :global(#qr-reader__dashboard) {
    display: none;
  }
  
  :global(#qr-reader img) {
    display: none;
  }
  
  .loading {
    text-align: center;
    padding: 32px;
  }
  
  .loading-text {
    font-size: 14px;
    color: var(--color-textSecondary);
    margin: 0;
  }
  
  .permission-prompt {
    text-align: center;
    padding: 24px;
    background: var(--color-cardBackground);
    border-radius: 12px;
    border: 2px dashed var(--color-border);
    max-width: 280px;
    width: 100%;
    box-sizing: border-box;
  }
  
  .prompt-text {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 8px 0;
  }
  
  .prompt-hint {
    font-size: 13px;
    color: var(--color-textSecondary);
    margin: 0 0 16px 0;
    line-height: 1.5;
  }
  
  /* Use consistent modern button styles */
  .btn-permission, .btn-retry {
    background: linear-gradient(135deg, var(--color-subPrimary) 0%, var(--color-primary) 100%);
    color: var(--color-textOnPrimary);
    border: none;
    padding: 12px 20px;
    height: 44px;
    border-radius: 12px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    width: 100%;
    box-shadow: 0 6px 18px rgba(0,0,0,0.08);
  }

  .btn-permission:hover, .btn-retry:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  }

  .btn-retry {
    width: auto;
    padding: 10px 18px;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    box-shadow: none;
  }

  .btn-retry:hover {
    background: var(--color-cardBackground);
  }  
  .scanner-footer {
    margin-top: 4px;
    width: 100%;
    display: flex;
    justify-content: center;
  }
  
  .btn-cancel {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 10px 24px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .btn-cancel:hover {
    background: var(--color-cardBackground);
  }

  .btn-cancel:hover {
    background: var(--color-cardBackground);
    border-color: var(--color-border);
  }
</style>
