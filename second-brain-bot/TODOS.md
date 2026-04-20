# TODOs

Scope commit from /office-hours 2026-04-16: **Second Brain is a personal tool, N=1 forever.**
See `~/.gstack/projects/SecondBrain/burnt-feat-ndr-teels-demo-design-20260416-115859.md` for the decision and its premises.

---

## P0 — From /plan-eng-review 2026-04-16 (commit d5dc61d)

### Apply review decisions to SETUP-AGENT-PROMPT.md
**What:** Apply the 15 review decisions from /plan-eng-review to the blueprint file.
**Why:** Review surfaced dangling references (Outbox DB never defined), missing state (LAST_SYNC_TS), silent failures, and value-prop gaps (hourly briefing misses meetings created mid-hour). Even as a personal tool the blueprint is wrong in its current form — bugs, not scope.
**How to apply (exact specs):**

1. **Step 1 header** — change "Then create 4 databases" to "Then create 7 databases."
2. **Step 1e Documents** — change `"Fetch Failures" NUMBER` to `"Fetch Failures" NUMBER DEFAULT 0`.
3. **Add Step 1f Outbox DB** — schema: `Message TITLE, Level SELECT('info','warn','error'), Trigger RICH_TEXT, Sent_At DATE, Delivered BOOLEAN, Payload RICH_TEXT`. Purpose: decouple trigger failures from Telegram delivery; enable retry and audit.
4. **Add Step 1g Sync State DB** — schema: `Key TITLE, Value RICH_TEXT, Last_Updated DATE`. One row per trigger that needs state (e.g., `slack_sync_last_ts`).
5. **Line 145** — change "Save all 5 data_source_id values" to "Save all 7 data_source_id values."
6. **Step 4 preamble** — change "create 5 triggers" to "create 8 triggers."
7. **Split Trigger 4a into two** — Briefing A at `cron: "0 * * * 1-5"` and Briefing B at `cron: "30 * * * 1-5"`. Both use 30-min lookahead. Both read/write a `Briefed` boolean flag on Meetings DB to dedup. Two separate triggers each running hourly, offset by 30 min (respects platform's 1-hour minimum).
8. **Every trigger (4a–4h)** — add at end of STEPS: "On any step failure, write to Outbox DB ({OUTBOX_DATA_SOURCE_ID}) with Level=error. If Outbox write ALSO fails (Notion outage), curl a fallback message directly to Telegram: `<b>[Trigger Name] failed</b>: {error}`."
9. **Trigger 4e Slack Sync** — replace `after={LAST_SYNC_TS}` with: "Read last sync timestamp from Sync State DB key='slack_sync_last_ts'. After the sync, update that key to the current timestamp." Add Haiku pre-filter pass: "For each message batch, first run a cheap Haiku classifier with prompt 'does this message contain a commitment, promise, action item, or document link? yes/no.' Only messages flagged yes go to the full Sonnet extraction pass." Add after URL classification: "Strip query params and fragments from the URL path before checking if it ends in `.pdf`."
10. **Trigger 4e and 4f** — add: "If a Notion API call returns HTTP 429, sleep 5 seconds and retry. Max 3 retries per call."
11. **Trigger 4f Document Refresh** — replace "Query Documents DB for Status=Active entries" with: "Query Documents DB for Status=Active entries, ordered by Last Fetched ascending. Cap at 100 docs per run (oldest-stale first)."
12. **Add Step 4g Q&A Trigger with TYPE G** — pull the full TYPE G doc-query branch from the design doc (lines 138-184 of `~/.gstack/projects/SecondBrain/burnt-feat-ndr-teels-demo-design-20260414-115226.md`). Include all other Q&A type branches currently live in the RemoteTrigger API.
13. **Add Step 4h DST Reminder Trigger** — `cron: "0 10 * * 0"` (check every Sunday), prompt: "If today is the Sunday US DST changes (second Sunday in March, first Sunday in November), Telegram: 'DST transitioned today. Cron triggers are UTC — local times drifted 1hr. Consider adjusting trigger cron offsets.' Otherwise stop silently."
14. **Step 5 CLAUDE.md template** — copy items 5 (Slack context) and 6 (Documents) verbatim from live `/Users/burnt/CLAUDE.md` so the personal setup template is current.
15. **Step 5 CLAUDE.md template** — add at end of "### When to synthesize": "- SKIP synthesis if the session topic is purely meta/infrastructure about Second Brain itself (to avoid recursive logging loops)."

**Depends on:** Nothing. Safe to implement in a single /ship session.

---

## P1 — Personal-tool value, ship next

### /context command
**What:** Add `/context Jean` command that pulls everything known about a person (relationship, notes, open commitments, last meeting date).
**Why:** Natural extension of existing findPerson + getCommitmentsForPerson. Gives instant context without opening Notion. High daily utility for a solo user. Zero scale cost — works the same at 10 people and 500.
**Depends on:** Bot running and People DB populated. Both true.
**Promotion rationale (2026-04-16):** Promoted from backlog to P1 after the personal-tool scope commit. This is now the most valuable buildable thing in the list.

### Fetch Failures reset on success
**What:** Document Refresh trigger (4f) should reset Fetch Failures to 0 when a fetch succeeds, not just increment on failure.
**Why:** A doc that flaps (success, fail, success, fail, success) trends toward Unreachable even though it's mostly reachable. Reset on success makes the 3-strike rule track consecutive failures, which is the intended semantics.
**How:** In trigger 4f, in the "if fetch succeeds" branch, add: "Reset Fetch Failures = 0."

---

## P2 — Nice-to-have if it makes the tool more fun

### Slack delivery channel
**What:** Push briefings (pre-call, digest, overdue) to Slack DM as alternative to Telegram.
**Why:** Reduces app-switching friction if you live in Slack most of the day.
**Depends on:** Slack MCP connected. Could be a config toggle: `delivery: "telegram" | "slack" | "both"`.

---

## P3 — Placeholders (deferred, do not start)

These were active TODOs in the earlier list. Under the personal-tool scope commit, they become deferred placeholders — documented so that if premises break (graph scales, blueprint gets shared, trigger silence starts cascading into real costs), the thinking is not lost.

- **Monitoring trigger for silent failures** — only matters if you stop noticing trigger silence. As long as you read your morning digest, you're the monitor. Trigger point: if you miss 3+ consecutive morning digests without noticing, revisit.
- **Nightly eval harness for LLM quality** — only matters if you stop reading every briefing. Trigger point: if you find yourself skimming past briefings without reading, revisit.
- **Full-text search + pagination discipline in triggers** — only matters if search feels slow. Trigger point: if a trigger ever takes >5min or times out on Notion pagination, revisit.

The Postgres migration thesis (the biggest deferred idea) lives in the design doc appendix at `~/.gstack/projects/SecondBrain/burnt-feat-ndr-teels-demo-design-20260416-115859.md`, not here — it's architecture-level, not task-level.
