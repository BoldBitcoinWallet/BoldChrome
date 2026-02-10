# Address derivation alignment with Bold Wallet app

After importing `pubKey` and `chainCode` from the Bold mobile app (via the bind flow), the extension derives receive addresses so they **match the app**.

## Derivation path (aligned with app)

The app (BBMTLib `GetOutputDescriptor` / `GetDerivedPubKey`) uses:

- **Master** = `pubKey` (33 bytes hex) + `chainCode` (32 bytes hex).
- **Account level** = non-hardened derivation from master:  
  `m / bipPath / coinType / 0`  
  - **Legacy (BIP44):** `m/44/0/0` (mainnet) or `m/44/1/0` (testnet)  
  - **SegWit nested (BIP49):** `m/49/0/0` or `m/49/1/0`  
  - **SegWit native (BIP84):** `m/84/0/0` or `m/84/1/0`  
- **Receive addresses** = from account: `account / 0 / index`  
  So first address = `m/84/0/0/0/0`, second = `m/84/0/0/0/1`, etc.

The extension (`src/lib/services/hdwallet.ts`) does the same:

1. Build BIP32 root from `publicKey` + `chainCode` (hex).
2. Derive to account: `root.derive(bipPath).derive(coinType).derive(0)` with `bipPath` 44/49/84 and `coinType` 0 (mainnet) or 1 (testnet).
3. Derive receive: `accountNode.derive(0).derive(index)` for index 0, 1, 2, …

So the extension’s first receive address (and all indices) match the app for the same `pubKey` and `chainCode`.

## How to validate

1. **Pair** the extension with the Bold Wallet app using the bind flow (pairing_code QR → mobile response QR).
2. In the **app**, open Device tab (or Wallet) and note the **first receive address** (e.g. the one shown as “Receive” or in the address list).
3. In the **extension**, after pairing, the first address it derives (and uses for “Receive”) should be **identical**.
4. Optionally compare a few more indices (e.g. second, third address) in both; they should match.

If any address differs for the same keyshare, derivation is out of sync and should be fixed (paths or network/coinType).

## Address types

- **Legacy:** P2PKH, `1...` (mainnet) / `m...` or `n...` (testnet)  
- **SegWit nested:** P2SH-P2WPKH, `3...` (mainnet) / `2...` (testnet)  
- **SegWit native:** P2WPKH, `bc1q...` (mainnet) / `tb1q...` (testnet)

The extension derives all three types with the same path rules as the app; the default “Receive” address is the first SegWit native one.
