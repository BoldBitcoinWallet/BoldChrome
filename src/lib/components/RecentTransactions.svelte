<script lang="ts">
  import { slide } from "svelte/transition";
  import ActiveTxVisualizer from "./ActiveTxVisualizer.svelte";

  // --- Props ---
  export let transactions: any[] = [];
  export let visibleTransactions: any[] = [];
  export let isLoading: boolean = false;
  export let isLoadingMore: boolean = false;
  export let hasMore: boolean = false;
  export let network: "mainnet" | "testnet" = "mainnet";
  export let themeName: string = "dark";
  export let fiatSymbol: string = "$";

  // Assets
  export let inIcon: string;
  export let outIcon: string;
  export let pendingIcon: string;

  // Pagination & Actions
  export let txPageIndex: number = 0;
  export let txTotalPages: number = 1;
  export let prevTxPage: () => void;
  export let nextTxPage: () => void;
  export let fetchMoreTransactions: () => void;
  export let openTxInMempool: (txid: string) => void;

  // --- Internal State ---
  let expandedTxId: string | null = null;

  function toggleTxExpansion(txid: string) {
    expandedTxId = expandedTxId === txid ? null : txid;
  }

  function handleKeydown(event: KeyboardEvent, txid: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleTxExpansion(txid);
    }
  }
</script>

<section class="tx-list fade-in" class:dark-mode={themeName === "darkPolished"}>
  <h2>Recent Transactions</h2>

  {#if transactions.length === 0 && !isLoading}
    <p class="tx-empty">No transactions yet</p>
  {:else}
    <div
      class="tx-scroll-region"
      role="region"
      aria-label="Recent transactions list"
    >
      <ul class="tx-list-ul">
        {#each visibleTransactions as tx (tx.id)}
          <li
            class="tx-item"
            class:in={tx.type === "in"}
            class:out={tx.type === "out"}
            class:expanded={expandedTxId === tx.id}
          >
            <div
              class="tx-item-clickable"
              role="button"
              tabindex="0"
              aria-expanded={expandedTxId === tx.id}
              on:click={() => toggleTxExpansion(tx.id)}
              on:keydown={(e) => handleKeydown(e, tx.id)}
            >
              <div class="tx-row tx-row-main">
                <div class="tx-status-wrap">
                  <!-- Branta Verified Merchant Integration -->
                  {#if tx.merchant}
                    <div class="tx-merchant-icon-wrap">
                      <img
                        src={tx.merchant.logoUrl || outIcon}
                        alt={tx.merchant.merchantName}
                        class="tx-merchant-icon"
                        on:error={(e) => {
                          const img = e.currentTarget as HTMLImageElement;
                          img.src = outIcon;
                        }}
                      />
                      <span class="tx-merchant-check" aria-hidden="true">✓</span
                      >
                    </div>
                  {:else}
                    <img
                      src={tx.status === "pending"
                        ? pendingIcon
                        : tx.type === "in"
                          ? inIcon
                          : outIcon}
                      alt=""
                      class="tx-status-icon"
                      width="20"
                      height="20"
                    />
                  {/if}
                  <span class="tx-status-text">{tx.statusLabel}</span>
                </div>
                <span
                  class="tx-amount"
                  class:in={tx.type === "in"}
                  class:out={tx.type === "out"}
                >
                  {tx.type === "in" ? "+" : "-"}{tx.amountFormatted}
                  <span class="tx-unit">BTC</span>
                </span>
              </div>

              {#if tx.addressLabel}
                <div class="tx-row tx-row-address">
                  <span class="tx-address-label">{tx.addressLabel}</span>
                  {#if tx.fiatAmount}
                    <span class="tx-fiat">~{fiatSymbol}{tx.fiatAmount}</span>
                  {/if}
                </div>
              {/if}

              <div class="tx-row tx-row-meta">
                <span class="tx-id-label"
                  >Tx: <span class="tx-id-value">{tx.shortTxId}</span></span
                >
                <span class="tx-time">{tx.timeLabel}</span>

                <button
                  class="tx-explorer-link"
                  type="button"
                  on:click|stopPropagation={() => openTxInMempool(tx.id)}
                  title="View on Explorer"
                  aria-label="View on Explorer"
                >
                  ↗
                </button>
              </div>
            </div>

            <!-- Expandable Visualizer Section -->
            {#if expandedTxId === tx.id}
              <div transition:slide={{ duration: 250 }}>
                <div class="tx-visualizer-dropdown">
                  <ActiveTxVisualizer
                    txid={tx.id}
                    {network}
                    initialPhase={tx.status === "confirmed"
                      ? "confirmed"
                      : "mempool"}
                    explorerBaseUrl={null}
                    compact={true}
                    onPhaseChange={() => {}}
                  />
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>

    <!-- Pagination Controls -->
    {#if transactions.length > 0}
      <div class="tx-list-footer">
        {#if txTotalPages > 1}
          <div class="tx-page-controls">
            <button
              type="button"
              class="tx-page-btn"
              on:click={prevTxPage}
              disabled={txPageIndex === 0}
            >
              Prev
            </button>
            <span class="tx-page-indicator">
              {txPageIndex + 1} / {txTotalPages}
            </span>
            <button
              type="button"
              class="tx-page-btn"
              on:click={nextTxPage}
              disabled={txPageIndex >= txTotalPages - 1}
            >
              Next
            </button>
          </div>
        {/if}

        {#if isLoadingMore}
          <p class="tx-list-footer-loading">Loading more…</p>
        {:else if hasMore && txPageIndex >= txTotalPages - 1}
          <button
            type="button"
            class="tx-list-load-more"
            on:click={fetchMoreTransactions}
          >
            Load more
          </button>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  /* Completely hide scrollbar for Chrome, Safari, and Opera */
  :global(*::-webkit-scrollbar) {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }

  .tx-list {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 100%;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .tx-scroll-region {
    max-height: 440px;
    overflow-y: auto;
    overflow-x: hidden;
    width: 100%;
    box-sizing: border-box;

    /* Completely hide scrollbar for Firefox */
    scrollbar-width: none !important;

    /* Completely hide scrollbar for IE and Edge legacy */
    -ms-overflow-style: none !important;
  }

  .tx-list-ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
  }

  .tx-item {
    display: flex;
    flex-direction: column;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    overflow: hidden;
    transition:
      background 0.2s ease,
      border-color 0.2s ease;
    width: 100%;
    box-sizing: border-box;
  }

  .tx-item.expanded {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .tx-item-clickable {
    width: 100%;
    box-sizing: border-box;
    background: transparent;
    border: none;
    padding: 12px;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: inherit;
    font-family: inherit;
    outline: none;
  }

  .tx-item-clickable:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .tx-item-clickable:focus-visible {
    background: rgba(255, 255, 255, 0.04);
    box-shadow: inset 0 0 0 2px rgba(0, 255, 204, 0.5);
  }

  .tx-visualizer-dropdown {
    padding: 0 12px 12px 12px;
    width: 100%;
    box-sizing: border-box;
  }

  .tx-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    gap: 8px;
  }

  .tx-status-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  /* Branta Merchant Styles */
  .tx-merchant-icon-wrap {
    position: relative;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tx-merchant-icon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    object-fit: cover;
  }

  .tx-merchant-check {
    position: absolute;
    bottom: -2px;
    right: -2px;
    background: #00ffaa;
    color: #000;
    font-size: 8px;
    font-weight: 700;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 4px rgba(0, 255, 170, 0.6);
  }

  .tx-amount,
  .tx-fiat,
  .tx-time {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .tx-explorer-link {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }

  .tx-explorer-link:hover,
  .tx-explorer-link:focus-visible {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
  }

  .tx-list-footer {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    width: 100%;
    box-sizing: border-box;
  }

  .tx-page-controls {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .tx-page-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #fff;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
  }

  .tx-page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .tx-list-load-more {
    background: transparent;
    border: 1px solid rgba(0, 255, 204, 0.4);
    color: #00ffcc;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
  }
</style>
