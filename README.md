# Strength Levels Feedback System

Three-agent Slack feedback pipeline. No Make.com. No polling. Event-driven.

## Agents

| Agent | Role | Trigger |
|-------|------|---------|
| **Dawn** | Responds warmly to feedback, logs to Supabase | New message in #feedback |
| **Sofia** | Triages feedback into categorized tickets | Weekly cron (Monday 9am) or manual |
| **Emma** | Creates Cursor prompts + GitHub Issues | Reply "approved" to Sofia's ticket |

## Architecture

```
Slack #feedback → Dawn (Vercel) → Supabase
                                     ↓
Cron/Manual → Sofia (Vercel) → Tickets in Supabase → Posts to #tickets
                                                          ↓
"approved" reply → Emma (Vercel) → GitHub Issue + Cursor Prompt
```

## Setup

### 1. Supabase Schema

Go to Supabase SQL Editor → paste contents of `supabase/migration.sql` → Run.

### 2. Slack Apps Configuration

For each bot (Dawn, Sofia, Emma), in the Slack App settings:

**Dawn (api.slack.com → Dawn app):**
- Event Subscriptions → Enable → Request URL: `https://your-vercel-domain.vercel.app/api/slack/dawn`
- Subscribe to bot events: `message.channels`
- OAuth Scopes: `chat:write`, `users:read`, `channels:history`

**Sofia:**
- No event subscriptions needed (triggered by cron/manual)
- OAuth Scopes: `chat:write`

**Emma (api.slack.com → Emma app):**
- Event Subscriptions → Enable → Request URL: `https://your-vercel-domain.vercel.app/api/slack/emma`
- Subscribe to bot events: `message.channels`
- OAuth Scopes: `chat:write`, `channels:history`

**Important:** Invite all three bots to both #feedback and #tickets channels.

### 3. Get Channel IDs

In Slack, right-click channel name → "View channel details" → scroll to bottom → copy Channel ID.

### 4. Vercel Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables, add all vars from `.env.example`.

### 5. Deploy

Push this folder's contents to your `strength-levels` repo (or the subfolder for the feedback system). Vercel auto-deploys.

### 6. Verify

1. Post in #feedback → Dawn should reply in thread within a few seconds
2. Hit Sofia manually: `curl -X POST https://your-domain.vercel.app/api/slack/sofia -H "x-cron-secret: YOUR_SECRET"`
3. Reply "approved" to Sofia's ticket message → Emma creates GitHub Issue

## Manual Sofia Trigger

```bash
# Via curl
curl -X POST https://your-domain.vercel.app/api/slack/sofia \
  -H "x-cron-secret: your-cron-secret-here"

# Via browser (GET)
https://your-domain.vercel.app/api/slack/sofia?secret=your-cron-secret-here
```

## File Structure

```
api/slack/
  dawn.js    — Event handler: feedback → warm reply + log
  sofia.js   — Cron/manual: triage new feedback → tickets
  emma.js    — Event handler: "approved" → GitHub Issue
lib/
  anthropic.js — Claude API client
  github.js    — GitHub Issue creation
  slack.js     — Signature verification + posting
  supabase.js  — Supabase client
supabase/
  migration.sql — Database schema
```
