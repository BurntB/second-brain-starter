import Anthropic from "@anthropic-ai/sdk";
import { findPerson, getCommitmentsForPerson } from "./notion-client.js";
import { getTodayEvents } from "./calendar-client.js";
import { getOverdueCommitments, getAllOpenCommitments } from "./notion-client.js";
import "dotenv/config";

const anthropic = new Anthropic();

// Who the bot is briefing. Set USER_NAME and USER_ROLE in .env to personalize.
// Defaults keep prompts working if nothing is set.
const USER_NAME = process.env.USER_NAME || "the user";
const USER_ROLE = process.env.USER_ROLE || "";
const USER_DESCRIPTOR = USER_ROLE ? `${USER_NAME}, ${USER_ROLE}` : USER_NAME;

// --- Pre-call briefing ---

export async function generatePreCallBriefing(event) {
  // Look up each non-self attendee in the People DB
  const externalAttendees = event.attendees.filter((a) => !a.self);
  const attendeeProfiles = [];

  for (const attendee of externalAttendees) {
    const name =
      attendee.name !== attendee.email
        ? attendee.name
        : attendee.email.split("@")[0];
    const matches = await findPerson(name);
    const person = matches[0] ?? null;
    let commitments = [];
    if (person) {
      commitments = await getCommitmentsForPerson(person.id);
    }
    attendeeProfiles.push({ attendee, person, commitments });
  }

  const contextBlock = attendeeProfiles
    .map(({ attendee, person, commitments }) => {
      const lines = [`**${attendee.name}** (${attendee.email})`];
      if (person) {
        lines.push(
          `  Role: ${person.role} @ ${person.company} | Relationship: ${person.relationship}`
        );
        if (person.notes) lines.push(`  Notes: ${person.notes}`);
        if (person.lastMeeting)
          lines.push(`  Last meeting: ${person.lastMeeting}`);
        if (commitments.length > 0) {
          lines.push(`  Open commitments:`);
          for (const c of commitments) {
            const due = c.dueDate ? ` (due ${c.dueDate})` : "";
            lines.push(`    - [${c.direction}] ${c.commitment}${due}`);
          }
        }
      } else {
        lines.push(`  Not in People DB — first-time or external contact`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const prompt = `You are a blunt, no-BS executive briefing assistant for ${USER_DESCRIPTOR}.

Meeting: "${event.summary}"
Starts: ${event.start}
Meet link: ${event.meetLink ?? "none"}

Attendee context:
${contextBlock}

Meeting description:
${event.description || "(none)"}

Write a pre-call briefing in under 150 words. Be direct. Include:
- Who these people are and your relationship
- Any open commitments (theirs to you, yours to them) — call out overdue ones bluntly
- What to push on or follow up during this call
- Any context that would be embarrassing to forget

No fluff. No "hope this helps." Talk like a sharp chief of staff.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text;
}

// --- Daily digest ---

export async function generateDailyDigest() {
  const [todayEvents, overdue, allOpen] = await Promise.all([
    getTodayEvents(),
    getOverdueCommitments(),
    getAllOpenCommitments(),
  ]);

  const scheduleBlock = todayEvents
    .map((e) => {
      const time = new Date(e.start).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      const attendees = e.attendees
        .filter((a) => !a.self)
        .map((a) => a.name)
        .join(", ");
      return `- ${time}: ${e.summary}${attendees ? ` (with ${attendees})` : ""}`;
    })
    .join("\n");

  const overdueBlock = overdue
    .map((c) => `- [${c.direction}] ${c.commitment} (due ${c.dueDate})`)
    .join("\n");

  const openBlock = allOpen
    .map((c) => {
      const due = c.dueDate ? ` — due ${c.dueDate}` : "";
      return `- [${c.priority ?? "?"}] [${c.direction}] ${c.commitment}${due}`;
    })
    .join("\n");

  const prompt = `You are a blunt, no-BS executive briefing assistant for ${USER_DESCRIPTOR}.

Today's schedule (ET):
${scheduleBlock || "(no meetings today)"}

Overdue commitments:
${overdueBlock || "(none)"}

All open commitments:
${openBlock || "(none)"}

Write a morning digest in under 200 words. Be direct and punchy. Include:
- Today's schedule at a glance with what to prep for
- Any overdue items that need immediate attention — be blunt about who dropped the ball
- Top priorities for the day
- Anything that could blow up if ignored

No fluff. Talk like a sharp chief of staff giving the morning rundown.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text;
}
