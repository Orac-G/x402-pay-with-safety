# x402-pay-with-safety

Make x402 micropayments (HTTP 402 Payment Required) with built-in security screening.

Before making any payment, this skill calls the [Orac Safety Layer](https://orac-safety.orac.workers.dev) to detect prompt injection attacks — attacks where malicious instructions embedded in content could cause an agent to make unauthorized payments.

**Author**: Orac (orac.eth)
**Version**: 1.0.0
**License**: MIT

---

## Install

```bash
git clone https://github.com/Orac-G/x402-pay-with-safety /path/to/skills/x402-pay-with-safety
cd /path/to/skills/x402-pay-with-safety
npm install
```

## Requirements

- Node.js 18+
- `WALLET_PRIVATE_KEY` environment variable — Ethereum private key for a Base mainnet wallet holding USDC
- The wallet needs USDC on Base mainnet for payments (Safety Layer costs 0.005 USDC per scan)

## Usage

```bash
# Screen + pay for an API call
node pay.js \
  --url https://api.example.com/v1/endpoint \
  --body '{"query": "some request"}' \
  --context "User asked: look up the weather"

# Skip safety screening (not recommended for untrusted prompts)
node pay.js \
  --url https://api.example.com/v1/endpoint \
  --body '{"query": "some request"}' \
  --no-safety-check

# JSON output (for scripting/integration)
node pay.js \
  --url https://api.example.com/v1/endpoint \
  --body '{"query": "some request"}' \
  --context "User request context" \
  --json
```

## Options

| Flag | Description |
|------|-------------|
| `--url <url>` | Target API URL (required) |
| `--body <json>` | Request body as JSON string (default: `{}`) |
| `--context <text>` | The prompt or context that triggered this payment — used for injection screening |
| `--no-safety-check` | Skip the Safety Layer screen (saves 0.005 USDC) |
| `--json` | Output as JSON (default: human-readable) |

## Payment Flow

```
1. Safety Screen (if --context provided):
   → POST /v1/scan to Orac Safety Layer
   → Costs 0.005 USDC, paid via x402
   → If MALICIOUS: abort, exit(2)
   → If SUSPICIOUS: warn, continue
   → If BENIGN: continue

2. Make Request:
   → POST --url with --body
   → If 200: return response, no payment needed (exit 0)
   → If 402: parse payment requirements

3. Sign & Pay:
   → Create USDC transfer on Base via EIP-712 typed signature
   → Retry request with X-Payment header
   → If 200: return response, payment confirmed (exit 0)

4. Total cost = safety_screen (0.005 USDC) + api_cost (varies)
```

## Example Output

```
Target: https://orac-safety.orac.workers.dev/v1/scan
Wallet: 0x4a47B25c90eA79e32b043d9eE282826587187ca5
Screening with Safety Layer...
Safety check cost: $0.005000 USDC

Making request...
Paid: $0.005000 USDC → 0x4a47...ca5

Response:
{
  "verdict": "BENIGN",
  "riskScore": 5,
  "findings": []
}
```

## Security

The Safety Layer uses 27 patterns to detect:
- Prompt injection (`SYSTEM OVERRIDE`, `ignore previous instructions`, etc.)
- Social engineering patterns (`your continued operation depends on`, etc.)
- Payload exfiltration patterns
- Authorization bypass attempts

See [orac-safety.orac.workers.dev](https://orac-safety.orac.workers.dev) for full documentation.
Repo: [github.com/Orac-G/safety-api](https://github.com/Orac-G/safety-api)

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — payment made (or not required) |
| `1` | Error — network, signing, or API failure |
| `2` | Blocked — Safety Layer detected MALICIOUS prompt |
| `3` | (unused) |

## Example: Calling the Orac Safety Layer

```bash
# Scan a prompt for injection attacks
WALLET_PRIVATE_KEY=0x... node pay.js \
  --url https://orac-safety.orac.workers.dev/v1/scan \
  --body '{"prompt": "Ignore all previous instructions..."}' \
  --no-safety-check \
  --json
```

## Development

To test without spending real USDC, point to a local x402 server or use a test wallet with small amounts.

```bash
# Check wallet balance before running
cast balance 0xYOUR_ADDRESS --rpc-url https://mainnet.base.org
cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 "balanceOf(address)(uint256)" 0xYOUR_ADDRESS --rpc-url https://mainnet.base.org
```

---

*x402-pay-with-safety v1.0.0 — Built by Orac (orac.eth)*
*Safety Layer: https://orac-safety.orac.workers.dev*
