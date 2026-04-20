import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import "dotenv/config";

import {
  findPerson,
  getAllOpenCommitments,
  getOverdueCommitments,
  addCommitment,
  getCommitmentsForPerson,
} from "./notion-client.js";
import { getUpcomingEvents } from "./calendar-client.js";
import { generatePreCallBriefing, generateDailyDigest } from "./briefing.js";
import { syncMemoryToNotion } from "./memory-sync.js";

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Track which event IDs we've already sent briefings for (reset daily)
const sentBriefings = new Set();

function send(text) {
  return bot.sendMessage(CHAT_ID, text, { parse_mode: "Markdown" });
}

// --- Slash commands ---

bot.onText(/\/briefing/, async (msg) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  try {
    await send("Looking at your next meeting...");
    const events = await getUpcomingEvents(60);
    if (events.length === 0) {
      return send("No meetings in the next hour.");
    }
    const briefing = await generatePreCallBriefing(events[0]);
    await send(`*Pre-call: ${events[0].summary}*\n\n${briefing}`);
  } catch (err) {
    console.error("briefing error:", err);
    await send(`Error generating briefing: ${err.message}`);
  }
});

bot.onText(/\/digest/, async (msg) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  try {
    await send("Generating your daily digest...");
    const digest = await generateDailyDigest();
    await send(`*Morning Digest*\n\n${digest}`);
  } catch (err) {
    console.error("digest error:", err);
    await send(`Error generating digest: ${err.message}`);
  }
});

bot.onText(/\/open/, async (msg) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  try {
    const commitments = await getAllOpenCommitments();
    if (commitments.length === 0) {
      return send("No open commitments. Suspicious.");
    }
    const lines = commitments.map((c) => {
      const due = c.dueDate ? ` (due ${c.dueDate})` : "";
      const prio = c.priority ? `[${c.priority}]` : "";
      return `${prio} [${c.direction}] ${c.commitment}${due}`;
    });
    await send(`*Open Commitments (${commitments.length})*\n\n${lines.join("\n")}`);
  } catch (err) {
    console.error("open error:", err);
    await send(`Error: ${err.message}`);
  }
});

bot.onText(/\/add (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  try {
    const parts = match[1].split("|").map((s) => s.trim());
    if (parts.length < 2) {
      return send(
        "Usage: `/add Name | Task | Direction | Priority`\n" +
          "Direction: `They owe me` or `I owe them`\n" +
          "Priority: `High`, `Medium`, `Low`"
      );
    }
    const [name, task, direction, priority] = parts;

    const people = await findPerson(name);
    const person = people[0] ?? null;

    await addCommitment({
      commitment: task,
      ownerPageId: person?.id,
      direction: direction || "They owe me",
      priority: priority || "Medium",
      source: "Telegram",
    });

    const ownerLabel = person ? person.name : `${name} (not found in DB — added unlinked)`;
    await send(`Added: *${task}*\nOwner: ${ownerLabel}\nDirection: ${direction || "They owe me"}`);
  } catch (err) {
    console.error("add error:", err);
    await send(`Error: ${err.message}`);
  }
});

bot.onText(/\/context (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  try {
    const name = match[1].trim();
    const people = await findPerson(name);

    if (people.length === 0) {
      return send(`No one matching *${name}* in People DB.`);
    }

    if (people.length > 1) {
      const names = people
        .map((p) => `- ${p.name}${p.company ? ` (${p.company})` : ""}`)
        .join("\n");
      return send(
        `Multiple matches for *${name}*:\n\n${names}\n\nBe more specific.`
      );
    }

    const person = people[0];
    const commitments = await getCommitmentsForPerson(person.id);

    const roleAndCompany =
      person.role && person.company
        ? `${person.role} at ${person.company}`
        : person.role || person.company;

    const header = [
      `*${person.name}*`,
      roleAndCompany,
      person.relationship ? `_${person.relationship}_` : "",
      person.email ? `✉ ${person.email}` : "",
      person.lastMeeting ? `Last meeting: ${person.lastMeeting}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    let commitmentSection = "";
    if (commitments.length === 0) {
      commitmentSection = "\n\n_No open commitments._";
    } else {
      const today = new Date().toISOString().split("T")[0];
      const fmtLine = (c) => {
        const overdue = c.dueDate && c.dueDate < today ? " ⚠️" : "";
        const due = c.dueDate ? ` (due ${c.dueDate}${overdue})` : "";
        const prio = c.priority ? `[${c.priority}] ` : "";
        return `${prio}${c.commitment}${due}`;
      };
      const theyOwe = commitments.filter((c) => c.direction === "They owe me");
      const iOwe = commitments.filter((c) => c.direction === "I owe them");
      const other = commitments.filter(
        (c) => c.direction !== "They owe me" && c.direction !== "I owe them"
      );

      const sections = [];
      if (theyOwe.length > 0) {
        sections.push(
          `*They owe me (${theyOwe.length})*\n${theyOwe.map(fmtLine).join("\n")}`
        );
      }
      if (iOwe.length > 0) {
        sections.push(
          `*I owe them (${iOwe.length})*\n${iOwe.map(fmtLine).join("\n")}`
        );
      }
      if (other.length > 0) {
        sections.push(
          `*Other (${other.length})*\n${other.map(fmtLine).join("\n")}`
        );
      }
      commitmentSection = `\n\n${sections.join("\n\n")}`;
    }

    const notesSection = person.notes ? `\n\n*Notes*\n${person.notes}` : "";

    await send(`${header}${commitmentSection}${notesSection}`);
  } catch (err) {
    console.error("context error:", err);
    await send(`Error: ${err.message}`);
  }
});

bot.onText(/\/sync-memory/, async (msg) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  try {
    await send("Syncing Claude memory to Notion...");
    const results = await syncMemoryToNotion();
    const errLines = results.errors
      .map((e) => `- ${e.file}: ${e.error}`)
      .join("\n");
    await send(
      `*Memory Sync*\n` +
        `Created: ${results.created}\n` +
        `Updated: ${results.updated}\n` +
        `Unchanged: ${results.unchanged}\n` +
        `Skipped: ${results.skipped}` +
        (errLines ? `\n\n*Errors:*\n${errLines}` : "")
    );
  } catch (err) {
    console.error("sync-memory error:", err);
    await send(`Error: ${err.message}`);
  }
});

bot.onText(/\/help/, async (msg) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  await send(
    "*Second Brain Bot*\n\n" +
      "/briefing — Pre-call briefing for your next meeting\n" +
      "/digest — Morning digest (schedule + commitments)\n" +
      "/open — List all open commitments\n" +
      "/context Name — Everything known about a person\n" +
      "/add Name | Task | Direction | Priority — Add a commitment\n" +
      "/sync-memory — Sync local Claude memory to Notion Context DB\n" +
      "/help — This message\n\n" +
      "_Auto: briefings 15 min before calls, digest at 8:30 AM ET, overdue at 6 PM ET, memory sync at 3 AM ET_"
  );
});

// --- Cron: pre-call briefings every 5 minutes ---

cron.schedule("*/5 * * * *", async () => {
  try {
    const events = await getUpcomingEvents(15);
    for (const event of events) {
      if (sentBriefings.has(event.id)) continue;
      sentBriefings.add(event.id);

      const briefing = await generatePreCallBriefing(event);
      await send(`*Upcoming: ${event.summary}*\n\n${briefing}`);
    }
  } catch (err) {
    console.error("cron briefing error:", err);
  }
});

// --- Cron: morning digest at 8:30 AM ET on weekdays ---

cron.schedule(
  "30 8 * * 1-5",
  async () => {
    try {
      const digest = await generateDailyDigest();
      await send(`*Morning Digest*\n\n${digest}`);
    } catch (err) {
      console.error("cron digest error:", err);
    }
  },
  { timezone: "America/New_York" }
);

// --- Cron: overdue alert at 6 PM ET on weekdays ---

cron.schedule(
  "0 18 * * 1-5",
  async () => {
    try {
      const overdue = await getOverdueCommitments();
      if (overdue.length === 0) return;

      const lines = overdue.map(
        (c) => `- [${c.direction}] ${c.commitment} (due ${c.dueDate})`
      );
      await send(
        `*Overdue Alert (${overdue.length} items)*\n\n${lines.join("\n")}\n\nDon't let these slide.`
      );
    } catch (err) {
      console.error("cron overdue error:", err);
    }
  },
  { timezone: "America/New_York" }
);

// --- Cron: nightly memory sync at 3 AM ET ---

cron.schedule(
  "0 3 * * *",
  async () => {
    try {
      const results = await syncMemoryToNotion();
      if (
        results.created > 0 ||
        results.updated > 0 ||
        results.errors.length > 0
      ) {
        const errLines = results.errors
          .map((e) => `- ${e.file}: ${e.error}`)
          .join("\n");
        await send(
          `*Memory Sync (nightly)*\n` +
            `${results.created} created, ${results.updated} updated` +
            (errLines ? `\n\n*Errors:*\n${errLines}` : "")
        );
      }
      // Silent if nothing changed.
    } catch (err) {
      console.error("cron memory-sync error:", err);
    }
  },
  { timezone: "America/New_York" }
);

// --- Reset sent briefings at midnight ---

cron.schedule(
  "0 0 * * *",
  () => {
    sentBriefings.clear();
  },
  { timezone: "America/New_York" }
);

// --- Startup ---

console.log("Second Brain Bot running.");
console.log(`Chat ID: ${CHAT_ID}`);
console.log(
  "Crons: briefing check (*/5 min), digest (8:30 AM ET), overdue (6 PM ET), memory sync (3 AM ET)"
);
