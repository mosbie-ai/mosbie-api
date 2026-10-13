require("dotenv").config();
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

// ---------- DISCOVERY FILES (free, not behind the paywall) ----------
app.get("/", (req, res) => res.json({ name: "Mosbie Human Agency API", status: "ok" }));

app.get("/llms.txt", (req, res) => {
  res.type("text/plain").send(
    "# Mosbie On-Demand Human Agency\n" +
      "> Real-world phone calls and verification for AI agents.\n\n" +
      "## Services & Endpoints\n\n" +
      "- Phone Call Execution: https://api.mosbie.com/v1/tasks/phone-call\n" +
      "  - Description: Mosbie dials a phone number, asks your questions, and returns the result.\n" +
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
    description_for_model:
      "Human execution service operated by Mosbie. Makes phone calls on request for $15.00 USDC per task, paid via x402.",
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
          description:
            "Mosbie dials the target number, asks the requested questions, and returns the answers. Price: $15.00 USDC on Base via x402.",
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
                      description: "Phone number with country code, e.g. +14155550123",
                    },
                    objective: {
                      type: "string",
                      description: "Detailed instructions on what to ask during the call.",
                    },
                    agent_callback_url: {
                      type: "string",
                      description: "Optional webhook URL for the call result.",
                    },
                  },
                  required: ["target_phone", "objective"],
                },
              },
            },
          },
          responses: {
            200: { description: "Payment verified; task accepted" },
            400: { description: "Invalid request body" },
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
  description: "Mosbie makes a phone call for you and reports back",
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

  if (typeof target_phone !== "string" || !/^\+[1-9]\d{6,14}$/.test(target_phone.trim())) {
    return res
      .status(400)
      .json({ error: "target_phone must be in international format, e.g. +14155550123" });
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

  await sendTelegram(
    `🚨 <b>NEW $15 USDC TASK (PAID)</b>\n\n` +
      `📱 <b>Target phone:</b> ${escapeHtml(target_phone)}\n` +
      `🎯 <b>Objective:</b> ${escapeHtml(objective)}\n` +
      `🔗 <b>Callback URL:</b> ${escapeHtml(agent_callback_url || "None provided")}`
  );

  return res.status(200).json({
    success: true,
    message: "Payment confirmed. Mosbie has been notified and will make the call shortly.",
    task_status: "IN_PROGRESS",
  });
});

app.listen(PORT, () => console.log(`Mosbie API running on port ${PORT} (${X402_NETWORK})`));
