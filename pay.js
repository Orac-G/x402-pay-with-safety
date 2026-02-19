#!/usr/bin/env node
/**
 * x402-pay — Make x402 micropayments with built-in Safety Layer screening
 *
 * Usage:
 *   node pay.js --url <url> [--body <json>] [--context <text>] [--no-safety-check] [--json]
 *
 * Requires: WALLET_PRIVATE_KEY env var (Ethereum private key, Base mainnet with USDC)
 */

'use strict';

const https = require('https');

// --- Argument parsing ---

function parseArgs(argv) {
  const args = { safetyCheck: true, json: false, body: null, context: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--url':    args.url = argv[++i]; break;
      case '--body':   args.body = argv[++i]; break;
      case '--context': args.context = argv[++i]; break;
      case '--no-safety-check': args.safetyCheck = false; break;
      case '--json':   args.json = true; break;
    }
  }
  return args;
}

// --- HTTP helpers ---

function post(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyBuffer = Buffer.from(body);
    const lib = parsed.protocol === 'https:' ? https : require('http');

    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyBuffer.length,
        'Accept': 'application/json',
        ...extraHeaders
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

// --- x402 payment flow ---

async function makeX402Payment(url, requestBody, signer) {
  // Step 1: Initial request — expect 402
  const step1 = await post(url, requestBody);

  if (step1.status === 200) {
    return { paid: false, status: 200, body: JSON.parse(step1.body), cost: '0' };
  }

  if (step1.status !== 402) {
    throw new Error(`Expected 402, got ${step1.status}: ${step1.body.substring(0, 200)}`);
  }

  // Parse payment requirements
  const req402 = JSON.parse(step1.body);
  const payment = req402.accepts?.[0];
  if (!payment) throw new Error('No payment options in 402 response');

  const usdcAmount = parseInt(payment.amount) / 1e6;

  // Step 2: Sign payment
  const paymentPayload = await signer.sign(req402);
  const paymentHeader = signer.encodeHeader(paymentPayload);

  // Step 3: Retry with payment
  const step2 = await post(url, requestBody, paymentHeader);

  if (step2.status !== 200) {
    throw new Error(`Payment failed: ${step2.body.substring(0, 300)}`);
  }

  return {
    paid: true,
    status: 200,
    cost: usdcAmount.toFixed(6),
    recipient: payment.payTo,
    body: JSON.parse(step2.body)
  };
}

// --- Safety Layer integration ---

const SAFETY_URL = 'https://orac-safety.orac.workers.dev/v1/scan';

async function screenWithSafetyLayer(context, signer, verbose) {
  if (verbose) process.stderr.write('Screening with Safety Layer...\n');

  const requestBody = JSON.stringify({ prompt: context });

  try {
    const result = await makeX402Payment(SAFETY_URL, requestBody, signer);

    const { verdict, riskScore, findings } = result.body;

    if (verbose && result.paid) {
      process.stderr.write(`Safety check cost: $${result.cost} USDC\n`);
    }

    return { verdict, riskScore, findings };
  } catch (err) {
    // If Safety Layer is unreachable, default to allowing (fail open)
    process.stderr.write(`Warning: Safety Layer unavailable (${err.message}) — proceeding without screen\n`);
    return { verdict: 'UNKNOWN', riskScore: 0, findings: [] };
  }
}

// --- x402 signer using viem + @x402 ---

function createSigner(privateKeyHex) {
  const { createWalletClient, http } = require('viem');
  const { privateKeyToAccount } = require('viem/accounts');
  const { base } = require('viem/chains');
  const { x402Client, x402HTTPClient } = require('@x402/core/client');
  const { ExactEvmScheme } = require('@x402/evm');

  const key = privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`;
  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });

  const viemSigner = {
    address: account.address,
    signTypedData: (params) => walletClient.signTypedData(params)
  };

  const client = new x402Client();
  client.register('eip155:8453', new ExactEvmScheme(viemSigner));
  const httpClient = new x402HTTPClient(client);

  return {
    address: account.address,
    sign: (req402) => client.createPaymentPayload(req402),
    encodeHeader: (payload) => httpClient.encodePaymentSignatureHeader(payload)
  };
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    console.error('Error: --url is required');
    console.error('Usage: node pay.js --url <url> [--body <json>] [--context <text>] [--no-safety-check] [--json]');
    process.exit(1);
  }

  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    console.error('Error: WALLET_PRIVATE_KEY not set in environment');
    process.exit(1);
  }

  const verbose = !args.json;
  const requestBody = args.body || '{}';

  // Validate request body is valid JSON
  try { JSON.parse(requestBody); } catch {
    console.error('Error: --body must be valid JSON');
    process.exit(1);
  }

  if (verbose) {
    process.stderr.write(`Target: ${args.url}\n`);
  }

  // Set up signer
  const signer = createSigner(privateKey);

  if (verbose) {
    process.stderr.write(`Wallet: ${signer.address}\n`);
  }

  // Safety screen
  if (args.safetyCheck && args.context) {
    const screen = await screenWithSafetyLayer(args.context, signer, verbose);

    if (screen.verdict === 'MALICIOUS') {
      const result = {
        success: false,
        aborted: true,
        reason: 'Safety Layer: MALICIOUS prompt detected',
        riskScore: screen.riskScore,
        findings: screen.findings
      };

      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error(`\n BLOCKED: Potential prompt injection attack detected`);
        console.error(`Risk Score: ${screen.riskScore}/100`);
        if (screen.findings?.length) {
          for (const f of screen.findings) {
            console.error(`  [${f.severity?.toUpperCase()}] ${f.description || f.id}`);
          }
        }
      }
      process.exit(2);
    }

    if (screen.verdict === 'SUSPICIOUS' && verbose) {
      process.stderr.write(`Warning: Safety Layer flagged SUSPICIOUS (risk: ${screen.riskScore}/100) — proceeding with caution\n`);
    }
  } else if (args.safetyCheck && !args.context && verbose) {
    process.stderr.write('Note: No --context provided, skipping safety screen\n');
  }

  // Make x402 payment
  if (verbose) process.stderr.write('Making request...\n');

  try {
    const result = await makeX402Payment(args.url, requestBody, signer);

    if (args.json) {
      console.log(JSON.stringify({
        success: true,
        paid: result.paid,
        cost: result.paid ? `${result.cost} USDC` : '0',
        recipient: result.recipient || null,
        response: result.body
      }, null, 2));
    } else {
      if (result.paid) {
        console.log(`\nPaid: $${result.cost} USDC → ${result.recipient}`);
      } else {
        console.log('\nNo payment required (200 direct)');
      }
      console.log('\nResponse:');
      console.log(JSON.stringify(result.body, null, 2));
    }

    process.exit(result.status === 200 ? 0 : 1);
  } catch (err) {
    if (args.json) {
      console.log(JSON.stringify({ success: false, error: err.message }));
    } else {
      console.error(`\nError: ${err.message}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
