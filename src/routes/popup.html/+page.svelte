<script lang="ts">
  import logoSmall from "$lib/assets/Icon-App-40x40@2x.png";
  import logoSmallDark from "$lib/assets/icon-inverted.png";
  import logo from "$lib/assets/bold-icon.png";
  import sendIcon from "$lib/assets/send-icon.png";
  import receiveIcon from "$lib/assets/receive-icon.png";
  import eyeOnIcon from "$lib/assets/eye-on-icon.png";
  import eyeOffIcon from "$lib/assets/eye-off-icon.png";
  import inIcon from "$lib/assets/in-icon.png";
  import outIcon from "$lib/assets/out-icon.png";
  import pendingIcon from "$lib/assets/pending-icon.png";
  import lightIcon from "$lib/assets/light-icon.png";
  import darkIcon from "$lib/assets/dark-icon.png";
  import refreshIcon from "$lib/assets/refresh-icon.png";
  import deleteIcon from "$lib/assets/delete-icon.png";
  import addressTypeIcon from "$lib/assets/address-type-icon.png";
  import bitcoinLogo from "$lib/assets/bitcoin-logo.png";
  import pasteIcon from "$lib/assets/paste-icon.png";
  import { onDestroy, onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { get } from "svelte/store";
  import {
    walletStore,
    refreshWalletData,
    initializeWalletStore,
    updateWalletFromPairing,
    resetWallet,
    fetchMoreTransactions,
    getCurrentReceiveAddress,
    runHdDiscovery,
    switchAddressType,
    addressTypeUISelection,
  } from "$lib/stores/wallet";
  import {
    networkStore,
    setNetwork,
  } from "$lib/stores/network";
  import { qr } from "$lib/services/qr";
  import { psbt } from "$lib/services/psbt";
  import QRScannerPopup from "$lib/components/QRScannerPopup.svelte";
  import QRScanner from "$lib/components/QRScanner.svelte";
  import { goto } from "$app/navigation";
  import { applyTheme, themeName } from "$lib/styles/theme";
  import { storage } from "$lib/services/storage";
  import {
    blockchain,
    type RecommendedFees,
    type UTXO,
  } from "$lib/services/blockchain";
  import {
    hashPin,
    verifyPin,
    isPinValid,
    PIN_MIN_LENGTH,
    PIN_MAX_LENGTH,
  } from "$lib/services/pin";
  import lockerIcon from "$lib/assets/locker-icon.png";
  import { keyshareFingerprint as computeKeyshareFingerprint } from "$lib/services/keyshareFingerprint";
  import GetStartedView from "$lib/components/GetStartedView.svelte";
  import RecentTransactions from "$lib/components/RecentTransactions.svelte";

  type TxVisualizerPhase =
    | "idle"
    | "signing"
    | "broadcasting"
    | "mempool"
    | "confirmed";

  function getExtensionVersionLabel(): string {
    try {
      const cr = (
        globalThis as {
          chrome?: {
            runtime?: {
              getManifest?: () => { version?: string; version_name?: string };
            };
          };
        }
      ).chrome;
      if (!cr?.runtime?.getManifest) return "";
      const m = cr.runtime.getManifest();
      const named =
        typeof m.version_name === "string" ? m.version_name.trim() : "";
      if (named) return named;
      const v = typeof m.version === "string" ? m.version.trim() : "";
      return v ? `v${v}` : "";
    } catch {
      return "";
    }
  }
  const extensionVersionLabel = getExtensionVersionLabel();

  // PIN lock state
  let pinHash: string | null = null;
  let pinChecked = false;
  let unlocked = false;
  let setPinValue = "";
  let setPinConfirm = "";
  let setPinError = "";
  let unlockPinValue = "";
  let unlockError = "";

  // First-load camera permission prompt
  let showCameraPermissionScreen = false;
  let cameraPermissionRequesting = false;
  /** User previously denied camera; show "go to settings" hint instead of prompting again. */
  let cameraPermissionDeniedHint = false;
  /** When set, run this action after user grants or skips camera permission (e.g. "pairing" = start Bind wallet flow). */
  let pendingActionAfterCamera: "pairing" | null = null;

  $: showPinLoading = isPaired && !pinChecked;
  $: showLockScreen = isPaired && pinChecked && !!pinHash && !unlocked;
  $: showSetPinScreen =
    isPaired && pinChecked && !pinHash && mempoolChoice !== null;
  $: showMempoolPreferenceScreen =
    isPaired && pinChecked && mempoolChoice === null;
  $: showMainApp =
    isPaired && pinChecked && !!pinHash && unlocked && mempoolChoice !== null;

  async function loadPinHash() {
    const stored = await storage.get<string>("pinHash");
    pinHash = stored && typeof stored === "string" ? stored : null;
    pinChecked = true;
  }

  async function handleSetPin() {
    setPinError = "";
    if (!isPinValid(setPinValue)) {
      setPinError = `PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`;
      return;
    }
    if (setPinValue !== setPinConfirm) {
      setPinError = "PINs do not match";
      return;
    }
    const hash = hashPin(setPinValue);
    await storage.set("pinHash", hash);
    pinHash = hash;
    unlocked = true;
    setPinValue = "";
    setPinConfirm = "";
    triggerToast("PIN set. Extension will require it on next open.", "success");
  }

  async function handleUnlock() {
    unlockError = "";
    if (!unlockPinValue.trim()) {
      unlockError = "Enter your PIN";
      return;
    }
    if (!pinHash || !verifyPin(unlockPinValue, pinHash)) {
      unlockError = "Incorrect PIN";
      unlockPinValue = "";
      return;
    }
    unlocked = true;
    unlockPinValue = "";
  }

  function handleLock() {
    unlocked = false;
    unlockPinValue = "";
    unlockError = "";
  }

  // Detect if running as a full-page tab (expanded view) vs popup.
  // When opened as a popup the window is constrained; as a tab it fills the viewport.
  const isExpandedView =
    typeof window !== "undefined" &&
    window.innerWidth > 600;
  let isHeaderUtilitiesExpanded = false;

  function toggleHeaderUtilities(): void {
    isHeaderUtilitiesExpanded = !isHeaderUtilitiesExpanded;
  }

  $: if (!showMainApp && isHeaderUtilitiesExpanded) {
    isHeaderUtilitiesExpanded = false;
  }

  function openExpandedView() {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL && chrome.tabs) {
      const appUrl = chrome.runtime.getURL("popup.html");
      chrome.tabs.query({ url: appUrl }, (tabs) => {
        if (tabs.length > 0 && tabs[0].id != null) {
          chrome.tabs.update(tabs[0].id, { active: true });
          if (tabs[0].windowId != null) {
            chrome.windows.update(tabs[0].windowId, { focused: true });
          }
        } else {
          chrome.tabs.create({ url: appUrl });
        }
      });
    }
  }

  // Pairing state
  // Steps: 0=Start/Logo, 1=Instructions, 2=QR, 3=ResponseChoice, 4=Scanner, 5=ManualInput
  let pairingStep = 0;
  // Removed redundant booleans: showPairingQR, showManualInput, showScanner
  // use computed properties if needed for transition classes, otherwise strict steps

  let pairingQRData = "";
  let pairingStatus = "Click logo to start pairing";
  let manualPublicKey = "";
  let processingPairing = false;

  // Reactive: Check if wallet is paired based on store
  $: isPaired =
    !!$walletStore.publicKey && $walletStore.publicKey.trim() !== "";

  $: keyshareFingerprintDisplay = computeKeyshareFingerprint(
    $walletStore.publicKey,
  );

  type Tx = {
    id: string;
    type: "in" | "out";
    amount: number;
    unit?: string;
    date: string;
    status?: "confirmed" | "pending";
    description?: string;
  };

  let balance = 0; // Will be populated from store
  let fiat = 0; // Will be populated from store
  let showBalance = true; // toggle to hide/show balance
  let showWalletSettingsMenu = false;
  let isRefreshing = false;
  let requestingAddresses = false;

  // Network toggle state (used inside Wallet Details modal)
  let isTogglingNetwork = false;

  // Mempool provider: null = not chosen (show preference after pairing), '' = default, string = custom URL. 'loading' = init.
  let mempoolChoice: string | null | "loading" = "loading";
  let pendingWalletFetchAfterMempool = false;
  let showMempoolModal = false;
  let mempoolInputValue = "";
  let mempoolModalInputValue = "";
  let mempoolError = "";
  let mempoolSaving = false;

  function normalizeMempoolUrl(url: string): string {
    if (!url || !url.trim()) return "";
    let u = url.trim().replace(/\/+$/, "");
    if (!/\/api\/?$/i.test(u)) u = u + "/api";
    return u;
  }

  async function validateMempoolEndpoint(apiUrl: string): Promise<boolean> {
    try {
      const testUrl = `${apiUrl.replace(/\/$/, "")}/blocks/tip/hash`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(testUrl, { method: "GET", signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      const hash = await res.text();
      return /^[a-f0-9]{64}$/i.test(hash.trim());
    } catch {
      return false;
    }
  }

  async function loadMempoolFromStorage() {
    const url = await storage.get<string | null>("mempoolMainnetUrl");
    if (url === undefined || url === null) {
      mempoolChoice = null;
    } else {
      mempoolChoice = url;
      blockchain.setMempoolMainnet(url === "" ? "" : url);
    }
  }

  async function handleMempoolSkip() {
    mempoolChoice = "";
    await storage.set("mempoolMainnetUrl", "");
    blockchain.setMempoolMainnet("");
    if (pendingWalletFetchAfterMempool) {
      pendingWalletFetchAfterMempool = false;
      try {
        await fetchWalletDataAndHandleStatus();
        await fetchPrices();
      } catch (e) {
        console.error("Wallet fetch after mempool skip:", e);
      }
    }
  }

  async function handleMempoolSave(customUrl: string) {
    mempoolError = "";
    const normalized = normalizeMempoolUrl(customUrl);
    if (!normalized) {
      handleMempoolSkip();
      return;
    }
    mempoolSaving = true;
    try {
      const ok = await validateMempoolEndpoint(normalized);
      if (!ok) {
        mempoolError =
          "Invalid endpoint. Use a valid mempool.space API URL or skip.";
        return;
      }
      mempoolChoice = normalized;
      await storage.set("mempoolMainnetUrl", normalized);
      blockchain.setMempoolMainnet(normalized);
      mempoolInputValue = "";
      mempoolModalInputValue = "";
      showMempoolModal = false;
      if (pendingWalletFetchAfterMempool) {
        pendingWalletFetchAfterMempool = false;
        await fetchWalletDataAndHandleStatus();
        await fetchPrices();
      }
    } finally {
      mempoolSaving = false;
    }
  }

  function handleMempoolChange() {
    mempoolModalInputValue =
      mempoolChoice && mempoolChoice !== ""
        ? mempoolChoice
        : "https://mempool.space/api";
    mempoolError = "";
    showMempoolModal = true;
  }

  /** In modal: Reset only sets the input to default URL; user can then Save to apply. */
  function handleMempoolResetInput() {
    if (
      !confirm("Are you sure? You be using https://mempool.space public apis")
    )
      return;
    mempoolModalInputValue = "https://mempool.space/api";
  }

  /** Reactive display name for footer so it updates when provider changes. */
  $: mempoolDisplayName =
    mempoolChoice === null || mempoolChoice === "loading"
      ? "mempool.space"
      : mempoolChoice === ""
        ? "mempool.space"
        : (() => {
            try {
              const u = new URL(mempoolChoice.replace(/\/api\/?$/i, ""));
              return u.hostname;
            } catch {
              return "mempool.space";
            }
          })();

  // Bitcoin price & currency (app-style)
  let priceData: Record<string, number> = {};
  let selectedCurrency = "USD";
  let showCurrencyModal = false;
  const CURRENCY_NAMES: Record<string, string> = {
    USD: "US Dollar",
    EUR: "Euro",
    GBP: "British Pound",
    JPY: "Japanese Yen",
    AUD: "Australian Dollar",
    CAD: "Canadian Dollar",
    CHF: "Swiss Franc",
  };
  const CURRENCY_SYMBOLS: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    AUD: "A$",
    CAD: "C$",
    CHF: "Fr",
  };
  function getCurrencySymbol(code: string): string {
    return CURRENCY_SYMBOLS[code] ?? code + " ";
  }
  function formatPrice(rate: number): string {
    if (rate >= 1e6) return (rate / 1e6).toFixed(2) + "M";
    if (rate >= 1e3)
      return rate.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return rate.toFixed(2);
  }
  async function fetchPrices() {
    if (!isPaired) return;
    try {
      priceData = await blockchain.getBitcoinPrices();
    } catch (e) {
      console.warn("Price fetch failed", e);
    }
  }
  async function openCurrencyModal() {
    if (Object.keys(priceData).length === 0) await fetchPrices();
    showCurrencyModal = true;
  }
  async function selectCurrency(code: string) {
    selectedCurrency = code;
    await storage.set("currency", code); // persist fiat preference
    showCurrencyModal = false;
  }

  async function toggleTheme() {
    const next =
      $themeName === "darkPolished" ? "lightPolished" : "darkPolished";
    await storage.set("theme", next === "darkPolished" ? "dark" : "light");
    applyTheme(next);
  }

  function toggleWalletSettingsMenu() {
    showWalletSettingsMenu = !showWalletSettingsMenu;
  }

  function closeWalletSettingsMenu() {
    showWalletSettingsMenu = false;
  }

  function handleWalletSettingsEscape(e: KeyboardEvent) {
    if (showWalletSettingsMenu && e.key === "Escape") {
      e.preventDefault();
      closeWalletSettingsMenu();
    }
  }

  async function onSettingsSyncAddresses() {
    closeWalletSettingsMenu();
    await handleRequestAddresses();
  }

  async function handleUnpair() {
    if (
      !confirm(
        "Unpair this wallet? You will need to bind again to see balance and addresses.",
      )
    )
      return;
    showWalletSettingsMenu = false;

    // Also clear multi-network paired wallet storage
    try {
      await chrome.storage.local.remove('pairedWallets');
    } catch {}

    await resetWallet();
    pairingStep = 0;
    pairingStatus = "Click logo to start pairing";
  }

  // Network change handler (used inside Wallet Details modal)
  async function handleNetworkChange(newNetwork: 'mainnet' | 'testnet') {
    if (isTogglingNetwork || $networkStore.network === newNetwork) return;
    isTogglingNetwork = true;
    try {
      await setNetwork(newNetwork);
      // Refresh balances & tx history immediately for the new network
      await refreshWalletData();
      triggerToast(`Switched to ${newNetwork}`, 'success');
    } catch (err) {
      console.error('[WalletDetails] Network switch failed:', err);
      triggerToast('Failed to switch network', 'error');
    } finally {
      isTogglingNetwork = false;
    }
  }

  // Subscribe to wallet store
  $: {
    balance = parseFloat($walletStore.btc) || 0;
    const storeFiat = parseFloat($walletStore.usd) || 0;
    const rate =
      selectedCurrency && priceData[selectedCurrency] != null
        ? priceData[selectedCurrency]
        : null;
    fiat = rate != null ? balance * rate : storeFiat;
  }
  // btcRate for tx fiat amounts: use selected currency rate when available
  $: btcRateForFiat =
    selectedCurrency && priceData[selectedCurrency] != null
      ? priceData[selectedCurrency]
      : balance > 0 && fiat > 0
        ? fiat / balance
        : 0;
  $: btcPriceDisplay =
    selectedCurrency && priceData[selectedCurrency] != null
      ? formatPrice(priceData[selectedCurrency])
      : "–";
  // Symbol for balance and tx fiat: selected currency when we have a rate, else USD (store fallback)
  $: fiatSymbol =
    selectedCurrency && priceData[selectedCurrency] != null
      ? getCurrencySymbol(selectedCurrency)
      : getCurrencySymbol("USD");

  // Relative time for tx list (app-style)
  function formatTxTime(timestamp: number, status: string): string {
    if (status === "pending") return "Pending confirmation";
    const sec = Math.floor(Date.now() / 1000) - timestamp;
    if (sec < 60) return "Just now";
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year:
        d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  }

  function openTxInMempool(txid: string) {
    const network = $walletStore.network || "mainnet";
    const base = getActiveExplorerBase(network);
    const url = `${base}/tx/${txid}`;
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank", "noopener");
    }
  }

  function getActiveExplorerBase(network: "mainnet" | "testnet"): string {
    if (network === "testnet") {
      return "https://mempool.space/testnet";
    }
    if (
      typeof mempoolChoice === "string" &&
      mempoolChoice.trim() !== "" &&
      mempoolChoice !== "loading"
    ) {
      return normalizeMempoolUrl(mempoolChoice).replace(/\/api\/?$/i, "");
    }
    return "https://mempool.space";
  }

  // Convert wallet transactions to UI format (app-aligned: status, amount, address, txid, time)
  $: btcRate = btcRateForFiat;
  $: activeAddressTypeId =
    $walletStore.hdState?.addressType || "segwit-native";
  $: settingsHighlightedAddressType =
    $addressTypeUISelection ?? activeAddressTypeId;
  // Reactive short preview — uses the network-aware receive address
  $: selectedAddressShort = (() => {
    const addr = receiveAddress || $walletStore.address;
    if (!addr || addr === "No address configured") return "";
    return addr.length > 15 ? `${addr.slice(0, 6)}...${addr.slice(-6)}` : addr;
  })();
  $: transactions = $walletStore.transactions.map((tx) => {
    const type = tx.type === "receive" ? "in" : ("out" as "in" | "out");
    const amountBtc = tx.amount / 100_000_000;
    const relevantAddr = type === "in" ? (tx.from ?? "") : (tx.to ?? "");
    const shortAddr = relevantAddr
      ? `${relevantAddr.slice(0, 4)}...${relevantAddr.slice(-4)}`
      : "";
    const merchant = tx.brantaMerchant || (relevantAddr ? cachedBrantaMap.get(relevantAddr.trim()) : undefined);
    const merchantName = merchant?.merchantName;
    return {
      id: tx.txid,
      type,
      amount: amountBtc,
      amountFormatted: amountBtc.toFixed(8).replace(/\.?0+$/, "") || "0",
      status: tx.status,
      statusLabel:
        tx.status === "pending"
          ? type === "in"
            ? "Receiving"
            : merchantName
              ? `Paying ${merchantName}`
              : "Sending"
          : type === "in"
            ? "Received"
            : merchantName
              ? `Sent to ${merchantName}`
              : "Sent",
      shortTxId: `${tx.txid.slice(0, 4)}...${tx.txid.slice(-4)}`,
      timeLabel: formatTxTime(tx.timestamp, tx.status),
      addressLabel:
        type === "in"
          ? shortAddr
            ? `Fr: ${shortAddr}`
            : ""
            : shortAddr
              ? `To: ${shortAddr}`
              : "",
      fiatAmount: btcRate > 0 ? (amountBtc * btcRate).toFixed(2) : "",
      merchant,
    };
  });

  const TX_PAGE_SIZE = 4;
  let txPageIndex = 0;
  let txTotalPages = 1;

  $: txTotalPages = Math.max(1, Math.ceil(transactions.length / TX_PAGE_SIZE));
  $: txPageIndex = Math.min(txPageIndex, txTotalPages - 1);

  function prevTxPage(): void {
    txPageIndex = Math.max(0, txPageIndex - 1);
  }

  function nextTxPage(): void {
    txPageIndex = Math.min(txTotalPages - 1, txPageIndex + 1);
  }

  let clearVisualizerTimer: ReturnType<typeof setTimeout> | null = null;
  let showSend = false;
  let showReceive = false;
  let sendAmount = "";
  let sendAddress = "";
  let isVerifying = false;
  let brantaResult: {
    merchantId?: string;
    merchantName: string;
    logoUrl?: string;
    verifyUrl?: string;
    isFlagged?: boolean;
    riskLabel?: string;
  } | null = null;
  let brantaError: string | null = null;
  let brantaLogoLoadFailed = false;
  let brantaDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let brantaLookupSeq = 0;
  let sendMode: "dkls" | "psbt" = "dkls";
  let showSendAddressScanner = false;
  let receiveAddress = ""; // Will be populated from store
  let receiveDerivationPath = "";

  // Reactive receive address & path — updates when network or HD state changes
  $: {
    void $networkStore.network;          // subscribe to network changes
    void $walletStore.hdState;
    void $walletStore.address;

    const hdAddr = getCurrentReceiveAddress();
    if (hdAddr) {
      receiveAddress = hdAddr.address;
      receiveDerivationPath = hdAddr.path;
    } else if ($walletStore.address) {
      receiveAddress = $walletStore.address;
      // Build correct derivation path label from network
      const coin = $networkStore.network === 'testnet' ? "1'" : "0'";
      receiveDerivationPath = `m/84'/${coin}/0'/0/0`;
    } else {
      receiveAddress = "No address configured";
      receiveDerivationPath = "";
    }
  }
  let sending = false;
  let message = "";

  // Fee market (mempool.space): economy, 1hr, 30m, fast
  type SendFeeStrategy = "economy" | "1hr" | "30m" | "fast";
  let sendFeeEstimates: RecommendedFees | null = null;
  let sendFeeStrategy: SendFeeStrategy = "1hr";
  let sendFeeRate = 0;
  let sendFeeEstimatesLoading = false;
  let sendUtxos: UTXO[] | null = null;

  const FEE_STRATEGY_KEYS: Record<SendFeeStrategy, keyof RecommendedFees> = {
    economy: "economyFee",
    "1hr": "hourFee",
    "30m": "halfHourFee",
    fast: "fastestFee",
  };

  const SEND_FEE_TIERS: { id: SendFeeStrategy; label: string }[] = [
    { id: "economy", label: "Eco" },
    { id: "1hr", label: "1hr" },
    { id: "30m", label: "30m" },
    { id: "fast", label: "Fast" },
  ];

  function toNum(v: unknown): number {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      return !Number.isNaN(n) ? n : 0;
    }
    return 0;
  }

  function inferAddressNetwork(
    address: string,
  ): "mainnet" | "testnet" | null {
    const a = (address || "").trim().toLowerCase();
    if (!a) return null;
    if (a.startsWith("bc1") || a.startsWith("1") || a.startsWith("3")) {
      return "mainnet";
    }
    if (
      a.startsWith("tb1") ||
      a.startsWith("m") ||
      a.startsWith("n") ||
      a.startsWith("2")
    ) {
      return "testnet";
    }
    return null;
  }

  function resolveNetworkAddressCandidate(
    wallet: {
      network?: "mainnet" | "testnet";
      address?: string;
      addresses?: Array<{ address: string }>;
    },
  ): { network: "mainnet" | "testnet"; address: string } {
    const fallbackNetwork = wallet.network || "mainnet";
    const currentAddress = wallet.address || "";
    const currentAddressNetwork = inferAddressNetwork(currentAddress);
    const resolvedNetwork = currentAddressNetwork || fallbackNetwork;

    if (currentAddress && currentAddressNetwork === resolvedNetwork) {
      return { network: resolvedNetwork, address: currentAddress };
    }

    const compatible = (wallet.addresses || []).find(
      a => inferAddressNetwork(a.address) === resolvedNetwork,
    );

    if (compatible?.address) {
      return { network: resolvedNetwork, address: compatible.address };
    }

    return { network: fallbackNetwork, address: currentAddress };
  }

  function getSendFeeRate(): number {
    if (!sendFeeEstimates) return 0;

    const key = FEE_STRATEGY_KEYS[sendFeeStrategy];
    let rate = toNum(sendFeeEstimates[key]);
    if (rate > 0) return rate;

    rate = toNum(sendFeeEstimates.hourFee);
    if (rate > 0) return rate;

    rate = toNum(sendFeeEstimates.halfHourFee);
    if (rate > 0) return rate;

    rate = toNum(sendFeeEstimates.fastestFee);
    if (rate > 0) return rate;

    return (
      toNum(sendFeeEstimates.economyFee) ||
      toNum(sendFeeEstimates.minimumFee) ||
      0
    );
  }

  /** Estimate vsize and fee for a given amount (coin-select for amount + buffer). */
  function estimateFeeForAmount(
    amountSats: number,
    utxos: UTXO[] | null,
    feeRateSatPerVb: number,
  ): { feeSats: number; vsize: number } {
    const baseSize = 10;
    const inputSize = 68;
    const outputSize = 31;
    const numOutputs = 2;
    const minVsize = baseSize + inputSize + numOutputs * outputSize;
    if (!utxos || utxos.length === 0) {
      return {
        feeSats: Math.max(1, Math.ceil(minVsize * feeRateSatPerVb)),
        vsize: minVsize,
      };
    }
    const sorted = [...utxos].sort((a, b) => b.value - a.value);
    let numInputs = 0;
    let total = 0;
    let feeSats = 0;
    let vsize = minVsize;
    for (let i = 0; i < sorted.length; i++) {
      total += sorted[i].value;
      numInputs = i + 1;
      vsize = baseSize + numInputs * inputSize + numOutputs * outputSize;
      feeSats = Math.max(1, Math.ceil(vsize * feeRateSatPerVb));
      if (total >= amountSats + feeSats) break;
    }
    return { feeSats, vsize };
  }

  $: sendFeeStrategy, sendFeeEstimates, (sendFeeRate = getSendFeeRate());
  $: sendAmountSats = Math.round((parseFloat(sendAmount || "0") || 0) * 1e8);
  $: effectiveFeeRate =
    sendFeeRate > 0
      ? sendFeeRate
      : sendFeeEstimates
        ? Math.max(
            1,
            toNum(sendFeeEstimates.halfHourFee) ||
              toNum(sendFeeEstimates.hourFee) ||
              toNum(sendFeeEstimates.fastestFee) ||
              toNum(sendFeeEstimates.economyFee) ||
              1,
          )
        : 0;
  $: sendFeeEst = (() => {
    void sendAmount;
    void sendFeeStrategy;
    void sendFeeEstimates;
    void sendUtxos;
    void sendFeeRate;
    const rate = sendFeeEstimates
      ? Math.max(1, effectiveFeeRate)
      : effectiveFeeRate;
    if (rate <= 0) return { feeSats: 0, vsize: 140 };
    return estimateFeeForAmount(sendAmountSats, sendUtxos, rate);
  })();
  $: sendEstimatedFeeSats = sendFeeEst.feeSats;
  $: sendTotalSats = sendAmountSats + sendEstimatedFeeSats;
  $: sendBalanceSats = Math.round(balance * 1e8);
  $: sendAmountValid = sendAmountSats > 0 && sendTotalSats <= sendBalanceSats;

  // Fiat equivalents for send summary (reactive)
  $: sendAmountFiat =
    (parseFloat(sendAmount || "0") || 0) * (btcRateForFiat || 0);
  $: sendFeeFiat = (sendEstimatedFeeSats / 1e8) * (btcRateForFiat || 0);
  $: sendTotalFiat = (sendTotalSats / 1e8) * (btcRateForFiat || 0);

  /** Extract Bitcoin address from scanned QR (pipe format, BIP21, or raw address). */
  function extractAddressFromQR(qrData: string): string | null {
    const s = (qrData || "").trim();
    if (!s) return null;
    // Pipe-separated send format: address|amount|fee|...
    if (s.includes("|")) {
      const addr = s.split("|")[0].trim();
      if (addr && /^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(addr))
        return addr;
    }
    // BIP21: bitcoin:ADDRESS?...
    if (s.toLowerCase().startsWith("bitcoin:")) {
      const rest = s.slice(8).split("?")[0].trim();
      if (rest && /^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(rest))
        return rest;
    }
    // Raw address
    if (/^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(s)) return s;
    return null;
  }

  function isValidBitcoinAddressForBranta(value: string): boolean {
    const candidate = (value || "").trim();
    if (candidate.length < 26 || candidate.length > 90) return false;
    return /^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(candidate);
  }

  let sendBrantaLookupOverride: { address: string; payload: string } | null = null;

  function hasBrantaPayloadMarkers(value: string): boolean {
    const lower = value.toLowerCase();
    return (
      lower.includes("branta_id=") ||
      lower.includes("branta_secret=") ||
      lower.includes("/v2/verify/") ||
      lower.includes("k-")
    );
  }

  function parseBrantaLookupInput(value: string): {
    shouldLookup: boolean;
    payload?: string;
    isQrCode?: boolean;
  } {
    const candidate = (value || "").trim();
    if (!candidate) return { shouldLookup: false };

    if (hasBrantaPayloadMarkers(candidate)) {
      return {
        shouldLookup: true,
        payload: candidate,
        isQrCode: true,
      };
    }

    if (isValidBitcoinAddressForBranta(candidate)) {
      return {
        shouldLookup: true,
        payload: candidate,
        isQrCode: false,
      };
    }

    return { shouldLookup: false };
  }

  function clearBrantaState(): void {
    isVerifying = false;
    brantaResult = null;
    brantaError = null;
    brantaLogoLoadFailed = false;
  }

  function parseBrantaResult(data: unknown): {
    merchantId?: string;
    merchantName: string;
    logoUrl?: string;
    verifyUrl?: string;
    isFlagged?: boolean;
    riskLabel?: string;
  } | null {
    const payload = data as { payment?: Record<string, unknown>; verifyUrl?: string } | null;
    if (!payload?.payment) return null;

    const payment = payload.payment;
    const merchantRecord =
      typeof payment.merchant === "object" && payment.merchant !== null
        ? (payment.merchant as Record<string, unknown>)
        : null;

    const firstString = (...values: unknown[]): string | undefined => {
      for (const value of values) {
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed) return trimmed;
        }
      }
      return undefined;
    };

    const nestedLogoUrl =
      typeof payment.logo === "object" && payment.logo !== null
        ? firstString((payment.logo as Record<string, unknown>).url, (payment.logo as Record<string, unknown>).src)
        : undefined;

    const nestedMerchantLogoUrl =
      merchantRecord && typeof merchantRecord.logo === "object" && merchantRecord.logo !== null
        ? firstString(
            (merchantRecord.logo as Record<string, unknown>).url,
            (merchantRecord.logo as Record<string, unknown>).src
          )
        : undefined;

    const metadataLogoUrl =
      typeof payment.metadata === "object" && payment.metadata !== null
        ? firstString(
            (payment.metadata as Record<string, unknown>).logoUrl,
            (payment.metadata as Record<string, unknown>).logo
          )
        : undefined;

    const normalizeLogoUrl = (rawUrl?: string): string | undefined => {
      if (!rawUrl) return undefined;
      const normalizedInput = rawUrl.trim();
      if (!normalizedInput) return undefined;
      try {
        if (normalizedInput.startsWith("//")) {
          return `https:${normalizedInput}`;
        }
        if (normalizedInput.startsWith("ipfs://")) {
          const cidPath = normalizedInput.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "");
          return `https://ipfs.io/ipfs/${cidPath}`;
        }
        if (/^https?:\/\//i.test(normalizedInput) || normalizedInput.startsWith("data:") || normalizedInput.startsWith("blob:")) {
          return normalizedInput;
        }
        // Handle relative paths returned by API payloads.
        if (normalizedInput.startsWith("/")) {
          if (typeof payload?.verifyUrl === "string" && payload.verifyUrl.trim()) {
            const base = new URL(payload.verifyUrl);
            return new URL(normalizedInput, `${base.protocol}//${base.host}`).toString();
          }
          return new URL(normalizedInput, "https://branta.pro").toString();
        }
        // Normalize scheme-less host paths like cdn.example.com/logo.png
        if (/^[a-z0-9.-]+\.[a-z]{2,}($|\/)/i.test(normalizedInput)) {
          return `https://${normalizedInput}`;
        }
      } catch {
        return normalizedInput;
      }
      return normalizedInput;
    };

    const merchantName = String(
      payment.merchantName ||
        payment.name ||
        payment.displayName ||
        payment.platform ||
        merchantRecord?.merchantName ||
        merchantRecord?.name ||
        merchantRecord?.displayName ||
        merchantRecord?.brandName ||
        merchantRecord?.organizationName ||
        "Verified Merchant"
    ).trim();

    const status = String(payment.status || "").toLowerCase();
    const riskLevel = String(payment.riskLevel || payment.risk || "").toLowerCase();
    const flagged =
      payment.isFlagged === true ||
      status === "flagged" ||
      status === "blocked" ||
      status === "suspicious" ||
      riskLevel === "high" ||
      riskLevel === "critical";

    const parsed = {
      merchantId: String(
        payment.merchantId ||
          payment.id ||
          payment._id ||
          merchantRecord?.merchantId ||
          merchantRecord?.id ||
          merchantRecord?._id ||
          ""
      ).trim() || undefined,
      merchantName,
      logoUrl: normalizeLogoUrl(
        firstString(
          payment.logoUrl,
          payment.platformLogoUrl,
          payment.avatar,
          payment.image,
          payment.imageUrl,
          payment.icon,
          payment.logo,
          merchantRecord?.logoUrl,
          merchantRecord?.avatar,
          merchantRecord?.image,
          merchantRecord?.imageUrl,
          merchantRecord?.icon,
          merchantRecord?.logo,
          nestedLogoUrl,
          nestedMerchantLogoUrl,
          metadataLogoUrl
        )
      ),
      verifyUrl: String(payload.verifyUrl || payment.verifyUrl || "").trim() || undefined,
      isFlagged: flagged,
      riskLabel: flagged ? (riskLevel || status || "flagged") : undefined,
    };

    return parsed;
  }

  async function persistPendingBrantaMetadata(
    recipientAddress: string,
    amountSats: number,
  ): Promise<void> {
    if (!brantaResult || brantaResult.isFlagged) return;
    try {
      const key = "pendingBrantaMetadata";
      const raw = await storage.get<string>(key);
      const existing = raw
        ? (JSON.parse(raw) as Array<{
            recipientAddress: string;
            amountSats: number;
            createdAt: number;
            brantaMerchant: {
              merchantId?: string;
              merchantName: string;
              logoUrl?: string;
              verifyUrl?: string;
            };
          }>)
        : [];
      const now = Date.now();
      const fresh = existing.filter(
        (item) => now - item.createdAt < 72 * 60 * 60 * 1000,
      );
      fresh.push({
        recipientAddress,
        amountSats,
        createdAt: now,
        brantaMerchant: {
          merchantId: brantaResult.merchantId,
          merchantName: brantaResult.merchantName,
          logoUrl: brantaResult.logoUrl,
          verifyUrl: brantaResult.verifyUrl,
        },
      });
      await storage.set(key, JSON.stringify(fresh.slice(-50)));
    } catch (error) {
      console.warn("[popup] Failed to cache pending Branta metadata", error);
    }
  }

  async function runBrantaLookup(
    lookupPayload: string,
    sourceValue: string,
    isQrCode: boolean
  ): Promise<void> {
    const currentLookupSeq = ++brantaLookupSeq;
    const lookupAddress = (sourceValue || "").trim();
    isVerifying = true;
    brantaError = null;
    brantaLogoLoadFailed = false;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "VERIFY_BRANTA_ADDRESS",
        address: lookupPayload,
        isQrCode,
        network: $walletStore.network,
      });

      // Ignore stale responses from prior lookups (common while typing/pasting).
      if (currentLookupSeq !== brantaLookupSeq || lookupAddress !== (sendAddress || "").trim()) {
        return;
      }

      if (!response?.success || !response?.data) {
        brantaResult = null;
        return;
      }

      brantaResult = parseBrantaResult(response.data);
    } catch (error) {
      if (currentLookupSeq !== brantaLookupSeq || lookupAddress !== (sendAddress || "").trim()) {
        return;
      }
      console.warn("[Branta][SendBTC] Lookup errored", {
        lookupSeq: currentLookupSeq,
        reason: error instanceof Error ? error.message : String(error),
      });
      brantaResult = null;
      brantaError = "Unable to verify with Branta right now.";
    } finally {
      if (currentLookupSeq === brantaLookupSeq) {
        isVerifying = false;
      }
    }
  }

  function scheduleBrantaLookup(value: string): void {
    const candidate = (value || "").trim();
    if (brantaDebounceTimer) {
      clearTimeout(brantaDebounceTimer);
      brantaDebounceTimer = null;
    }

    if (
      sendBrantaLookupOverride &&
      sendBrantaLookupOverride.address !== candidate
    ) {
      sendBrantaLookupOverride = null;
    }

    const lookupCandidate =
      sendBrantaLookupOverride && sendBrantaLookupOverride.address === candidate
        ? {
            shouldLookup: true,
            payload: sendBrantaLookupOverride.payload,
            isQrCode: true,
          }
        : parseBrantaLookupInput(candidate);

    if (!lookupCandidate.shouldLookup || !lookupCandidate.payload) {
      if (candidate.length > 0) {
      }
      clearBrantaState();
      return;
    }

    brantaDebounceTimer = setTimeout(() => {
      void runBrantaLookup(
        lookupCandidate.payload!,
        candidate,
        lookupCandidate.isQrCode === true
      );
    }, 400);
  }

  $: if (showSend) {
    scheduleBrantaLookup(sendAddress);
  } else {
    if (brantaDebounceTimer) {
      clearTimeout(brantaDebounceTimer);
      brantaDebounceTimer = null;
    }
    clearBrantaState();
  }

  function handleSendAddressScanned(qrData: string) {
    const addr = extractAddressFromQR(qrData);
    if (addr) {
      sendAddress = addr;
      if (hasBrantaPayloadMarkers(qrData)) {
        sendBrantaLookupOverride = { address: addr, payload: qrData.trim() };
      }
      triggerToast("Address scanned", "success");
    } else {
      triggerToast("No Bitcoin address found in QR", "error");
    }
    showSendAddressScanner = false;
  }

  let cachedBrantaMap: Map<string, any> = new Map();

  // Load cached metadata if you use local storage caching
async function loadCachedBrantaMetadata() {
    try {
      const raw = await storage.get<string>("pendingBrantaMetadata");
      console.log("[Branta Debug] Raw storage cache loaded:", raw);
      if (raw) {
        const items = JSON.parse(raw);
        cachedBrantaMap.clear();
        for (const item of items) {
          if (item.recipientAddress && item.brantaMerchant) {
            cachedBrantaMap.set(item.recipientAddress.trim(), item.brantaMerchant);
          }
        }
        console.log("[Branta Debug] Parsed cache map size:", cachedBrantaMap.size);
      }
    } catch (e) {
      console.warn("[Branta Debug] Failed to load cached Branta metadata", e);
    }
  }

$: mappedTransactions = $walletStore.transactions.map((tx) => {
    const type = tx.type === "receive" ? "in" : ("out" as "in" | "out");
    const amountBtc = tx.amount / 100_000_000;
    const relevantAddr = type === "in" ? (tx.from ?? "") : (tx.to ?? "");
    const shortAddr = relevantAddr ? `${relevantAddr.slice(0, 4)}...${relevantAddr.slice(-4)}` : "";
      
    const merchant = tx.brantaMerchant || (relevantAddr ? cachedBrantaMap.get(relevantAddr.trim()) : undefined);
    const merchantName = merchant?.merchantName;

    return {
      id: tx.txid,
      type,
      amount: amountBtc,
      amountFormatted: amountBtc.toFixed(8).replace(/\.?0+$/, "") || "0",
      status: tx.status,
      statusLabel:
        tx.status === "pending"
          ? type === "in" ? "Receiving" : merchantName ? `Paying ${merchantName}` : "Sending"
          : type === "in" ? "Received" : merchantName ? `Sent to ${merchantName}` : "Sent",
      shortTxId: `${tx.txid.slice(0, 4)}...${tx.txid.slice(-4)}`,
      timeLabel: formatTxTime(tx.timestamp, tx.status),
      // Fixed: Properly handles both incoming, merchant, and regular outgoing address labels
      addressLabel: type === "in"
        ? (shortAddr ? `Fr: ${shortAddr}` : "")
        : (shortAddr ? `To: ${shortAddr}` : ""),
      fiatAmount: btcRate > 0 ? (amountBtc * btcRate).toFixed(2) : "",
      merchant,
    };
  });

  function handleSendAddressScannerClose() {
    showSendAddressScanner = false;
  }

  // Toast notification state
  let toastMessage = "";
  let toastType: "success" | "error" | "" = "";
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function triggerToast(msg: string, type: "success" | "error" = "success") {
    // Clear previous timer
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastMessage = msg;
    toastType = type;
    // Auto-clear after 3s
    toastTimer = setTimeout(() => {
      toastMessage = "";
      toastType = "";
      toastTimer = null;
    }, 3200);
  }

  async function copyWalletFingerprint() {
    const id = keyshareFingerprintDisplay;
    if (!id || id === "N/A") {
      triggerToast("No Fingerprint to copy", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(id);
      triggerToast("Fingerprint copied", "success");
    } catch {
      triggerToast("Could not copy", "error");
    }
  }
  let showQRModal = false;
  let qrCodeDataUrl = "";
  let qrModalTitle = "";

  // Receive modal (app-style)
  let receiveQRDataUrl = "";
  let isReceiveCopied = false;
  // Re-derive receive address whenever the wallet store changes (hdState, address, etc.).
  // Reference both $walletStore.hdState and $walletStore.address so Svelte tracks them.
  $: {
    void $walletStore.hdState;
    const hdAddr = getCurrentReceiveAddress();
    receiveAddress = hdAddr?.address || $walletStore.address || "No address configured";
    receiveDerivationPath = hdAddr?.path || "";
  }

  async function openReceive() {
    showReceive = true;
    receiveQRDataUrl = "";
    // Re-derive to guarantee the freshest HD receive address
    const hdAddr = getCurrentReceiveAddress();
    const addrToShow = hdAddr?.address || $walletStore.address || "";
    if (addrToShow !== receiveAddress) {
      receiveAddress = addrToShow;
    }
    receiveDerivationPath = hdAddr?.path || "";
    if (receiveAddress && receiveAddress !== "No address configured") {
      try {
        receiveQRDataUrl = await qr.generateAddressQR(receiveAddress);
      } catch (e) {
        console.warn("Receive QR generate failed", e);
      }
    }
  }
  function copyReceiveAddress() {
    if (receiveAddress && receiveAddress !== "No address configured") {
      navigator.clipboard?.writeText(receiveAddress);
      isReceiveCopied = true;
      setTimeout(() => {
        isReceiveCopied = false;
      }, 350);
    }
  }

  // Pairing functions
  async function hasCameraPermission(): Promise<boolean> {
    try {
      if ("permissions" in navigator && navigator.permissions) {
        const result = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        return result.state === "granted";
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  async function startPairingFlow() {
    try {
      pairingQRData = await qr.generatePairingCodeQR();
      pairingStatus = "";
      pairingStep = 1;
    } catch (error) {
      console.error("Failed to generate pairing QR:", error);
      pairingStatus = "Failed to generate QR code";
      alert("Failed to generate pairing QR code");
    }
  }

  async function handlePairDevice() {
    const cameraOk = await hasCameraPermission();
    if (!cameraOk) {
      pendingActionAfterCamera = "pairing";
      showCameraPermissionScreen = true;
      return;
    }
    await startPairingFlow();
  }

  function nextStep() {
    if (pairingStep === 1) pairingStep = 3;
    else pairingStep++;
  }

  function prevStep() {
    if (pairingStep === 3 || pairingStep === 5) {
      pairingStep = pairingStep === 5 ? 3 : 1;
      pairingStatus = "";
    } else if (pairingStep === 1) {
      pairingStep = 0;
      pairingStatus = "Click logo to start pairing";
    }
  }

  function handleStartScanner() {
    pairingStep = 4;
  }

  function handleCloseScanner() {
    // Close scanner and return to pairing options (step 3)
    pairingStep = 3;
    pairingStatus = "";
  }

  function handleScanResponse() {
    // Move to Manual Input (Step 5)
    pairingStep = 5;
    pairingStatus = "Enter the response from your mobile wallet";
  }

  function inferPairingNetwork(payload: any): "mainnet" | "testnet" | null {
    const declared = payload?.network;
    const declaredNetwork: "mainnet" | "testnet" | null =
      declared === "mainnet"
        ? "mainnet"
        : declared === "testnet" ||
            declared === "testnet4" ||
            declared === "testnet3"
          ? "testnet"
          : null;

    const addr =
      payload?.address ||
      payload?.addresses?.testnet ||
      payload?.addresses?.testnet4 ||
      payload?.addresses?.mainnet;

    const inferredFromAddress: "mainnet" | "testnet" | null =
      typeof addr === "string" && addr
        ? /^tb1|^[mn2]/.test(addr)
          ? "testnet"
          : "mainnet"
        : null;

    if (declaredNetwork && inferredFromAddress && declaredNetwork !== inferredFromAddress) {
      console.warn("[pairing] Network declaration/address format mismatch; preferring address format", {
        declaredNetwork,
        inferredFromAddress,
        addressPreview: typeof addr === "string" ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : null,
      });
      return inferredFromAddress;
    }

    return inferredFromAddress || declaredNetwork;
  }

  async function handleQRScanFromCamera(qrData: string) {
    // Hide scanner immediately by setting a temp step or loading step, keeping 4 for now until success
    // But logically we process it.

    try {
      pairingStatus = "Processing scanned response...";
      const result = await qr.processScanedQR(qrData);
      // If we got a short numeric pairing code, instruct the user and show manual input
      if (result && result.type === "pairing_code") {
        pairingStatus = `Received pairing code: ${result.data.code}. Please export full pairing response.`;
        pairingStep = 5; // Go to manual input
        return;
      }

      // Ensure network state is switched before any refresh hits blockchain APIs.
      const inferredNetwork = inferPairingNetwork(result?.data);
      if (inferredNetwork) {
        await setNetwork(inferredNetwork);
        await tick();
      }

      // Refresh local wallet state
      await initializeWalletStore();

      const latestWallet = get(walletStore);
      let persistedPublicKey = (await storage.get<string>("publicKey")) || "";
      let paired = !!persistedPublicKey.trim();

      if (!paired && result?.data?.publicKey) {
        console.warn("[pairing] Scan produced key material but store was empty; applying direct pairing fallback");
        await updateWalletFromPairing(result.data);
        await initializeWalletStore();
        persistedPublicKey = (await storage.get<string>("publicKey")) || "";
        paired = !!persistedPublicKey.trim();
      }

      if (paired) {
        pairingStatus = "Paired successfully!";
        pairingStep = 0;
        if (mempoolChoice === null) {
          pendingWalletFetchAfterMempool = true;
          return;
        }
        if (!latestWallet.address) {
          pairingStatus =
            "Paired (watch-only). No addresses available to fetch balance";
          triggerToast("Paired (watch-only)", "success");
          setTimeout(() => {
            if (
              typeof chrome !== "undefined" &&
              chrome.runtime &&
              chrome.runtime.getURL
            ) {
              const popupUrl = chrome.runtime.getURL("popup.html");
              if (typeof window !== "undefined" && location.href !== popupUrl) {
                location.href = popupUrl;
              }
            } else if (
              typeof window !== "undefined" &&
              location.pathname !== "/popup.html"
            ) {
              goto("/popup.html");
            }
          }, 700);
        } else {
          try {
            pairingStatus = "Fetching wallet data...";
            await fetchWalletDataAndHandleStatus();
            await fetchPrices();
            pairingStatus = "Wallet updated";
          } catch (err) {
            console.error("Failed to refresh wallet data after pairing:", err);
            pairingStatus = "Paired but failed to fetch wallet data";
          }
        }
      } else {
        const latestAfter = get(walletStore);
        console.warn('[pairing] No publicKey after processScanedQR', {
          publicKey: latestAfter.publicKey,
          persistedPublicKey,
          addresses: latestAfter.addresses?.length,
          resultNetwork: result?.data?.network,
          resultHasChainCode: !!result?.data?.chainCode,
          resultHasAddress: !!(result?.data?.address || result?.data?.addresses),
        });
        pairingStatus = "Pairing response received but no key was stored";
        // Stay on scanner or go back? Go back to options
        pairingStep = 3;
      }
    } catch (error) {
      console.error("Failed to process scanned QR code:", error);
      pairingStatus = "Failed to pair. Please try again.";
      pairingStep = 3; // Go back to options
      alert(
        "Failed to process QR code: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    }
  }

  async function handleManualSubmit() {
    if (!manualPublicKey.trim()) {
      alert("Please enter the public key from your mobile wallet");
      return;
    }

    processingPairing = true;

    try {
      pairingStatus = "Processing public key...";
      const result = await qr.processScanedQR(manualPublicKey.trim());

      // Ensure network state is switched before any refresh hits blockchain APIs.
      const inferredNetwork = inferPairingNetwork(result?.data);
      if (inferredNetwork) {
        await setNetwork(inferredNetwork);
        await tick();
      }

      // Refresh local wallet state
      await initializeWalletStore();

      const latestWallet = get(walletStore);
      const paired = !!latestWallet.publicKey?.trim();

      if (paired) {
        pairingStatus = "Paired successfully!";
        pairingStep = 0;
        if (mempoolChoice === null) {
          pendingWalletFetchAfterMempool = true;
          return;
        }
        if (!latestWallet.address) {
          pairingStatus =
            "Paired (watch-only). No addresses available to fetch balance";
        } else {
          try {
            pairingStatus = "Fetching wallet data...";
            await fetchWalletDataAndHandleStatus();
            await fetchPrices();
            pairingStatus = "Wallet updated";
          } catch (err) {
            console.error(
              "Failed to refresh wallet data after manual pairing:",
              err,
            );
            pairingStatus = "Paired but failed to fetch wallet data";
          }
        }
      }
    } catch (error) {
      console.error("Failed to process public key:", error);
      pairingStatus = "Failed to pair. Please try again.";
      alert(
        "Failed to process: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    } finally {
      processingPairing = false;
    }
  }

  async function handleQRScanned(qrData: string) {
    // Redundant legacy handler? Let's alias it to handleQRScanFromCamera or just remove usage
    await handleQRScanFromCamera(qrData);
  }

  async function handleRefresh() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      await fetchWalletDataAndHandleStatus();
      await fetchPrices();
    } finally {
      // Add small delay for visual feedback
      setTimeout(() => {
        isRefreshing = false;
      }, 500);
    }
  }

  function toggleBalance() {
    showBalance = !showBalance;
  }

  // Reactive address format list — reflects the currently selected network
  $: ADDRESS_TYPES = $networkStore.network === 'testnet'
    ? [
        { id: "segwit-native" as const, label: "Native SegWit", prefix: "tb1q..." },
        { id: "segwit-nested" as const, label: "SegWit Compatible", prefix: "2..." },
        { id: "legacy" as const, label: "Legacy", prefix: "m... / n..." },
      ]
    : [
        { id: "segwit-native" as const, label: "Native SegWit", prefix: "bc1q..." },
        { id: "segwit-nested" as const, label: "SegWit Compatible", prefix: "3..." },
        { id: "legacy" as const, label: "Legacy", prefix: "1..." },
      ];

  async function handleSelectAddressType(
    typeId: "segwit-native" | "segwit-nested" | "legacy",
  ) {
    const current = get(walletStore).hdState?.addressType;
    if (current === typeId) {
      closeWalletSettingsMenu();
      return;
    }

    try {
      await switchAddressType(typeId);
      closeWalletSettingsMenu();
    } catch (e) {
      console.error("Address type switch failed:", e);
      triggerToast(
        e instanceof Error
          ? e.message
          : "Could not switch address format. Try again.",
        "error",
      );
    }
  }

  /**
   * Attempt to fetch wallet data (balance, txs) with local status handling
   */
  async function fetchWalletDataAndHandleStatus() {
    isRefreshing = true;
    try {
      await refreshWalletData();
      pairingStatus = "Wallet updated";
      pairingStep = 0;
      // Show success toast and redirect to main wallet page after short delay
      triggerToast("Wallet Loaded", "success");
      setTimeout(() => {
        // Ensure navigation only happens when needed and use a robust extension URL fallback
        pairingStep = 0;
        if (
          typeof chrome !== "undefined" &&
          chrome.runtime &&
          chrome.runtime.getURL
        ) {
          const popupUrl = chrome.runtime.getURL("popup.html");
          if (typeof window !== "undefined" && location.href !== popupUrl) {
            location.href = popupUrl;
          }
        } else if (
          typeof window !== "undefined" &&
          location.pathname !== "/popup.html"
        ) {
          // Fallback to client navigation if chrome.runtime not available
          goto("/popup.html");
        }
      }, 700);
    } catch (err) {
      console.error("Failed to refresh wallet data:", err);
      pairingStatus = "Paired but failed to fetch wallet data";
      triggerToast("Paired but failed to fetch wallet data", "error");
      throw err;
    } finally {
      isRefreshing = false;
    }
  }
  async function handleRequestAddresses() {
    requestingAddresses = true;
    try {
      // Generate QR code for mobile to scan
      const dataUrl = await qr.requestAddresses();
      qrCodeDataUrl = dataUrl;
      qrModalTitle = "Scan with Mobile Wallet";
      showQRModal = true;
    } catch (error) {
      console.error("Failed to generate address request QR:", error);
      alert("Failed to generate QR code");
    } finally {
      requestingAddresses = false;
    }
  }

  function closeQRModal() {
    if (!showQRModal) return; // avoid double-close / redundant runs
    showQRModal = false;
    qrCodeDataUrl = "";
    qrModalTitle = "";
    qr.clearSession();
  }

  async function retryFetchWalletData() {
    if (isRefreshing) return;
    pairingStatus = "Retrying wallet data fetch...";
    try {
      await fetchWalletDataAndHandleStatus();
    } catch (err) {
      // error handled by helper
    }
  }

  async function openSend() {
    sendAmount = "";
    sendAddress = "";
    clearBrantaState();
    showSendAddressScanner = false;
    sendFeeEstimates = null;
    sendUtxos = null;
    sendFeeStrategy = "1hr";
    sendFeeEstimatesLoading = true;
    showSend = true;
    const wallet = get(walletStore);
    const candidate = resolveNetworkAddressCandidate(wallet);
    const address = candidate.address;
    const network = candidate.network;
    try {
      if (wallet.network !== network) {
        await setNetwork(network);
      }
      if (address) {
        blockchain.setNetwork(network);
        const [fees, utxos] = await Promise.all([
          blockchain
            .getFeeEstimates()
            .catch(() => ({ fastestFee: 2, halfHourFee: 1, hourFee: 1, minimumFee: 1 })),
          blockchain.getUTXOs(address).catch(() => []),
        ]);
        sendFeeEstimates = fees;
        sendUtxos = utxos && utxos.length > 0 ? utxos : null;
      } else {
        sendFeeEstimates = await blockchain
          .getFeeEstimates()
          .catch(() => ({ fastestFee: 2, halfHourFee: 1, hourFee: 1, minimumFee: 1 }));
      }
    } catch (e) {
      console.warn("Send modal: failed to load fees/utxos", e);
    } finally {
      sendFeeEstimatesLoading = false;
    }
  }

  async function handleSendMax() {
    const balanceSats = Math.round(balance * 1e8);
    if (balanceSats <= 0) return;
    if (!sendFeeEstimates) {
      triggerToast("Fee not loaded yet", "error");
      return;
    }
    const rate =
      sendFeeRate > 0
        ? sendFeeRate
        : toNum(sendFeeEstimates.halfHourFee) ||
          toNum(sendFeeEstimates.hourFee) ||
          toNum(sendFeeEstimates.fastestFee) ||
          1;
    const { feeSats } =
      sendUtxos && rate > 0
        ? estimateFeeForAmount(balanceSats, sendUtxos, rate)
        : { feeSats: Math.ceil(140 * rate) };
    const maxAmountSats = Math.max(0, balanceSats - feeSats);
    sendAmount = (maxAmountSats / 1e8).toFixed(8).replace(/\.?0+$/, "") || "0";
    await tick();
  }

  function closeModals() {
    showSend = false;
    showReceive = false;
    if (brantaDebounceTimer) {
      clearTimeout(brantaDebounceTimer);
      brantaDebounceTimer = null;
    }
    clearBrantaState();
    message = "";
  }

  async function confirmSend() {
    sending = true;
    message = "";
    await new Promise((r) => setTimeout(r, 400));
    const amount = parseFloat(sendAmount || "0");
    if (!amount || !sendAddress) {
      message = "Please enter amount and address.";
      sending = false;
      return;
    }
    if (!sendAmountValid) {
      message =
        "Amount + fee exceeds balance. Lower the amount or choose a cheaper fee.";
      triggerToast(message, "error");
      sending = false;
      return;
    }

    try {
      const amountSats = Math.round(amount * 1e8);
      const wallet = get(walletStore);
      const candidate = resolveNetworkAddressCandidate(wallet);
      const network = candidate.network;

      if (brantaResult && !brantaResult.isFlagged) {
        psbt.setBrantaMerchant({
          merchantId: brantaResult.merchantId,
          merchantName: brantaResult.merchantName,
          logoUrl: brantaResult.logoUrl,
          verifyUrl: brantaResult.verifyUrl,
        });
      } else {
        psbt.setBrantaMerchant(null);
      }

      if (wallet.network !== network) {
        await setNetwork(network);
      }

      // Use aggregated tagged UTXOs from HD wallet store
      const taggedUtxos = (wallet.utxos || []).filter(
        u => inferAddressNetwork(u.address) === network,
      );
      if (taggedUtxos.length === 0) {
        throw new Error("No UTXOs available for spending");
      }

      blockchain.setNetwork(network);

      const balanceSats = taggedUtxos.reduce((sum, u) => sum + u.value, 0);
      if (amountSats > balanceSats) {
        throw new Error(
          `Insufficient balance. Have ${balanceSats} sats, need ${amountSats} sats`,
        );
      }

      let feeRateUsed = getSendFeeRate();
      if (!feeRateUsed || feeRateUsed <= 0) {
        const feeEst = await blockchain
          .getFeeEstimates()
          .catch(() => ({ fastestFee: 2, halfHourFee: 1, hourFee: 1, minimumFee: 1 }));
        feeRateUsed =
          feeEst.hourFee ?? feeEst.halfHourFee ?? feeEst.fastestFee ?? 5;
      }
      if (!feeRateUsed || feeRateUsed <= 0) {
        throw new Error("Failed to get fee estimates from mempool");
      }

      const estimatedVsize = 140;
      const estimatedFeeSats = Math.max(1, Math.ceil(estimatedVsize * feeRateUsed));
      if (amountSats + estimatedFeeSats > balanceSats) {
        throw new Error(
          `Total (amount + fee) exceeds balance. Have ${balanceSats} sats, need ${amountSats + estimatedFeeSats} sats.`,
        );
      }

      if (sendMode === "dkls") {
        const pairedNostrNpub = ($walletStore.pairedNostrNpub || "").trim();
        if (pairedNostrNpub) {
          // Native DKLS MPC send: paired mobile device signs with its own committee
          // peer and broadcasts itself — never build/send a PSBT for this path.
          const { qrDataUrl } = await psbt.requestNativeSend({
            recipientAddress: sendAddress,
            amountSats,
            feeRate: feeRateUsed,
          });
          // Strictly airgapped initiation: extension only shows QR for mobile scan.
          qrCodeDataUrl = qrDataUrl;
          qrModalTitle = "Scan with Mobile Wallet to Send";
          showSend = false;
          showQRModal = true;
          triggerToast(
            "Send QR generated. Scan with your mobile to continue.",
            "success",
          );
          return;
        }

        // No live Nostr channel yet: fall back to the plain send-fill QR (v5 format),
        // which mobile already recognizes as a native, non-PSBT send request.
        const { dataUrl } = await qr.generateSendQR(
          sendAddress,
          amountSats,
          estimatedFeeSats,
          "",
          $walletStore.hdState?.addressType || "segwit-native",
          getCurrentReceiveAddress()?.path || "",
          $walletStore.network,
        );
        await persistPendingBrantaMetadata(sendAddress, amountSats);
        qrCodeDataUrl = dataUrl;
        qrModalTitle = "Scan with Mobile Wallet to Send";
        showSend = false;
        showQRModal = true;
        message =
          "Open your mobile wallet and scan this QR to complete the send natively.";
        triggerToast("Send QR generated. Scan with mobile to complete.", "success");
        setTimeout(() => {
          message = "";
        }, 1200);
        return;
      }

      // Standard PSBT Export: explicit user choice, regardless of pairing type.
      const { psbtBase64, feeSats } = await psbt.createPsbt({
        recipientAddress: sendAddress,
        amountSats,
        feeRate: feeRateUsed,
      });

      const psbtQrDataUrl = await qr.generatePsbtQR(psbtBase64);
      qrCodeDataUrl = psbtQrDataUrl;
      qrModalTitle = "Scan with Mobile Wallet to Co-Sign";
      showSend = false;
      showQRModal = true;
      message =
        "Open your mobile wallet and scan this QR to sign and request peer co-signature.";
      triggerToast(
        `PSBT QR generated (fee ${feeSats} sats). Scan with mobile to co-sign.`,
        "success",
      );

      setTimeout(() => {
        message = "";
      }, 1200);
    } catch (err) {
      console.error("Failed to prepare/send transaction:", err);
      const errMsg =
        err instanceof Error ? err.message : typeof err === "string" ? err : "";
      if (/No UTXOs available/.test(errMsg)) {
        message =
          "No UTXOs available for spending on this address. Please fund the wallet or use your mobile wallet to send.";
        triggerToast(message, "error");
      } else if (/Insufficient balance|Total.*exceeds/.test(errMsg)) {
        message = errMsg;
        triggerToast(message, "error");
      } else if (/fee estimates|No active wallet/.test(errMsg)) {
        message = errMsg;
        triggerToast(message, "error");
      } else if (/radix2\.encode|Uint8Array|bech32/i.test(errMsg)) {
        message =
          "Failed to prepare a secure connection to your mobile device. Please try again — if this persists, re-pair your device.";
        triggerToast(message, "error");
      } else if (/HTTP 5\d\d|NetworkError|Failed to fetch|timed? ?out/i.test(errMsg)) {
        message =
          "Network error while preparing the transaction. Please check your connection and try again.";
        triggerToast(message, "error");
      } else {
        triggerToast("Failed to prepare transaction", "error");
        message = "Failed to prepare transaction.";
      }
    } finally {
      sending = false;
    }
  }

  function mockReceive() {
    const amount = 0.0025;
    balance = +(balance + amount).toFixed(8);
    const mockId = Math.random().toString(36).slice(2);
    transactions = [
      {
        id: mockId,
        type: "in" as const,
        amount,
        amountFormatted: amount.toFixed(8).replace(/\.?0+$/, "") || "0",
        status: "confirmed" as const,
        statusLabel: "Received",
        shortTxId: `${mockId.slice(0, 4)}...${mockId.slice(-4)}`,
        timeLabel: "Just now",
        addressLabel: "",
        fiatAmount: btcRateForFiat ? (amount * btcRateForFiat).toFixed(2) : "",
        merchant: undefined,
      },
      ...transactions,
    ];
    message = "Received!";
    setTimeout(() => closeModals(), 1000);
  }

  async function checkCameraPermissionOnFirstLoad() {
    const alreadyChecked = await storage.get<boolean>(
      "cameraPermissionChecked",
    );
    if (alreadyChecked) return;
    try {
      let hasPermission = false;
      if ("permissions" in navigator && navigator.permissions) {
        const result = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        hasPermission = result.state === "granted";
      }
      if (hasPermission) {
        await storage.set("cameraPermissionChecked", true);
      } else {
        showCameraPermissionScreen = true;
      }
    } catch {
      showCameraPermissionScreen = true;
    }
  }

  function handleCameraPermissionGranted(
    changes: { [key: string]: chrome.storage.StorageChange },
    namespace: string,
  ) {
    if (namespace === "local" && changes.cameraPermissionGranted?.newValue) {
      chrome.storage.onChanged.removeListener(handleCameraPermissionGranted);
      chrome.storage.local.remove("cameraPermissionGranted");
      storage.set("cameraPermissionChecked", true);
      showCameraPermissionScreen = false;
      triggerToast("Camera permission granted", "success");
      if (pendingActionAfterCamera === "pairing") {
        pendingActionAfterCamera = null;
        startPairingFlow();
      }
    }
  }

  /**
   * Request camera permission by opening the extension's permission page in a new tab.
   * Chrome reliably shows the Allow/Block prompt in a full tab; in the popup it often
   * does not appear or the popup closes. After the user allows in the tab, we get
   * notified via storage and close the overlay / run pending action.
   */
  function requestCameraPermission() {
    if (cameraPermissionRequesting) return;
    cameraPermissionDeniedHint = false;
    openCameraPermissionTab();
  }

  function openCameraSettings() {
    try {
      chrome.tabs.create({ url: "chrome://settings/content/camera" });
      triggerToast("Open Camera settings and allow this extension", "success");
    } catch {
      triggerToast(
        "Go to Chrome Settings → Privacy and security → Site settings → Camera",
        "success",
      );
    }
  }

  function openCameraPermissionTab() {
    chrome.tabs.create({
      url: chrome.runtime.getURL("permission-grant.html"),
      active: true,
    });
    chrome.storage.onChanged.addListener(handleCameraPermissionGranted);
  }

  async function skipCameraPermission() {
    cameraPermissionDeniedHint = false;
    await storage.set("cameraPermissionChecked", true);
    showCameraPermissionScreen = false;
    if (pendingActionAfterCamera === "pairing") {
      pendingActionAfterCamera = null;
      await startPairingFlow();
    }
  }

  onDestroy(() => {
    if (brantaDebounceTimer) {
      clearTimeout(brantaDebounceTimer);
      brantaDebounceTimer = null;
    }
    if (clearVisualizerTimer) {
      clearTimeout(clearVisualizerTimer);
      clearVisualizerTimer = null;
    }
  });

  onMount(async () => {
    await initializeWalletStore();
    await loadCachedBrantaMetadata();
    await loadPinHash();
    await loadMempoolFromStorage();
    await checkCameraPermissionOnFirstLoad();
    const saved = await storage.get<string>("currency");
    if (saved && typeof saved === "string") selectedCurrency = saved;
    if (isPaired && mempoolChoice !== null && mempoolChoice !== "loading") {
      // Ensure HD discovery has run (skips automatically if still fresh).
      // Populates hdState so getCurrentReceiveAddress returns the correct index.
      await runHdDiscovery();
      await fetchWalletDataAndHandleStatus();
      await fetchPrices();
    }
    console.log("[Page Debug] RecentTransactions mounted. Wallet store transactions count:", $walletStore.transactions?.length);
  });
    $: console.log("[Page Debug] Wallet store updated. Raw transactions:", $walletStore.transactions);

</script>

<svelte:window on:keydown={handleWalletSettingsEscape} />
<div
  class="popup-root"
  class:unpaired={!isPaired && !showCameraPermissionScreen}
  class:launch-screen={showCameraPermissionScreen ||
    (!isPaired && pairingStep === 0)}
>
  {#if showCameraPermissionScreen}
    <div class="camera-permission-overlay">
      <div class="camera-permission-card">
        <img
          src={$themeName === "darkPolished" ? logoSmallDark : logo}
          alt=""
          class="camera-permission-logo"
          width="64"
          height="64"
        />
        {#if cameraPermissionDeniedHint}
          <h1 class="camera-permission-title">Camera was blocked</h1>
          <p class="camera-permission-hint">
            The browser won't show the prompt again. To allow camera: open <strong
              >Chrome Settings → Privacy and security → Site settings → Camera</strong
            >, find this extension and set it to <strong>Allow</strong>.
          </p>
          <div class="camera-permission-actions">
            <button
              type="button"
              class="btn-primary camera-permission-grant"
              on:click={openCameraSettings}
            >
              Open camera settings
            </button>
            <button
              type="button"
              class="btn-secondary camera-permission-skip"
              on:click={requestCameraPermission}
              disabled={cameraPermissionRequesting}
            >
              {cameraPermissionRequesting ? "Requesting…" : "Try again"}
            </button>
            <button
              type="button"
              class="btn-secondary camera-permission-skip"
              on:click={skipCameraPermission}
            >
              Skip for now
            </button>
          </div>
        {:else}
          <h1 class="camera-permission-title">Camera access</h1>
          <p class="camera-permission-hint">
            {#if pendingActionAfterCamera === "pairing"}
              Camera is needed to scan the response QR from your phone. Grant
              access to continue with pairing.
            {:else}
              Bold Wallet uses your camera to scan QR codes for pairing and
              sending Bitcoin. Grant access to get started.
            {/if}
          </p>
          <div class="camera-permission-actions">
            <button
              type="button"
              class="btn-primary camera-permission-grant"
              on:click={requestCameraPermission}
              disabled={cameraPermissionRequesting}
            >
              {cameraPermissionRequesting
                ? "Requesting…"
                : "Grant camera permission"}
            </button>
            <button
              type="button"
              class="btn-secondary camera-permission-skip"
              on:click={skipCameraPermission}
            >
              Skip for now
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
  <!-- Generic header (hidden on launch screen) -->
  {#if isPaired || pairingStep > 0}
    <header class="app-header" aria-label="Extension header">
      <span class="app-header-left">
        {#if showLockScreen}
          <img
            src={$themeName === "darkPolished" ? logoSmallDark : logoSmall}
            alt="Bold"
            class="header-logo"
            width="32"
            height="32"
          />
          <span class="header-title-text">Unlock</span>
        {:else if showSetPinScreen}
          <img
            src={$themeName === "darkPolished" ? logoSmallDark : logoSmall}
            alt="Bold"
            class="header-logo"
            width="32"
            height="32"
          />
          <span class="header-title-text">Set PIN</span>
        {:else if showMainApp}
          <div class="header-mainnet-testnet-wrap">
            <button
              type="button"
              class="header-price-btn"
              on:click={openCurrencyModal}
              title="Bitcoin price – tap to change currency"
              aria-label="Bitcoin price: {btcPriceDisplay} {getCurrencySymbol(
                selectedCurrency,
              )}. Tap to change currency."
            >
              <img
                src={bitcoinLogo}
                alt=""
                class="header-price-icon"
                width="20"
                height="20"
              />
              <span class="header-price-text"
                >{btcPriceDisplay} {getCurrencySymbol(selectedCurrency)}</span
              >
            </button>
            {#if $networkStore.isTestnet}
              <span class="header-testnet-badge">TESTNET</span>
            {/if}
          </div>
        {:else}
          <img
            src={$themeName === "darkPolished" ? logoSmallDark : logoSmall}
            alt="Bold"
            class="header-logo"
            width="32"
            height="32"
          />
        {/if}
      </span>
      <span class="app-header-right">
        {#if !isExpandedView}
          <button
            type="button"
            class="expand-btn"
            on:click={openExpandedView}
            title="Open in full tab"
            aria-label="Open wallet in full tab"
          >
            <svg
              class="header-icon expand-icon"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <path d="M3 3h5.5M3 3v5.5M3 3l6 6M17 17h-5.5M17 17v-5.5M17 17l-6-6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        {/if}
        {#if showMainApp}
          <button
            type="button"
            class="lock-btn"
            on:click={handleLock}
            title="Lock extension"
            aria-label="Lock extension"
          >
            <img
              src={lockerIcon}
              alt=""
              class="header-icon lock-icon"
              width="20"
              height="20"
            />
          </button>
          <div
            id="header-secondary-utils"
            class="header-secondary-utils"
            class:expanded={isHeaderUtilitiesExpanded}
            aria-hidden={!isHeaderUtilitiesExpanded}
          >
            <button
              class:refresh-btn={true}
              class:spinning={isRefreshing}
              on:click={handleRefresh}
              disabled={isRefreshing}
              title="Refresh wallet data"
              tabindex={isHeaderUtilitiesExpanded ? 0 : -1}
            >
              <img
                src={refreshIcon}
                alt=""
                class="header-icon refresh-icon"
                width="20"
                height="20"
              />
            </button>
            <button
              class="balance-visibility-btn"
              on:click={toggleBalance}
              title={showBalance ? "Hide balance" : "Show balance"}
              aria-label={showBalance ? "Hide balance" : "Show balance"}
              tabindex={isHeaderUtilitiesExpanded ? 0 : -1}
            >
              <img
                src={showBalance ? eyeOnIcon : eyeOffIcon}
                alt=""
                class="balance-visibility-icon"
                width="20"
                height="20"
              />
            </button>
          </div>
          <button
            type="button"
            class="header-utils-toggle-btn"
            class:expanded={isHeaderUtilitiesExpanded}
            on:click={toggleHeaderUtilities}
            title={isHeaderUtilitiesExpanded
              ? "Hide quick actions"
              : "Show quick actions"}
            aria-label={isHeaderUtilitiesExpanded
              ? "Hide quick actions"
              : "Show quick actions"}
            aria-expanded={isHeaderUtilitiesExpanded}
            aria-controls="header-secondary-utils"
          >
            <svg
              class="header-icon header-utils-toggle-icon"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <path
                d="M12.5 4.5L7 10l5.5 5.5"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            class="wallet-settings-btn"
            on:click={toggleWalletSettingsMenu}
            title="Wallet details and settings"
            aria-label="Wallet details and settings"
            aria-expanded={showWalletSettingsMenu}
            aria-haspopup="dialog"
          >
            <svg
              class="header-icon wallet-settings-icon"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        {:else if isPaired || pairingStep > 0}
          <button
            class="theme-toggle"
            on:click={toggleTheme}
            title={$themeName === "darkPolished"
              ? "Switch to light"
              : "Switch to dark"}
            aria-label="Toggle theme"
          >
            <img
              src={$themeName === "darkPolished" ? lightIcon : darkIcon}
              alt=""
              class="header-icon theme-toggle-icon"
              width="20"
              height="20"
            />
          </button>
        {/if}
      </span>
    </header>
  {/if}

  {#if showWalletSettingsMenu && showMainApp}
    <div
      class="modal mempool-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-settings-title"
      tabindex="-1"
      on:click={closeWalletSettingsMenu}
      on:keydown={(e) => e.key === "Escape" && closeWalletSettingsMenu()}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events: stop modal backdrop from receiving bubbled clicks from the panel -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        id="wallet-settings-panel"
        class="modal-card wallet-settings-sheet"
        role="document"
        tabindex="-1"
        on:click|stopPropagation
      >
      <div class="wallet-settings-head">
        <h2 id="wallet-settings-title" class="wallet-settings-title">
          Wallet details
        </h2>
        <button
          type="button"
          class="wallet-settings-close"
          on:click={closeWalletSettingsMenu}
          aria-label="Close wallet settings"
        >✕</button>
      </div>

      <div class="wallet-settings-body">
      <section class="wallet-settings-block">
        <h3 class="wallet-settings-label">Fingerprint</h3>
        <p class="wallet-settings-hint">
          Short fingerprint for this wallet
        </p>
        <div class="wallet-settings-fingerprint-row">
          <span class="wallet-settings-fingerprint-value">
            {keyshareFingerprintDisplay}
          </span>
          <button
            type="button"
            class="wallet-id-copy"
            on:click={copyWalletFingerprint}
            disabled={keyshareFingerprintDisplay === "N/A"}
            title="Copy fingerprint"
            aria-label="Copy fingerprint"
          >
            Copy
          </button>
        </div>
      </section>

      <section class="wallet-settings-block">
        <h3 class="wallet-settings-label">Appearance</h3>
        <div class="wallet-settings-row">
          <span class="wallet-settings-row-text">
            {$themeName === "darkPolished" ? "Dark theme" : "Light theme"}
          </span>
          <button
            type="button"
            class="wallet-settings-theme-btn"
            on:click={toggleTheme}
            title={$themeName === "darkPolished"
              ? "Switch to light mode"
              : "Switch to dark mode"}
          >
            <img
              src={$themeName === "darkPolished" ? lightIcon : darkIcon}
              alt=""
              class="header-icon"
              width="20"
              height="20"
            />
          </button>
        </div>
      </section>

      <!-- Network / Environment Toggle (moved from header into Wallet Details) -->
      <section class="wallet-settings-block">
        <h3 class="wallet-settings-label">Network</h3>
        <p class="wallet-settings-hint">Switch between Mainnet and Testnet (developer mode).</p>
        <div class="network-toggle-row">
          <button
            type="button"
            class="network-pill"
            class:active={$networkStore.network === 'mainnet'}
            on:click={() => handleNetworkChange('mainnet')}
            disabled={isTogglingNetwork}
          >
            Mainnet
          </button>
          <button
            type="button"
            class="network-pill testnet"
            class:active={$networkStore.network === 'testnet'}
            on:click={() => handleNetworkChange('testnet')}
            disabled={isTogglingNetwork}
          >
            Testnet
          </button>
        </div>
        {#if $networkStore.isTestnet}
          <div class="testnet-badge-inline">TESTNET — developer mode active</div>
        {/if}
      </section>

      <section class="wallet-settings-block">
        <h3 class="wallet-settings-label">Receiving address format</h3>
        {#if selectedAddressShort}
          <p class="wallet-settings-address-preview">{selectedAddressShort}</p>
        {/if}
        {#if $walletStore.publicKey}
          {#if $addressTypeUISelection}
            <p class="wallet-settings-switching" aria-live="polite">
              Switching to {$addressTypeUISelection === "segwit-native"
                ? "Native SegWit"
                : $addressTypeUISelection === "segwit-nested"
                  ? "SegWit compatible"
                  : "Legacy"}… fetching addresses
            </p>
          {/if}
          <ul class="wallet-settings-address-list">
            {#each ADDRESS_TYPES as atype}
              <li>
                <button
                  type="button"
                  class="address-item wallet-settings-address-item"
                  class:active={settingsHighlightedAddressType === atype.id}
                  disabled={!!$addressTypeUISelection}
                  on:click={() => handleSelectAddressType(atype.id)}
                >
                  <img
                    src={addressTypeIcon}
                    alt=""
                    class="address-type-icon"
                    width="18"
                    height="18"
                  />
                  <div class="address-info">
                    <div class="address-text">{atype.label}</div>
                    <div class="address-prefix">{atype.prefix}</div>
                  </div>
                  {#if settingsHighlightedAddressType === atype.id}
                    <span class="address-check">✓</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <button
            type="button"
            class="wallet-settings-sync-btn"
            disabled={requestingAddresses}
            on:click={onSettingsSyncAddresses}
          >
            {requestingAddresses ? "Opening…" : "Sync addresses from mobile"}
          </button>
        {/if}
      </section>

      <section class="wallet-settings-block wallet-settings-danger">
        <button
          type="button"
          class="wallet-settings-unpair-btn"
          on:click={handleUnpair}
        >
          <img
            src={deleteIcon}
            alt=""
            class="wallet-settings-unpair-icon"
            width="18"
            height="18"
          />
          Unpair wallet
        </button>
      </section>
      </div>
    </div>
    </div>
  {/if}

  <!-- Global toast (always visible when message set, regardless of paired/unpaired) -->
  {#if toastMessage}
    <div
      class="toast toast-global {toastType}"
      role="status"
      aria-live="polite"
      in:fade={{ duration: 200 }}
      out:fade={{ duration: 420 }}
    >
      {toastMessage}
    </div>
  {/if}

  <!-- Content area -->
  <div class="app-content">
    {#if showPinLoading}
      <div class="pin-screen pin-loading">
        <span class="spinner" aria-hidden="true"></span>
        <p class="pin-loading-text">Loading…</p>
      </div>
    {:else if showLockScreen}
      <!-- Lock screen: require PIN to unlock -->
      <div class="pin-screen lock-screen">
        <div class="lock-screen-main">
          <div class="pin-screen-card">
            <img
              src={$themeName === "darkPolished" ? logoSmallDark : logo}
              alt=""
              class="pin-screen-logo"
              width="56"
              height="56"
            />
            <h2 class="pin-screen-title">Unlock extension</h2>
            <p class="pin-screen-hint">Enter your PIN to continue</p>
            <form on:submit|preventDefault={handleUnlock} class="pin-form">
              <input
                type="password"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="off"
                placeholder="PIN"
                bind:value={unlockPinValue}
                class="pin-input"
                maxlength={PIN_MAX_LENGTH}
                aria-label="PIN"
                aria-invalid={!!unlockError}
                aria-describedby={unlockError ? "unlock-pin-error" : undefined}
              />
              {#if unlockError}
                <p id="unlock-pin-error" class="pin-error" role="alert">
                  {unlockError}
                </p>
              {/if}
              <button type="submit" class="btn-primary pin-submit">Unlock</button>
            </form>
          </div>
        </div>
        {#if extensionVersionLabel}
          <p class="lock-screen-version" aria-label="Extension version">
            {extensionVersionLabel}
          </p>
        {/if}
      </div>
    {:else if showMempoolPreferenceScreen}
      <!-- Mempool provider: choose custom or skip for default (after pairing, once) -->
      <div class="pin-screen mempool-preference-screen">
        <div class="pin-screen-card mempool-preference-card">
          <img
            src={$themeName === "darkPolished" ? logoSmallDark : logo}
            alt=""
            class="pin-screen-logo"
            width="56"
            height="56"
          />
          <h2 class="pin-screen-title">Mempool provider</h2>
          <p class="pin-screen-hint pin-hint-long">
            You can use the default mempool.space (Skip) or point to your own
            server for enhanced privacy.
          </p>
          <div class="mempool-preference-form">
            <label for="mempool-url" class="mempool-label"
              >Provider URL (optional)</label
            >
            <input
              id="mempool-url"
              type="url"
              autocomplete="off"
              placeholder="https://mempool.space/api"
              bind:value={mempoolInputValue}
              class="pin-input mempool-input"
              aria-label="Mempool API URL"
            />
            {#if mempoolError}
              <p class="pin-error" role="alert">{mempoolError}</p>
            {/if}
            <div class="mempool-preference-actions">
              <button
                type="button"
                class="btn-secondary mempool-skip-btn"
                on:click={handleMempoolSkip}
              >
                Skip
              </button>
              <button
                type="button"
                class="btn-primary mempool-save-btn"
                on:click={() => handleMempoolSave(mempoolInputValue)}
                disabled={mempoolSaving}
              >
                {mempoolSaving ? "Checking…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    {:else if showSetPinScreen}
      <!-- Set PIN screen: required after pairing if no PIN -->
      <div class="pin-screen set-pin-screen">
        <div class="pin-screen-card">
          <img
            src={$themeName === "darkPolished" ? logoSmallDark : logo}
            alt=""
            class="pin-screen-logo"
            width="56"
            height="56"
          />
          <h2 class="pin-screen-title">Set your PIN</h2>
          <form on:submit|preventDefault={handleSetPin} class="pin-form pin-form-confirm">
            <input
              type="password"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              placeholder="PIN"
              bind:value={setPinValue}
              class="pin-input"
              maxlength={PIN_MAX_LENGTH}
              aria-label="PIN"
              aria-invalid={!!setPinError}
              aria-describedby={setPinError ? "set-pin-error" : undefined}
            />
            <input
              type="password"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              placeholder="Confirm PIN"
              bind:value={setPinConfirm}
              class="pin-input"
              maxlength={PIN_MAX_LENGTH}
              aria-label="Confirm PIN"
              aria-invalid={!!setPinError}
              aria-describedby={setPinError ? "set-pin-error" : undefined}
            />
            {#if setPinError}
              <p id="set-pin-error" class="pin-error" role="alert">
                {setPinError}
              </p>
            {/if}
            <button type="submit" class="btn-primary pin-submit">Set PIN</button
            >
          </form>
        </div>
      </div>
    {:else if !isPaired}
      <!-- Unpaired: pairing flow -->
      <div class="pairing-container" class:steps-active={pairingStep > 0}>
        <div class="pairing-body" class:steps-active={pairingStep > 0}>
          {#if pairingStep === 0}
            <GetStartedView onBind={handlePairDevice} />
          {/if}

          {#if pairingStep > 0}
            {#if pairingStep !== 4}
              <div class="bind-flow">
                <nav
                  class="stepper stepper-dots stepper-top"
                  aria-label="Binding progress"
                >
                  <span
                    class="stepper-dot"
                    class:active={pairingStep === 1}
                    class:done={pairingStep >= 3}
                    aria-current={pairingStep === 1 ? "step" : undefined}
                    >1</span
                  >
                  <span
                    class="stepper-line"
                    class:done={pairingStep >= 3}
                    aria-hidden="true"
                  ></span>
                  <span
                    class="stepper-dot"
                    class:active={pairingStep >= 3}
                    class:done={pairingStatus === "Paired successfully" ||
                      pairingStatus ===
                        "Paired but failed to fetch wallet data"}
                    aria-current={pairingStep >= 3 ? "step" : undefined}>2</span
                  >
                </nav>
                <div class="qr-display">
                  {#if pairingStep === 1}
                    <div class="step-container step-one">
                      <h2 class="step-title">Scan with your phone</h2>
                      <p class="instruction">
                        Open the Bold app, go to Devices or Wallet, and scan
                        this QR.
                      </p>
                      <div class="qr-code">
                        <img
                          src={pairingQRData}
                          alt="Pairing code – scan with Bold app"
                        />
                      </div>
                      <div class="button-row">
                        <button class="btn-secondary" on:click={prevStep}
                          >Cancel</button
                        >
                        <button class="btn-primary" on:click={nextStep}
                          >Continue</button
                        >
                      </div>
                    </div>
                  {:else if pairingStep === 3}
                    <div class="step-container step-two">
                      <h2 class="step-title">Scan response from phone</h2>
                      <p class="instruction">
                        The Bold app shows a QR. Scan it here or paste the
                        response manually.
                      </p>
                      <div class="button-row">
                        <button
                          class="btn-primary"
                          on:click={handleStartScanner}>Scan QR</button
                        >
                        <button
                          class="btn-secondary"
                          on:click={handleScanResponse}>Enter manually</button
                        >
                      </div>
                      <button class="btn-text" on:click={prevStep}>Back</button>
                    </div>
                  {:else if pairingStep === 5}
                    <div class="step-container step-manual">
                      <h2 class="step-title">Paste response</h2>
                      <p class="instruction">
                        Paste the response from your mobile wallet below.
                      </p>
                      <textarea
                        class="public-key-input"
                        bind:value={manualPublicKey}
                        placeholder="Paste response here..."
                        rows="4"
                        disabled={processingPairing}
                      ></textarea>
                      <div class="button-row">
                        <button
                          class="btn-primary"
                          on:click={handleManualSubmit}
                          disabled={!manualPublicKey.trim() ||
                            processingPairing}
                        >
                          {processingPairing ? "Processing…" : "Complete"}
                        </button>
                      </div>
                      <button
                        class="btn-text"
                        on:click={() => {
                          pairingStep = 3;
                          pairingStatus = "";
                        }}>Back</button
                      >
                    </div>
                  {/if}

                  {#if pairingStatus || isRefreshing}
                    <p class="pairing-status">
                      {#if isRefreshing}
                        <span
                          class="spinner"
                          aria-hidden="true"
                          title="Fetching wallet data"
                        ></span>
                      {/if}
                      {pairingStatus}
                    </p>
                  {/if}
                  {#if toastMessage}
                    <div class="toast {toastType}">{toastMessage}</div>
                  {/if}

                  {#if pairingStatus === "Paired but failed to fetch wallet data"}
                    <div class="fetch-retry">
                      <p class="instruction">
                        Failed to fetch wallet data. You can retry fetching
                        balances and transactions.
                      </p>
                      <button
                        class="btn-retry-fetch"
                        on:click={retryFetchWalletData}
                        disabled={isRefreshing}
                      >
                        {#if isRefreshing}Retrying...{/if}
                        {#if !isRefreshing}Retry fetch{/if}
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          {/if}

          {#if pairingStep === 4}
            <div class="bind-flow scanner-overlay">
              <nav
                class="stepper stepper-dots stepper-top"
                aria-label="Binding progress"
              >
                <span class="stepper-dot" class:done={true}>1</span>
                <span class="stepper-line" class:done={true} aria-hidden="true"
                ></span>
                <span
                  class="stepper-dot"
                  class:active={true}
                  aria-current="step">2</span
                >
              </nav>
              <div class="scanner-card">
                <p class="scanner-step-label">
                  Scan the response QR from your phone
                </p>
                <QRScannerPopup
                  onScan={handleQRScanFromCamera}
                  onClose={handleCloseScanner}
                />
              </div>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Paired State: Show wallet (single generic header above) -->
      <div class="wallet">
        <div class="wallet-content">
          <section class="balance-card">
            <div class="balance-card-inner">
              {#if $walletStore.isLoading}
                <div class="balance-loading">
                  <span class="spinner" aria-hidden="true"></span>
                  <span>Loading…</span>
                </div>
              {:else if $walletStore.error}
                <div class="amount error fade-in">Error</div>
                <div class="fiat error fade-in">{$walletStore.error}</div>
              {:else if showBalance}
                <div class="amount fade-in">
                  {balance.toFixed(8)} <span class="unit">BTC</span>
                </div>
                <div class="fiat fade-in">
                  ~ {fiatSymbol}{fiat.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              {:else}
                <div class="amount placeholder fade-in">●●●●●●●●</div>
                <div class="fiat placeholder fade-in">●●●●●●●</div>
              {/if}
            </div>
          </section>

          <section class="actions-row">
            <button class="action-btn send-btn" on:click={openSend}>
              <img
                src={sendIcon}
                alt=""
                class="action-btn-icon"
                width="18"
                height="18"
              />
              <span>Send</span>
            </button>
            <button class="action-btn receive-btn" on:click={openReceive}>
              <img
                src={receiveIcon}
                alt=""
                class="action-btn-icon"
                width="18"
                height="18"
              />
              <span>Receive</span>
            </button>
          </section>

          {#if showBalance}
            <RecentTransactions
              transactions={mappedTransactions}
              visibleTransactions={mappedTransactions.slice(txPageIndex * TX_PAGE_SIZE, (txPageIndex + 1) * TX_PAGE_SIZE)}
              isLoading={$walletStore.isLoading}
              isLoadingMore={$walletStore.isLoadingMoreTransactions}
              hasMore={$walletStore.hasMoreTransactions}
              network={$walletStore.network}
              themeName={$themeName}
              {fiatSymbol}
              {inIcon}
              {outIcon}
              {pendingIcon}
              {txPageIndex}
              {txTotalPages}
              {prevTxPage}
              {nextTxPage}
              {fetchMoreTransactions}
              {openTxInMempool}
            />
          {:else}
            <section class="tx-list-hidden fade-in">
              <p class="empty">Balance/Transactions hidden</p>
            </section>
          {/if}

          {#if showSend}
            <div
              class="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="send-modal-title"
            >
              <div
                class="modal-card send-modal-card"
                role="presentation"
                on:click|stopPropagation
                on:keydown|stopPropagation
              >
                <div class="receive-modal-header">
                  <h3 id="send-modal-title" class="receive-modal-title">
                    Send BTC
                  </h3>
                  <button
                    type="button"
                    class="receive-modal-close"
                    on:click={closeModals}
                    aria-label="Close">✕</button
                  >
                </div>
                <div class="send-balance-row">
                  <span class="send-balance-label">Balance</span>
                  <span class="send-balance-value"
                    >{balance.toFixed(8)} BTC</span
                  >
                  <span class="send-balance-fiat"
                    >≈ {fiatSymbol}{formatPrice(fiat)}</span
                  >
                </div>
                <label for="send-address">Recipient address</label>
                <div class="send-address-row">
                  <input
                    id="send-address"
                    type="text"
                    placeholder="bc1..."
                    bind:value={sendAddress}
                    class="send-address-input"
                  />
                  <button
                    type="button"
                    class="send-scan-qr-btn"
                    on:click={() => (showSendAddressScanner = true)}
                    title="Scan QR for address"
                    aria-label="Scan QR for address"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><rect x="3" y="3" width="7" height="7" /><rect
                        x="14"
                        y="3"
                        width="7"
                        height="7"
                      /><rect x="3" y="14" width="7" height="7" /><rect
                        x="14"
                        y="14"
                        width="7"
                        height="7"
                      /></svg
                    >
                  </button>
                </div>
                {#if isVerifying}
                  <div class="send-branta-status checking" role="status" aria-live="polite">
                    <span class="send-branta-spinner" aria-hidden="true"></span>
                    <span>Verifying with Branta...</span>
                  </div>
                {:else if brantaError}
                  <div class="send-branta-status error" role="alert">
                    <span class="send-branta-icon" aria-hidden="true">!</span>
                    <span>{brantaError}</span>
                  </div>
                {:else if brantaResult}
                  <div
                    class="send-branta-status"
                    class:flagged={!!brantaResult.isFlagged}
                    class:verified={!brantaResult.isFlagged}
                  >
                    {#if brantaResult.logoUrl && !brantaLogoLoadFailed}
                      <img
                        src={brantaResult.logoUrl}
                        alt={brantaResult.merchantName}
                        class="send-branta-logo"
                        on:error={() => (brantaLogoLoadFailed = true)}
                      />
                    {:else}
                      <span class="send-branta-icon" aria-hidden="true"
                        >{brantaResult.isFlagged ? "!" : "✓"}</span
                      >
                    {/if}
                    <span>
                      {#if brantaResult.isFlagged}
                        Branta flagged address: {brantaResult.merchantName}
                      {:else}
                        Branta Verified: {brantaResult.merchantName}
                      {/if}
                    </span>
                    {#if brantaResult.verifyUrl}
                      <a
                        class="send-branta-link"
                        href={brantaResult.verifyUrl}
                        target="_blank"
                        rel="noreferrer"
                        >Proof ↗</a
                      >
                    {/if}
                  </div>
                {/if}
                <label for="send-amount">Amount (BTC)</label>
                <div class="send-amount-row">
                  <input
                    id="send-amount"
                    type="text"
                    inputmode="decimal"
                    placeholder="0.001"
                    bind:value={sendAmount}
                    class="send-amount-input"
                  />
                  <button
                    type="button"
                    class="send-max-btn"
                    on:click={handleSendMax}
                    disabled={sendBalanceSats <= 0 || sendFeeEstimatesLoading}
                    title="Send maximum (balance − fee)">Max</button
                  >
                </div>
                {#if sendAmountFiat > 0}
                  <p class="send-fiat-equivalent">
                    ≈ {fiatSymbol}{formatPrice(sendAmountFiat)}
                  </p>
                {/if}
                {#if sendFeeEstimatesLoading}
                  <p class="send-fee-row">Loading fee options…</p>
                {:else if sendFeeEstimates}
                  <div class="send-fee-strategy">
                    <span class="send-fee-label">Fee</span>
                    <div
                      class="send-fee-buttons"
                      role="group"
                      aria-label="Fee speed"
                    >
                      {#each SEND_FEE_TIERS as tier}
                        <button
                          type="button"
                          class="send-fee-btn"
                          class:selected={sendFeeStrategy === tier.id}
                          on:click={() => (sendFeeStrategy = tier.id)}
                          disabled={!sendFeeEstimates}
                        >
                          <div class="fee-strategy-name">{tier.label}</div>
                          <div class="fee-strategy-rate">
                            {#if sendFeeEstimates && FEE_STRATEGY_KEYS[tier.id] && sendFeeEstimates[FEE_STRATEGY_KEYS[tier.id]]}
                              <span class="fee-strategy-rate-value"
                                >{sendFeeEstimates[FEE_STRATEGY_KEYS[tier.id]]} sat/vB</span
                              >
                            {:else}
                              —
                            {/if}
                          </div>
                        </button>
                      {/each}
                    </div>
                  </div>
                  <div class="send-summary">
                    <div class="send-summary-line">
                      <span class="send-summary-label">Est. Fee:</span>
                      <span class="send-summary-value">
                        {sendEstimatedFeeSats} sats
                        {#if sendFeeFiat > 0}
                          <span class="send-summary-fiat">≈ {fiatSymbol}{formatPrice(sendFeeFiat)}</span>
                        {/if}
                      </span>
                    </div>
                    <div class="send-summary-line">
                      <span class="send-summary-label">Receiver:</span>
                      <span class="send-summary-value">
                        {(sendAmountSats / 1e8).toFixed(8)} BTC
                        {#if sendAmountFiat > 0}
                          <span class="send-summary-fiat">≈ {fiatSymbol}{formatPrice(sendAmountFiat)}</span>
                        {/if}
                      </span>
                    </div>
                    <div class="send-summary-line send-summary-total">
                      <span class="send-summary-label">Total:</span>
                      <span
                        class="send-summary-value"
                        class:invalid={!sendAmountValid && sendAmountSats > 0}
                      >
                        {(sendTotalSats / 1e8).toFixed(8)} BTC
                        {#if sendTotalFiat > 0}
                          <span class="send-summary-fiat">≈ {fiatSymbol}{formatPrice(sendTotalFiat)}</span>
                        {/if}
                      </span>
                    </div>
                  </div>
                  {#if sendAmountSats > 0 && !sendAmountValid}
                    <p class="send-total-warn">Amount + fee exceeds balance</p>
                  {/if}
                {/if}
                <div class="send-mode-track">
                  <span class="send-fee-label" id="send-mode-label"
                    >Signing Mode</span
                  >
                  <div
                    class="send-mode-options"
                    role="group"
                    aria-labelledby="send-mode-label"
                  >
                    <button
                      type="button"
                      class="send-mode-btn"
                      class:selected={sendMode === "dkls"}
                      on:click={() => (sendMode = "dkls")}
                    >
                      Regular MPC
                    </button>
                    <button
                      type="button"
                      class="send-mode-btn"
                      class:selected={sendMode === "psbt"}
                      on:click={() => (sendMode = "psbt")}
                    >
                      Standard PSBT Export
                    </button>
                  </div>
                </div>
                <div class="modal-actions">
                  <button class="btn" on:click={closeModals}>Cancel</button>
                  <button
                    class="btn primary"
                    on:click={confirmSend}
                    disabled={sending || !sendAmountValid}
                    >{sending ? "Sending..." : "Confirm"}</button
                  >
                </div>
                {#if message}
                  <div class="msg">{message}</div>
                {/if}
              </div>
            </div>
          {/if}

          {#if showSendAddressScanner}
            <QRScanner
              onScan={handleSendAddressScanned}
              onClose={handleSendAddressScannerClose}
            />
          {/if}

          {#if showReceive}
            <div
              class="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="receive-modal-title"
            >
              <div
                class="modal-card receive-modal-card"
                role="presentation"
                on:click|stopPropagation
                on:keydown|stopPropagation
              >
                <div class="receive-modal-header">
                  <div class="receive-modal-title-wrap">
                    <img
                      src={bitcoinLogo}
                      alt=""
                      class="receive-modal-btc-logo"
                      width="24"
                      height="24"
                    />
                    <h3 id="receive-modal-title" class="receive-modal-title">
                      Receive Bitcoin
                    </h3>
                  </div>
                  <button
                    type="button"
                    class="receive-modal-close"
                    on:click={closeModals}
                    aria-label="Close">✕</button
                  >
                </div>
                <div class="receive-modal-badge">
                  {$networkStore.network === 'testnet' ? 'Testnet' : 'Mainnet'}
                </div>
                {#if receiveQRDataUrl}
                  <div class="receive-qr-wrap">
                    <img
                      src={receiveQRDataUrl}
                      alt="Receive address QR code"
                      class="receive-qr-img"
                      width="200"
                      height="200"
                    />
                  </div>
                {:else if receiveAddress && receiveAddress !== "No address configured"}
                  <div class="receive-qr-loading">Generating QR…</div>
                {:else}
                  <div class="receive-qr-loading">No address</div>
                {/if}
                <div class="receive-address-section">
                  {#if receiveDerivationPath}
                    <span class="receive-derivation-path">{receiveDerivationPath}</span>
                  {/if}
                  <button
                    type="button"
                    class="receive-address-touch"
                    on:click={copyReceiveAddress}
                    disabled={!receiveAddress ||
                      receiveAddress === "No address configured"}
                  >
                    {#if isReceiveCopied}
                      <span class="receive-copy-feedback">✓ Copied!</span>
                    {:else}
                      <span class="receive-address-text">{receiveAddress}</span>
                      <span class="receive-address-hint">Tap to copy</span>
                    {/if}
                  </button>
                  <div class="receive-modal-actions">
                    <button
                      type="button"
                      class="receive-action-btn primary"
                      on:click={copyReceiveAddress}
                      disabled={!receiveAddress ||
                        receiveAddress === "No address configured"}
                    >
                      <img
                        src={pasteIcon}
                        alt=""
                        class="receive-action-icon"
                        width="20"
                        height="20"
                      />
                      <span>Copy</span>
                    </button>
                    <button
                      type="button"
                      class="receive-action-btn secondary"
                      on:click={closeModals}>Close</button
                    >
                  </div>
                </div>
              </div>
            </div>
          {/if}

          {#if showQRModal}
            <div class="modal" role="dialog" aria-modal="true">
              <div
                class="modal-card qr-modal"
                role="presentation"
                on:click|stopPropagation
                on:keydown|stopPropagation
              >
                <h3>{qrModalTitle}</h3>
                {#if qrCodeDataUrl}
                  <div class="qr-container">
                    <img src={qrCodeDataUrl} alt="QR Code" class="qr-code" />
                  </div>
                  <p class="qr-instructions">
                    Open your mobile wallet and scan this QR code
                  </p>
                {:else}
                  <p>Generating QR code...</p>
                {/if}
                <div class="modal-actions">
                  <button
                    class="btn"
                    type="button"
                    on:click|stopPropagation={closeQRModal}>Close</button
                  >
                </div>
              </div>
            </div>
          {/if}

          {#if showCurrencyModal}
            <div
              class="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="currency-modal-title"
              tabindex="-1"
              on:click={() => (showCurrencyModal = false)}
              on:keydown={(e) =>
                e.key === "Escape" && (showCurrencyModal = false)}
            >
              <div
                class="modal-card currency-modal-card"
                role="presentation"
                on:click|stopPropagation
                on:keydown|stopPropagation
              >
                <div class="receive-modal-header">
                  <h3 id="currency-modal-title" class="receive-modal-title">
                    Select currency
                  </h3>
                  <button
                    type="button"
                    class="receive-modal-close"
                    on:click={() => (showCurrencyModal = false)}
                    aria-label="Close">✕</button
                  >
                </div>
                <div class="currency-list">
                  {#each Object.entries(priceData).sort( ([a], [b]) => a.localeCompare(b), ) as [code, rate]}
                    <button
                      type="button"
                      class="currency-row"
                      class:selected={code === selectedCurrency}
                      on:click={() => selectCurrency(code)}
                    >
                      <span class="currency-code">{code}</span>
                      <span class="currency-name"
                        >{CURRENCY_NAMES[code] ?? code}</span
                      >
                      <span class="currency-rate"
                        >{formatPrice(rate)} {getCurrencySymbol(code)}</span
                      >
                    </button>
                  {/each}
                </div>
                {#if Object.keys(priceData).length === 0}
                  <p class="currency-loading">Loading prices…</p>
                {/if}
              </div>
            </div>
          {/if}
        </div>

        <footer class="footer">
          {#if showMainApp}
            <span class="footer-left">
              <span class="footer-mempool-label">Provider:</span>
              <span class="footer-mempool-value">{mempoolDisplayName}</span>
            </span>
            <span class="footer-right">
              <button
                type="button"
                class="footer-btn footer-change-btn"
                on:click={handleMempoolChange}
                title="Change mempool provider">Change</button
              >
            </span>
          {/if}
        </footer>

        {#if showMempoolModal}
          <div
            class="modal mempool-modal"
            role="dialog"
            aria-labelledby="mempool-modal-title"
            aria-modal="true"
          >
            <div class="modal-card mempool-modal-card">
              <h3 id="mempool-modal-title" class="mempool-modal-title">
                Change mempool provider
              </h3>
              <label for="mempool-modal-url" class="mempool-label"
                >Provider URL</label
              >
              <input
                id="mempool-modal-url"
                type="url"
                autocomplete="off"
                placeholder="https://mempool.space/api"
                bind:value={mempoolModalInputValue}
                class="mempool-modal-input"
                aria-label="Mempool API URL"
              />
              {#if mempoolError}
                <p class="pin-error" role="alert">{mempoolError}</p>
              {/if}
              <div class="mempool-modal-actions">
                <button
                  type="button"
                  class="btn-secondary"
                  on:click={() => {
                    showMempoolModal = false;
                    mempoolError = "";
                  }}>Cancel</button
                >
                <button
                  type="button"
                  class="btn-secondary mempool-modal-reset-btn"
                  on:click={handleMempoolResetInput}
                  title="Fill with default URL">Reset</button
                >
                <button
                  type="button"
                  class="btn-primary"
                  on:click={() => handleMempoolSave(mempoolModalInputValue)}
                  disabled={mempoolSaving}
                >
                  {mempoolSaving ? "Checking…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes slideInUp {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }

  @keyframes shimmer {
    0% {
      background-position: -1000px 0;
    }
    100% {
      background-position: 1000px 0;
    }
  }

  @keyframes rotate {
    from {
      transform: rotateY(0deg);
    }
    to {
      transform: rotateY(360deg);
    }
  }

  @keyframes rotateHidden {
    from {
      transform: rotateY(360deg);
    }
    to {
      transform: rotateY(0deg);
    }
  }

  :global(body) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    min-height: 100%;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
      Ubuntu, Cantarell, sans-serif;
    /* Side panel fills the browser panel — do not pin to legacy ~600px popup height */
    background: var(--color-background);
    overflow-x: hidden;
    color: var(--color-text);
  }

  :global(html) {
    width: 100%;
    height: 100%;
    min-height: 100%;
    overflow: hidden;
    background: var(--color-background);
  }



  .popup-root {
    width: 100%;
    min-width: 0;
    min-height: 100%;
    height: min(100dvh, 600px);
    max-height: 600px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    background: transparent;
    overflow: hidden;
    position: relative;
    box-sizing: border-box;
  }

  .popup-root.unpaired {
    justify-content: stretch;
  }

  /* Header title + lock button (PIN screen styles in app.css) */
  .header-title-text {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text);
    margin-left: var(--space-small);
    line-height: 1.3;
    display: inline-flex;
    align-items: center;
  }
  .lock-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: var(--radius-small);
    background: var(--glass-pane-bg, var(--color-cardBackground));
    color: var(--color-text);
    cursor: pointer;
    transition:
      background 0.2s,
      transform 0.2s,
      box-shadow 0.2s;
    box-shadow:
      inset 0 1px 0 0 color-mix(in srgb, var(--glass-inset-highlight, #fff) 40%, transparent),
      0 1px 6px color-mix(in srgb, var(--color-shadowColor) 5%, transparent);
    backdrop-filter: blur(12px) saturate(var(--glass-sat, 165%));
    -webkit-backdrop-filter: blur(12px) saturate(var(--glass-sat, 165%));
  }
  .lock-btn:hover {
    background: var(--glass-pane-bg-solid, var(--color-border));
    transform: scale(1.05);
  }
  .lock-icon {
    display: block;
    width: 20px;
    height: 20px;
    object-fit: contain;
    opacity: 0.9;
  }

  .wallet {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-height: 0;
    flex: 1 1 auto;
    align-self: stretch;
    color: var(--color-text);
    background: transparent;
    overflow: hidden;
    box-sizing: border-box;
  }

  .wallet-content {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    flex: 1;
    overflow-x: hidden;
    overflow-y: hidden;
    padding: 0 var(--space-small) var(--space-medium);
    box-sizing: border-box;
  }

  /* Structural only — glass surface from app.css (.popup-root .balance-card) */
  .balance-card {
    margin-top: 0;
    margin-bottom: 0;
    padding: 12px;
    box-sizing: border-box;
    min-width: 0;
  }
  .balance-card-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 44px;
    min-width: 0;
  }

  /* Wallet details: fit side-panel viewport; header fixed, body scrolls */
  .wallet-settings-sheet.modal-card {
    width: min(400px, calc(100vw - 32px));
    max-width: 100%;
    max-height: calc(100dvh - 32px);
    height: auto;
    margin: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
    box-sizing: border-box;
  }

  .wallet-settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 12px 8px;
    border-bottom: 1px solid var(--glass-stroke, var(--color-border));
    flex-shrink: 0;
    background: var(--glass-pane-bg, var(--color-cardBackground));
    backdrop-filter: blur(var(--glass-blur, 20px)) saturate(var(--glass-sat, 160%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 20px))
      saturate(var(--glass-sat, 160%));
    z-index: 1;
  }

  .wallet-settings-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding-bottom: 12px;
    -webkit-overflow-scrolling: touch;
  }

  .wallet-settings-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text);
  }

  .wallet-settings-close {
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--color-textSecondary);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .wallet-settings-close:hover {
    background: var(--color-background);
    color: var(--color-text);
  }

  .wallet-settings-block {
    padding: 12px;
    border-bottom: 1px solid var(--color-border);
  }

  .wallet-settings-block:last-child {
    border-bottom: none;
  }

  .wallet-settings-label {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-textSecondary);
  }

  .wallet-settings-hint {
    margin: 0 0 10px;
    font-size: 12px;
    line-height: 1.35;
    color: var(--color-textSecondary);
  }

  .wallet-settings-fingerprint-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: color-mix(
      in srgb,
      var(--color-background) 70%,
      var(--color-cardBackground)
    );
    min-width: 0;
  }

  .wallet-settings-fingerprint-value {
    font-family: var(--font-mono), ui-monospace, monospace;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  .wallet-settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .wallet-settings-row-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
  }

  .wallet-settings-theme-btn {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-background);
    cursor: pointer;
    transition:
      border-color 0.15s,
      transform 0.15s;
  }

  .wallet-settings-theme-btn:hover {
    border-color: var(--color-primary);
    transform: scale(1.04);
  }

  .wallet-settings-theme-btn img {
    display: block;
    opacity: 0.95;
  }

  .wallet-settings-address-preview {
    margin: 0 0 8px;
    font-family: var(--font-mono), ui-monospace, monospace;
    font-size: 11px;
    color: var(--color-textSecondary);
    word-break: break-all;
    text-align: center;
    padding: 6px 8px;
    background: var(--color-background);
    border-radius: 6px;
    border: 1px solid var(--color-border);
  }

  .wallet-settings-switching {
    margin: 0;
    font-size: 12px;
    color: var(--color-textSecondary);
    text-align: center;
    padding: 8px;
  }

  .wallet-settings-address-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .wallet-settings-address-list li {
    margin: 0;
  }

  .wallet-settings-sheet .wallet-settings-address-item {
    border-radius: 8px;
    border: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
  }

  .wallet-settings-sheet .wallet-settings-address-item:disabled {
    opacity: 0.58;
    cursor: wait;
  }

  .wallet-settings-sheet .wallet-settings-address-item:last-child {
    border-bottom: 1px solid var(--color-border);
  }

  .wallet-settings-sync-btn {
    width: 100%;
    margin-top: 4px;
    padding: 10px 12px;
    border-radius: 8px;
    border: none;
    background: var(--color-primary);
    color: var(--color-textOnPrimary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .wallet-settings-sync-btn:hover:not(:disabled) {
    filter: brightness(0.95);
  }

  .wallet-settings-sync-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .wallet-settings-danger {
    padding-top: 8px;
  }

  .wallet-settings-unpair-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-error) 45%, transparent);
    background: color-mix(
      in srgb,
      var(--color-error) 10%,
      var(--color-cardBackground)
    );
    color: var(--color-error);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
  }

  .wallet-settings-unpair-btn:hover {
    background: color-mix(
      in srgb,
      var(--color-error) 16%,
      var(--color-cardBackground)
    );
    border-color: var(--color-error);
  }

  .wallet-settings-unpair-icon {
    display: block;
    object-fit: contain;
    flex-shrink: 0;
  }

  /* === Network toggle inside Wallet Details modal === */
  .network-toggle-row {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .network-pill {
    flex: 1;
    padding: 8px 14px;
    border-radius: 9999px;
    border: 1px solid var(--color-border);
    background: #000;
    color: #aaa;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .network-pill:hover:not(:disabled) {
    color: #fff;
    border-color: #444;
  }
  .network-pill.active {
    background: #fff;
    color: #000;
    border-color: #fff;
  }
  .network-pill.testnet.active {
    background: #f59e0b;
    color: #000;
    border-color: #f59e0b;
  }
  .network-pill:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .testnet-badge-inline {
    margin-top: 8px;
    font-size: 11px;
    color: #f59e0b;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  :global([data-theme="darkPolished"]) .wallet-settings-unpair-icon {
    filter: brightness(0) invert(1);
    opacity: 0.9;
  }

  .wallet-id-copy {
    flex-shrink: 0;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-cardBackground);
    color: var(--color-textSecondary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }

  .wallet-id-copy:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-text);
    background: var(--color-background);
  }

  .wallet-id-copy:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .balance-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-textSecondary);
    font-size: 14px;
  }
  .balance-loading .spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: rotate 0.7s linear infinite;
  }

  /* Action row: Send / Receive (app-style) */
  .actions-row {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    margin-bottom: 0;
    align-items: stretch;
    min-width: 0;
  }
  .action-btn {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 0.2s,
      filter 0.2s,
      box-shadow 0.2s;
    color: var(--color-textOnPrimary);
  }
  .action-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .action-btn:active {
    transform: translateY(0);
  }
  .action-btn-icon {
    display: block;
    object-fit: contain;
    flex-shrink: 0;
  }
  .send-btn {
    background: var(--color-accent);
    color: var(--color-textOnPrimary);
  }
  .send-btn span {
    color: inherit;
  }
  .send-btn .action-btn-icon,
  .receive-btn .action-btn-icon {
    filter: brightness(0) invert(1);
  }
  .send-btn:hover {
    filter: brightness(1.05);
  }
  .receive-btn {
    background: var(--color-secondary);
    color: var(--color-textOnPrimary);
  }
  .receive-btn:hover {
    filter: brightness(1.08);
  }

  /* Generic header buttons: same style as inner paired header .icon-btn */
  .app-header .theme-toggle,
  .app-header .refresh-btn,
  .app-header .balance-visibility-btn,
  .app-header .expand-btn,
  .app-header .header-utils-toggle-btn,
  .app-header .lock-btn,
  .app-header .wallet-settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: var(--glass-pane-bg, var(--color-cardBackground));
    color: var(--color-text);
    cursor: pointer;
    transition:
      background 0.2s,
      transform 0.2s,
      box-shadow 0.2s;
    font-size: 16px;
    box-shadow:
      inset 0 1px 0 0 color-mix(in srgb, var(--glass-inset-highlight, #fff) 40%, transparent),
      0 1px 6px color-mix(in srgb, var(--color-shadowColor) 5%, transparent);
    backdrop-filter: blur(12px) saturate(var(--glass-sat, 165%));
    -webkit-backdrop-filter: blur(12px) saturate(var(--glass-sat, 165%));
    flex-shrink: 0;
  }
  .app-header .theme-toggle:hover:not(:disabled),
  .app-header .refresh-btn:hover:not(:disabled),
  .app-header .balance-visibility-btn:hover,
  .app-header .expand-btn:hover,
  .app-header .header-utils-toggle-btn:hover,
  .app-header .lock-btn:hover,
  .app-header .wallet-settings-btn:hover {
    background: var(--glass-pane-bg-solid, var(--color-border));
    transform: scale(1.05);
  }
  .app-header .theme-toggle:active,
  .app-header .refresh-btn:active,
  .app-header .balance-visibility-btn:active,
  .app-header .expand-btn:active,
  .app-header .header-utils-toggle-btn:active,
  .app-header .lock-btn:active,
  .app-header .wallet-settings-btn:active {
    transform: scale(0.98);
  }
  .app-header .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .app-header .refresh-btn.spinning {
    animation: rotate 0.6s linear infinite;
  }
  .header-icon {
    display: block;
    width: 20px;
    height: 20px;
    object-fit: contain;
    opacity: 0.9;
  }
  .expand-icon {
    color: var(--color-text);
    opacity: 0.9;
  }
  :global([data-theme="darkPolished"]) .header-icon {
    filter: brightness(0) invert(1);
    opacity: 0.95;
  }
  .balance-visibility-icon {
    display: block;
    width: 20px;
    height: 20px;
    object-fit: contain;
    opacity: 0.9;
  }
  :global([data-theme="darkPolished"]) .balance-visibility-icon {
    filter: brightness(0) invert(1);
    opacity: 0.95;
  }
  :global([data-theme="darkPolished"]) .action-btn-icon {
    filter: brightness(0) invert(1);
  }

  .balance {
    padding: 20px 16px;
    background: var(--color-cardBackground);
    border-bottom: 1px solid var(--color-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .balance-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .amount {
    font-family: var(--font-mono), ui-monospace, monospace;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--color-text);
    word-break: break-all;
    text-align: center;
  }

  .amount.placeholder {
    letter-spacing: 2px;
    color: var(--color-disabled);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .amount.error {
    color: var(--color-error);
    font-size: 18px;
  }

  .unit {
    font-size: 12px;
    margin-left: 4px;
    color: var(--color-textSecondary);
    font-weight: 500;
  }

  .fiat {
    font-family: var(--font-mono), ui-monospace, monospace;
    color: var(--color-textSecondary);
    font-size: 12px;
    letter-spacing: 0.02em;
  }

  .fiat.placeholder {
    color: var(--color-disabled);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .fiat.error {
    color: var(--color-error);
    font-size: 12px;
  }

  .fade-in {
    animation: fadeIn 0.4s ease-out;
  }

  .address-selector {
    position: relative;
    margin-top: 8px;
    min-width: 0;
    width: 100%;
  }
  /* Glass surface + chrome from app.css (.popup-root .address-selector-inner) */
  .address-selector-inner {
    padding: 12px;
    border-radius: 10px;
    box-sizing: border-box;
    min-width: 0;
    width: 100%;
  }

  .dropdown-toggle {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 0;
    cursor: pointer;
    transition: background 0.2s ease;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--color-text);
    overflow: hidden;
    box-sizing: border-box;
  }
  .address-toggle-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex-shrink: 0;
  }
  .address-type-label {
    font-weight: 600;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .address-toggle-right {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin-left: auto;
  }

  .dropdown-toggle:hover {
    opacity: 0.9;
  }

  .address-type-icon {
    display: block;
    object-fit: contain;
    flex-shrink: 0;
    opacity: 0.9;
  }
  :global([data-theme="darkPolished"]) .address-item .address-type-icon {
    filter: brightness(0) invert(1);
    opacity: 0.95;
  }

  .address-display {
    color: var(--color-text);
    font-weight: 500;
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-family: var(--font-mono);
  }

  .dropdown-arrow {
    font-size: 10px;
    color: var(--color-textSecondary);
    transition: transform 0.2s ease;
  }

  .dropdown-arrow.open {
    transform: rotate(180deg);
  }

  .sync-addresses {
    padding: 8px 16px;
    background: var(--color-primary);
    color: var(--color-textOnPrimary);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .sync-addresses:hover:not(:disabled) {
    filter: brightness(0.9);
  }

  .sync-addresses:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .address-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 1000;
    margin-top: 4px;
    max-height: 220px;
    overflow: hidden;
    animation: slideInUp 0.2s ease-out;
    min-width: 0;
    border-radius: 0 0 10px 10px;
    border-color: var(--color-border);
  }
  :global([data-theme="darkPolished"]) .address-dropdown {
    box-shadow:
      inset 0 1px 0 0 color-mix(in srgb, var(--glass-inset-highlight, #fff) 30%, transparent),
      0 12px 40px rgba(0, 0, 0, 0.45);
    border-top: 1px solid var(--color-border);
    border-radius: 0 0 10px 10px;
    border-color: var(--color-secondary);
    padding: 4px;
  }
  :global([data-theme="darkPolished"]) .address-selector-inner {
    border-color: var(--glass-stroke, var(--color-border));
  }

  .dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 8px 10px;
    background: var(--color-background);
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text);
    min-width: 0;
  }
  :global([data-theme="darkPolished"]) .dropdown-header {
    background: var(--color-background);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .sync-btn-small {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    font-size: 14px;
    opacity: 0.6;
    transition: opacity 0.2s ease;
  }

  .sync-btn-small:hover:not(:disabled) {
    opacity: 1;
  }

  .sync-btn-small:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .address-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 250px;
    overflow-y: auto;
  }

  .address-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    transition: background 0.2s ease;
    border: none;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-cardBackground);
    width: 100%;
    text-align: left;
    min-width: 0;
    box-sizing: border-box;
  }

  .address-item:last-child {
    border-bottom: none;
  }

  .address-item:hover {
    background: var(--color-background);
  }

  .address-item.active {
    background: var(--color-background);
    border-left: 3px solid var(--color-primary);
  }
  :global([data-theme="darkPolished"]) .address-item {
    background: var(--color-cardBackground);
    border-bottom-color: var(--color-border);
    color: var(--color-text);
  }
  :global([data-theme="darkPolished"]) .address-item:hover,
  :global([data-theme="darkPolished"]) .address-item.active {
    background: var(--color-background);
  }
  :global([data-theme="darkPolished"]) .address-item .address-type-icon {
    filter: brightness(0) invert(1);
    opacity: 0.95;
  }

  .address-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .address-text {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .address-prefix {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--color-textSecondary);
  }

  .address-check {
    font-size: 14px;
    color: var(--color-primary);
    font-weight: 700;
    flex-shrink: 0;
  }

  /* Legacy .actions kept for any refs; primary is .actions-row */
  .actions {
    display: flex;
    gap: 10px;
    padding: 14px 0;
  }

  .btn {
    flex: 1;
    padding: 12px 16px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    background: var(--color-background);
    color: var(--color-text);
    font-weight: 500;
    transition: all 0.3s ease;
    font-size: 14px;
  }

  .btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .btn:active {
    transform: translateY(0);
  }

  .btn.primary {
    background: var(--color-primary);
    color: var(--color-textOnPrimary);
  }

  .btn.primary:hover {
    background: var(--color-subPrimary);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  }

  .btn.send {
    background: var(--color-accent);
    color: var(--color-text);
  }

  .btn.send:hover {
    filter: brightness(0.95);
  }

  .btn.receive {
    background: var(--color-secondary);
    color: var(--color-textOnPrimary);
  }

  .btn.receive:hover {
    filter: brightness(0.95);
  }

  .tx-list {
    padding: 8px 0 0;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    overflow: hidden;
    margin-top: 4px;
    display: flex;
    flex-direction: column;
  }

  .tx-list-hidden {
    padding: 12px;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
    min-width: 0;
  }

  .tx-empty {
    text-align: center;
    font-size: 14px;
    color: var(--color-textSecondary);
    opacity: 0.8;
    padding: 20px 0;
    margin: 0;
  }

  .tx-scroll-region {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding-right: 2px;
  }

  .tx-scroll-region::-webkit-scrollbar {
    width: 4px;
  }

  .tx-scroll-region::-webkit-scrollbar-track {
    background: transparent;
  }

  .tx-scroll-region::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }

  .tx-scroll-region::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.34);
  }

  .tx-list-ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .tx-list-footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    padding: var(--space-medium, 12px) 0;
    margin-top: var(--space-small, 8px);
    border-top: 1px solid var(--color-border);
  }
  .tx-list-footer-loading,
  .tx-list-footer-end {
    margin: 0;
    font-size: var(--font-size-sm, 12px);
    color: var(--color-textSecondary);
  }
  .tx-list-load-more {
    padding: var(--space-small, 8px) var(--space-medium, 12px);
    border-radius: var(--radius-small, 8px);
    border: 1px solid var(--color-border);
    background: var(--color-cardBackground);
    color: var(--color-text);
    font-size: var(--font-size-sm, 12px);
    font-weight: var(--font-weight-medium, 500);
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s;
  }
  .tx-list-load-more:hover {
    background: var(--color-background);
    border-color: var(--color-primary);
  }

  .tx-page-controls {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .tx-page-btn {
    border: 1px solid var(--color-border);
    background: var(--color-cardBackground);
    color: var(--color-text);
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 12px;
    line-height: 1.2;
    cursor: pointer;
  }

  .tx-page-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tx-page-indicator {
    min-width: 52px;
    text-align: center;
    font-size: 11px;
    color: var(--color-textSecondary);
    letter-spacing: 0.04em;
  }

  .active-tx-visualizer-wrap {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
    min-height: 188px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .active-tx-visualizer-wrap :global(.tx-visualizer) {
    flex-shrink: 0;
    min-height: 176px;
  }

  .active-tx-carousel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .carousel-meta {
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .carousel-title {
    font-size: 11px;
    line-height: 1.3;
    color: var(--color-textSecondary);
    letter-spacing: 0.03em;
  }

  .carousel-txid {
    font-family: var(--font-mono), ui-monospace, monospace;
    font-size: 11px;
    line-height: 1.3;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .carousel-btn {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-cardBackground);
    color: var(--color-text);
    font-size: 18px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex: 0 0 auto;
  }

  .carousel-btn:hover {
    border-color: var(--color-primary);
    background: var(--color-background);
  }

  .carousel-btn.remove-btn {
    border-color: rgba(255, 80, 80, 0.45);
    color: #ff6464;
    font-size: 20px;
  }

  .carousel-btn.remove-btn:hover {
    border-color: #ff6464;
    background: rgba(255, 80, 80, 0.12);
    color: #ff8080;
  }

  .active-tx-dots {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 6px;
  }

  .active-tx-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: transparent;
    cursor: pointer;
    padding: 0;
  }

  .active-tx-dot.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }

  /* App-style transaction item card */
  .tx-item {
    margin: 0;
    list-style: none;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  .tx-item-btn {
    display: block;
    width: 100%;
    max-width: 100%;
    padding: 10px 12px;
    border-radius: 10px;
    transition:
      background 0.2s,
      border-color 0.2s,
      box-shadow 0.2s;
    animation: slideInUp 0.3s ease-out;
    min-width: 0;
    box-sizing: border-box;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
  }

  .tx-row {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    margin-top: 4px;
    gap: 8px;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  .tx-row:first-child {
    margin-top: 0;
  }
  .tx-row-main {
    align-items: center;
  }
  .tx-status-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .tx-status-icon {
    display: block;
    object-fit: contain;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .tx-merchant-icon-wrap {
    position: relative;
    width: 32px;
    height: 24px;
    flex-shrink: 0;
  }
  .tx-merchant-icon {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }
  .tx-merchant-check {
    position: absolute;
    bottom: -1px;
    right: 0;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #22c55e;
    color: #ffffff;
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-surface, #ffffff);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
  .tx-status-text {
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text);
    opacity: 0.9;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tx-amount {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }
  .tx-amount.in {
    color: var(--color-secondary);
  }
  .tx-amount.out {
    color: var(--color-bitcoinOrange);
  }
  :global([data-theme="darkPolished"]) .tx-amount.out {
    color: var(--color-bitcoinOrange);
  }
  .tx-unit {
    font-size: 12px;
    color: var(--color-textSecondary);
    font-weight: 500;
    margin-left: 2px;
  }
  .tx-row-address {
    margin-top: 4px;
  }
  .tx-address-label {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-text);
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tx-fiat {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--color-textSecondary);
    opacity: 0.8;
    flex-shrink: 0;
  }
  .tx-row-meta {
    margin-top: 4px;
  }
  .tx-id-label {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--color-textSecondary);
    opacity: 0.65;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tx-id-value {
    opacity: 0.85;
    color: var(--color-text);
  }
  .tx-time {
    font-size: 11px;
    color: var(--color-textSecondary);
    opacity: 0.6;
    flex-shrink: 0;
  }

  .footer {
    padding: 4px 4px;
    font-size: 10px;
    color: var(--color-textSecondary);
    text-align: center;
    background: var(--color-background);
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
    margin-top: auto;
    width: 100%;
    box-sizing: border-box;
  }

  /* Short-height visual polish: keep 3 tx rows + carousel + visualizer visible in tight popups. */
  @media (max-height: 620px) {
    .wallet-content {
      padding: 0 8px 8px;
      gap: 0;
    }

    .balance-card {
      padding: 8px 10px;
    }

    .balance-card-inner {
      min-height: 38px;
      gap: 1px;
    }

    .actions-row {
      margin-top: 6px;
      margin-bottom: 6px;
      gap: 8px;
    }

    .action-btn {
      min-height: 34px;
      padding: 6px 8px;
    }

    .tx-list {
      padding-top: 4px;
      margin-top: 2px;
    }

    .tx-scroll-region {
      padding-right: 1px;
    }

    .tx-list-ul {
      gap: 4px;
    }

    .tx-item-btn {
      padding: 7px 9px;
      border-radius: 8px;
    }

    .tx-row {
      margin-top: 2px;
      gap: 6px;
    }

    .tx-status-wrap {
      gap: 6px;
    }

    .tx-status-icon {
      width: 16px;
      height: 16px;
    }

    .tx-status-text {
      font-size: 13px;
      line-height: 1.2;
    }

    .tx-amount {
      font-size: 12px;
      line-height: 1.2;
    }

    .tx-unit,
    .tx-address-label,
    .tx-fiat,
    .tx-id-label,
    .tx-time {
      font-size: 10px;
      line-height: 1.2;
    }

    .tx-row-address,
    .tx-row-meta {
      margin-top: 2px;
    }

    .tx-list-footer {
      padding: 6px 0 4px;
      margin-top: 4px;
    }

    .tx-page-controls {
      margin-bottom: 4px;
      gap: 6px;
    }

    .tx-page-btn {
      padding: 3px 8px;
      font-size: 11px;
    }

    .tx-page-indicator {
      font-size: 10px;
      min-width: 44px;
    }

    .active-tx-visualizer-wrap {
      margin-top: 6px;
      gap: 5px;
      min-height: 170px;
    }

    .active-tx-visualizer-wrap :global(.tx-visualizer) {
      min-height: 160px;
    }

    .active-tx-carousel-header {
      gap: 6px;
    }

    .carousel-title,
    .carousel-txid {
      font-size: 10px;
      line-height: 1.2;
    }

    .carousel-btn {
      width: 24px;
      height: 24px;
      font-size: 16px;
    }

    .active-tx-dots {
      gap: 5px;
    }

    .active-tx-dot {
      width: 6px;
      height: 6px;
    }
  }

  .modal {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.3s ease-out;
    z-index: 1000;
  }

  .modal-card {
    padding: 20px;
    border-radius: var(--radius-large, 14px);
    width: 320px;
    animation: slideInUp 0.4s ease-out;
  }

  .modal-card h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text);
  }

  /* Receive modal (app-style) */
  .receive-modal-card {
    width: 90%;
    max-width: 340px;
    padding: 16px;
    padding-bottom: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .receive-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    margin-bottom: var(--space-large, 20px);
  }
  .receive-modal-title-wrap {
    display: flex;
    align-items: center;
    gap: var(--space-small, 8px);
    flex: 1;
    min-width: 0;
  }
  .receive-modal-btc-logo {
    display: block;
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .receive-modal-title {
    margin: 0;
    font-size: var(--font-size-xl, 18px);
    font-weight: var(--font-weight-bold, 700);
    color: var(--color-text);
  }
  .receive-modal-close {
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: var(--font-size-lg, 16px);
    cursor: pointer;
    line-height: 1;
    opacity: 0.8;
    border-radius: var(--radius-small, 8px);
    transition: opacity 0.2s;
  }
  .receive-modal-close:hover {
    opacity: 1;
  }

  /* Send modal: balance, fiat, address + scan (tokens aligned with app.css & DESIGN_SYSTEM) */
  .send-modal-card {
    width: 90%;
    max-width: 340px;
    min-width: 0;
    overflow: hidden;
    box-sizing: border-box;
    padding: var(--space-large, 20px);
    padding-bottom: var(--space-large, 20px);
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .send-balance-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-small, 8px) var(--space-medium, 12px);
    margin-bottom: var(--space-large, 20px);
    padding: var(--space-medium, 12px);
    background: var(--color-inputBackground);
    border-radius: var(--radius-small, 8px);
    border: 1px solid var(--color-border);
  }
  .send-balance-label {
    font-size: var(--font-size-sm, 12px);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-textSecondary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .send-balance-value {
    font-family: var(--font-mono), ui-monospace, monospace;
    font-size: var(--font-size-base, 14px);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-text);
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
  }
  .send-balance-fiat {
    font-size: var(--font-size-sm, 12px);
    color: var(--color-textSecondary);
    margin-left: auto;
  }
  .send-fiat-equivalent {
    margin: -6px 0 var(--space-medium, 12px) 0;
    font-size: var(--font-size-sm, 12px);
    color: var(--color-textSecondary);
  }
  .send-address-row {
    display: flex;
    gap: var(--space-small, 8px);
    align-items: stretch;
    margin-bottom: var(--space-medium, 12px);
    min-width: 0;
    max-width: 100%;
  }
  .send-address-input {
    flex: 1 1 0;
    min-width: 0;
    max-width: 100%;
    margin-bottom: 0 !important;
    box-sizing: border-box;
  }
  .send-scan-qr-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-small, 8px);
    padding: var(--space-small, 8px);
    min-width: 36px;
    border-radius: var(--radius-small, 8px);
    border: 1px solid var(--color-border);
    background: var(--color-inputBackground);
    color: var(--color-text);
    font-size: var(--font-size-sm, 12px);
    font-weight: var(--font-weight-medium, 500);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.2s,
      border-color 0.2s;
    box-sizing: border-box;
  }
  .send-scan-qr-btn:hover {
    background: var(--color-disabled);
    border-color: var(--color-primary);
  }

  .send-branta-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: -4px 0 10px;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.3;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-cardBackground) 80%, transparent);
    color: var(--color-textSecondary);
  }

  .send-branta-status.checking {
    color: var(--color-text);
  }

  .send-branta-status.verified {
    background: rgba(34, 197, 94, 0.1);
    border-color: rgba(34, 197, 94, 0.32);
    color: #15803d;
  }

  .send-branta-status.flagged,
  .send-branta-status.error {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.32);
    color: #b91c1c;
  }

  .send-branta-icon {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #ffffff;
    background: currentColor;
    flex-shrink: 0;
  }

  .send-branta-logo {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid rgba(0, 0, 0, 0.08);
    background: #ffffff;
  }

  .send-branta-status.verified .send-branta-icon {
    background: #16a34a;
  }

  .send-branta-status.flagged .send-branta-icon,
  .send-branta-status.error .send-branta-icon {
    background: #dc2626;
  }

  .send-branta-spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-primary);
    animation: rotate 0.75s linear infinite;
    flex-shrink: 0;
  }

  .send-branta-link {
    margin-left: auto;
    color: inherit;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }

  .send-branta-link:hover {
    text-decoration: underline;
  }

  .receive-modal-badge {
    background: var(--color-disabled);
    color: var(--color-text);
    font-size: var(--font-size-sm, 12px);
    font-weight: var(--font-weight-semibold, 600);
    padding: var(--space-small, 8px) var(--space-medium, 12px);
    border-radius: var(--radius-small, 8px);
    margin-bottom: var(--space-large, 20px);
  }
  .receive-qr-wrap {
    background: var(--color-cardBackground);
    padding: var(--space-small, 8px);
    border-radius: var(--radius-small, 8px);
    margin-bottom: var(--space-large, 20px);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  .receive-qr-img {
    display: block;
    width: 200px;
    height: 200px;
    border-radius: var(--radius-small, 8px);
  }
  .receive-qr-loading {
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-textSecondary);
    font-size: var(--font-size-base, 14px);
    margin-bottom: var(--space-large, 20px);
  }
  .receive-address-section {
    width: 100%;
    margin-bottom: 0;
  }
  .receive-derivation-path {
    display: block;
    text-align: center;
    font-family: "SF Mono", "Menlo", "Consolas", monospace;
    font-size: 11px;
    color: var(--color-textSecondary, #888);
    letter-spacing: 0.3px;
    margin-bottom: 6px;
  }
  .receive-address-touch {
    width: 100%;
    padding: var(--space-medium, 12px);
    border-radius: var(--radius-small, 8px);
    border: 1px solid var(--color-border);
    background: var(--color-cardBackground);
    margin-bottom: var(--space-medium, 12px);
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .receive-address-touch:hover:not(:disabled) {
    background: var(--color-background);
    border-color: var(--color-textSecondary);
  }
  .receive-address-touch:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .receive-address-text {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-text);
    word-break: break-all;
    line-height: 1.4;
  }
  .receive-address-hint {
    font-size: 11px;
    color: var(--color-textSecondary);
    margin-top: 4px;
  }
  .receive-copy-feedback {
    font-size: 15px;
    font-weight: 700;
    color: var(--color-success);
  }
  .receive-modal-actions {
    display: flex;
    gap: 10px;
    width: 100%;
    justify-content: stretch;
  }

  .currency-modal-card {
    width: 90%;
    max-width: 320px;
  }
  .currency-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 240px;
    overflow-y: auto;
    margin-top: 12px;
  }
  .currency-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--color-text);
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .currency-row:hover {
    background: var(--color-disabled);
  }
  .currency-row.selected {
    background: var(--color-bitcoinOrange);
    color: var(--color-primaryContrast);
  }
  .currency-code {
    font-weight: 600;
    min-width: 44px;
  }
  .currency-name {
    flex: 1;
    color: var(--color-textSecondary);
    font-size: 13px;
  }
  .currency-row.selected .currency-name {
    color: rgba(255, 255, 255, 0.9);
  }
  .currency-rate {
    font-weight: 600;
    font-size: 13px;
  }
  .currency-loading {
    margin: 16px 0 0;
    color: var(--color-textSecondary);
    font-size: 14px;
  }
  .receive-action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 16px;
    border: none;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition:
      filter 0.2s,
      transform 0.2s;
  }
  .receive-action-btn.primary {
    background: var(--color-primary);
    color: var(--color-textOnPrimary);
  }
  .receive-action-btn.primary:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .receive-action-btn.secondary {
    background: var(--color-cardBackground);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }
  .receive-action-btn.secondary:hover {
    background: var(--color-background);
  }
  .receive-action-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .receive-action-icon {
    display: block;
    object-fit: contain;
    filter: brightness(0) invert(1);
  }
  :global([data-theme="darkPolished"]) .receive-action-icon {
    filter: brightness(0) invert(1);
  }

  .modal-card label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-textSecondary);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .modal-card input {
    width: 100%;
    padding: 10px 12px;
    margin: 0 0 12px 0;
    border-radius: var(--radius-small, 8px);
    border: 1px solid var(--color-border);
    background: var(--color-inputBackground);
    color: var(--color-text);
    font-size: 14px;
    transition: all 0.3s ease;
    box-sizing: border-box;
  }

  .modal-card input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px
      color-mix(in srgb, var(--color-primary) 20%, transparent);
  }

  .modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 16px;
  }

  .msg {
    margin-top: 12px;
    padding: 10px 12px;
    background: color-mix(
      in srgb,
      var(--color-success) 12%,
      var(--color-cardBackground)
    );
    color: var(--color-success);
    border-radius: var(--radius-small, 6px);
    border: 1px solid var(--color-success);
    font-size: 12px;
    animation: slideInUp 0.3s ease-out;
  }

  .address {
    font-family: var(--font-mono), "Courier New", monospace;
    background: var(--color-inputBackground);
    color: var(--color-text);
    padding: 12px;
    border-radius: var(--radius-small, 8px);
    border: 1px solid var(--color-border);
    word-break: break-all;
    margin: 12px 0;
    font-size: 12px;
  }

  .empty {
    text-align: center;
    color: var(--color-textSecondary);
    padding: 20px 0;
    font-size: 14px;
  }

  .qr-modal {
    max-width: 400px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .qr-modal h3 {
    text-align: center;
    width: 100%;
  }

  .qr-modal .qr-container {
    width: 100%;
    box-sizing: border-box;
  }

  .qr-modal .modal-actions {
    width: 100%;
    justify-content: center;
  }

  /* Pairing UI later sets `.qr-code { display: flex }` for div wrappers; the send
   * modal uses `<img class="qr-code">` — override with higher specificity so the
   * image centers reliably. */
  .qr-modal .qr-container img {
    display: block;
    margin-inline: auto;
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-small, 8px);
  }

  .qr-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
    background: var(--color-cardBackground);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-small, 8px);
    margin: 16px 0;
  }

  .qr-instructions {
    text-align: center;
    color: var(--color-textSecondary);
    font-size: 14px;
    margin: 12px 0;
  }

  /* Pairing UI: center on launch (step 0), top-aligned when steps active */
  .pairing-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    flex: 1;
    padding: 0;
    margin: 0;
    background: transparent;
    color: var(--color-text);
    box-sizing: border-box;
  }
  .pairing-container:not(.steps-active) {
    justify-content: center;
  }

  /* Generic app header */
  .app-header {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    max-width: 380px !important;
    z-index: 20;
    min-height: 48px;
    height: 48px;
    background: var(--color-background);
    border-bottom: 1px solid var(--color-border);
    box-sizing: border-box;
    padding: 12px 8px;
    display: flex !important;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    overflow: visible;
    line-height: normal;
  }
  .app-header-left {
    display: inline-flex !important;
    align-items: center;
    gap: 8px;
    width: auto !important;
    min-width: 0;
    flex: 1 1 auto;
  }
  .app-header-right {
    display: inline-flex !important;
    align-items: center;
    gap: 6px;
    width: auto !important;
    margin-left: auto;
    flex: 0 0 auto;
    flex-wrap: nowrap;
  }
  .header-secondary-utils {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 0;
    opacity: 0;
    overflow: hidden;
    pointer-events: none;
    transition:
      max-width 0.3s cubic-bezier(0.22, 0.61, 0.36, 1),
      opacity 0.2s ease;
    will-change: max-width, opacity;
  }
  .header-secondary-utils.expanded {
    max-width: 88px;
    opacity: 1;
    pointer-events: auto;
  }
  .header-utils-toggle-btn.expanded .header-utils-toggle-icon {
    transform: rotate(180deg);
  }
  .header-utils-toggle-icon {
    transition: transform 0.25s ease;
  }
  .header-logo {
    display: block;
    width: 32px;
    height: 32px;
    object-fit: contain;
    margin: 0;
  }

  .header-price-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--glass-stroke, var(--color-border));
    border-radius: 8px;
    background: var(--glass-pane-bg, var(--color-disabled));
    color: var(--color-text);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    backdrop-filter: blur(12px) saturate(var(--glass-sat, 165%));
    -webkit-backdrop-filter: blur(12px) saturate(var(--glass-sat, 165%));
    box-shadow:
      inset 0 1px 0 0 color-mix(in srgb, var(--glass-inset-highlight, #fff) 35%, transparent),
      0 2px 10px color-mix(in srgb, var(--color-shadowColor) 5%, transparent);
    transition:
      background 0.2s,
      border-color 0.2s,
      box-shadow 0.2s;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
  }
  .header-mainnet-testnet-wrap {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 0 1 auto;
    flex-wrap: nowrap;
    box-sizing: border-box;
  }
  .header-testnet-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-error) 45%, var(--color-border));
    background: color-mix(in srgb, var(--color-error) 12%, transparent);
    color: var(--color-error, #c22d2d);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1.2;
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .header-price-btn:hover {
    background: var(--glass-pane-bg-solid, var(--color-border));
    border-color: var(--color-primary);
  }
  .header-price-icon {
    display: block;
    width: 20px;
    height: 20px;
    object-fit: contain;
  }
  .header-price-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }

  /* Responsive header adjustments for constrained viewports */
  @media (max-width: 360px) {
    .app-header {
      padding: 10px 6px;
      gap: 4px;
    }
    .app-header-left {
      gap: 6px;
    }
    .app-header-right {
      gap: 4px;
    }
    .header-secondary-utils {
      gap: 4px;
    }
    .header-secondary-utils.expanded {
      max-width: 76px;
    }
  }

  /* Content container below header — scrolls; reserve space for fixed header */
  .app-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    overflow-x: hidden;
    overflow-y: hidden;
    width: 100%;
    min-width: 0;
    margin-top: 48px;
    padding-top: 8px;
    min-height: 0;
    box-sizing: border-box;
  }
  .popup-root.launch-screen .app-content {
    margin-top: 0;
    padding-top: 0;
  }

  /* Body: centered on launch (step 0), start-aligned when steps active */
  .pairing-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    overflow: auto;
    padding: 24px 16px;
    box-sizing: border-box;
    gap: 16px;
    width: 100%;
  }
  .pairing-body:not(.steps-active) {
    justify-content: center;
  }
  .pairing-body.steps-active {
    padding-top: 0;
  }

  /* Removed gradient animation for clean white background */

  :global(body) {
    /* Popup should enforce themed background in this route; no !important needed */
    background: var(--color-background);
    color: var(--color-text);
    height: 100%;
    margin: 0;
  }

  :global(html) {
    /* Popup should enforce themed background in this route; no !important needed */
    background: var(--color-background);
    height: 100%;
  }

  :global(body[data-sveltekit-preload-data="hover"]) {
    /* Explicitly target the SvelteKit-preloaded body attribute so popup sizing and background
 match our layout rules and don't interfere with centering */
    width: 380px;
    min-height: 100%;
    height: 100%;
    background: var(--color-background);
  }

  .scanner-overlay {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    padding: 16px 16px 24px;
    background: var(--color-background);
    color: var(--color-text);
    box-sizing: border-box;
  }
  .scanner-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 100%;
    max-width: 360px;
    padding: 28px 24px;
    background: var(--color-cardBackground);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
    box-sizing: border-box;
  }
  .scanner-step-label {
    font-size: var(--font-size-sm, 12px);
    font-weight: 600;
    color: var(--color-textSecondary);
    margin: 0 0 4px 0;
    text-align: center;
  }

  .pairing-start {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 24px 20px;
    text-align: center;
    align-self: center;
    gap: 0;
  }
  .pairing-get-started {
    font-size: var(--font-size-xl, 22px);
    font-weight: 700;
    color: var(--color-text);
    margin: 0 0 8px 0;
    line-height: 1.25;
    text-align: center;
  }
  .pairing-cta {
    color: var(--color-textSecondary);
    font-size: var(--font-size-sm, 14px);
    font-weight: 500;
    line-height: 1.4;
    margin: 0 0 24px 0;
    text-align: center;
    max-width: 280px;
  }
  .pairing-bind-btn {
    width: 100%;
    max-width: 240px;
    min-height: 44px;
    font-size: var(--font-size-base, 15px);
    font-weight: 600;
    border-radius: var(--radius-medium, 10px);
  }

  /* Center and animate logo (used in pairing-start as smaller, non-interactive) */
  .pairing-logo {
    display: flex; /* use flex so child aligns properly */
    flex-direction: column;
    align-items: center;
    justify-content: center;
    align-self: center; /* ensure it is centered in parent */
    cursor: pointer;
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease;
    position: relative; /* z-index will take effect */
    margin: 0 auto; /* horizontal centering fallback */
    z-index: 10;
    background: var(--color-cardBackground);
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
    border: 1px solid var(--color-border);
    width: max-content; /* shrink to contents */
    max-width: 320px;
  }

  /* Hover / focus lift */
  .pairing-logo:focus,
  .pairing-logo:hover {
    transform: translateY(-6px) scale(1.02);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }

  .app-logo {
    width: 120px;
    height: 120px;
    margin-bottom: 12px;
    transition: transform 200ms ease;
  }
  :global([data-theme="darkPolished"]) .app-logo {
    filter: brightness(0) invert(1);
  }

  @keyframes bounce {
    0% {
      transform: translateY(0);
    }
    30% {
      transform: translateY(-12px);
    }
    50% {
      transform: translateY(0);
    }
    65% {
      transform: translateY(-6px);
    }
    100% {
      transform: translateY(0);
    }
  }

  .pairing-logo:hover {
    transform: translateY(-6px) scale(1.02);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }

  .pairing-logo:active {
    transform: translateY(-3px) scale(0.98);
  }

  .app-logo {
    display: block; /* ensure it centers inside its container */
    margin: 0 auto 24px; /* center horizontally and keep spacing */
    width: 120px;
    height: 120px;
    cursor: pointer;
    transform-origin: center;
    will-change: transform;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
  }

  /* Pulse animation is handled by other rules; removed unused :not(:hover) selector to satisfy Svelte CSS compiler */

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.8;
      transform: scale(1.05);
    }
  }

  .pairing-hint {
    font-size: 15px;
    font-weight: 600;
    color: var(--color-textSecondary);
    text-align: center;
    margin-top: 8px;
    letter-spacing: 0.3px;
  }

  .qr-display {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 20px;
    background: var(--color-cardBackground);
    padding: 28px 24px;
    border-radius: 16px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
    border: 1px solid var(--color-border);
    position: relative;
    z-index: 1;
    animation: slideIn 0.4s ease-out;
    width: 100%;
    max-width: 360px;
    align-self: center;
    box-sizing: border-box;
    transition: all 0.3s ease;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .pairing-status {
    font-size: 18px;
    font-weight: 700;
    color: var(--color-text);
    text-align: center;
    margin: 0;
    letter-spacing: -0.025em;
  }

  .instruction {
    font-size: 14px;
    color: var(--color-textSecondary);
    text-align: center;
    line-height: 1.6;
    margin: 0;
    max-width: 320px;
  }

  /* Horizontal dot stepper: under step title, one row (● — ●) */
  .bind-flow {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 0;
    width: 100%;
    max-width: 360px;
    flex-shrink: 0;
  }
  .stepper-top {
    position: sticky;
    top: 0;
    z-index: 5;
    margin-bottom: 16px;
    flex-shrink: 0;
    background: var(--color-background);
    padding: 4px 0;
    width: 100%;
  }
  /* Stepper: fixed width so 1 and 2 stay aligned on every step */
  .stepper.stepper-dots {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: center;
    gap: 0;
    width: 96px;
    margin: 0 auto;
    flex-shrink: 0;
  }
  .stepper-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--color-border);
    background: var(--color-cardBackground);
    color: var(--color-textSecondary);
    font-size: 11px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background 0.2s,
      border-color 0.2s,
      color 0.2s;
  }
  .stepper-dot.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-textOnPrimary);
  }
  /* .done = primary (same as active), completed steps match current step style */
  .stepper-dot.done {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-textOnPrimary);
  }
  .stepper-line {
    flex: 0 0 24px;
    width: 24px;
    height: 2px;
    background: var(--color-border);
    margin: 0 6px;
    transition: background 0.2s;
  }
  .stepper-line.done {
    background: var(--color-primary);
  }
  .step-title {
    font-size: var(--font-size-lg, 16px);
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-small, 8px) 0;
    text-align: center;
    line-height: 1.3;
  }
  .step-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-medium, 12px);
    width: 100%;
    padding: 0 16px;
    text-align: center;
  }
  .step-one .instruction,
  .step-two .instruction,
  .step-manual .instruction {
    margin: 0;
    text-align: center;
    color: var(--color-textSecondary);
    font-size: var(--font-size-sm, 12px);
    line-height: 1.4;
    max-width: 320px;
  }
  .pairing-status {
    text-align: center;
    color: var(--color-textSecondary);
    font-size: var(--font-size-sm, 12px);
    margin: 0;
  }

  .qr-code {
    background: var(--color-cardBackground);
    padding: 10px;
    border-radius: 16px;
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.06),
      inset 0 1px 2px rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(0, 0, 0, 0.08);
    animation: fadeIn 0.5s ease-out 0.2s both;
    transition: transform 0.2s ease;
    max-width: 100%;
  }

  .qr-code:hover {
    transform: scale(1.02);
  }

  .qr-code img {
    display: block;
    width: 160px;
    height: 160px;
    max-width: 100%;
    border-radius: 12px;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .btn-primary {
    background: var(--color-primary);
    color: var(--color-textOnPrimary);
    border: none;
    padding: 12px 20px;
    height: 44px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease,
      filter 0.15s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    letter-spacing: 0.01em;
    text-transform: none;
    width: 100%;
    max-width: 280px;
  }

  .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.14);
    filter: brightness(0.95);
  }

  .btn-primary:active {
    transform: translateY(0);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.12);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .btn-text {
    background: none;
    border: none;
    color: var(--color-textSecondary);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    padding: 8px 14px;
    transition: all 0.2s ease;
    border-radius: 8px;
    margin-top: 12px;
  }

  .btn-text:hover {
    background: rgba(0, 0, 0, 0.05);
    color: var(--color-text);
    transform: translateY(-1px);
  }

  /* Uniform button row styles for steppers */
  .step-container .button-row {
    display: flex;
    gap: 12px;
    width: 100%;
    justify-content: center;
    align-items: center;
    margin-top: 16px;
  }

  .step-container .button-row button {
    flex: 1;
    width: auto;
    max-width: 160px;
    min-width: 110px;
    height: 44px;
    padding: 0 12px;
    font-size: 14px;
    margin: 0;
    border-radius: 10px;
  }

  /* Scoped pairing button styles (avoid global overrides) */
  .qr-display .btn-primary {
    width: 100%;
    background: var(--color-primary);
    color: var(--color-textOnPrimary);
    border: none;
    padding: 12px 18px;
    height: 44px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease,
      filter 0.15s ease;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
    margin: 0;
  }

  .qr-display .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
    filter: brightness(0.95);
  }

  .qr-display .btn-secondary {
    background: var(--color-cardBackground);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    padding: 12px 16px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease,
      background 0.15s ease;
    box-shadow: 0 4px 12px rgba(16, 24, 40, 0.05);
    margin: 0;
  }

  .qr-display .btn-secondary:hover {
    transform: translateY(-1px);
    background: rgba(0, 0, 0, 0.02);
    border-color: var(--color-border);
    box-shadow: 0 6px 16px rgba(16, 24, 40, 0.08);
  }

  .btn-secondary:hover {
    background: rgba(0, 0, 0, 0.02);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
  }

  .btn-secondary:active {
    transform: translateY(0);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  /* Pairing stepper styles */
  .pairing-stepper {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }

  .steps-indicator {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  .step-controls,
  .button-row {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-top: 8px;
  }

  .scanner-inline {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }

  /* center QR and ensure it doesn't get pushed by wide controls */
  .qr-display {
    align-items: center; /* ensure qr and controls are centered */
  }

  .qr-code {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 6px 0 0 0;
  }

  .qr-code img {
    display: block;
    margin: 0 auto;
    width: 160px;
    height: 160px;
    object-fit: contain;
  }

  /* Spinner for fetch state */
  .spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid rgba(0, 0, 0, 0.12);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 8px;
    vertical-align: middle;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Retry fetch UI */
  .fetch-retry {
    text-align: center;
    margin-top: 12px;
  }

  .btn-retry-fetch {
    background: transparent;
    border: 1px solid rgba(0, 0, 0, 0.2);
    color: var(--color-text);
    padding: 8px 16px;
    border-radius: 10px;
    cursor: pointer;
    font-weight: 600;
  }

  .btn-retry-fetch[disabled] {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Toast notification */
  .toast {
    position: absolute;
    top: 12px;
    right: 12px;
    background: #111827;
    color: #fff;
    padding: 8px 12px;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    z-index: 1200;
    font-weight: 600;
  }

  .toast.error {
    background: var(--color-error);
  }

  .toast.success {
    background: var(--color-success);
  }

  /* Manual Input Container - removed, now using qr-display */

  .public-key-input {
    width: 100%;
    padding: 16px;
    border: 2px solid var(--color-border);
    border-radius: 12px;
    font-family: "SF Mono", Monaco, "Courier New", monospace;
    font-size: 13px;
    resize: none;
    transition: all 0.3s ease;
    box-sizing: border-box;
    background: var(--color-inputBackground);
    color: var(--color-text);
    line-height: 1.5;
    min-height: 120px;
  }

  .public-key-input:focus {
    outline: none;
    border-color: var(--color-primary);
    background: var(--color-cardBackground);
    box-shadow:
      0 0 0 4px rgba(59, 130, 246, 0.1),
      0 4px 12px rgba(0, 0, 0, 0.08); /* Keep shadow for now */
    transform: translateY(-1px);
  }

  .public-key-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background: var(--color-background);
  }

  .public-key-input::placeholder {
    color: var(--color-textSecondary);
    font-style: italic;
  }

  .scanner-container {
    width: 100%;
    max-width: 400px;
    background: var(--color-cardBackground);
    padding: 24px;
    border-radius: 24px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(0, 0, 0, 0.06);
    position: relative;
    z-index: 1;
    animation: slideIn 0.4s ease-out;
  }

  .scanner-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    background: var(--color-cardBackground);
    padding: 24px 20px;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(0, 0, 0, 0.06);
    position: relative;
    z-index: 1;
    animation: slideIn 0.4s ease-out;
    width: 100%;
    max-width: 340px;
    box-sizing: border-box;
  }

  .btn-secondary {
    background: var(--color-cardBackground);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    padding: 10px 18px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease,
      background 0.15s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    letter-spacing: 0.01em;
    width: 100%;
    max-width: 280px;
  }

  .btn-secondary:hover {
    background: rgba(0, 0, 0, 0.02);
    border-color: var(--color-border);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
  }

  .btn-secondary:active {
    transform: translateY(0);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  }
  .step-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    text-align: center;
    gap: 16px;
  }

  /* Container: relative so absolute header stays within bounds */
  :global(.popup-root) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    max-width: 100%;
    min-height: 100%;
    height: min(100dvh, 600px);
    max-height: 600px;
    flex: 1;
    margin: 0 auto;
    background: var(--color-background);
    color: var(--color-text);
    box-sizing: border-box;
    overflow: hidden;
  }

  :global(.popup-root .app-header) {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    z-index: 20;
    display: flex !important;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    box-sizing: border-box;
  }
  :global(.popup-root .app-header-left) {
    position: static !important;
    left: auto !important;
    right: auto !important;
    top: auto !important;
    transform: none !important;
    display: inline-flex !important;
    align-items: center;
    gap: 8px;
    width: auto !important;
    min-width: 0;
    flex: 1 1 auto;
    padding-right: 8px;
  }
  :global(.popup-root .app-header-right) {
    position: static !important;
    left: auto !important;
    right: auto !important;
    top: auto !important;
    transform: none !important;
    display: inline-flex !important;
    align-items: center;
    gap: 8px;
    width: auto !important;
    margin-left: auto;
    flex: 0 0 auto;
  }

  :global(.popup-root .app-content) {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    margin-top: 48px !important;
    padding-top: 8px !important;
    min-height: 0;
    box-sizing: border-box;
  }

  :global(.popup-root .pairing-container) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    flex: 1;
    padding: 0;
    margin: 0;
    background: transparent;
    color: var(--color-text);
    box-sizing: border-box;
    overflow: auto;
  }
  :global(.popup-root .pairing-container:not(.steps-active)) {
    justify-content: center;
  }
  :global(.popup-root .pairing-body) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    flex: 1;
    padding: 24px 16px;
    gap: 16px;
    overflow: auto;
    box-sizing: border-box;
    width: 100%;
  }
  :global(.popup-root .pairing-body:not(.steps-active)) {
    justify-content: center;
  }
  :global(.popup-root .pairing-body.steps-active) {
    padding-top: 0;
  }

  :global(.popup-root .pairing-logo) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: var(--color-cardBackground);
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
    border: 1px solid var(--color-border);
  }

  :global(.popup-root .qr-display) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 20px;
    background: var(--color-cardBackground);
    padding: 28px 24px;
    border-radius: 16px;
    border: 1px solid var(--color-border);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
    width: 100%;
    max-width: 360px;
    box-sizing: border-box;
  }

  /* Stepper: fixed width so 1 and 2 aligned on every step; green = done only */
  :global(.popup-root .stepper.stepper-dots) {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: center;
    gap: 0;
    width: 96px;
    margin: 0 auto;
    flex-shrink: 0;
  }
  :global(.popup-root .stepper-dot) {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--color-border);
    background: var(--color-cardBackground);
    color: var(--color-textSecondary);
    font-size: 11px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background 0.2s,
      border-color 0.2s,
      color 0.2s;
  }
  :global(.popup-root .stepper-dot.active) {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-textOnPrimary);
  }
  :global(.popup-root .stepper-dot.done) {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-textOnPrimary);
  }
  :global(.popup-root .stepper-line) {
    flex: 0 0 24px;
    width: 24px;
    height: 2px;
    background: var(--color-border);
    margin: 0 6px;
    transition: background 0.2s;
  }
  :global(.popup-root .stepper-line.done) {
    background: var(--color-primary);
  }
  :global(.popup-root .step-title) {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 8px 0;
    text-align: center;
    line-height: 1.3;
  }
  :global(.popup-root .step-container) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    width: 100%;
    padding: 0 16px;
    text-align: center;
  }

  :global(.popup-root .pairing-status) {
    font-size: 18px;
    font-weight: 700;
    color: var(--color-text);
    text-align: center;
    margin: 0;
  }

  :global(.popup-root .instruction) {
    font-size: 14px;
    color: var(--color-textSecondary);
    text-align: center;
    line-height: 1.6;
    margin: 0;
  }

  :global(.popup-root .button-row) {
    display: flex;
    gap: 12px;
    width: 100%;
    justify-content: center;
    align-items: center;
    margin-top: 16px;
  }

  :global(.popup-root .btn-primary) {
    background: var(--color-primary);
    color: var(--color-textOnPrimary);
    border: none;
    padding: 12px 20px;
    height: 44px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }

  :global(.popup-root .btn-secondary) {
    background: var(--color-cardBackground);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    padding: 10px 18px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  :global(.popup-root .btn-text) {
    background: none;
    border: none;
    color: var(--color-textSecondary);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    padding: 8px 14px;
  }

  /* Expanded / full-tab (min-width: 601px): full-bleed background + centered column — see static/app.css */
</style>
