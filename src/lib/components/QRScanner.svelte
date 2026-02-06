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
      <h3>Scan QR Code</h3>
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
    background: var(--color-background);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(6px);
  }

  .scanner-modal {
    background: var(--color-cardBackground); color: var(--color-text);
    border-radius: 20px;
    padding: 1.5rem;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow: auto;
    border: 1px solid var(--color-border);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
  }

  .scanner-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .scanner-header h3 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--color-text);
    font-weight: 600;
  }

  .close-btn {
    background: rgba(255, 255, 255, 0.08);
    border: none;
    font-size: 1.5rem;
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

  .scanner-container {
    position: relative;
    width: 100%;
    background: var(--color-cardBackground); /* themed background for camera area */
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 320px; /* ensure camera area is large enough for frame */
  }

  .scanner-frame {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 220px;
    height: 220px;
    border: 3px solid var(--color-accent);
    border-radius: 12px;
    box-shadow: 0 0 0 99999px rgba(0,0,0,0.03), 0 0 30px var(--color-accent);
  }

  .help-text {
    text-align: center;
    margin-top: 1rem;
    color: var(--color-textSecondary);
    font-size: 0.9rem;
  }

  .scanner-video {
    width: 100%;
    height: 100%;
    min-height: 320px;
    display: block;
    object-fit: cover; /* ensure video fills the container and doesn't appear small */
  }

  .scanner-frame {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 250px;
    height: 250px;
    border: 3px solid var(--color-accent);
    border-radius: 16px;
    box-shadow: 0 0 0 99999px rgba(0, 0, 0, 0.6),
                0 0 30px var(--color-accent),
                inset 0 0 20px rgba(255,193,7,0.1);
  }

  .help-text {
    text-align: center;
    margin-top: 1rem;
    color: var(--color-textSecondary);
    font-size: 0.9rem;
  }

  .error {
    background: rgba(244,67,54,0.08);
    color: var(--color-error);
    padding: 1.5rem;
    border-radius: 12px;
    margin-bottom: 1rem;
    line-height: 1.6;
    border: 1px solid rgba(244,67,54,0.2);
  }

  .error p {
    margin: 0.5rem 0;
    color: rgba(244,67,54,0.6);
  }

  .error p:first-child {
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--color-error);
  }
</style>
