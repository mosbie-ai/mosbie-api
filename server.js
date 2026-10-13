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

// ---------- SERVICES (edit prices and wording here) ----------
const DELIVERY =
  "Same-day delivery (South Africa Standard Time, UTC+2). If the target is closed, " +
  "unreachable or outside sensible hours, the task is completed at the next opportunity " +
  "and the result says so.";

const TASKS = {
  "phone-call": {
    price: "$15.00",
    priceNumber: 15,
    summary: "Hire a human to make a phone call (South Africa, US/Canada, UK, Australia, NZ)",
    description:
      "A human dials the number, asks your questions and reports exactly what was said. " +
      "Supported destinations: South Africa (+27), United States and Canada (+1), " +
      "United Kingdom (+44), Australia (+61) and New Zealand (+64). " + DELIVERY,
    targetField: "target_phone",
    targetDescription:
      "Phone number in international format, starting +27 (South Africa), +1 (US/Canada), +44 (UK), +61 (Australia) or +64 (New Zealand), e.g. +14155550123",
    validateTarget: (v) =>
      typeof v === "string" &&
      /^\+[1-9]\d{6,14}$/.test(v.trim()) &&
      ["+27", "+1", "+44", "+61", "+64"].some((p) => v.trim().startsWith(p)),
    targetError:
      "target_phone must be in international format and start with +27 (South Africa), +1 (US/Canada), +44 (UK), +61 (Australia) or +64 (New Zealand).",
  },
  email: {
    price: "$15.00",
    priceNumber: 15,
    summary: "Hire a human to send an email and report the reply",
    description:
      "A human writes and sends an email on your behalf, follows up once, and reports any reply. " +
      DELIVERY,
    targetField: "recipient_email",
    targetDescription: "Email address to contact",
    validateTarget: (v) =>
      typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
    targetError: "recipient_email must be a valid email address.",
  },
  "site-visit": {
    price: "$30.00",
    priceNumber: 30,
    summary: "Hire a human to visit a place in person (Cape Town area)",
    description:
      "A human visits a location in the Cape Town, South Africa area, checks what you ask " +
      "(is it open, what is on display, a price, a photo) and reports back with a description " +
      "and photos where permitted. Cape Town area only. " + DELIVERY,
    targetField: "address",
    targetDescription: "Street address or place name in the Cape Town area",
    validateTarget: (v) => typeof v === "string" && v.trim().length >= 5 && v.length <= 300,
    targetError: "address must be 5-300 characters (Cape Town area).",
  },
};

// ---------- APP ----------
const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "20kb" }));

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
// Landing page for api.mosbie.com. Directories read the title and description from here,
// so this keeps the API listing separate from the main mosbie.com website.
const SITE_TITLE = "Mosbie Human Agency API | Hire a human to call, email or visit";
const SITE_DESC =
  "Things only humans can do, for AI agents: phone calls, emails and in-person visits, " +
  "paid per task in USDC via x402. Same-day delivery.";
app.get("/", (req, res) => {
  if (req.accepts(["html", "json"]) === "json") {
    return res.json({ name: "Mosbie Human Agency API", status: "ok" });
  }
  const items = Object.entries(TASKS)
    .map(
      ([slug, t]) =>
        `<li><strong>${escapeHtml(t.summary)}</strong> &ndash; ${escapeHtml(t.price)} USDC<br>` +
        `<code>POST /v1/tasks/${slug}</code></li>`
    )
    .join("");
  res.type("html").send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${escapeHtml(SITE_TITLE)}</title>` +
      `<meta name="description" content="${escapeHtml(SITE_DESC)}">` +
      `<meta property="og:title" content="${escapeHtml(SITE_TITLE)}">` +
      `<meta property="og:description" content="${escapeHtml(SITE_DESC)}">` +
      `<meta property="og:url" content="https://api.mosbie.com">` +
      `</head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px">` +
      `<h1>Mosbie Human Agency API</h1><p>${escapeHtml(SITE_DESC)}</p><ul>${items}</ul>` +
      `<p><a href="/llms.txt">llms.txt</a> &middot; <a href="/.well-known/openapi.json">OpenAPI</a> ` +
      `&middot; <a href="https://www.mosbie.com">mosbie.com</a></p></body></html>`
  );
});

app.get("/llms.txt", (req, res) => {
  const lines = Object.entries(TASKS).map(
    ([slug, t]) =>
      `- ${t.summary}: https://api.mosbie.com/v1/tasks/${slug}\n` +
      `  - ${t.description}\n` +
      `  - Price: ${t.price} USDC on Base (x402)\n`
  );
  res.type("text/plain").send(
    "# Mosbie On-Demand Human Agency\n" +
      "> Things only humans can do: phone calls, emails and in-person visits, for AI agents.\n\n" +
      "## Services & Endpoints\n\n" +
      lines.join("\n") +
      "\n## API Specifications\n\n" +
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
      "Human execution service operated by Mosbie. Makes phone calls, sends emails and does " +
      "in-person visits (Cape Town area) on request, paid per task in USDC via x402. Same-day delivery.",
    description_for_human: "Hire a real human to call, email or visit on your behalf.",
    auth: { type: "none" },
    api: { type: "openapi", url: "https://api.mosbie.com/.well-known/openapi.json" },
    logo_url: "https://www.mosbie.com/logo.png",
    contact_email: "contact@mosbie.com",
  });
});

function openApiPath(slug, t) {
  return {
    post: {
      summary: t.summary,
      description: `${t.description} Price: ${t.price} USDC on Base via x402.`,
      operationId: "request_" + slug.replace(/-/g, "_"),
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                [t.targetField]: { type: "string", description: t.targetDescription },
                objective: {
                  type: "string",
                  description: "Exactly what the human should ask, say, check or find out (5-2000 characters).",
                },
                reply_email: {
                  type: "string",
                  description: "Email address where the result is sent. Provide this or agent_callback_url.",
                },
                agent_callback_url: {
                  type: "string",
                  description: "https URL where the result is posted. Provide this or reply_email.",
                },
              },
              required: [t.targetField, "objective"],
            },
          },
        },
      },
      responses: {
        200: {
          description: "Payment verified; task accepted. The result is delivered later by email or webhook.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  task_id: { type: "string", description: "Reference for this task." },
                  task_status: { type: "string", enum: ["ACCEPTED"] },
                  message: { type: "string" },
                  expected_delivery: { type: "string" },
                },
                required: ["success", "task_id", "task_status"],
              },
            },
          },
        },
        400: { description: "Invalid request body (you are not charged)" },
        402: { description: "Payment required (x402)" },
      },
    },
  };
}

app.get("/.well-known/openapi.json", (req, res) => {
  const paths = {};
  for (const [slug, t] of Object.entries(TASKS)) paths[`/v1/tasks/${slug}`] = openApiPath(slug, t);
  res.json({
    openapi: "3.0.1",
    info: {
      title: "Mosbie Human Agency API",
      description: "API for AI agents to hire a human for calls, emails and in-person visits.",
      version: "v1",
      contact: { email: "contact@mosbie.com" },
    },
    servers: [{ url: "https://api.mosbie.com" }],
    paths,
  });
});

// ---------- x402 PAYWALL ----------
const routes = {};
for (const [slug, t] of Object.entries(TASKS)) {
  const route = {
    accepts: [{ scheme: "exact", price: t.price, network: NETWORK_ID, payTo: BASE_WALLET_ADDRESS }],
    description: t.summary,
    mimeType: "application/json",
  };
  routes[`POST /v1/tasks/${slug}`] = route;
  routes[`GET /v1/tasks/${slug}`] = route;
}
app.use(paymentMiddleware(routes, resourceServer));

// ---------- PAID TASK ENDPOINTS (only reached after payment is verified) ----------
function validHttpUrl(v) {
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}

for (const [slug, t] of Object.entries(TASKS)) {
  app.all(`/v1/tasks/${slug}`, async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST with a JSON body." });
    }

    const body = req.body || {};
    const target = body[t.targetField];
    const { objective, reply_email, agent_callback_url } = body;

    // Validation failures return 400, so the payment is not settled.
    if (!t.validateTarget(target)) return res.status(400).json({ error: t.targetError });
    if (typeof objective !== "string" || objective.trim().length < 5 || objective.length > 2000) {
      return res.status(400).json({ error: "objective must be 5-2000 characters." });
    }
    const hasEmail =
      typeof reply_email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply_email.trim());
    const hasUrl = typeof agent_callback_url === "string" && validHttpUrl(agent_callback_url);
    if (reply_email !== undefined && !hasEmail) {
      return res.status(400).json({ error: "reply_email must be a valid email address." });
    }
    if (agent_callback_url !== undefined && !hasUrl) {
      return res.status(400).json({ error: "agent_callback_url must be a valid http(s) URL." });
    }
    if (!hasEmail && !hasUrl) {
      return res
        .status(400)
        .json({ error: "Provide reply_email or agent_callback_url so the result can be delivered." });
    }

    const taskId = "mos_" + crypto.randomBytes(5).toString("hex");

    await sendTelegram(
      `🚨 <b>NEW ${escapeHtml(t.price)} TASK (PAID): ${escapeHtml(slug)}</b>\n` +
        `🆔 <code>${taskId}</code>\n\n` +
        `📍 <b>${escapeHtml(t.targetField)}:</b> ${escapeHtml(target)}\n` +
        `🎯 <b>Objective:</b> ${escapeHtml(objective)}\n` +
        `✉️ <b>Reply email:</b> ${escapeHtml(hasEmail ? reply_email : "None")}\n` +
        `🔗 <b>Callback URL:</b> ${escapeHtml(hasUrl ? agent_callback_url : "None")}`
    );

    return res.status(200).json({
      success: true,
      task_id: taskId,
      task_status: "ACCEPTED",
      message: "Payment confirmed. A human has been notified and will complete this task.",
      expected_delivery: "Same day (South Africa Standard Time, UTC+2).",
    });
  });
}

app.listen(PORT, () => console.log(`Mosbie API running on port ${PORT} (${X402_NETWORK})`));
