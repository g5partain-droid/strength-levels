const { verifySlackSignature, postMessage, getRawBody } = require("../../lib/slack");
const { ask } = require("../../lib/anthropic");
const { getSupabase } = require("../../lib/supabase");
const { createIssue } = require("../../lib/github");

const EMMA_SYSTEM_PROMPT = `You are Emma, an AI engineering lead for the Strength Levels PWA app.
Your job is to take an approved ticket and create a Cursor-ready implementation prompt.

The prompt should be specific enough that a developer using Cursor AI can paste it in and start coding.

Structure your prompt like this:

## Task
[One-line description]

## Context
[What the user reported and why this matters]

## Implementation Plan
1. [Step 1 with specific file paths if known]
2. [Step 2]
3. [Step 3]

## Acceptance Criteria
- [ ] [Specific testable criterion]
- [ ] [Another criterion]

## Tech Stack Notes
- This is a PWA (Progressive Web App)
- Frontend stack: [infer from context or say "check repo"]
- Consider offline support implications

Keep it actionable and specific. No fluff.`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Ignore Slack retries
  if (req.headers["x-slack-retry-num"]) {
    return res.status(200).json({ ok: true });
  }

  try {
    const rawBody = await getRawBody(req);
    const body = JSON.parse(rawBody);

    if (body.type === "url_verification") {
      return res.status(200).json({ challenge: body.challenge });
    }

    const signature = req.headers["x-slack-signature"];
    const timestamp = req.headers["x-slack-request-timestamp"];

    if (
      !verifySlackSignature(
        process.env.EMMA_SIGNING_SECRET,
        signature,
        timestamp,
        rawBody
      )
    ) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    if (body.type === "event_callback") {
      const event = body.event;

      console.log("Emma event:", event.type, "channel:", event.channel, "thread_ts:", event.thread_ts);

      if (
        event.type !== "message" ||
        event.subtype ||
        event.bot_id ||
        !event.thread_ts
      ) {
        return res.status(200).json({ ok: true });
      }

      if (event.channel !== process.env.TICKETS_CHANNEL_ID) {
        return res.status(200).json({ ok: true });
      }

      const text = (event.text || "").toLowerCase().trim();

      if (text !== "approved" && text !== "dismissed") {
        return res.status(200).json({ ok: true });
      }

      // Process BEFORE responding
      try {
        if (text === "approved") {
          await processApproval(event);
        } else {
          await processDismissal(event);
        }
      } catch (processErr) {
        console.error("Emma processing error:", processErr);
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Emma handler error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};

async function processApproval(event) {
  const supabase = getSupabase();

  const { data: ticket, error } = await supabase
    .from("tickets")
    .select("*, feedback(*)")
    .eq("sofia_slack_ts", event.thread_ts)
    .single();

  if (error || !ticket) {
    console.error("Ticket not found for thread:", event.thread_ts);
    await postMessage(
      process.env.EMMA_BOT_TOKEN,
      event.channel,
      "⚠️ Couldn't find the ticket for this thread.",
      event.thread_ts
    );
    return;
  }

  if (ticket.status === "approved") {
    await postMessage(
      process.env.EMMA_BOT_TOKEN,
      event.channel,
      "✅ Already approved.",
      event.thread_ts
    );
    return;
  }

  console.log("Emma: generating cursor prompt for", ticket.title);

  const cursorPrompt = await ask(
    EMMA_SYSTEM_PROMPT,
    [
      `Ticket: ${ticket.title}`,
      `Summary: ${ticket.summary}`,
      `Category: ${ticket.category}`,
      `Priority: ${ticket.priority}`,
      `Original feedback: "${ticket.feedback?.message || "N/A"}"`,
      `From: ${ticket.feedback?.slack_user_name || ticket.feedback?.slack_user || "Unknown user"}`,
    ].join("\n")
  );

  const categoryLabel = ticket.category || "other";
  const priorityLabel = `priority:${ticket.priority || "medium"}`;

  const issueBody = [
    `## Ticket Info`,
    `- **Category:** ${ticket.category}`,
    `- **Priority:** ${ticket.priority}`,
    `- **Original Feedback:** "${ticket.feedback?.message || "N/A"}"`,
    `- **From:** ${ticket.feedback?.slack_user_name || ticket.feedback?.slack_user || "Unknown"}`,
    ``,
    `---`,
    ``,
    `## Cursor-Ready Prompt`,
    ``,
    cursorPrompt,
  ].join("\n");

  console.log("Emma: creating GitHub issue");

  const issue = await createIssue(
    `[${ticket.category}] ${ticket.title}`,
    issueBody,
    [categoryLabel, priorityLabel]
  );

  await supabase
    .from("tickets")
    .update({
      status: "approved",
      cursor_prompt: cursorPrompt,
      github_issue_url: issue.html_url,
      github_issue_number: issue.number,
    })
    .eq("id", ticket.id);

  if (ticket.feedback_id) {
    await supabase
      .from("feedback")
      .update({ status: "approved" })
      .eq("id", ticket.feedback_id);
  }

  const confirmMessage = [
    `✅ *Approved and shipped to GitHub!*`,
    ``,
    `📋 *GitHub Issue:* <${issue.html_url}|#${issue.number} - ${ticket.title}>`,
    ``,
    `🤖 *Cursor Prompt:*`,
    "```",
    cursorPrompt,
    "```",
  ].join("\n");

  await postMessage(
    process.env.EMMA_BOT_TOKEN,
    event.channel,
    confirmMessage,
    event.thread_ts
  );

  console.log("Emma: done! GitHub issue #" + issue.number);
}

async function processDismissal(event) {
  const supabase = getSupabase();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, feedback_id")
    .eq("sofia_slack_ts", event.thread_ts)
    .single();

  if (ticket) {
    await supabase.from("tickets").update({ status: "rejected" }).eq("id", ticket.id);
    if (ticket.feedback_id) {
      await supabase.from("feedback").update({ status: "dismissed" }).eq("id", ticket.feedback_id);
    }
  }

  await postMessage(
    process.env.EMMA_BOT_TOKEN,
    event.channel,
    "🗑️ Ticket dismissed.",
    event.thread_ts
  );
}
