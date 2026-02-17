const crypto = require("crypto");

/**
 * Verify Slack request signature
 */
function verifySlackSignature(signingSecret, signature, timestamp, rawBody) {
  // Reject requests older than 5 minutes
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBasestring, "utf8")
      .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(mySignature, "utf8"),
    Buffer.from(signature, "utf8")
  );
}

/**
 * Post a message to Slack
 */
async function postMessage(botToken, channel, text, threadTs = null) {
  const body = {
    channel,
    text,
    ...(threadTs && { thread_ts: threadTs }),
  };

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("Slack postMessage error:", data.error);
  }
  return data;
}

/**
 * Get user info from Slack
 */
async function getUserInfo(botToken, userId) {
  const res = await fetch(
    `https://slack.com/api/users.info?user=${userId}`,
    {
      headers: { Authorization: `Bearer ${botToken}` },
    }
  );
  const data = await res.json();
  return data.ok ? data.user : null;
}

/**
 * Parse raw body from Vercel request
 */
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = {
  verifySlackSignature,
  postMessage,
  getUserInfo,
  getRawBody,
};
