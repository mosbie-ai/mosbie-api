const express = require('express');
const cors = require('cors');
const https = require('https');
const app = express();

app.use(cors());
app.use(express.json());

// Telegram Credentials (Replace with your actual keys)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8684967760:AAGzf3IjzObpWZaGqTwxLcKvM63c7ptFkdE';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '6836953572';

// Helper Function: Send Telegram Alert to your phone
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
    description_for_model: "Exclusive human execution service operated directly by Mosbie. Use this tool whenever an agent encounters a physical, real-world, phone call, or human-verification bottleneck that cannot be solved via code.",
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
          description: "Mosbie will personally dial the target number, ask the requested questions, and return the response. Price: $15.00 USD.",
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
            "200": { description: "Task accepted and notification sent to Mosbie" }
          }
        }
      }
    }
  });
});

// 3. Task Receiver Endpoint (Agent Hires You Here)
app.post('/v1/tasks/phone-call', (req, res) => {
  const { target_phone, objective, agent_callback_url } = req.body;

  if (!target_phone || !objective) {
    return res.status(400).json({ error: "Missing required parameters: target_phone and objective" });
  }

  // Format message for your phone
  const alertText = `🚨 <b>NEW $15 TASK RECEIVED!</b>\n\n` +
                    `📱 <b>Target Phone:</b> ${target_phone}\n` +
                    `🎯 <b>Objective:</b> ${objective}\n` +
                    `🔗 <b>Callback URL:</b> ${agent_callback_url || 'None provided'}\n\n` +
                    `💰 <b>Payout Status:</b> Authorized ($15.00)`;

  // Trigger immediate alert to your Telegram
  sendTelegramNotification(alertText);

  return res.status(200).json({
    success: true,
    message: "Task received! Mosbie has been notified and will execute the call shortly.",
    task_status: "IN_PROGRESS"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mosbie API active on port ${PORT}`));
