const { verifySlackSignature, postMessage, getUserInfo, getRawBody } = require("../../lib/slack");
const { ask } = require("../../lib/anthropic");
const { getSupabase } = require("../../lib/supabase");

const DAWN_SYSTEM_PROMPT = `You are Dawn, a warm and supportive AI assistant for the Strength Levels app team. 
Your job is to acknowledge user feedback with genuine warmth and appreciation.

Guidelines:
- Be warm, encouraging, and grateful for their feedback
- Keep responses concise (2-3 sentences max)
- Acknowledge the specific feedback they gave
- Let them know their input helps improve the app
- Use a friendly, conversational tone (like a supportive teammate)
- Never be robotic or overly formal
- Don't promise specific timelines or features
- If they report a bug, empathize and assure them it's being tracked`;

// Disable Vercel body parsing so we can verify Slack signature
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawBody = await getRawBody(req);
    const body = JSON.parse(rawBody);

    console.log("Dawn received event type:", body.type);

    // Handle Slack URL verification challenge
    if (body.type === "url_verification") {
      return res.status(200).json({ challenge: body.challenge });
    }

    // Verify signature
    const signature = req.headers["x-slack-signature"];
    const timestamp = req.headers["x-slack-request-timestamp"];

    if (
      !verifySlackSignature(
        process.env.DAWN_SIGNING_SECRET,
        signature,
        timestamp,
        rawBody
      )
    ) {
      console.log("Dawn: signature verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Handle event callback
    if (body.type === "event_callback") {
      const event = body.event;

      console.log("Dawn event:", event.type, "channel:", event.channel, "subtype:", event.subtype, "bot_id:", event.bot_id, "thread_ts:", event.thread_ts);

      // Only process messages - ignore bot messages, edits, and thread replies
      if (
        event.type !== "message" ||
        event.subtype ||
        event.bot_id ||
        event.thread_ts
      ) {
        console.log("Dawn: skipping - filtered out");
        return res.status(200).json({ ok: true });
      }

      // Only process messages in the feedback channel
      if (event.channel !== process.env.FEEDBACK_CHANNEL_ID) {
        console.log("Dawn: skipping - wrong channel. Got:", event.channel, "Expected:", process.env.FEEDBACK_CHANNEL_ID);
        return res.status(200).json({ ok: true });
      }

      console.log("Dawn: processing feedback from", event.user);

      // Respond immediately to Slack (3s timeout requirement)
      res.status(200).json({ ok: true });

      // Process async
      await processFeedback(event);
      return;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Dawn handler error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};

async function processFeedback(event) {
  try {
    const supabase = getSupabase();

    // Check if we already processed this message (idempotency)
    const { data: existing } = await supabase
      .from("feedback")
      .select("id")
      .eq("slack_message_ts", event.ts)
      .single();

    if (existing) {
      console.log("Dawn: already processed this message");
      return;
    }

    // Get user info for a personal touch
    const user = await getUserInfo(process.env.DAWN_BOT_TOKEN, event.user);
    const userName = user?.real_name || user?.name || "there";

    console.log("Dawn: generating response for", userName);

    // Generate Dawn's response
    const dawnResponse = await ask(
      DAWN_SYSTEM_PROMPT,
      `Feedback from ${userName}: "${event.text}"`
    );

    console.log("Dawn: posting response to thread");

    // Post response in thread
    await postMessage(
      process.env.DAWN_BOT_TOKEN,
      event.channel,
      dawnResponse,
      event.ts // reply in thread
    );

    // Log to Supabase
    await supabase.from("feedback").insert({
      slack_message_ts: event.ts,
      slack_channel_id: event.channel,
      slack_user_id: event.user,
      slack_user_name: userName,
      message_text: event.text,
      dawn_response: dawnResponse,
      status: "new",
    });

    console.log("Dawn: done processing feedback from", userName);
  } catch (err) {
    console.error("Dawn processFeedback error:", err);
  }
}
