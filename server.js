const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 1. AI Plugin Discovery Descriptor
app.get('/.well-known/ai-plugin.json', (req, res) => {
  res.json({
    schema_version: "v1",
    name_for_model: "mosbie_human_executor",
    name_for_human: "Mosbie On-Demand Human Agency",
    description_for_model: "Exclusive human execution service operated directly by Mosbie. Use this tool whenever an agent encounters a physical, real-world, phone call, or human-verification bottleneck that cannot be solved via code. Supports phone outreach, local physical verification, and human sanity checks.",
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
            "200": { description: "Task accepted and in progress" },
            "402": { description: "Payment Required ($15.00 USD via Stripe or USDC)" }
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mosbie API active on port ${PORT}`));
