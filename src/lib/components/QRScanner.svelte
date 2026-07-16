<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import jsQR from 'jsqr';
  
  export let onScan: (data: string) => void;
  export let onClose: () => void;
  
  let video: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let canvasContext: CanvasRenderingContext2D | null;
  let scanning = false;
  let stream: MediaStream | null = null;
  let error = '';
  let animationFrameId: number;
  let cameraStarted = false;

  onMount(async () => {
    // Initialize canvas context but don't start camera yet
    if (canvas) {
      canvasContext = canvas.getContext('2d');
    }
    
    // Auto-start camera when component mounts
    await startCamera();
  });

  async function startCamera() {
    if (cameraStarted) return;
    
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not available in this browser');
      }

      console.log('[QRScanner] Requesting camera permission...');
      
      // Request camera permission with more specific constraints
      stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      
      console.log('[QRScanner] Camera permission granted, starting video...');
      cameraStarted = true;
      
      if (video) {
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        
        // Wait for video to be ready
        await video.play();
        scanning = true;
        requestAnimationFrame(tick);
        
        console.log('[QRScanner] Video started successfully');
      }
    } catch (err) {
      console.error('[QRScanner] Camera error:', err);
      
      // Better error messages based on error type
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          error = 'Camera permission denied.\n\nTo enable camera:\n\n1. Click the camera icon (🎥) in your browser address bar\n2. Select "Always allow on this site"\n3. Click "Done" and try again';
        } else if (err.name === 'NotFoundError') {
          error = 'No camera found on this device.';
        } else if (err.name === 'NotReadableError') {
          error = 'Camera is already in use by another application.\n\nPlease close other apps using the camera and try again.';
        } else if (err.name === 'SecurityError') {
          error = 'Camera access blocked by browser security.\n\nCheck your browser settings to allow camera access for this extension.';
        } else {
          error = `Camera error: ${err.name}\n${err.message}`;
        }
      } else {
        error = err instanceof Error ? err.message : 'Failed to access camera';
      }
    }
  }

  onDestroy(() => {
    stopScanning();
  });

  function stopScanning() {
    scanning = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  }

  function tick() {
    if (!scanning || !video || !canvas || !canvasContext) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.height = video.videoHeight;
      canvas.width = video.videoWidth;
      canvasContext.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const imageData = canvasContext.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        stopScanning();
        onScan(code.data);
        return;
      }
    }

    animationFrameId = requestAnimationFrame(tick);
  }

  function handleClose() {
    stopScanning();
    onClose();
  }
</script>

<div class="scanner-overlay">
  <div class="scanner-modal">
    <div class="scanner-header">
      <button on:click={handleClose} class="close-btn">×</button>
    </div>
    
    {#if error}
      <div class="error">
        {#each error.split('\n') as line}
          {#if line.trim()}
            <p>{line}</p>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="scanner-container">
        <video bind:this={video} class="scanner-video"></video>
        <canvas bind:this={canvas} style="display: none;"></canvas>
        <div class="scanner-frame"></div>
      </div>
      <p class="help-text">Position QR code within the frame</p>
    {/if}
  </div>
</div>

<style>
  .scanner-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    backdrop-filter: blur(6px);
    padding: 12px;
    box-sizing: border-box;
  }

  .scanner-modal {
    background: var(--color-cardBackground);
    color: var(--color-text);
    border-radius: 20px;
    padding: 1rem 1.25rem 1.25rem;
    width: min(292px, 100%);
    max-width: 100%;
    max-height: min(560px, 100vh - 24px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    border: 1px solid var(--color-border);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
    box-sizing: border-box;
    margin: 0 auto;
  }

  .scanner-header {
    align-self: stretch;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    margin-bottom: 0.75rem;
    min-height: 36px;
  }

  .close-btn {
    background: rgba(255, 255, 255, 0.08);
    border: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-textSecondary);
    border-radius: 10px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    color: var(--color-accent);
    background: rgba(255, 193, 7, 0.1);
  }

  /* Square preview: video fills box; frame stays centered */
  .scanner-container {
    position: relative;
    width: min(260px, calc(100vw - 48px));
    max-width: 100%;
    aspect-ratio: 1 / 1;
    margin: 0 auto;
    background: #0a0a0a;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .scanner-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }

  .scanner-frame {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 72%;
    height: 72%;
    max-width: 220px;
    max-height: 220px;
    box-sizing: border-box;
    border: 3px solid var(--color-accent);
    border-radius: 12px;
    pointer-events: none;
    box-shadow:
      0 0 0 99999px rgba(0, 0, 0, 0.55),
      0 0 24px color-mix(in srgb, var(--color-accent) 45%, transparent);
  }

  .help-text {
    align-self: stretch;
    text-align: center;
    margin: 1rem 0 0;
    padding: 0 4px;
    color: var(--color-textSecondary);
    font-size: 0.875rem;
    line-height: 1.35;
  }

  .error {
    background: rgba(244, 67, 54, 0.08);
    color: var(--color-error);
    padding: 1.5rem;
    border-radius: 12px;
    margin-bottom: 1rem;
    line-height: 1.6;
    border: 1px solid rgba(244, 67, 54, 0.2);
    align-self: stretch;
    box-sizing: border-box;
  }

  .error p {
    margin: 0.5rem 0;
    color: rgba(244, 67, 54, 0.75);
  }

  .error p:first-child {
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--color-error);
  }
</style>
