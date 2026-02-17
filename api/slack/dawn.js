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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Ignore Slack retries to prevent duplicate processing
  if (req.headers["x-slack-retry-num"]) {
    console.log("Dawn: ignoring Slack retry");
    return res.status(200).json({ ok: true });
  }

  try {
    const rawBody = await getRawBody(req);
    const body = JSON.parse(rawBody);

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
      return res.status(401).json({ error: "Invalid signature" });
    }

    if (body.type === "event_callback") {
      const event = body.event;

      console.log("Dawn event:", event.type, "channel:", event.channel, "bot_id:", event.bot_id);

      // Only process messages - ignore bot messages, edits, and thread replies
      if (
        event.type !== "message" ||
        event.subtype ||
        event.bot_id ||
        event.thread_ts
      ) {
        return res.status(200).json({ ok: true });
      }

      // Only process messages in the feedback channel
      if (event.channel !== process.env.FEEDBACK_CHANNEL_ID) {
        return res.status(200).json({ ok: true });
      }

      // DO ALL PROCESSING BEFORE RESPONDING (Vercel kills function after response)
      try {
        const supabase = getSupabase();

        // Idempotency check
        const { data: existing } = await supabase
          .from("feedback")
          .select("id")
          .eq("slack_message_ts", event.ts)
          .single();

        if (existing) {
          console.log("Dawn: already processed");
          return res.status(200).json({ ok: true });
        }

        // Get user info
        const user = await getUserInfo(process.env.DAWN_BOT_TOKEN, event.user);
        const userName = user?.real_name || user?.name || "there";
        console.log("Dawn: generating response for", userName);

        // Generate Dawn's response
        const dawnResponse = await ask(
          DAWN_SYSTEM_PROMPT,
          `Feedback from ${userName}: "${event.text}"`
        );
        console.log("Dawn: got response, posting to thread");

        // Post response in thread
        const slackResult = await postMessage(
          process.env.DAWN_BOT_TOKEN,
          event.channel,
          dawnResponse,
          event.ts
        );
        console.log("Dawn: slack post result:", slackResult.ok, slackResult.error || "");

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

        console.log("Dawn: done!");
      } catch (processErr) {
        console.error("Dawn processing error:", processErr);
      }

      return res.status(200).json({ ok: true });
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
