const Anthropic = require("@anthropic-ai/sdk");

let client;

function getAnthropic() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

async function ask(systemPrompt, userMessage, options = {}) {
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: options.model || "claude-sonnet-4-20250514",
    max_tokens: options.maxTokens || 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  return response.content[0].text;
}

module.exports = { getAnthropic, ask };
