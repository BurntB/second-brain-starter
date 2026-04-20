import { Client } from "@notionhq/client";
import "dotenv/config";

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const PEOPLE_DB = process.env.NOTION_PEOPLE_DB;
const COMMITMENTS_DB = process.env.NOTION_COMMITMENTS_DB;
const CONTEXT_DB = process.env.NOTION_CONTEXT_DB;

// --- People DB helpers ---

function parsePerson(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: p.Name?.title?.[0]?.plain_text ?? "",
    role: p.Role?.rich_text?.[0]?.plain_text ?? "",
    company: p.Company?.rich_text?.[0]?.plain_text ?? "",
    email: p.Email?.email ?? "",
    relationship: p.Relationship?.select?.name ?? "",
    lastMeeting: p["Last Meeting"]?.date?.start ?? null,
    notes: p.Notes?.rich_text?.[0]?.plain_text ?? "",
    openItems: p["Open Items"]?.number ?? 0,
  };
}

export async function findPerson(name) {
  const response = await notion.databases.query({
    database_id: PEOPLE_DB,
    filter: {
      property: "Name",
      title: { contains: name },
    },
  });
  return response.results.map(parsePerson);
}

export async function getAllPeople() {
  const pages = [];
  let cursor;
  do {
    const response = await notion.databases.query({
      database_id: PEOPLE_DB,
      start_cursor: cursor,
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return pages.map(parsePerson);
}

// --- Commitments DB helpers ---

function parseCommitment(page) {
  const p = page.properties;
  return {
    id: page.id,
    commitment: p.Commitment?.title?.[0]?.plain_text ?? "",
    ownerIds: p.Owner?.relation?.map((r) => r.id) ?? [],
    status: p.Status?.select?.name ?? "",
    dueDate: p["Due Date"]?.date?.start ?? null,
    source: p.Source?.rich_text?.[0]?.plain_text ?? "",
    priority: p.Priority?.select?.name ?? "",
    direction: p.Direction?.select?.name ?? "",
    notes: p.Notes?.rich_text?.[0]?.plain_text ?? "",
    created: p.Created?.created_time ?? null,
  };
}

export async function getCommitmentsForPerson(personPageId) {
  const response = await notion.databases.query({
    database_id: COMMITMENTS_DB,
    filter: {
      and: [
        { property: "Owner", relation: { contains: personPageId } },
        { property: "Status", select: { equals: "Open" } },
      ],
    },
    sorts: [{ property: "Due Date", direction: "ascending" }],
  });
  return response.results.map(parseCommitment);
}

export async function getAllOpenCommitments() {
  const response = await notion.databases.query({
    database_id: COMMITMENTS_DB,
    filter: { property: "Status", select: { equals: "Open" } },
    sorts: [{ property: "Due Date", direction: "ascending" }],
  });
  return response.results.map(parseCommitment);
}

export async function getOverdueCommitments() {
  const today = new Date().toISOString().split("T")[0];
  const response = await notion.databases.query({
    database_id: COMMITMENTS_DB,
    filter: {
      and: [
        { property: "Status", select: { equals: "Open" } },
        { property: "Due Date", date: { before: today } },
      ],
    },
    sorts: [{ property: "Due Date", direction: "ascending" }],
  });
  return response.results.map(parseCommitment);
}

export async function addCommitment({
  commitment,
  ownerPageId,
  direction,
  priority,
  dueDate,
  source,
  notes,
}) {
  const properties = {
    Commitment: { title: [{ text: { content: commitment } }] },
    Status: { select: { name: "Open" } },
  };
  if (ownerPageId) {
    properties.Owner = { relation: [{ id: ownerPageId }] };
  }
  if (direction) {
    properties.Direction = { select: { name: direction } };
  }
  if (priority) {
    properties.Priority = { select: { name: priority } };
  }
  if (dueDate) {
    properties["Due Date"] = { date: { start: dueDate } };
  }
  if (source) {
    properties.Source = { rich_text: [{ text: { content: source } }] };
  }
  if (notes) {
    properties.Notes = { rich_text: [{ text: { content: notes } }] };
  }

  return notion.pages.create({
    parent: { database_id: COMMITMENTS_DB },
    properties,
  });
}

export async function updatePersonNotes(personPageId, notes) {
  return notion.pages.update({
    page_id: personPageId,
    properties: {
      Notes: { rich_text: [{ text: { content: notes } }] },
    },
  });
}

// --- Context DB helpers (for local Claude memory → Notion sync) ---

function parseContext(page) {
  const p = page.properties;
  return {
    pageId: page.id,
    title: p.Title?.title?.[0]?.plain_text ?? "",
    type: p.Type?.select?.name ?? "",
    description: p.Description?.rich_text?.[0]?.plain_text ?? "",
    sourceFile: p["Source File"]?.rich_text?.[0]?.plain_text ?? "",
    contentHash: p["Content Hash"]?.rich_text?.[0]?.plain_text ?? "",
  };
}

export async function findContextByPath(sourceFile) {
  if (!CONTEXT_DB) return null;
  const response = await notion.databases.query({
    database_id: CONTEXT_DB,
    filter: {
      property: "Source File",
      rich_text: { equals: sourceFile },
    },
    page_size: 1,
  });
  if (response.results.length === 0) return null;
  return parseContext(response.results[0]);
}

export async function upsertContext({
  pageId,
  title,
  type,
  description,
  sourceFile,
  content,
  contentHash,
}) {
  if (!CONTEXT_DB) throw new Error("NOTION_CONTEXT_DB not set in .env");

  const today = new Date().toISOString().split("T")[0];

  // Notion rich_text fields cap at 2000 chars per block. Memory bodies can
  // exceed that (the PropTech project memory is ~2.2k). Truncate for the
  // Notion Content field but keep the hash of the full body so change
  // detection stays accurate; the local file is the source of truth.
  const contentForNotion =
    content.length > 1900
      ? content.slice(0, 1900) + "\n\n... [truncated, see source file]"
      : content;

  const properties = {
    Title: { title: [{ text: { content: title } }] },
    Type: { select: { name: type } },
    Description: { rich_text: [{ text: { content: description } }] },
    "Source File": { rich_text: [{ text: { content: sourceFile } }] },
    Content: { rich_text: [{ text: { content: contentForNotion } }] },
    "Content Hash": { rich_text: [{ text: { content: contentHash } }] },
    "Last Synced": { date: { start: today } },
  };

  if (pageId) {
    return notion.pages.update({ page_id: pageId, properties });
  }
  return notion.pages.create({
    parent: { database_id: CONTEXT_DB },
    properties,
  });
}
