---
name: x402-pay-with-safety
description: Make x402 micropayments (HTTP 402 Payment Required) using USDC on Base (EVM) or Solana (SVM). Automatically screens requests via the Orac Safety Layer before paying to detect prompt injection attacks. Use when calling any paid API that returns 402 Payment Required. Requires WALLET_PRIVATE_KEY in environment (Base mainnet wallet with USDC). Optional SOLANA_PRIVATE_KEY for Solana payments.
allowed-tools: []
---

# x402-pay-with-safety

Make x402 micropayments with built-in security screening. Automatically detects prompt injection attacks that could cause unauthorized payments before committing USDC. Supports both Base (EVM) and Solana (SVM) payment chains.

## When to Use

- Calling any API that returns HTTP 402 Payment Required
- Making micropayments on Base or Solana via x402 protocol
- When you want to call a paid service and safety-screen the request first

## Usage

```bash
# Basic: pay for an API call
node /workspace/group/skills/x402-pay-with-safety/pay.js \
  --url https://api.example.com/v1/resource \
  --body '{"query": "hello"}' \
  --context "User asked me to look up weather"

# Skip safety check (not recommended)
node /workspace/group/skills/x402-pay-with-safety/pay.js \
  --url https://api.example.com/v1/resource \
  --body '{"query": "hello"}' \
  --no-safety-check

# JSON output (for programmatic use)
node /workspace/group/skills/x402-pay-with-safety/pay.js \
  --url https://api.example.com/v1/resource \
  --body '{"query": "hello"}' \
  --json
```

## Environment Variables

- `WALLET_PRIVATE_KEY` — Ethereum private key for signing x402 payments (Base mainnet) — required
- `SOLANA_PRIVATE_KEY` — Solana private key, base58-encoded (Solana mainnet with SPL USDC) — optional

## Payment Flow

1. **Safety Screen** (default): Calls Orac Safety Layer to scan `--context` for prompt injection attacks (costs 0.005 USDC)
2. **Request**: Sends your request to the target URL
3. **402 Response**: Parses payment requirements — auto-selects EVM or Solana based on available keys and server options
4. **Sign**: Creates payment signature (EIP-3009 for EVM, partially-signed SPL transfer for Solana)
5. **Retry**: Resends request with `Payment-Signature` header
6. **Settlement**: The server verifies the signature and settles payment on-chain via the [Dexter facilitator](https://x402.dexter.cash) (gas sponsored by Dexter on both chains)
7. **Result**: Returns the API response with `X-Payment-Confirmed: true`

If the safety scan returns MALICIOUS, the payment is aborted (exit code 2).

## Exit Codes

- `0` — Success, payment made
- `1` — Error (network, signing, etc.)
- `2` — Safety check FAILED — potential injection attack detected
- `3` — No payment required (API returned 200 directly)

## Security

This skill calls `https://orac-safety.orac.workers.dev/v1/scan` before making payments.
The scan itself costs 0.005 USDC and is paid from your wallet.
If you're screening a low-value payment, consider `--no-safety-check` to avoid the overhead.
