/**
 * QR Code Service
 * Handles QR code generation for communication with mobile app
 * Supports pairing, address requests, and PSBT signing
 */

import QRCode from 'qrcode';
import CryptoJS from 'crypto-js';
import logo from '$lib/assets/logo.png';
import { writable } from 'svelte/store';
import { updateWalletFromPairing, updateAddresses } from '$lib/stores/wallet';
import { psbt } from './psbt';
import {
  parseExtensionResponse,
  isBoldBindResponse,
  getBoldBindPairingCodeStorageKey,
} from './extensionBind';

export type QRDataType = 
  | 'pairing' 
  | 'address_request' 
  | 'psbt_signing' 
  | 'pairing_response' 
  | 'pairing_code' /* short numeric pairing codes (4-8 digits) from some mobile flows */
  | 'address_response' 
  | 'psbt_signed'
  | 'public_key'
  | 'bitcoin_address'
  | 'payment_request';

export interface QRData {
  type: QRDataType;
  data: any;
  timestamp: number;
  id: string;
}

export interface QRSession {
  id: string;
  type: QRData['type'];
  qrCodeDataUrl?: string;
  status: 'generating' | 'awaiting_scan' | 'completed' | 'failed';
  createdAt: number;
  result?: any;
  error?: string;
}

/**
 * Encode send-bitcoin QR payload (v5 format — matches mobile's decodeSendBitcoinQR).
 * toAddress|amount|fee|spendingHash|addressType|derivationPath|network|utxosJson|changeAddress
 */
export const encodeSendBitcoinQR = (
  toAddress: string,
  amountSats: number | string,
  feeSats: number | string,
  spendingHash: string = '',
  addressType: string = '',
  derivationPath: string = '',
  network: string = '',
  utxosJson: string = '',
  changeAddress: string = ''
): string => {
  const amount = typeof amountSats === 'string' ? amountSats : amountSats.toString();
  const fee = typeof feeSats === 'string' ? feeSats : feeSats.toString();
  return `${toAddress}|${amount}|${fee}|${spendingHash || ''}|${addressType || ''}|${derivationPath || ''}|${network || ''}|${utxosJson || ''}|${changeAddress || ''}`;
};

class QRService {
  private currentSession = writable<QRSession | null>(null);
  public session = { subscribe: this.currentSession.subscribe };

  private async generateQRCode(data: unknown): Promise<string> {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);

    if (typeof document === 'undefined') {
      return QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 360,
        color: { dark: '#000000', light: '#ffffff' }
      });
    }

    const canvas = document.createElement('canvas');

    await QRCode.toCanvas(canvas, payload, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 360,
      color: { dark: '#000000', light: '#ffffff' }
    });

    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/png');

    const img: HTMLImageElement = new Image();
    img.src = logo;
    const decodeFn = (img as HTMLImageElement & { decode?: () => Promise<void> }).decode;
    if (typeof decodeFn === 'function') {
      try {
        await decodeFn.call(img);
      } catch {
        // fallback to onload
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load logo'));
        });
      }
    } else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load logo'));
      });
    }

    const size = Math.round(canvas.width * 0.22);
    const x = (canvas.width - size) / 2;
    const y = (canvas.height - size) / 2;
    const radius = Math.round(size * 0.18);

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + size - radius, y);
    ctx.quadraticCurveTo(x + size, y, x + size, y + radius);
    ctx.lineTo(x + size, y + size - radius);
    ctx.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
    ctx.lineTo(x + radius, y + size);
    ctx.quadraticCurveTo(x, y + size, x, y + size - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.drawImage(img, x, y, size, size);

    return canvas.toDataURL('image/png');
  }

  /**
   * Generate pairing QR code requesting public key from mobile
   */
  async generatePairingQR(): Promise<string> {
    const id = `pair-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const qrData: QRData = {
      type: 'pairing',
      data: {
        action: 'request_public_key',
        extensionId: chrome?.runtime?.id || 'web',
        timestamp: Date.now()
      },
      timestamp: Date.now(),
      id
    };

    console.log('[QR Service] Generating public key request QR:', qrData);

    const qrCodeDataUrl = await this.generateQRCode(qrData);

    this.currentSession.set({
      id,
      type: 'pairing',
      qrCodeDataUrl,
      status: 'awaiting_scan',
      createdAt: Date.now()
    });

    console.log('[QR Service] Public key request QR generated successfully');
    return qrCodeDataUrl;
  }

  /**
   * Generate Bold bind pairing QR (swimlanes.io): shows pairing_code=XXXX for mobile to scan.
   * Stores the code so when the user scans the mobile response QR we can decipher it.
   */
  async generatePairingCodeQR(): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const key = getBoldBindPairingCodeStorageKey();
    await new Promise<void>((resolve) =>
      chrome.storage.local.set({ [key]: code }, resolve)
    );
    const payload = `pairing_code=${code}`;
    const qrCodeDataUrl = await this.generateQRCode(payload);
    const id = `pair-code-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.currentSession.set({
      id,
      type: 'pairing',
      qrCodeDataUrl,
      status: 'awaiting_scan',
      createdAt: Date.now(),
    });
    console.log('[QR Service] Bold bind pairing_code QR generated:', payload);
    return qrCodeDataUrl;
  }

  /**
   * Generate QR code for address request
   */
  async requestAddresses(): Promise<string> {
    const id = `addr-req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const qrData: QRData = {
      type: 'address_request',
      data: {
        action: 'get_addresses',
        maxAddresses: 3
      },
      timestamp: Date.now(),
      id
    };

    const qrCodeDataUrl = await this.generateQRCode(qrData);

    this.currentSession.set({
      id,
      type: 'address_request',
      qrCodeDataUrl,
      status: 'awaiting_scan',
      createdAt: Date.now()
    });

    return qrCodeDataUrl;
  }

  /**
   * Generate QR code for PSBT signing
   */
  async generatePsbtQR(psbt: string): Promise<string> {
    const id = `psbt-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const qrData: QRData = {
      type: 'psbt_signing',
      data: {
        psbt,
        action: 'sign'
      },
      timestamp: Date.now(),
      id
    };

    const qrCodeDataUrl = await this.generateQRCode(qrData);

    this.currentSession.set({
      id,
      type: 'psbt_signing',
      qrCodeDataUrl,
      status: 'awaiting_scan',
      createdAt: Date.now()
    });

    return qrCodeDataUrl;
  }

  /**
   * Generate a plain QR code for a receive address (no logo overlay for reliable scanning).
   */
  async generateAddressQR(address: string): Promise<string> {
    return QRCode.toDataURL(address, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 200,
      color: { dark: '#000000', light: '#ffffff' }
    });
  }

  /**
   * Generate a simple send QR (plain pipe-separated format) intended to populate the mobile
   * send flow. Uses encodeSendBitcoinQR and sets spendingHash = sha256(qrData + Date.now()).
   */
  async generateSendQR(
    toAddress: string,
    amountSats: number | string,
    feeSats: number | string,
    spendingHash: string = '',
    addressType: string = '',
    derivationPath: string = '',
    network: string = '',
    utxosJson: string = '',
    changeAddress: string = ''
  ): Promise<{ dataUrl: string; payload: string }> {
    const id = `send-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const basePayload = encodeSendBitcoinQR(toAddress, amountSats, feeSats, '', addressType, derivationPath, network, utxosJson, changeAddress);
    const computedHash = spendingHash || CryptoJS.SHA256(basePayload + Date.now()).toString();
    const payload = encodeSendBitcoinQR(toAddress, amountSats, feeSats, computedHash, addressType, derivationPath, network, utxosJson, changeAddress);

    try {
      const dataUrl = await this.generateQRCode(payload);

      this.currentSession.set({
        id,
        type: 'payment_request',
        qrCodeDataUrl: dataUrl,
        status: 'awaiting_scan',
        createdAt: Date.now(),
        result: { payload }
      });

      return { dataUrl, payload };
    } catch (err) {
      console.error('[QR] Failed to generate send QR', err);
      throw err;
    }
  }

  /**
   * Process scanned QR code data
   * Supports multiple formats: JSON pairing data, raw public keys, Bitcoin addresses, etc.
   */
  async processScanedQR(qrText: string): Promise<{ type: QRDataType; data: any }> {
    try {
      console.log('[QR] Processing scanned data:', qrText.substring(0, 100) + '...');

      // Bold mobile bind response (swimlanes.io): base64 67-byte response from mobile
      if (typeof qrText === 'string' && isBoldBindResponse(qrText)) {
        const storageKey = getBoldBindPairingCodeStorageKey();
        const stored = await new Promise<Record<string, string | undefined>>((resolve) => {
          chrome.storage.local.get([storageKey], (items: Record<string, string | undefined>) => {
            resolve(items);
          });
        });
        const code = stored?.[storageKey];
        if (!code) {
          throw new Error(
            'No pairing code in session. Show the extension pairing QR first (pairing_code=...), then scan the mobile response.'
          );
        }
        const result = parseExtensionResponse(qrText.trim(), code);
        if (!result.valid) {
          throw new Error(
            'Invalid response: checksum mismatch. Ensure you scanned the QR from the Bold mobile app.'
          );
        }
        const pairingData = {
          publicKey: result.pubKey,
          chainCode: result.chainCode,
          deviceId: 'mobile-wallet',
          network: 'mainnet',
        };
        await this.handlePairingResponse(pairingData);
        return { type: 'pairing_response', data: pairingData };
      }

      // Compact encrypted pairing payload: pair:<cipherB64Url>.<ivHex>.<code>
      if (typeof qrText === 'string' && qrText.trim().startsWith('pair:')) {
        const compact = qrText.trim().slice(5);
        const parts = compact.split('.');
        let cipherUrl: string | undefined;
        let ivHex: string | undefined;
        let code: string | undefined;

        if (parts.length >= 3) {
          [cipherUrl, ivHex, code] = parts;
        } else {
          // Fallback: infer from suffix (32 hex iv + 6-digit code)
          const suffixMatch = compact.match(/([A-Za-z0-9_-]+)([0-9a-fA-F]{32})(\d{6})$/);
          if (suffixMatch) {
            cipherUrl = suffixMatch[1];
            ivHex = suffixMatch[2];
            code = suffixMatch[3];
          }
        }

        if (cipherUrl && ivHex && code) {
          const cipher = cipherUrl
            .replace(/-/g, '+')
            .replace(/_/g, '/');
          const padded = cipher + '='.repeat((4 - (cipher.length % 4)) % 4);
          const pairingData = await this.processPairingData({ c: padded, i: ivHex, k: code });
          return { type: 'pairing_response', data: pairingData };
        }
      }
      
      // First, try to parse as JSON (structured QR data)
      try {
        const qrData = JSON.parse(qrText);
        console.log('[QR] Parsed as JSON, type:', qrData.type);

        // Handle structured QR data with explicit type
        if (qrData.type === 'pairing_response') {
          const pairingData = await this.processPairingData(qrData.data);
          return { type: 'pairing_response', data: pairingData };
        } else if (qrData.type === 'address_response') {
          this.handleAddressResponse(qrData.data);
          return { type: 'address_response', data: qrData.data };
        } else if (qrData.type === 'psbt_signed') {
          this.handleSignedPsbt(qrData.data);
          return { type: 'psbt_signed', data: qrData.data };
        } else if (qrData.type === 'public_key') {
          // Direct public key sharing
          const pairingData = await this.processPairingData(qrData.data);
          return { type: 'public_key', data: pairingData };
        }
        
        // Handle JSON without explicit type but with publicKey field (common mobile app format)
        if (qrData.publicKey) {
          console.log('[QR] JSON contains publicKey, treating as pairing response');
          const pairingData = {
            publicKey: qrData.publicKey,
            chainCode: qrData.chainCode,
            deviceId: qrData.deviceId || 'mobile-wallet',
            network: qrData.network || 'mainnet',
            address: qrData.address,
            addresses: qrData.addresses
          };
          const processed = await this.processPairingData(pairingData);
          return { type: 'pairing_response', data: processed };
        }

        // Handle JSON with just data field (wrapped format)
        if (qrData.data && qrData.data.publicKey) {
          console.log('[QR] JSON data field contains publicKey');
          const pairingData = await this.processPairingData(qrData.data);
          return { type: 'pairing_response', data: pairingData };
        }

        this.currentSession.update(s => s ? { ...s, status: 'completed', result: qrData } : null);
        return { type: qrData.type || 'pairing_response', data: qrData };
      } catch (jsonErr) {
        // Not valid JSON on first pass — try tolerating common encodings and wrappers
        console.log('[QR] Not valid JSON, trying tolerant parsing. Raw preview:', qrText.substring(0, 200));

        let candidate = qrText.trim();

        // Remove surrounding quotes if present
        if ((candidate.startsWith('"') && candidate.endsWith('"')) || (candidate.startsWith("'") && candidate.endsWith("'"))) {
          candidate = candidate.slice(1, -1);
        }

        // Try decodeURIComponent if it appears encoded
        if (/%7B|%22/.test(candidate)) {
          try {
            const decoded = decodeURIComponent(candidate);
            candidate = decoded;
            console.log('[QR] decodeURIComponent succeeded, preview:', candidate.substring(0, 200));
          } catch (e) {
            // ignore decode errors
          }
        }

        // If it's a data URL (e.g., data:application/json;base64,eyJ... ), decode base64
        const dataUrlMatch = candidate.match(/^data:(?:application\/(?:json\+)?json|text\/plain);base64,(.+)$/i);
        if (dataUrlMatch) {
          try {
            const b64 = dataUrlMatch[1];
            // Browser-friendly base64 decode
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const decoded = new TextDecoder().decode(bytes);
            candidate = decoded;
            console.log('[QR] Data URL decode succeeded, preview:', candidate.substring(0, 200));
          } catch (e) {
            // ignore
          }
        }

        // Try parsing candidate as JSON
        try {
          const qrData = JSON.parse(candidate);
          console.log('[QR] Parsed as JSON after tolerant parsing, type:', qrData.type);

          if (qrData.type === 'pairing_response') {
            const pairingData = await this.processPairingData(qrData.data);
            return { type: 'pairing_response', data: pairingData };
          }

          if (qrData.publicKey) {
            const pairingData = {
              publicKey: qrData.publicKey,
              chainCode: qrData.chainCode,
              deviceId: qrData.deviceId || 'mobile-wallet',
              network: qrData.network || 'mainnet',
              address: qrData.address,
              addresses: qrData.addresses
            };
            const processed = await this.processPairingData(pairingData);
            return { type: 'pairing_response', data: processed };
          }

          if (qrData.data && qrData.data.publicKey) {
            const pairingData = await this.processPairingData(qrData.data);
            return { type: 'pairing_response', data: pairingData };
          }

          this.currentSession.update(s => s ? { ...s, status: 'completed', result: qrData } : null);
          return { type: qrData.type || 'pairing_response', data: qrData };
        } catch (e) {
          // Continue to other format checks
          console.log('[QR] Tolerant JSON parse failed, continuing with other heuristics');
        }

        // Additional tolerant attempt: strip non-printable/control characters and try to extract a JSON object
        try {
          let cleaned = candidate.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

          // If it looks like it contains a JSON object, try to extract the largest {...} substring
          const firstBrace = cleaned.indexOf('{');
          const lastBrace = cleaned.lastIndexOf('}');

          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            let jsonSub = cleaned.slice(firstBrace, lastBrace + 1);

            // Try to progressively trim trailing characters if parse fails (handles truncated content)
            for (let attempt = 0; attempt < 20; attempt++) {
              try {
                const qrData = JSON.parse(jsonSub);
                console.log('[QR] Recovered JSON from noisy QR, type:', qrData.type);

                if (qrData.type === 'pairing_response') {
                  const pairingData = await this.processPairingData(qrData.data);
                  return { type: 'pairing_response', data: pairingData };
                }

                if (qrData.publicKey) {
                  const pairingData = {
                    publicKey: qrData.publicKey,
                    chainCode: qrData.chainCode,
                    deviceId: qrData.deviceId || 'mobile-wallet',
                    network: qrData.network || 'mainnet',
                    address: qrData.address,
                    addresses: qrData.addresses
                  };
                  const processed = await this.processPairingData(pairingData);
                  return { type: 'pairing_response', data: processed };
                }

                if (qrData.data && qrData.data.publicKey) {
                  const pairingData = await this.processPairingData(qrData.data);
                  return { type: 'pairing_response', data: pairingData };
                }

                this.currentSession.update(s => s ? { ...s, status: 'completed', result: qrData } : null);
                return { type: qrData.type || 'pairing_response', data: qrData };
              } catch (err) {
                // Trim one character and retry
                jsonSub = jsonSub.slice(0, -1);
                if (jsonSub.length < 20) break;
              }
            }
          }
        } catch (e) {
          // Ignore and continue
          console.log('[QR] JSON recovery attempt failed');
        }
      }

      // Heuristic: attempt to extract publicKey/chainCode from noisy/truncated JSON strings
      // Example: '{"type":"pairing_response","data":{"publicKey":"03f2...","chainCode":"7c70...","devi'
      const pkMatch = qrText.match(/"publicKey"\s*:\s*"([0-9a-fA-F]{66,130})"/);
      const ccMatch = qrText.match(/"chainCode"\s*:\s*"([0-9a-fA-F]{64})"/);
      if (pkMatch) {
        const pairingData: any = {
          publicKey: pkMatch[1],
          chainCode: ccMatch ? ccMatch[1] : undefined,
          // keep a short preview for debugging
          rawPreview: qrText && typeof qrText === 'string' ? qrText.toString().substring(0, 500) : String(qrText)
        };

        console.log('[QR] Extracted publicKey (and chainCode if present) from noisy QR, proceeding with pairing', {
          publicKey: pairingData.publicKey,
          chainCode: pairingData.chainCode
        });

        const processed = await this.processPairingData(pairingData);
        return { type: 'pairing_response', data: processed };
      }

      // Check if it's a raw hex public key (compressed: 66 chars, uncompressed: 130 chars)
      if (/^[0-9a-fA-F]{66}$/.test(qrText) || /^[0-9a-fA-F]{130}$/.test(qrText)) {
        console.log('[QR] Detected raw public key');
        const pairingData = { publicKey: qrText, isRawKey: true };
        const processed = await this.processPairingData(pairingData);
        return { type: 'public_key', data: processed };
      }

      // Check if it's a Bitcoin address
      if (/^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(qrText)) {
        console.log('[QR] Detected Bitcoin address');
        return { type: 'bitcoin_address', data: { address: qrText } };
      }

      // Check if it's a BIP21 payment URI (bitcoin:address?amount=X)
      if (qrText.toLowerCase().startsWith('bitcoin:')) {
        console.log('[QR] Detected BIP21 payment request');
        const parsed = this.parseBIP21(qrText);
        return { type: 'payment_request', data: parsed };
      }

      // Check if it's a base64 encoded PSBT
      if (/^cHNidP8/.test(qrText)) {
        console.log('[QR] Detected PSBT');
        return { type: 'psbt_signed', data: { signedPsbt: qrText } };
      }

      // Check if it is a short numeric pairing code (common compact formats)
      if (/^\d{4,8}$/.test(qrText.trim())) {
        const code = qrText.trim();
        console.log('[QR] Detected short numeric pairing code', code);

        // Attempt to resolve full pairing payload from a configured relay (chrome.storage.local.pairingRelayUrl)
        try {
          const relayResult = await this.tryResolvePairingCodeFromRelay(code);
          if (relayResult) {
            console.log('[QR] Relay returned pairing payload, processing as pairing_response');
            // Normalize relayResult into pairing_response shape if necessary
            if (relayResult.type === 'pairing_response' && relayResult.data) {
              const pairingData = await this.processPairingData(relayResult.data);
              return { type: 'pairing_response', data: pairingData };
            }

            if (relayResult.publicKey) {
              const pairingData = await this.processPairingData(relayResult);
              return { type: 'pairing_response', data: pairingData };
            }

            if (relayResult.data && relayResult.data.publicKey) {
              const pairingData = await this.processPairingData(relayResult.data);
              return { type: 'pairing_response', data: pairingData };
            }
          }
        } catch (e) {
          console.error('[QR] Relay lookup error for pairing code', code, e);
        }

        // Store result in session for debugging and return explicit type so callers can handle it
        this.currentSession.update(s => s ? { ...s, status: 'completed', result: { pairingCode: code } } : null);
        return { type: 'pairing_code', data: { code } };
      }

      // Unknown format - but let's try to use it anyway if it looks like it might contain useful data
      console.log('[QR] Unknown format, attempting generic parse');
      const preview = qrText && typeof qrText === 'string' ? qrText.toString().substring(0,200) : String(qrText);
      const len = qrText && typeof qrText === 'string' ? qrText.length : undefined;
      throw new Error(`Unrecognized QR code format. Preview (truncated): ${preview} ${len ? `(len=${len})` : ''}. Tried tolerant JSON recovery and other heuristics. Expected: pairing data (JSON with publicKey), raw public key (hex), Bitcoin address, or PSBT.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process QR';
      console.error('[QR] Process error:', error);
      
      this.currentSession.update(s => s ? { 
        ...s, 
        status: 'failed', 
        error: message 
      } : null);
      
      throw error;
    }
  }

  /**
   * Attempt to resolve a short numeric pairing code via a configured relay service.
   * Relay URL must be configured in `chrome.storage.local.pairingRelayUrl`.
   * Relay contract: GET <pairingRelayUrl>?code=<code> returning JSON with either
   *  - { type: 'pairing_response', data: { publicKey, chainCode, ... } }
   *  - { publicKey: '03...', chainCode: '...', ... }
   */
  private async tryResolvePairingCodeFromRelay(code: string): Promise<any | null> {
    try {
      const stored = await new Promise<Record<string, any>>(resolve => chrome.storage.local.get(['pairingRelayUrl'], resolve));
      const relayUrl: string | undefined = stored && stored.pairingRelayUrl;
      if (!relayUrl) {
        console.log('[QR] No relay URL configured (chrome.storage.local.pairingRelayUrl)');
        return null;
      }

      const url = relayUrl.includes('?') ? `${relayUrl}&code=${encodeURIComponent(code)}` : `${relayUrl}?code=${encodeURIComponent(code)}`;
      console.log('[QR] Attempting relay lookup:', url);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const resp = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, signal: controller.signal });
        clearTimeout(timeout);

        if (!resp.ok) {
          console.warn('[QR] Relay lookup returned non-OK status:', resp.status);
          return null;
        }

        const body = await resp.json();
        console.log('[QR] Relay lookup returned body:', body && (body.type || body.publicKey ? '[pairing payload]' : body));
        return body;
      } catch (err) {
        clearTimeout(timeout);
        console.warn('[QR] Relay fetch failed or timed out:', err);
        return null;
      }
    } catch (error) {
      console.error('[QR] Error reading pairingRelayUrl from storage:', error);
      return null;
    }
  }

  /**
   * Parse BIP21 payment URI
   */
  private parseBIP21(uri: string): { address: string; amount?: number; label?: string; message?: string } {
    const url = new URL(uri);
    const address = url.pathname;
    const params = url.searchParams;
    
    return {
      address,
      amount: params.has('amount') ? parseFloat(params.get('amount')!) : undefined,
      label: params.get('label') || undefined,
      message: params.get('message') || undefined
    };
  }

  private decryptPairingPayload(data: any) {
    const cipher = data?.cipher ?? data?.c;
    const ivHex = data?.iv ?? data?.i;
    const code = data?.code ?? data?.k;
    if (!cipher || !ivHex || !code) return null;

    try {
      const key = CryptoJS.SHA256(String(code));
      const iv = CryptoJS.enc.Hex.parse(ivHex);
      const decrypted = CryptoJS.AES.decrypt(cipher, key, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });

      const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
      if (!plaintext) throw new Error('Decryption resulted in empty plaintext');

      const parsed = JSON.parse(plaintext);
      const normalized = {
        publicKey: parsed.publicKey ?? parsed.pk,
        chainCode: parsed.chainCode ?? parsed.cc,
        deviceId: parsed.deviceId ?? parsed.did,
        network: parsed.network ?? parsed.n,
        address: parsed.address ?? parsed.a,
        addresses: parsed.addresses ?? parsed.addrs,
      };
      console.log('[QR] Decrypted pairing payload');
      return normalized;
    } catch (error) {
      console.warn('[QR] Failed to decrypt pairing payload', error);
      return null;
    }
  }

  private async processPairingData(input: any) {
    const candidate = input?.data ?? input;
    const decrypted = this.decryptPairingPayload(candidate);
    const pairingData = decrypted || candidate;

    if (!pairingData || (!pairingData.publicKey && !pairingData.addresses && !pairingData.address)) {
      throw new Error('Pairing payload missing expected fields');
    }

    await this.handlePairingResponse(pairingData);
    return pairingData;
  }

  /**
   * Handle pairing response from mobile
   */
  private async handlePairingResponse(data: any) {
    console.log('[QR] Received pairing data:', data);
    await updateWalletFromPairing(data);
  }

  /**
   * Handle address response from mobile
   */
  private handleAddressResponse(data: any) {
    console.log('[QR] Received addresses:', data.addresses?.length);
    
    if (data.addresses) {
      updateAddresses(data.addresses);
    }
  }

  /**
   * Handle signed PSBT from mobile
   */
  private handleSignedPsbt(data: any) {
    console.log('[QR] Received signed PSBT');
    
    if (data.signedPsbt) {
      psbt.handleSignedPsbt(data.signedPsbt);
    }
  }

  /**
   * Clear current session
   */
  clearSession() {
    this.currentSession.set(null);
  }

  /**
   * Generate sample QR for testing
   */
  async generateTestQR(type: 'addresses' | 'signed_psbt'): Promise<string> {
    if (type === 'addresses') {
      const mockAddresses = [
        {
          address: 'bc1qtest1example...',
          index: 0,
          balance: 50000,
          label: 'Main',
          isUsed: true
        },
        {
          address: 'bc1qtest2example...',
          index: 1,
          balance: 0,
          label: 'Savings',
          isUsed: false
        }
      ];

      const qrData: QRData = {
        type: 'address_response',
        data: { addresses: mockAddresses },
        timestamp: Date.now(),
        id: 'test-' + Date.now()
      };

      return await this.generateQRCode(qrData);
    } else {
      const qrData: QRData = {
        type: 'psbt_signing',
        data: { signedPsbt: 'cHNidP8BAFUCAAAAAQ==' }, // Mock signed PSBT
        timestamp: Date.now(),
        id: 'test-' + Date.now()
      };

      return await this.generateQRCode(qrData);
    }
  }

  /**
   * Helper to generate a pairing response QR (for testing or for mobile apps to pre-generate in dev)
   * Expected payload (JSON): { type: 'pairing_response', data: { publicKey, chainCode?, deviceId?, network?, address?, addresses? }, timestamp, id }
   */
  async generatePairingResponseQR(data: { publicKey: string; chainCode?: string; deviceId?: string; network?: string; address?: string; addresses?: any[] }): Promise<string> {
    if (!data.publicKey) throw new Error('publicKey is required to generate pairing response');

    const id = `pair-res-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const qrData: QRData = {
      type: 'pairing_response',
      data: {
        publicKey: data.publicKey,
        chainCode: data.chainCode,
        deviceId: data.deviceId || 'mobile-wallet',
        network: data.network || 'mainnet',
        address: data.address,
        addresses: data.addresses
      },
      timestamp: Date.now(),
      id
    };

    return await this.generateQRCode(qrData);
  }
}

export const qr = new QRService();
