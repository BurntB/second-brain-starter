import { google } from "googleapis";
import "dotenv/config";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const calendar = google.calendar({ version: "v3", auth: oauth2Client });

function parseEvent(event) {
  return {
    id: event.id,
    summary: event.summary ?? "(no title)",
    start: event.start?.dateTime ?? event.start?.date,
    end: event.end?.dateTime ?? event.end?.date,
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.email,
      name: a.displayName ?? a.email,
      self: a.self ?? false,
      responseStatus: a.responseStatus,
    })),
    meetLink:
      event.hangoutLink ?? event.conferenceData?.entryPoints?.[0]?.uri ?? null,
    description: event.description ?? "",
  };
}

export async function getUpcomingEvents(minutes = 15) {
  const now = new Date();
  const soon = new Date(now.getTime() + minutes * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: soon.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return (response.data.items ?? []).map(parseEvent);
}

export async function getTodayEvents() {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return (response.data.items ?? []).map(parseEvent);
}
