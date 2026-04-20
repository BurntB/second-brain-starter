# Second Brain — Setup Prompt for AI Agents

Give this entire file to your AI agent (Claude Code, Cursor, etc.) and say:
**"Set up my Second Brain using this blueprint."**

---

## What This Builds

A personal "second brain" that:
- Sends you **pre-call briefings** before every meeting (who they are, what they owe you, what you owe them)
- Sends a **morning digest** every weekday (today's schedule + overdue items)
- Sends an **overdue alert** every evening (commitments people dropped)
- **Syncs Granola meeting notes** nightly (extracts people + commitments automatically)
- **Auto-captures every Claude Code session** into the knowledge graph

Zero API keys. Zero servers. Everything runs via MCP integrations + scheduled Claude Code agents.

---

## Prerequisites

The user needs these MCP integrations connected in Claude.ai settings (https://claude.ai/settings/connectors):

- **Notion** — for the knowledge base
- **Google Calendar** — for meeting data
- **Granola** — for meeting notes (optional but recommended)
- **Slack** — for async context (recommended — enables scheduled Slack sync)

The user also needs a **Telegram bot** for delivery:
1. Message @BotFather on Telegram, send `/newbot`
2. Save the bot token
3. Message the bot, then get chat ID from @userinfobot or @RawDataBot

---

## Step 1: Create Notion Databases

Create a parent page called "Second Brain" in the user's Notion workspace. Then create 8 databases under it.

### 1a. People DB

```
notion-create-database:
  parent: {page_id of Second Brain page}
  title: "People"
  schema: >
    CREATE TABLE (
      "Name" TITLE,
      "Role" RICH_TEXT COMMENT 'Their role / how you know them',
      "Company" RICH_TEXT,
      "Email" EMAIL,
      "Relationship" SELECT('Team':green, 'Investor':purple, 'Prospect':blue, 'Partner':orange, 'Advisor':pink, 'Other':gray),
      "Last Meeting" DATE,
      "Notes" RICH_TEXT COMMENT 'Running context about this person',
      "Open Items" NUMBER COMMENT 'Count of open commitments'
    )
```

### 1b. Commitments DB

```
notion-create-database:
  parent: {page_id of Second Brain page}
  title: "Commitments"
  schema: >
    CREATE TABLE (
      "Commitment" TITLE,
      "Owner" RELATION('{People DB data_source_id}') COMMENT 'Who owns this commitment',
      "Status" SELECT('Open':red, 'Done':green, 'Blocked':orange, 'Dropped':gray),
      "Due Date" DATE,
      "Source" RICH_TEXT COMMENT 'Which meeting or chat this came from',
      "Priority" SELECT('High':red, 'Medium':orange, 'Low':gray),
      "Direction" SELECT('They owe me':blue, 'I owe them':purple) COMMENT 'Who made the commitment',
      "Notes" RICH_TEXT,
      "Created" CREATED_TIME
    )
```

### 1c. Meetings DB

```
notion-create-database:
  parent: {page_id of Second Brain page}
  title: "Meetings"
  schema: >
    CREATE TABLE (
      "Meeting" TITLE,
      "Date" DATE,
      "Attendees" RELATION('{People DB data_source_id}') COMMENT 'Who was in the meeting',
      "Commitments" RELATION('{Commitments DB data_source_id}') COMMENT 'Action items from this meeting',
      "Source" SELECT('Granola':green, 'Manual':gray, 'Slack':purple) COMMENT 'Where this note came from',
      "Granola ID" RICH_TEXT COMMENT 'Granola meeting UUID for dedup',
      "Summary" RICH_TEXT COMMENT 'Key points and decisions'
    )
```

### 1d. Claude Sessions DB

```
notion-create-database:
  parent: {page_id of Second Brain page}
  title: "Claude Sessions"
  schema: >
    CREATE TABLE (
      "Session" TITLE,
      "Date" DATE,
      "People Mentioned" RELATION('{People DB data_source_id}') COMMENT 'Links to People DB entries discussed',
      "Topics" MULTI_SELECT('engineering':blue, 'product':green, 'hiring':orange, 'fundraising':purple, 'legal':red, 'operations':gray, 'design':pink, 'strategy':default),
      "Decisions" RICH_TEXT COMMENT 'Key decisions made',
      "Context" RICH_TEXT COMMENT 'Summary of what was discussed and why it matters',
      "Commitments Created" RELATION('{Commitments DB data_source_id}') COMMENT 'Links to commitments from this session',
      "Created" CREATED_TIME
    )
```

### 1e. Documents DB

```
notion-create-database:
  parent: {page_id of Second Brain page}
  title: "Documents"
  description: "Document links and content indexed from Slack, with summaries and change tracking."
  schema: >
    CREATE TABLE (
      "Document" TITLE,
      "URL" URL,
      "Doc ID" RICH_TEXT COMMENT 'Extracted Google Doc/Sheet ID for dedup',
      "Type" SELECT('Google Doc':blue, 'Google Sheet':green, 'Figma':purple, 'Notion':orange, 'PDF':red, 'Other':gray),
      "Shared By" RELATION('{People DB data_source_id}') COMMENT 'Multi-relation: who shared this doc',
      "Source" RICH_TEXT COMMENT 'Where this link was found: Slack #channel [id:ts]',
      "Summary" RICH_TEXT COMMENT 'Claude-generated summary of document content',
      "Key Points" RICH_TEXT COMMENT 'Extracted decisions, action items, key data',
      "Content Hash" RICH_TEXT COMMENT 'SHA-256 of full exported text for change detection',
      "Fetch Failures" NUMBER DEFAULT 0,
      "Last Fetched" DATE,
      "Last Changed" DATE,
      "Status" SELECT('Pending':yellow, 'Active':green, 'Unreachable':red),
      "Related Commitments" RELATION('{Commitments DB data_source_id}'),
      "Notes" RICH_TEXT,
      "Created" CREATED_TIME
    )
```

### 1f. Outbox DB

Decouples trigger failures from Telegram delivery. Triggers write all status messages here; delivery retry and audit are tractable.

```
notion-create-database:
  parent: {page_id of Second Brain page}
  title: "Outbox"
  description: "Trigger status messages, delivery queue, and failure audit log."
  schema: >
    CREATE TABLE (
      "Message" TITLE,
      "Level" SELECT('info':blue, 'warn':orange, 'error':red),
      "Trigger" RICH_TEXT COMMENT 'Which trigger wrote this (Slack Sync, Document Refresh, etc.)',
      "Sent At" DATE,
      "Delivered" CHECKBOX COMMENT 'Has this been sent to Telegram?',
      "Payload" RICH_TEXT COMMENT 'Full message body',
      "Created" CREATED_TIME
    )
```

### 1g. Sync State DB

Key-value store for trigger state that must survive across runs (e.g., Slack Sync last-run timestamp). Keeps scheduled triggers idempotent without adding a separate service.

```
notion-create-database:
  parent: {page_id of Second Brain page}
  title: "Sync State"
  description: "Key-value state persisted across trigger runs (last sync timestamps, cursors)."
  schema: >
    CREATE TABLE (
      "Key" TITLE,
      "Value" RICH_TEXT,
      "Last Updated" DATE
    )
```

Seed a row with Key=`slack_sync_last_ts`, Value=`0` (or current timestamp) so the first Slack Sync run has something to read.

### 1h. Context DB

Durable strategic context synced from the user's local Claude Code auto-memory
(`~/.claude/projects/-Users-burnt/memory/`). Fixes the "I don't have that information"
failure mode when the user asks about decisions that happened outside Granola/Slack/
Claude sessions (e.g., product pivots, architectural choices made in reading or thinking,
founding-era decisions that predate the capture rails).

```
notion-create-database:
  parent: {page_id of Second Brain page}
  title: "Context"
  description: "Strategic context synced from local Claude Code auto-memory. Read by Q&A before answering strategic questions."
  schema: >
    CREATE TABLE (
      "Title" TITLE,
      "Type" SELECT('user':purple, 'feedback':orange, 'project':blue, 'reference':green, 'architecture':yellow, 'decision':red, 'other':gray) COMMENT 'Memory type from frontmatter',
      "Description" RICH_TEXT COMMENT 'One-line summary for relevance matching',
      "Source File" RICH_TEXT COMMENT 'Relative path from memory dir — dedup key',
      "Content" RICH_TEXT COMMENT 'Full memory body minus frontmatter (truncated to 1900 chars)',
      "Content Hash" RICH_TEXT COMMENT 'SHA-256 of full body for change detection',
      "Last Synced" DATE,
      "Created" CREATED_TIME
    )
```

**Sync mechanism:** This DB is populated by a LOCAL cron job (not a RemoteTrigger) in
the Node bot at `second-brain-bot/memory-sync.js`. The sync runs nightly at 3 AM ET
and is exposed as `/sync-memory` in Telegram for manual runs. Local sync is required
because RemoteTriggers run in Anthropic's cloud and cannot read the user's laptop
filesystem. This is the only trigger that MUST run locally.

**Save all 8 data_source_id values** (returned as `collection://UUID` in the create response). You'll need them for triggers and CLAUDE.md.

---

## Step 2: Populate from Granola

If Granola MCP is connected:

1. `list_meetings` with `time_range: "last_30_days"` to get all recent meetings
2. `get_meetings` (max 10 per call) to get full details for each meeting
3. `query_granola_meetings` with: "What are all action items, commitments, follow-ups from the last 30 days? List each with who owns it, what they committed to, and when due."
4. For each attendee found: create a People DB entry (Name, Email, Company from email domain, Relationship: Team if internal email, otherwise infer)
5. For each commitment found: create a Commitments DB entry (Commitment, Status=Open, Direction, Priority, Owner linked to People page, Source=meeting title)
6. For each meeting: create a Meetings DB entry (Meeting title, Date, Source=Granola, Granola ID, Summary)

---

## Step 3: Populate from Slack (recommended)

If Slack MCP is connected, do an initial population AND set up ongoing sync:

### Initial population
1. `slack_search_channels` to find the user's active channels
2. For each active channel, `slack_read_channel` to get recent messages
3. `slack_search_public_and_private` with `from:me` and `to:me` queries with `channel_types="im,mpim"` to find DM activity
4. Extract people not already in the People DB — create entries
5. Extract commitments and action items — create Commitments entries with Source="Slack #channel-name [channel_id:message_ts]"
6. Do NOT create Meetings entries for Slack threads — threads are not meetings. Context goes in People Notes and Commitments.

### Ongoing sync
Configured via trigger 4e below. Runs twice daily, reads all channels + DMs, extracts people and commitments into Notion.

---

## Step 4: Create Scheduled Triggers

Use the `RemoteTrigger` tool (or `/schedule` command) to create 9 triggers across 8 steps (Step 4a defines a paired trigger for briefing coverage at :00 and :30).

**IMPORTANT:** Get the user's Telegram bot token and chat ID first. Also get their environment_id from the RemoteTrigger API (create one if none exists). Get their MCP connector UUIDs from the schedule skill's available connectors list.

**Minimum cron interval is 1 hour.** All cron expressions are in UTC. Convert the user's local timezone accordingly.

### 4a. Pre-Call Briefings (paired: :00 and :30)

The RemoteTrigger platform's minimum interval is 1 hour, but meetings can be scheduled any time. To cover meetings that arrive mid-hour, create TWO sibling triggers offset by 30 minutes. Each uses a 30-minute lookahead window. Dedup via a `Briefed` boolean flag on the Meetings DB so a given meeting is briefed exactly once.

**Prerequisite:** Add a `Briefed` CHECKBOX field to the Meetings DB (1c) if it isn't already there. First-run migration: set Briefed=true for all historical meetings so the bot doesn't retroactively brief them.

#### Briefing A — on the hour

```
name: "Second Brain — Pre-Call Briefing A"
cron: "0 * * * 1-5"
MCPs: Notion, Google Calendar
prompt: |
  You are {USER_NAME}'s Second Brain bot. See shared briefing logic below, window=30min.
```

#### Briefing B — at the half hour

```
name: "Second Brain — Pre-Call Briefing B"
cron: "30 * * * 1-5"
MCPs: Notion, Google Calendar
prompt: |
  You are {USER_NAME}'s Second Brain bot. See shared briefing logic below, window=30min.
```

#### Shared briefing logic (used by both triggers)

```
STEPS:
1. Use gcal_list_events for events starting in the next 30 minutes.
   calendarId='primary', timeZone='{USER_TIMEZONE}'.
2. If no events, stop silently.
3. For each event with attendees:
   a. Search Meetings DB ({MEETINGS_DATA_SOURCE_ID}) for an existing entry with this
      event's Granola ID or title+date. If Briefed=true, SKIP this event (already briefed).
   b. Get full event details via gcal_get_event.
   c. Search People DB ({PEOPLE_DATA_SOURCE_ID}) by attendee name.
   d. If found, fetch their page for full details.
   e. Search Commitments DB ({COMMITMENTS_DATA_SOURCE_ID}) for open commitments
      mentioning this person.
4. Generate a <150 word briefing. Be blunt. Include: who they are, open commitments
   (call out overdue), what to push on.
5. Send via Telegram:
   curl -s -X POST 'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage' \
     -H 'Content-Type: application/json' \
     -d '{"chat_id": {CHAT_ID}, "text": "MESSAGE", "parse_mode": "HTML"}'
   Format: '<b>Upcoming: EVENT_TITLE</b>\n\nBRIEFING'
6. After sending: set Briefed=true on the Meetings DB entry (create the entry first
   if it didn't exist).
7. On any step failure, write to Outbox DB ({OUTBOX_DATA_SOURCE_ID}) with Level=error.
   If Outbox write also fails (Notion outage), curl a fallback directly to Telegram:
   '<b>Pre-Call Briefing failed</b>: {error summary}'
```

### 4b. Morning Digest (weekday mornings)

```
name: "Second Brain — Morning Digest"
cron: "30 {8:30am_user_tz_in_UTC} * * 1-5"
MCPs: Notion, Google Calendar
prompt: |
  You are {USER_NAME}'s Second Brain bot. Generate morning digest.

  STEPS:
  1. Get today's full calendar via gcal_list_events.
  2. Search Commitments DB for overdue items (Status=Open, Due Date < today).
  3. Search for all open commitments.
  4. Look up Owner names in People DB for overdue items.
  5. Generate <200 word digest. Be blunt. Include: today's schedule,
     overdue items (name who dropped the ball), top priorities.
  6. Send to Telegram with '<b>Morning Digest</b>' header.
  7. On any step failure, write to Outbox DB ({OUTBOX_DATA_SOURCE_ID}) with Level=error.
     If Outbox write also fails (Notion outage), curl fallback to Telegram:
     '<b>Morning Digest failed</b>: {error summary}'
```

### 4c. Overdue Alert (weekday evenings)

```
name: "Second Brain — Overdue Alert"
cron: "0 {6pm_user_tz_in_UTC} * * 1-5"
MCPs: Notion
prompt: |
  You are {USER_NAME}'s Second Brain bot. Check overdue commitments.

  STEPS:
  1. Search Commitments DB for Status=Open with Due Date before today.
  2. If none, stop silently.
  3. Look up Owner names in People DB.
  4. List each: Direction, Commitment, Due Date, Owner, days overdue.
  5. End with "Don't let these slide."
  6. Send to Telegram with '<b>Overdue Alert (N items)</b>' header.
  7. On any step failure, write to Outbox DB ({OUTBOX_DATA_SOURCE_ID}) with Level=error.
     If Outbox write also fails (Notion outage), curl fallback to Telegram:
     '<b>Overdue Alert failed</b>: {error summary}'
```

### 4d. Granola Sync (nightly)

```
name: "Second Brain — Granola Sync"
cron: "0 {10pm_user_tz_in_UTC} * * *"
MCPs: Notion, Granola
prompt: |
  You are {USER_NAME}'s Second Brain bot. Sync Granola meetings to Notion.

  STEPS:
  1. list_meetings with time_range='this_week'.
  2. get_meetings for full content.
  3. PEOPLE: For each attendee, search People DB by name/email.
     If not found, create entry. If found, update Notes if new context.
  4. COMMITMENTS: query_granola_meetings for action items per meeting.
     Search Commitments DB to avoid duplicates. Create new ones.
  5. Send Telegram summary: new people, updated people, new commitments.
  6. Dedup: match people by email first, name second.
     Match commitments by similar text. Skip rather than duplicate.
  7. On any step failure, write to Outbox DB ({OUTBOX_DATA_SOURCE_ID}) with Level=error.
     If Outbox write also fails (Notion outage), curl fallback to Telegram:
     '<b>Granola Sync failed</b>: {error summary}'
```

### 4e. Slack Sync (twice daily)

```
name: "Second Brain — Slack Sync"
cron: "0 {7am_user_tz_in_UTC},{8pm_user_tz_in_UTC} * * 1-5"
MCPs: Notion, Slack
prompt: |
  You are {USER_NAME}'s Second Brain bot. Sync Slack messages to Notion.
  Read all channels + DMs since the last sync and extract people, commitments, and documents.

  STEPS:
  0. READ STATE: Query Sync State DB ({SYNC_STATE_DATA_SOURCE_ID}) for row with
     Key="slack_sync_last_ts". Call its Value LAST_SYNC_TS. If the row does not exist,
     treat LAST_SYNC_TS as (now - 14 hours) so the first run has a reasonable window.
     Record the current timestamp as NEW_SYNC_TS — you'll persist it in step 8.

  1. READ CHANNELS: For each of these channels, use slack_read_channel to get messages
     with `oldest=LAST_SYNC_TS`:
     {CHANNEL_LIST}
     For any threaded messages, use slack_read_thread for full context.
     Skip bot messages and automated notifications.

  2. READ DMs: Use slack_search_public_and_private with:
     - query="from:me" channel_types="im,mpim" after={LAST_SYNC_TS}
     - query="to:me" channel_types="im,mpim" after={LAST_SYNC_TS}
     Paginate through results. Read threads for context.

  3. PRE-FILTER (cost control): Before doing any extraction, batch all collected messages
     and run a cheap Haiku classifier pass. Prompt: "Does this message contain a commitment,
     promise, action item, follow-up, deadline, or document URL? yes/no. One answer per message."
     Drop every message marked "no" from the batch. Only messages marked "yes" proceed to
     steps 4–6.

  4. PEOPLE: For each person who sent or was mentioned in the filtered batch:
     - slack_read_user_profile to get name, title, email
     - Search People DB ({PEOPLE_DATA_SOURCE_ID}) by email first, then name
     - If not found: create entry (Name, Role from Slack profile,
       Company from email domain, Relationship=infer from context)
     - If found: append new Slack context to Notes if meaningful

  5. COMMITMENTS: For each action item, promise, follow-up, or TODO in the filtered batch:
     - Build deterministic key: "{channel_id}:{message_ts}"
     - Search Commitments DB ({COMMITMENTS_DATA_SOURCE_ID}) Source field for this key
     - If no match: create entry (Commitment, Owner linked, Status=Open,
       Direction=infer from who said it, Priority=infer,
       Source="Slack #channel-name [{channel_id}:{message_ts}]",
       Due Date if mentioned)
     - If match: skip (dedup)

  6. DOCUMENTS: For each message containing a document URL:
     - Strip query parameters and URL fragments (everything after `?` or `#`) from the
       URL's path before doing any classification. The .pdf extension check below applies
       to the cleaned path, not the raw URL.
     - Classify: docs.google.com/document (Google Doc), docs.google.com/spreadsheets
       (Google Sheet), drive.google.com/open?id= (Google Doc — known-imperfect, see
       KNOWN LIMITATIONS below), figma.com (Figma), notion.so / notion.site (Notion),
       cleaned URL path ends in .pdf (PDF)
     - Extract document ID from URL as dedup key
     - Search Documents DB ({DOCUMENTS_DATA_SOURCE_ID}) by Doc ID or URL
     - If not found: create entry (title from context, URL, Doc ID, Type,
       Shared By, Source, Status=Pending, Fetch Failures=0)
     - If found: update Source and Shared By if new channel/person
     - Do NOT fetch content here. Content is fetched on-demand via the Q&A trigger (4g).

  7. SKIP: bot messages, automated notifications, emoji-only reactions, simple
     acknowledgments ("ok", "thanks"). Do NOT create Meetings entries for Slack threads —
     threads are not meetings.

  8. WRITE STATE: Update Sync State DB ({SYNC_STATE_DATA_SOURCE_ID}) row Key="slack_sync_last_ts" with Value=NEW_SYNC_TS.
     This is atomic and runs last so a mid-run failure leaves the previous timestamp intact
     (at-least-once semantics, dedup handles re-processed messages).

  9. NOTIFY via Outbox: Write to Outbox DB ({OUTBOX_DATA_SOURCE_ID}) with Level=info:
     '<b>Slack Sync</b>\n\nN new people, N commitments captured, N documents indexed'
     Silent if nothing was found (no info-level message).

  NOTION RATE LIMIT HANDLING: If any Notion API call returns HTTP 429, sleep 5 seconds
  and retry. Max 3 retries per call. If still 429 after 3 retries, treat as a step failure.

  FAILURE: On any step failure, write to Outbox DB with Level=error. If Outbox write
  also fails (Notion outage), curl fallback directly to Telegram:
  '<b>Slack Sync failed</b>: {error summary}'

  KNOWN LIMITATIONS: `drive.google.com/open?id=` URLs can resolve to Docs, Sheets, or
  Slides but are classified as Google Doc here. If the on-demand fetch (trigger 4g)
  returns garbage for this document type, mark Status=Unreachable and move on.
```

### 4f. Document Refresh (weekly)

```
name: "Second Brain — Document Refresh"
cron: "0 {3am_user_tz_in_UTC} * * 0"
MCPs: Notion
prompt: |
  You are {USER_NAME}'s Second Brain bot. Weekly document refresh.
  Re-fetch Active documents to detect changes.

  STEPS:
  1. Query Documents DB ({DOCUMENTS_DATA_SOURCE_ID}) for Status=Active entries,
     ordered by Last Fetched ascending. Cap at 100 docs per run (oldest-stale first).
     Any docs beyond 100 will be picked up next Sunday; this keeps the run under
     the trigger timeout.
  2. For each document, re-fetch content based on Type:
     - Google Doc: curl -sL "https://docs.google.com/document/d/{DOC_ID}/export?format=txt"
     - Google Sheet: curl -sL "https://docs.google.com/spreadsheets/d/{DOC_ID}/export?format=csv"
     - Notion: use notion-fetch to read the page
     - PDF: curl -sL "{URL}"
     - Figma: skip
     CONTENT VALIDATION: if response starts with '<!DOCTYPE' or contains 'CAPTCHA' or
     'unusual traffic', treat as a fetch failure. Do NOT summarize HTML garbage.
  3. If fetch fails: increment Fetch Failures. If Fetch Failures >= 3, set Status=Unreachable.
  4. If fetch succeeds:
     - Reset Fetch Failures = 0 (three-strike rule counts CONSECUTIVE failures, not lifetime).
     - Compute SHA-256 of FULL content. Compare with stored Content Hash.
     - If different: truncate to 10K chars, re-summarize, re-extract key points,
       extract new commitments (link to Documents + People DBs), update hash,
       summary, key points, Last Changed = now.
     - If same: update Last Fetched only.
  5. Report hit rate across the 100-doc batch: "{accessible}/{processed} docs accessible ({X}%)"
  6. Write ONE summary to Outbox DB ({OUTBOX_DATA_SOURCE_ID}) with Level=info, listing
     changed doc titles (1-line diff each) + hit rate. Silent if nothing changed
     and no new Unreachable docs.

  NOTION RATE LIMIT HANDLING: If any Notion API call returns HTTP 429, sleep 5 seconds
  and retry. Max 3 retries per call. If still 429 after 3 retries, treat as a step failure.

  FAILURE: On any step failure, write to Outbox DB with Level=error. If Outbox write
  also fails (Notion outage), curl fallback directly to Telegram:
  '<b>Document Refresh failed</b>: {error summary}'
```

### 4g. Q&A Trigger (on-demand, invoked by Telegram bot webhook or manual run)

Answers user questions by searching the knowledge graph. Crucially, this trigger is
where document content gets fetched on-demand and cached — the Slack Sync trigger only
indexes document LINKS.

```
name: "Second Brain — Q&A"
cron: null  # run on-demand, not scheduled
MCPs: Notion
prompt: |
  You are {USER_NAME}'s Second Brain bot. Answer the user's question using the
  knowledge graph (People, Commitments, Meetings, Sessions, Documents).

  Classify the question type, then execute the matching branch. A question can trigger
  multiple types — execute all that apply and merge the answer.

  TYPE A — PERSON QUERY ("who is Jean?", "what's the context on X?"):
    Search People DB by name/email. Return role, company, relationship, last meeting,
    open commitments involving them (both directions).

  TYPE B — COMMITMENT QUERY ("what does Jean owe me?", "what's overdue?"):
    Search Commitments DB filtered by Owner, Status, Due Date, or Direction. Return
    each commitment with due date, direction, and source.

  TYPE C — MEETING QUERY ("what happened in the Jean call?"):
    Search Meetings DB by attendee + date range. Return summary + linked commitments.

  TYPE D — SESSION QUERY ("what did we decide about X?"):
    Search Claude Sessions DB by topic/keyword. Return decisions + context.

  TYPE E — CALENDAR QUERY ("what's on my schedule?"):
    Delegate to gcal_list_events. Out of scope for this trigger unless gcal MCP is
    attached — if not attached, say "I don't have calendar access in this trigger."

  TYPE F — NEW COMMITMENT ("remind me to X", "I promised Jean Y"):
    Create a Commitments DB entry. Owner = the user unless named otherwise.

  TYPE G — DOCUMENT QUERY ("what's in the whitepaper?", "did PJ finish section 3?",
  any question referencing a file, link, document title, or "that thing Gareth shared"):
    1. Search Documents DB ({DOCUMENTS_DATA_SOURCE_ID}) by keyword against Title,
       Summary, Key Points, URL.
    2. If found WITH Summary (already cached): return Summary + Key Points + URL +
       who shared it + when. Do NOT re-fetch.
    3. If found but Status=Pending or no Summary: FETCH ON-DEMAND by Type:
       - Google Doc: curl -sL "https://docs.google.com/document/d/{DOC_ID}/export?format=txt"
       - Google Sheet: curl -sL "https://docs.google.com/spreadsheets/d/{DOC_ID}/export?format=csv"
       - Notion: use notion-fetch to read the page
       - PDF: curl -sL "{URL}"
       - Figma: link-only — no content extraction. Return URL + context.
       CONTENT VALIDATION: if response starts with "<!DOCTYPE" or contains "CAPTCHA"
       or "unusual traffic": treat as a fetch failure. Do NOT summarize HTML garbage.
       If fetch succeeds:
         - Compute SHA-256 of FULL content.
         - Truncate to 10K chars for summarization.
         - Summarize in 2-3 sentences.
         - Extract key points (decisions, data, owners, deadlines).
         - Extract new commitments (link to Documents + People DBs).
         - Store Summary, Key Points, Content Hash, Last Fetched=now, Status=Active.
         - Reset Fetch Failures = 0.
         - Return Summary + Key Points + URL to the user.
       If fetch fails:
         - Increment Fetch Failures. If >= 3, set Status=Unreachable.
         - Return URL + who shared it + "Content not accessible (may require org login
           or the document was restricted after sharing)."
    4. If not found in Documents DB: "I don't have that document indexed. Share the
       link in any Slack channel and I'll pick it up on the next sync, or send me the
       URL directly and I'll ingest it now."
    5. NEVER say "I can't access files." The whole Document Brain exists so that
       answer is wrong.

  TYPE H — STRATEGIC / CONTEXT QUERY ("when did we pivot?", "what was the April 2
  decision?", "why did we choose X over Y?", any question about product direction,
  company strategy, historical decisions, user preferences, or architecture that
  isn't a specific meeting or commitment):
    1. Search Context DB ({CONTEXT_DATA_SOURCE_ID}) by keyword against Title,
       Description, Content. Sort by Type: decision > project > architecture > user
       > feedback > reference (decisions outrank profiles).
    2. If found: return Title + Description + relevant Content excerpts + Type.
       Cite the Source File so the user can trace the origin.
    3. If NOT found and the question is strategic: say "No matching context in the
       Context DB. If this decision happened outside Granola/Slack, it may not have
       been captured — add it via `/sync-memory` after updating local Claude memory,
       or record it directly in the Context DB."
    4. Do NOT fabricate strategic history. If the Context DB doesn't have it, say so
       explicitly rather than inferring from adjacent facts.

  NOTION RATE LIMIT HANDLING: If any Notion API call returns HTTP 429, sleep 5 seconds
  and retry. Max 3 retries per call.

  FAILURE: On any step failure, write to Outbox DB ({OUTBOX_DATA_SOURCE_ID}) with
  Level=error. If Outbox write also fails (Notion outage), curl fallback directly to
  Telegram:
  '<b>Q&A failed</b>: {error summary}'
```

### 4h. DST Reminder Trigger (weekly Sunday check)

All cron triggers store UTC expressions. When the US enters or leaves Daylight Saving
Time, every local-time-targeted cron drifts by 1 hour. This trigger fires twice a year
on the relevant Sundays to remind the user to adjust cron offsets.

```
name: "Second Brain — DST Reminder"
cron: "0 10 * * 0"  # every Sunday 10:00 UTC (roughly 5-6am ET)
MCPs: (none)
prompt: |
  You are {USER_NAME}'s Second Brain bot. Check if today is a US DST transition Sunday.

  STEPS:
  1. Get today's date. Determine:
     - Is this the SECOND Sunday of March? → Spring-forward (DST begins)
     - Is this the FIRST Sunday of November? → Fall-back (DST ends)
  2. If neither: stop silently.
  3. If yes: curl Telegram with:
     '<b>DST transitioned today</b>\n\n
      Cron triggers are UTC. Local times just drifted 1 hour (forward in March,
      back in November). Review these trigger cron offsets if they matter:
      - Pre-Call Briefings A + B
      - Morning Digest
      - Overdue Alert
      - Granola Sync
      - Slack Sync (7am / 8pm)
      - Document Refresh (3am Sunday)
      Don''t let these slide.'
```

---

## Step 5: Add CLAUDE.md Instructions

Add this to the user's project or global CLAUDE.md so every future Claude Code session auto-synthesizes:

```markdown
## Second Brain — Session Synthesis

At the END of every meaningful Claude Code session, SYNTHESIZE the session's output
into the Second Brain Notion databases. This is not just logging — it's updating the
knowledge graph so the scheduled briefing agents have fresh context.

### Notion DB IDs (under Second Brain page: {SECOND_BRAIN_PAGE_ID})
- People DB data source: `collection://{PEOPLE_DATA_SOURCE_ID}`
- Commitments DB data source: `collection://{COMMITMENTS_DATA_SOURCE_ID}`
- Meetings DB data source: `collection://{MEETINGS_DATA_SOURCE_ID}`
- Claude Sessions DB data source: `collection://{SESSIONS_DATA_SOURCE_ID}`
- Documents DB data source: `collection://{DOCUMENTS_DATA_SOURCE_ID}`

### What to synthesize (do ALL that apply):

1. **People** — If anyone was discussed, search the People DB by name.
   - If found: update their Notes field with new context from this session.
   - If not found: create a new entry (Name, Role, Company, Email, Relationship, Notes).

2. **Commitments** — If any action items, promises, or follow-ups were discussed:
   - Create new commitment entries (Commitment, Status=Open, Direction, Priority, Owner, Due Date, Source).
   - If existing commitments were completed or status changed, update them via notion-update-page.

3. **Meetings** — If a meeting was discussed or debriefed:
   - Create a Meetings entry (Meeting title, Date, Source=Manual, Summary).

4. **Claude Sessions** — Always create a session entry:
   - parent: `{"type": "data_source_id", "data_source_id": "{SESSIONS_DATA_SOURCE_ID}"}`
   - Session: short title
   - date:Date:start: today (YYYY-MM-DD)
   - Topics: from [engineering, product, hiring, fundraising, legal, operations, design, strategy]
   - Decisions: key decisions (1-3 sentences)
   - Context: what was discussed and why it matters (2-5 sentences)

5. **Slack context** — If Slack messages or channels were referenced in this session:
   - Use "Slack #channel-name [channel_id:message_ts]" in Commitment Source fields
   - Update People notes with Slack interaction context when relevant
   - Do NOT read Slack at every session end — the scheduled Slack Sync trigger handles ongoing sync

6. **Documents** — If documents or files were referenced in this session:
   - Search Documents DB `collection://{DOCUMENTS_DATA_SOURCE_ID}` by URL or description
   - If not found: create entry (Document title, URL, Type, Doc ID, Status=Pending)
   - If found: update Notes with session context if relevant

### When to synthesize
- When the user says goodbye, wraps up, or the conversation naturally ends.
- When the user explicitly asks to save/sync to the Second Brain.
- After any session where people, commitments, or decisions were discussed.
- **SKIP synthesis** if the session is purely meta/infrastructure about Second Brain itself
  (e.g., debugging a trigger, editing this setup doc, discussing the architecture). Logging
  a session about the logging system creates recursive noise that dilutes real signal.

This feeds the scheduled briefing agents. They read People, Commitments, and Meetings
before every call. Stale data = bad briefings.
```

---

## Step 6: Test

1. Send a test message to Telegram:
   ```
   curl -s -X POST 'https://api.telegram.org/bot{TOKEN}/sendMessage' \
     -H 'Content-Type: application/json' \
     -d '{"chat_id": {CHAT_ID}, "text": "Second Brain connected.", "parse_mode": "HTML"}'
   ```
2. Fire the pre-call briefing trigger manually via `RemoteTrigger run`
3. Check Telegram for the briefing
4. Open Notion and verify all 8 DBs exist (People, Commitments, Meetings, Claude Sessions, Documents, Outbox, Sync State, Context)
5. Fire the Q&A trigger manually with a test question about a document shared in Slack to verify on-demand fetch works
6. Check the Outbox DB — confirm at least one info-level entry was written by the initial test run

---

## Architecture

```
DATA IN:                          KNOWLEDGE GRAPH:              PUSH OUT:
                                  ┌─────────────────┐
  Granola ──(nightly sync)──────► │  Notion          │
  Google Calendar ──(live MCP)──► │  ├─ People       │──► Pre-Call Briefing
  Slack ──(7am + 8pm sync)──────► │  ├─ Commitments  │──► Morning Digest
  Claude Code ──(auto-save)─────► │  ├─ Meetings     │──► Overdue Alert
  Docs ──(on-demand + weekly)───► │  ├─ Sessions     │──► Telegram
                                  │  └─ Documents    │
                                  └─────────────────┘
  Zero API keys. Zero servers.
  Everything via MCP + scheduled agents.
```

---

## Customization

- **Delivery**: Swap Telegram curl for Slack MCP (`slack_send_message`) if user prefers Slack
- **Timezone**: Replace all `America/New_York` references with user's timezone
- **Tone**: Adjust briefing prompts. Current style: "blunt chief of staff." Can be warmer, more formal, etc.
- **Sources**: Add Clay MCP for CRM enrichment, Gmail MCP for email context, Asana MCP for task sync
- **Briefing window**: Adjust from 60 min lookahead to 30 or 120 depending on preference
