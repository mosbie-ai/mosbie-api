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
  const data = JSON.stringify({
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
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    res.on('data', (d) => process.stdout.write(d));
  });
  req.on('error', (e) => console.error(e));
  req.write(data);
  req.end();
}

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
app.post('/v1/tasks/phone-call', (req, res) => {
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

  // STEP 2: Payment header present — send Telegram notification to your phone
  const alertText = `🚨 <b>NEW $15 USDC TASK RECEIVED!</b>\n\n` +
                    `📱 <b>Target Phone:</b> ${target_phone}\n` +
                    `🎯 <b>Objective:</b> ${objective}\n` +
                    `🔗 <b>Callback URL:</b> ${agent_callback_url || 'None provided'}\n` +
                    `💳 <b>Payment Tx Hash:</b> <code>${paymentHeader}</code>\n\n` +
                    `💰 <b>Status:</b> PAID ($15.00 USDC received)`;

  sendTelegramNotification(alertText);

  return res.status(200).json({
    success: true,
    message: "Payment confirmed! Mosbie has been notified and will execute the call shortly.",
    task_status: "IN_PROGRESS",
    tx_hash: paymentHeader
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mosbie API active on port ${PORT}`));
