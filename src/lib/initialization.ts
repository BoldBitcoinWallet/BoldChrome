/**
 * Application Initialization
 * Sets up all services and stores (QR-based, no backend required)
 */

import { storage } from './services/storage';
import { initializeDeviceStore } from './stores/device';
import { initializeWalletStore, refreshWalletData } from './stores/wallet';
import { psbt } from './services/psbt';

export interface InitializationResult {
  success: boolean;
  error?: string;
}

/**
 * Initialize the application
 * This should be called once when the extension loads
 */
export async function initializeApp(): Promise<InitializationResult> {
  try {
    console.log('[App] Starting initialization...');

    // Step 1: Initialize Chrome storage
    console.log('[App] Initializing storage...');
    await storage.init();

    // Step 2: Load device and wallet stores from storage
    console.log('[App] Loading stores...');
    await initializeDeviceStore();
    await initializeWalletStore();

    // Step 3: Refresh wallet data if we have an address
    const address = await storage.get<string>('address');
    if (address) {
      console.log('[App] Refreshing wallet data...');
      // Don't await - let it run in background
      refreshWalletData().catch(err => 
        console.error('[App] Initial wallet refresh failed:', err)
      );
    }

    // Step 4: Initialize PSBT service
    console.log('[App] Initializing PSBT service...');
    await psbt.init();
    console.log('[App] PSBT service initialized');

    console.log('[App] Initialization complete (QR-based mode)');
    return { success: true };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[App] Initialization error:', message);
    return {
      success: false,
      error: message
    };
  }
}
