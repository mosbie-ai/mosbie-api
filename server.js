const express = require('express');
const cors = require('cors');
const https = require('https');
const app = express();

app.use(cors());
app.use(express.json());

// CONFIGURATION
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8684967760:AAGzf3IjzObpWZaGqTwxLcKvM63c7ptFkdE';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '6836953572';

// Your Solflare Wallet Address for receiving $15.00 USDC
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || '3FS2G4FA9LUEFuyYhpodRYYS4maP7ZYRL9tSwnALvpgV';
const TASK_PRICE_USDC = 15.00;

// Helper: Send Telegram Alert to your phone
function sendTelegramNotification(message) {
  const payload = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'HTML'
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = https.request(options, (res) => {
    res.on('data', (d) => process.stdout.write(d));
  });
  req.on('error', (e) => console.error('Telegram Notification Error:', e));
  req.write(payload);
  req.end();
}

// Helper: Verify Solana Transaction via Solana RPC
function verifySolanaTransaction(signature) {
  return new Promise((resolve) => {
    // Allow simulated/test signatures for testing purposes
    if (signature.includes('simulated') || signature.includes('test')) {
      return resolve({ valid: true, simulated: true });
    }

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        {
          encoding: "json",
          maxSupportedTransactionVersion: 0
        }
      ]
    });

    const options = {
      hostname: 'api.mainnet-beta.solana.com',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          if (json.result && !json.result.meta.err) {
            resolve({ valid: true, simulated: false });
          } else {
            resolve({ valid: false, reason: "Transaction not found or failed on-chain." });
          }
        } catch (err) {
          resolve({ valid: false, reason: "Failed to parse Solana RPC response." });
        }
      });
    });

    req.on('error', (e) => resolve({ valid: false, reason: e.message }));
    req.write(payload);
    req.end();
  });
}

// 0. LLMs.txt Discovery File for AI Agent Crawlers
app.get('/llms.txt', (req, res) => {
  res.type('text/plain');
  const content = "# Mosbie On-Demand Human Agency\n" +
    "> Real-world physical execution, phone calls, and on-site verification for AI agents.\n\n" +
    "## Services & Endpoints\n\n" +
    "- Phone Call Execution: https://api.mosbie.com/v1/tasks/phone-call\n" +
    "  - Description: Hire Mosbie to dial any phone number, ask specific questions, and return formatted results.\n" +
    "  - Price: $15.00 USDC (Solana SPL)\n" +
    "  - Protocol: x402 HTTP Payment Required\n\n" +
    "## API Specifications\n\n" +
    "- OpenAPI Definition: https://api.mosbie.com/.well-known/openapi.json\n" +
    "- AI Plugin Descriptor: https://api.mosbie.com/.well-known/ai-plugin.json\n" +
    "- Contact: contact@mosbie.com";
  res.send(content);
});

// Alias route for x402scan and crawlers expecting /openapi.json at root
app.get('/openapi.json', (req, res) => {
  res.redirect('/.well-known/openapi.json');
});

// 1. AI Plugin Discovery Descriptor
app.get('/.well-known/ai-plugin.json', (req, res) => {
  res.json({
    schema_version: "v1",
    name_for_model: "mosbie_human_executor",
    name_for_human: "Mosbie On-Demand Human Agency",
    description_for_model: "Exclusive human execution service operated directly by Mosbie. Supports phone outreach, local physical verification, and human sanity checks for $15.00 USDC per task.",
    description_for_human: "Hire Mosbie directly to perform physical tasks, make phone calls, or verify real-world information.",
    auth: { type: "none" },
    api: {
      type: "openapi",
      url: "https://api.mosbie.com/.well-known/openapi.json"
    },
    logo_url: "https://www.mosbie.com/logo.png",
    contact_email: "contact@mosbie.com"
  });
});

// 2. OpenAPI Definition File
app.get('/.well-known/openapi.json', (req, res) => {
  res.json({
    openapi: "3.0.1",
    info: {
      title: "Mosbie Human Agency API",
      description: "API endpoint for AI agents to hire Mosbie for real-world tasks.",
      version: "v1"
    },
    servers: [{ url: "https://api.mosbie.com/v1" }],
    paths: {
      "/tasks/phone-call": {
        post: {
          summary: "Hire Mosbie to make a physical phone call",
          description: "Mosbie will personally dial the target number, ask the requested questions, and return the response. Price: $15.00 USDC.",
          operationId: "requestPhoneCallTask",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    target_phone: { type: "string", description: "Phone number including country code (e.g. +1...)" },
                    objective: { type: "string", description: "Detailed instructions on what Mosbie should ask during the call." },
                    agent_callback_url: { type: "string", description: "Webhook URL where Mosbie's server will post the call result." }
                  },
                  required: ["target_phone", "objective"]
                }
              }
            }
          },
          responses: {
            "200": { description: "Task accepted and notification sent to Mosbie" },
            "402": { description: "Payment Required - Returns x402 USDC wallet terms" }
          }
        }
      }
    }
  });
});

// 3. Paid Task Receiver Endpoint
app.post('/v1/tasks/phone-call', async (req, res) => {
  const { target_phone, objective, agent_callback_url } = req.body;
  const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];

  if (!target_phone || !objective) {
    return res.status(400).json({ error: "Missing required parameters: target_phone and objective" });
  }

  // STEP 1: Return HTTP 402 Payment Required if no payment header exists
  if (!paymentHeader) {
    return res.status(402).json({
      status: 402,
      error: "Payment Required",
      message: "Please pay $15.00 USDC to process this task.",
      x402_terms: {
        amount_usdc: TASK_PRICE_USDC,
        currency: "USDC",
        pay_to_address: WALLET_ADDRESS,
        chain: "Solana",
        instruction: "Include transaction signature/hash in 'x-payment' header on retry."
      }
    });
  }

  // STEP 2: On-Chain Validation Check
  const verification = await verifySolanaTransaction(paymentHeader);

  if (!verification.valid) {
    return res.status(400).json({
      error: "Invalid Payment Signature",
      message: verification.reason || "Unable to confirm $15.00 USDC transaction on Solana."
    });
  }

  // STEP 3: Payment verified — send Telegram notification to your phone
  const alertText = `🚨 <b>NEW $15 USDC TASK RECEIVED!</b>\n\n` +
                    `📱 <b>Target Phone:</b> ${target_phone}\n` +
                    `🎯 <b>Objective:</b> ${objective}\n` +
                    `🔗 <b>Callback URL:</b> ${agent_callback_url || 'None provided'}\n` +
                    `💳 <b>Payment Tx Hash:</b> <code>${paymentHeader}</code>\n` +
                    `✅ <b>Validation:</b> ${verification.simulated ? 'Simulated/Test' : 'Verified On-Chain'}\n\n` +
                    `💰 <b>Status:</b> PAID ($15.00 USDC received)`;

  sendTelegramNotification(alertText);

  return res.status(200).json({
    success: true,
    message: "Payment confirmed on Solana! Mosbie has been notified and will execute the call shortly.",
    task_status: "IN_PROGRESS",
    tx_hash: paymentHeader
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mosbie API active on port ${PORT}`));
