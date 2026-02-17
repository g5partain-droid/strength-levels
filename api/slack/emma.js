const { verifySlackSignature, postMessage, getRawBody } = require("../../lib/slack");
const { ask } = require("../../lib/anthropic");
const { getSupabase } = require("../../lib/supabase");
const { createIssue } = require("../../lib/github");

export const config = {
  api: { bodyParser: false },
};

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

  try {
    const rawBody = await getRawBody(req);
    const body = JSON.parse(rawBody);

    // Handle Slack URL verification
    if (body.type === "url_verification") {
      return res.status(200).json({ challenge: body.challenge });
    }

    // Verify signature
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

      // Only process thread replies (not top-level messages)
      if (
        event.type !== "message" ||
        event.subtype ||
        event.bot_id ||
        !event.thread_ts
      ) {
        return res.status(200).json({ ok: true });
      }

      // Only process in tickets channel
      if (event.channel !== process.env.TICKETS_CHANNEL_ID) {
        return res.status(200).json({ ok: true });
      }

      const text = (event.text || "").toLowerCase().trim();

      // Check for approval or dismissal
      if (text !== "approved" && text !== "dismissed") {
        return res.status(200).json({ ok: true });
      }

      // Respond immediately
      res.status(200).json({ ok: true });

      // Process async
      if (text === "approved") {
        await processApproval(event);
      } else if (text === "dismissed") {
        await processDismissal(event);
      }
      return;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Emma handler error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
};

async function processApproval(event) {
  try {
    const supabase = getSupabase();

    // Find the ticket by Sofia's thread ts
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
        "⚠️ Couldn't find the ticket for this thread. It may have already been processed.",
        event.thread_ts
      );
      return;
    }

    if (ticket.status === "approved") {
      await postMessage(
        process.env.EMMA_BOT_TOKEN,
        event.channel,
        "✅ This ticket was already approved and has a GitHub issue.",
        event.thread_ts
      );
      return;
    }

    // Generate Cursor prompt
    const cursorPrompt = await ask(
      EMMA_SYSTEM_PROMPT,
      [
        `Ticket: ${ticket.title}`,
        `Summary: ${ticket.summary}`,
        `Category: ${ticket.category}`,
        `Priority: ${ticket.priority}`,
        `Original feedback: "${ticket.feedback?.message_text || "N/A"}"`,
        `From: ${ticket.feedback?.slack_user_name || "Unknown user"}`,
      ].join("\n")
    );

    // Create GitHub Issue
    const categoryLabel = ticket.category || "other";
    const priorityLabel = `priority:${ticket.priority || "medium"}`;

    const issueBody = [
      `## Ticket Info`,
      `- **Category:** ${ticket.category}`,
      `- **Priority:** ${ticket.priority}`,
      `- **Original Feedback:** "${ticket.feedback?.message_text || "N/A"}"`,
      `- **From:** ${ticket.feedback?.slack_user_name || "Unknown"}`,
      ``,
      `---`,
      ``,
      `## Cursor-Ready Prompt`,
      ``,
      cursorPrompt,
    ].join("\n");

    const issue = await createIssue(
      `[${ticket.category}] ${ticket.title}`,
      issueBody,
      [categoryLabel, priorityLabel]
    );

    // Update ticket in Supabase
    await supabase
      .from("tickets")
      .update({
        status: "approved",
        cursor_prompt: cursorPrompt,
        github_issue_url: issue.html_url,
        github_issue_number: issue.number,
      })
      .eq("id", ticket.id);

    // Update feedback status
    if (ticket.feedback_id) {
      await supabase
        .from("feedback")
        .update({ status: "approved" })
        .eq("id", ticket.feedback_id);
    }

    // Post confirmation in thread
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

    console.log(`Emma created GitHub issue #${issue.number} for ticket ${ticket.id}`);
  } catch (err) {
    console.error("Emma processApproval error:", err);
    await postMessage(
      process.env.EMMA_BOT_TOKEN,
      event.channel,
      `❌ Error creating GitHub issue: ${err.message}`,
      event.thread_ts
    );
  }
}

async function processDismissal(event) {
  try {
    const supabase = getSupabase();

    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, feedback_id")
      .eq("sofia_slack_ts", event.thread_ts)
      .single();

    if (ticket) {
      await supabase
        .from("tickets")
        .update({ status: "rejected" })
        .eq("id", ticket.id);

      if (ticket.feedback_id) {
        await supabase
          .from("feedback")
          .update({ status: "dismissed" })
          .eq("id", ticket.feedback_id);
      }
    }

    await postMessage(
      process.env.EMMA_BOT_TOKEN,
      event.channel,
      "🗑️ Ticket dismissed.",
      event.thread_ts
    );
  } catch (err) {
    console.error("Emma processDismissal error:", err);
  }
}
