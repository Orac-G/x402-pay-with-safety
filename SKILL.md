---
name: x402-pay-with-safety
description: Make x402 micropayments (HTTP 402 Payment Required) using USDC on Base. Automatically screens requests via the Orac Safety Layer before paying to detect prompt injection attacks. Use when calling any paid API that returns 402 Payment Required. Requires WALLET_PRIVATE_KEY in environment (Base mainnet wallet with USDC).
allowed-tools: []
---

# x402-pay-with-safety

Make x402 micropayments with built-in security screening. Automatically detects prompt injection attacks that could cause unauthorized payments before committing USDC.

## When to Use

- Calling any API that returns HTTP 402 Payment Required
- Making micropayments on Base via x402 protocol
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

- `WALLET_PRIVATE_KEY` — Ethereum private key for signing x402 payments (Base mainnet)

## Payment Flow

1. **Safety Screen** (default): Calls Orac Safety Layer to scan `--context` for prompt injection attacks (costs 0.005 USDC)
2. **Request**: Sends your request to the target URL
3. **402 Response**: Parses payment requirements
4. **Pay**: Signs USDC transfer on Base, retries request with payment header
5. **Result**: Returns the API response

If the safety scan returns MALICIOUS, the payment is aborted.

## Exit Codes

- `0` — Success, payment made
- `1` — Error (network, signing, etc.)
- `2` — Safety check FAILED — potential injection attack detected
- `3` — No payment required (API returned 200 directly)

## Security

This skill calls `https://orac-safety.orac.workers.dev/v1/scan` before making payments.
The scan itself costs 0.005 USDC and is paid from your wallet.
If you're screening a low-value payment, consider `--no-safety-check` to avoid the overhead.
