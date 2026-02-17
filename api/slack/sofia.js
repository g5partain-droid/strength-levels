const { postMessage } = require("../../lib/slack");
const { ask } = require("../../lib/anthropic");
const { getSupabase } = require("../../lib/supabase");

const SOFIA_SYSTEM_PROMPT = `You are Sofia, an AI product manager for the Strength Levels PWA app.
Your job is to triage user feedback into actionable tickets.

For each piece of feedback, you must return a JSON object with:
{
  "title": "Short descriptive title (max 80 chars)",
  "summary": "Clear description of what needs to happen (2-3 sentences)",
  "category": "bug|feature|ux|performance|content|other",
  "priority": "low|medium|high|critical"
}

Priority guidelines:
- critical: App crashes, data loss, security issues
- high: Core functionality broken, major UX pain points
- medium: Nice improvements, minor bugs that have workarounds
- low: Polish, nice-to-haves, cosmetic issues

Return ONLY the JSON object, no markdown, no explanation.`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth: Vercel cron header, or manual trigger via secret
  const cronHeader = req.headers.authorization;
  const manualSecret = req.headers["x-cron-secret"] || req.query?.secret;

  const isVercelCron = cronHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManualTrigger = manualSecret === process.env.CRON_SECRET;

  if (!isVercelCron && !isManualTrigger) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const supabase = getSupabase();

    // Get all new (untriaged) feedback (using actual column names)
    const { data: newFeedback, error } = await supabase
      .from("feedback")
      .select("*")
      .eq("status", "new")
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!newFeedback || newFeedback.length === 0) {
      return res.status(200).json({ message: "No new feedback to triage", count: 0 });
    }

    const results = [];

    for (const fb of newFeedback) {
      try {
        const userName = fb.slack_user_name || fb.slack_user || "Unknown";

        // Ask Sofia to triage
        const triageRaw = await ask(
          SOFIA_SYSTEM_PROMPT,
          `Feedback from ${userName}: "${fb.message}"`
        );

        // Parse Sofia's response
        const triage = JSON.parse(triageRaw.replace(/```json\n?|\n?```/g, "").trim());

        // Create ticket in Supabase
        const { data: ticket, error: ticketError } = await supabase
          .from("tickets")
          .insert({
            feedback_id: fb.id,
            title: triage.title,
            summary: triage.summary,
            category: triage.category,
            priority: triage.priority,
            status: "pending",
          })
          .select()
          .single();

        if (ticketError) throw ticketError;

        // Post ticket to Slack for review
        const priorityEmoji = {
          critical: "🔴",
          high: "🟠",
          medium: "🟡",
          low: "🟢",
        };

        const ticketMessage = [
          `${priorityEmoji[triage.priority] || "⚪"} *${triage.title}*`,
          `*Category:* ${triage.category} | *Priority:* ${triage.priority}`,
          `*Summary:* ${triage.summary}`,
          `*Original feedback:* "${fb.message}" — ${userName}`,
          ``,
          `_Reply "approved" to create a GitHub issue and Cursor prompt._`,
          `_Reply "dismissed" to skip._`,
          `\`ticket:${ticket.id}\``,
        ].join("\n");

        const slackResult = await postMessage(
          process.env.SOFIA_BOT_TOKEN,
          process.env.TICKETS_CHANNEL_ID,
          ticketMessage
        );

        // Save Sofia's Slack message ts for thread tracking
        if (slackResult.ok) {
          await supabase
            .from("tickets")
            .update({ sofia_slack_ts: slackResult.ts })
            .eq("id", ticket.id);
        }

        // Mark feedback as triaged
        await supabase
          .from("feedback")
          .update({ status: "triaged" })
          .eq("id", fb.id);

        results.push({ feedbackId: fb.id, ticketId: ticket.id, title: triage.title });
      } catch (fbErr) {
        console.error(`Sofia error processing feedback ${fb.id}:`, fbErr);
        results.push({ feedbackId: fb.id, error: fbErr.message });
      }
    }

    return res.status(200).json({
      message: `Triaged ${results.length} feedback items`,
      results,
    });
  } catch (err) {
    console.error("Sofia handler error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
};
