/**
 * Chrome Storage Service
 * Manages encrypted local storage for sensitive data using Chrome Storage API
 */

export interface StorageData {
  // Device identity
  deviceId: string;
  deviceName: string;
  keyshare?: string; // TSS key fragment (encrypted)
  devicePrivateKey?: string; // Device auth key (encrypted)

  // Wallet data
  address: string;
  addresses?: string; // JSON stringified DerivedAddress[]
  network: 'mainnet' | 'testnet';
  publicKey?: string;
  chainCode?: string;

  // Session
  sessionToken?: string;
  pairedAt?: string;
  pairedDevices?: string; // JSON stringified

  // Settings
  currency: string; // e.g. 'USD', 'EUR', 'GBP'
  theme: 'light' | 'dark';
  /** Mempool API: undefined = not chosen (show preference after pairing), '' = default mempool.space, else custom mainnet URL */
  mempoolMainnetUrl?: string | null;

  // HD wallet state (gap-limit discovery results)
  hdState?: string; // JSON stringified HdState

  // PIN lock (extension)
  pinHash?: string; // SHA-256 hash of PIN, never store raw PIN

  // First-load camera permission prompt (extension)
  cameraPermissionChecked?: boolean;
}

/**
 * Chrome Storage wrapper for managing wallet data
 */
class ChromeStorage {
  private storageKey = 'boldbtc_wallet_data';
  private encryptionKey?: string;

  /**
   * Initialize storage
   */
  async init(): Promise<void> {
    const existing = await this.getRaw('deviceId');
    if (!existing) {
      // First time setup
      const deviceId = this.generateDeviceId();
      await this.setRaw('deviceId', deviceId);
    }
  }

  /**
   * Generate unique device ID
   */
  private generateDeviceId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `ext_${result}`;
  }

  /**
   * Get single value
   */
  async get<T>(key: keyof StorageData): Promise<T | null> {
    const value = await this.getRaw(key as string);
    return value as T | null;
  }

  /**
   * Set single value
   */
  async set<T>(key: keyof StorageData, value: T): Promise<void> {
    await this.setRaw(key as string, value);
  }

  /**
   * Get all wallet data
   */
  async getAll(): Promise<Partial<StorageData>> {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items: any) => {
        resolve(items as Partial<StorageData>);
      });
    });
  }

  /**
   * Remove one or more keys
   */
  async remove(keys: string | string[]): Promise<void> {
    const k = Array.isArray(keys) ? keys : [keys];
    return new Promise((resolve) => {
      chrome.storage.local.remove(k, () => resolve());
    });
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.clear(() => {
        resolve();
      });
    });
  }

  /**
   * Private: Get raw value from storage
   */
  private getRaw(key: string): Promise<any> {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result: any) => {
        resolve(result[key] ?? null);
      });
    });
  }

  /**
   * Private: Set raw value in storage
   */
  private setRaw(key: string, value: any): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();
      });
    });
  }
}

export const storage = new ChromeStorage();
