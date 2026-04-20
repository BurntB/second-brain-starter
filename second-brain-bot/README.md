# Second Brain Bot

A personal knowledge graph + Telegram bot that sends you pre-call briefings, morning digests, and overdue alerts. Built on Notion (the source of truth), Anthropic scheduled triggers (the cloud cron), and a small local Node bot (for the manual Telegram commands like `/context` and `/sync-memory`).

The cloud triggers handle most of the autopilot work — briefings, digests, Slack sync, document indexing. The local Node bot adds a few on-demand commands and a nightly sync of your Claude Code auto-memory into Notion so the bot can answer strategic/historical questions without being limited to things that happened on Granola or Slack.

## Prerequisites

Before you touch any code:

- **Claude.ai account** with the MCP connectors for **Notion**, **Google Calendar**, **Granola** (optional), and **Slack** (optional but strongly recommended). Connect them at https://claude.ai/settings/connectors.
- **Claude Code CLI** installed locally — https://claude.com/claude-code
- **Node.js 20+** and npm (only for the local bot bits; the scheduled triggers run in Anthropic's cloud)
- **Telegram bot**: message `@BotFather` → `/newbot` → save the token. Message your new bot once, then message `@userinfobot` to get your chat ID.
- **Notion workspace** where you can create databases (free tier is fine)

## Step 1 — Have Claude Code set up your Notion + scheduled triggers

This is the heavy lifting. You do it once.

1. Open a Claude Code session in the directory you plan to keep the bot in.
2. Paste the contents of `../SETUP-AGENT-PROMPT.md` into Claude and say: **"Set up my Second Brain using this blueprint."**
3. Answer Claude's questions (your name, timezone, Telegram bot token, chat ID, which Slack channels to watch, etc.).
4. Claude will:
   - Create 8 Notion databases under a new "Second Brain" page (People, Commitments, Meetings, Sessions, Documents, Outbox, Sync State, Context)
   - Create the scheduled triggers in Anthropic's cloud (Pre-Call Briefing × 2, Morning Digest, Overdue Alert, Granola Sync, Slack Sync, Document Refresh, Q&A, DST Reminder)
   - Generate a `CLAUDE.md` snippet for your global Claude Code config so future sessions auto-sync into your graph
   - Hand you the 8 `data_source_id` values at the end — **save these**, you need them for the local bot

At this point you already have a working bot. The rest of this README is optional — only needed if you want the local Telegram slash commands and the local-memory → Notion sync.

## Step 2 — (Optional) Run the local Node bot

The cloud triggers handle scheduled work. The local bot adds:

- `/briefing` — on-demand pre-call briefing for your next meeting
- `/digest` — on-demand morning digest
- `/open` — list every open commitment
- `/context Name` — everything known about a person (role, commitments, notes)
- `/add Name | Task | Direction | Priority` — quick commitment capture from your phone
- `/sync-memory` — push your local Claude Code auto-memory into Notion's Context DB (also runs nightly at 3 AM local)
- `/help` — list commands

Setup:

```bash
cd second-brain-bot
cp .env.example .env
# edit .env and fill in your tokens + the 3 Notion data_source_id values you saved
npm install
node index.js
```

You should see `Second Brain Bot running.` in the console. Message your bot `/help` to confirm.

To keep it running after you close the terminal, use a process manager:

```bash
# macOS launchd (survives reboots, auto-restarts)
# see https://www.launchd.info/ for writing a plist, or:
npm install -g pm2
pm2 start index.js --name second-brain
pm2 save && pm2 startup
```

## Step 3 — Try it

- Send yourself a test message: the bot should already be getting them from the cloud triggers (Pre-Call Briefings check every hour during business hours, Morning Digest at 8:30 AM local on weekdays, Overdue Alert at 6 PM local on weekdays).
- From your phone: send `/help` to the bot. You should get the command list.
- From your phone: send `/context SomeoneYouKnow` — if they're in your People DB you'll get their full profile back.

## How the pieces fit

```
┌────────────────┐   ┌─────────────────────────┐   ┌────────────────┐
│ Granola        │──▶│                         │──▶│ Pre-call brief │
│ Google Cal     │──▶│   Notion (8 DBs)        │──▶│ Morning digest │
│ Slack          │──▶│                         │──▶│ Overdue alert  │
│ Claude Code    │──▶│   ← Source of truth     │──▶│ Debriefs       │
│ Local memory   │──▶│                         │──▶│ Q&A replies    │
└────────────────┘   └─────────────────────────┘   └────────────────┘
                              ▲                            │
                              │                            ▼
              ┌───────────────┴──────────┐        ┌────────────────┐
              │ Anthropic RemoteTriggers │        │ Outbox DB      │
              │ (cloud cron)             │        │ (queue)        │
              └──────────────────────────┘        └───────┬────────┘
                                                          │
                                                          ▼
                                                     Telegram
```

- **Scheduled triggers run in Anthropic's cloud** and read/write Notion directly via MCP
- **All delivery** goes through the Outbox DB, which an n8n (or similar) workflow drains into Telegram
- **The local Node bot** polls Telegram for incoming slash commands and also runs the memory sync

## Troubleshooting

**I'm not getting briefings.**
Check if the trigger is enabled: open Claude Code's Remote Triggers list (or use the `RemoteTrigger` MCP) and confirm `enabled: true`. Six days of silence usually means someone flipped it off.

**`/context` says "No one matching X in People DB."**
Expected if no Granola meeting or Slack message has introduced that person yet. Use `/add` or add them in Notion manually.

**Morning Digest runs but nothing arrives in Telegram.**
Your Outbox → Telegram forwarder is down. Check the n8n workflow that drains the Outbox. Entries may be sitting there with `Sent=__NO__`.

**Memory sync fails with "NOTION_CONTEXT_DB not set".**
You skipped filling that value in `.env`. It's the Context DB data_source_id from Step 1.

## Files

- `index.js` — the Telegram bot + local cron schedules
- `briefing.js` — LLM prompt construction for briefings and digests
- `calendar-client.js` — Google Calendar wrapper
- `notion-client.js` — Notion MCP/API wrapper with helpers for People, Commitments, Context
- `memory-sync.js` — nightly sync of local Claude Code auto-memory into Notion Context DB
- `../SETUP-AGENT-PROMPT.md` — the blueprint Claude Code follows to set up your Notion DBs and scheduled triggers

## Attribution

Originally built by [Burnt](https://github.com/BurntB) as a personal tool. Forked and shared with friends on request. Not officially supported — if something breaks, you own the fix.
