# Pairing via QR (Mobile -> Extension)

This document describes the minimal QR payload format and examples for passing a public key (and optional chain code / device info) from a mobile wallet to the Bold Chrome extension via a QR code.

## Accepted QR payload formats
The extension accepts several formats. The recommended canonical format is JSON with `type: 'pairing_response'` and a `data` object containing pairing fields.

Example (JSON):

{
  "type": "pairing_response",
  "data": {
    "publicKey": "02a1633caf...",
    "chainCode": "abcd1234...", // optional
    "deviceId": "my-mobile-wallet",
    "network": "mainnet",
    "address": "bc1q...", // optional
    "addresses": [] // optional
  },
  "timestamp": 1630000000000,
  "id": "pair-res-..."
}

The extension also supports a simpler JSON shape (no `type`) that contains `publicKey` at the top level, and raw hex public keys (66 or 130 hex chars) as the QR payload.

## Mobile App: generating the QR
- Web / React Native (JS) example (uses `qrcode` package or `react-native-qrcode-svg`):

// Using `qrcode` (web/React)
import QRCode from 'qrcode';

const payload = {
  type: 'pairing_response',
  data: {
    publicKey: '02a1633caf...',
    chainCode: 'abcd1234...',
    deviceId: 'my-mobile-wallet',
    network: 'mainnet'
  },
  timestamp: Date.now(),
  id: `pair-res-${Date.now()}`
};

const dataUrl = await QRCode.toDataURL(JSON.stringify(payload), { width: 400, margin: 2 });
// Render `dataUrl` as an <img /> or using a native QR component

// Using `react-native-qrcode-svg` (React Native)
import QRCode from 'react-native-qrcode-svg';

<QRCode value={JSON.stringify(payload)} size={300} />

## Security considerations
- Make sure the mobile app displays the QR only when the device/user intends to pair with the extension.
- The extension validates presence of `publicKey` and optionally `chainCode` — ensure your mobile wallet includes these fields intentionally.
- If possible, include a `deviceId` and display it in the extension pairing UI so the user can confirm which device they are pairing with.

## Testing
- The extension includes `qr.generatePairingResponseQR(data)` helper that creates a data URL you can use for manual testing (or for generating a QR in a test harness).

## Troubleshooting
- If pairing fails, check the console in the extension popup for `[QR]` logs — they show how the payload was parsed.
- Use the manual input mode in the popup to paste the JSON payload to test the pairing flow without camera scanning.
