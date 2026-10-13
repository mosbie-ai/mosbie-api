require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { paymentMiddleware, x402ResourceServer } = require("@x402/express");
const { ExactEvmScheme } = require("@x402/evm/exact/server");
const { HTTPFacilitatorClient } = require("@x402/core/server");

// ---------- CONFIG (all secrets come from environment variables) ----------
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  BASE_WALLET_ADDRESS,
  X402_NETWORK = "base", // use "base-sepolia" for testing
  PORT = 3000,
} = process.env;

for (const [name, value] of Object.entries({
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  BASE_WALLET_ADDRESS,
})) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

// x402 v2 network IDs. Mainnet needs the Coinbase (CDP) facilitator;
// testnet uses the public one.
const isMainnet = X402_NETWORK === "base";
const NETWORK_ID = isMainnet ? "eip155:8453" : "eip155:84532";
let facilitatorConfig = { url: "https://x402.org/facilitator" };
if (isMainnet) {
  if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
    console.error("Mainnet needs CDP_API_KEY_ID and CDP_API_KEY_SECRET (cdp.coinbase.com).");
    process.exit(1);
  }
  facilitatorConfig = require("@coinbase/x402").facilitator;
}
const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient(facilitatorConfig)
).register(NETWORK_ID, new ExactEvmScheme());

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "20kb" }));

// ---------- HELPERS ----------
const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

async function sendTelegram(text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
    if (!r.ok) console.error("Telegram error:", r.status, await r.text());
  } catch (e) {
    console.error("Telegram request failed:", e.message);
  }
}

// ---------- SERVICE TERMS (edit this text in one place) ----------
const SERVICE_DESCRIPTION =
  "Mosbie phones a South African number (+27), asks your questions, and reports the answers. " +
  "Same-day turnaround during South African business hours (SAST, UTC+2). " +
  "If the business is closed or cannot be reached that day, the result will say so.";

// ---------- DISCOVERY FILES (free, not behind the paywall) ----------
app.get("/", (req, res) => res.json({ name: "Mosbie Human Agency API", status: "ok" }));

app.get("/llms.txt", (req, res) => {
  res.type("text/plain").send(
    "# Mosbie On-Demand Human Agency\n" +
      "> Real-world phone calls and verification for AI agents.\n\n" +
      "## Services & Endpoints\n\n" +
      "- Phone Call Execution: https://api.mosbie.com/v1/tasks/phone-call\n" +
      `  - Description: ${SERVICE_DESCRIPTION}\n` +
      "  - Price: $15.00 USDC on Base\n" +
      "  - Protocol: x402 HTTP Payment Required\n\n" +
      "## API Specifications\n\n" +
      "- OpenAPI Definition: https://api.mosbie.com/.well-known/openapi.json\n" +
      "- AI Plugin Descriptor: https://api.mosbie.com/.well-known/ai-plugin.json\n" +
      "- Contact: contact@mosbie.com\n"
  );
});

app.get("/openapi.json", (req, res) => res.redirect("/.well-known/openapi.json"));

app.get("/.well-known/ai-plugin.json", (req, res) => {
  res.json({
    schema_version: "v1",
    name_for_model: "mosbie_human_executor",
    name_for_human: "Mosbie On-Demand Human Agency",
    description_for_model: `${SERVICE_DESCRIPTION} Price: $15.00 USDC per task, paid via x402.`,
    description_for_human: "Hire Mosbie to make phone calls and verify real-world information.",
    auth: { type: "none" },
    api: { type: "openapi", url: "https://api.mosbie.com/.well-known/openapi.json" },
    logo_url: "https://www.mosbie.com/logo.png",
    contact_email: "contact@mosbie.com",
  });
});

app.get("/.well-known/openapi.json", (req, res) => {
  res.json({
    openapi: "3.0.1",
    info: {
      title: "Mosbie Human Agency API",
      description: "API for AI agents to hire Mosbie for real-world tasks.",
      version: "v1",
      contact: { email: "contact@mosbie.com" },
    },
    servers: [{ url: "https://api.mosbie.com" }],
    paths: {
      "/v1/tasks/phone-call": {
        post: {
          summary: "Hire Mosbie to make a phone call",
          description: `${SERVICE_DESCRIPTION} Price: $15.00 USDC on Base via x402.`,
          operationId: "requestPhoneCallTask",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    target_phone: {
                      type: "string",
                      pattern: "^\\+27[0-9]{9}$",
                      description: "South African phone number in international format, e.g. +27821234567",
                      example: "+27821234567",
                    },
                    objective: {
                      type: "string",
                      description: "Detailed instructions on what to ask during the call (5-2000 characters).",
                      example: "Ask whether they are open today and what time they close.",
                    },
                    agent_callback_url: {
                      type: "string",
                      description: "Optional URL where Mosbie will send the call result.",
                    },
                  },
                  required: ["target_phone", "objective"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Payment verified; task accepted and queued for a same-day call",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", description: "True when the task was accepted." },
                      task_id: { type: "string", description: "Reference ID for this task." },
                      task_status: {
                        type: "string",
                        enum: ["IN_PROGRESS"],
                        description: "Status of the task at the time of the response.",
                      },
                      expected_completion: {
                        type: "string",
                        description: "When to expect the result.",
                      },
                      message: { type: "string", description: "Human-readable confirmation." },
                    },
                    required: ["success", "task_id", "task_status", "message"],
                  },
                  example: {
                    success: true,
                    task_id: "3f6c2a9e-8f0b-4d52-9d2e-7a1b5c4e9f10",
                    task_status: "IN_PROGRESS",
                    expected_completion: "Same day, during South African business hours (SAST)",
                    message: "Payment confirmed. Mosbie has been notified and will make the call shortly.",
                  },
                },
              },
            },
            400: {
              description: "Invalid request body (nothing is charged)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { error: { type: "string" } },
                    required: ["error"],
                  },
                },
              },
            },
            402: { description: "Payment required (x402)" },
          },
        },
      },
    },
  });
});

// ---------- x402 PAYWALL ----------
// The middleware returns a spec-compliant 402 for unpaid requests and verifies
// the payment through the facilitator before the handler below ever runs.
const phoneCallRoute = {
  accepts: [
    {
      scheme: "exact",
      price: "$15.00",
      network: NETWORK_ID,
      payTo: BASE_WALLET_ADDRESS,
    },
  ],
  description: SERVICE_DESCRIPTION,
  mimeType: "application/json",
};

app.use(
  paymentMiddleware(
    {
      "POST /v1/tasks/phone-call": phoneCallRoute,
      "GET /v1/tasks/phone-call": phoneCallRoute,
    },
    resourceServer
  )
);

// ---------- PAID TASK ENDPOINT (only reached after payment is verified) ----------
app.all("/v1/tasks/phone-call", async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST with a JSON body." });
  }

  const { target_phone, objective, agent_callback_url } = req.body || {};

  if (typeof target_phone !== "string" || !/^\+27\d{9}$/.test(target_phone.trim())) {
    return res
      .status(400)
      .json({ error: "target_phone must be a South African number, e.g. +27821234567" });
  }
  if (typeof objective !== "string" || objective.trim().length < 5 || objective.length > 2000) {
    return res.status(400).json({ error: "objective must be 5-2000 characters." });
  }
  if (agent_callback_url !== undefined) {
    try {
      const u = new URL(agent_callback_url);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error();
    } catch {
      return res.status(400).json({ error: "agent_callback_url must be a valid http(s) URL." });
    }
  }

  const taskId = crypto.randomUUID();

  await sendTelegram(
    `🚨 <b>NEW $15 USDC TASK (PAID)</b>\n\n` +
      `🆔 <b>Task ID:</b> <code>${taskId}</code>\n` +
      `📱 <b>Target phone:</b> ${escapeHtml(target_phone)}\n` +
      `🎯 <b>Objective:</b> ${escapeHtml(objective)}\n` +
      `🔗 <b>Callback URL:</b> ${escapeHtml(agent_callback_url || "None provided")}`
  );

  return res.status(200).json({
    success: true,
    task_id: taskId,
    task_status: "IN_PROGRESS",
    expected_completion: "Same day, during South African business hours (SAST)",
    message: "Payment confirmed. Mosbie has been notified and will make the call shortly.",
  });
});

app.listen(PORT, () => console.log(`Mosbie API running on port ${PORT} (${X402_NETWORK})`));
