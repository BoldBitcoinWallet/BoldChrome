<script lang="ts">
  import { networkStore, setNetwork, type Network } from '$lib/stores/network';
  import { refreshWalletData } from '$lib/stores/wallet';

  let isToggling = false;

  async function handleNetworkChange(newNetwork: Network) {
    if (isToggling || $networkStore.network === newNetwork) return;

    isToggling = true;
    try {
      await setNetwork(newNetwork);
      // Immediately re-fetch balance & tx history for the new network
      await refreshWalletData();
    } catch (err) {
      console.error('[NetworkToggle] Failed to switch network:', err);
    } finally {
      isToggling = false;
    }
  }
</script>

<div class="network-toggle">
  <div class="toggle-label">Network</div>
  
  <div class="toggle-container" class:testnet-active={$networkStore.isTestnet}>
    <button
      class="toggle-option"
      class:active={$networkStore.network === 'mainnet'}
      on:click={() => handleNetworkChange('mainnet')}
      disabled={isToggling}
    >
      Mainnet
    </button>
    
    <button
      class="toggle-option testnet"
      class:active={$networkStore.network === 'testnet'}
      on:click={() => handleNetworkChange('testnet')}
      disabled={isToggling}
    >
      Testnet
    </button>
  </div>

  {#if $networkStore.isTestnet}
    <div class="testnet-badge" aria-label="Developer Mode Active">
      TESTNET
    </div>
  {/if}
</div>

<style>
  .network-toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: #111;
    border-radius: 8px;
    border: 1px solid #222;
  }

  .toggle-label {
    font-size: 0.75rem;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .toggle-container {
    display: flex;
    background: #000;
    border-radius: 6px;
    padding: 2px;
    border: 1px solid #333;
  }

  .toggle-option {
    padding: 4px 14px;
    font-size: 0.8rem;
    font-weight: 500;
    color: #aaa;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .toggle-option:hover:not(:disabled) {
    color: #fff;
    background: #1a1a1a;
  }

  .toggle-option.active {
    background: #fff;
    color: #000;
    font-weight: 600;
  }

  .toggle-option.testnet.active {
    background: #f59e0b;
    color: #000;
  }

  .toggle-option:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .testnet-badge {
    margin-left: auto;
    padding: 2px 10px;
    background: #f59e0b;
    color: #000;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 1px;
    border-radius: 9999px;
    text-transform: uppercase;
  }
</style>
