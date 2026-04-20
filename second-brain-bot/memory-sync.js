import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import "dotenv/config";

import { findContextByPath, upsertContext } from "./notion-client.js";

// Claude Code encodes the homedir path into its projects slug by replacing
// every '/' with '-'. E.g. /Users/jane -> -Users-jane. This auto-derives it
// so the bot is portable across machines/users without editing code.
const CLAUDE_PROJECT_SLUG = os.homedir().replace(/\//g, "-");
const MEMORY_DIR =
  process.env.CLAUDE_MEMORY_DIR ||
  path.join(os.homedir(), ".claude/projects", CLAUDE_PROJECT_SLUG, "memory");

const VALID_TYPES = new Set([
  "user",
  "feedback",
  "project",
  "reference",
  "architecture",
  "decision",
]);

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const header = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const frontmatter = {};
  for (const line of header.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) frontmatter[m[1]] = m[2].trim();
  }
  return { frontmatter, body };
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function syncMemoryToNotion({ dryRun = false } = {}) {
  const entries = await fs.readdir(MEMORY_DIR);
  const results = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
  };

  for (const filename of entries) {
    if (!filename.endsWith(".md") || filename === "MEMORY.md") {
      results.skipped++;
      continue;
    }

    const filepath = path.join(MEMORY_DIR, filename);
    try {
      const raw = await fs.readFile(filepath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(raw);

      const title = frontmatter.name || filename.replace(/\.md$/, "");
      const description = frontmatter.description || "";
      let type = frontmatter.type || "other";
      if (!VALID_TYPES.has(type)) type = "other";

      const bodyTrimmed = body.trim();
      const hash = sha256(bodyTrimmed);

      const existing = await findContextByPath(filename);

      if (existing) {
        if (existing.contentHash === hash) {
          results.unchanged++;
          continue;
        }
        if (!dryRun) {
          await upsertContext({
            pageId: existing.pageId,
            title,
            type,
            description,
            sourceFile: filename,
            content: bodyTrimmed,
            contentHash: hash,
          });
        }
        results.updated++;
      } else {
        if (!dryRun) {
          await upsertContext({
            title,
            type,
            description,
            sourceFile: filename,
            content: bodyTrimmed,
            contentHash: hash,
          });
        }
        results.created++;
      }
    } catch (err) {
      results.errors.push({ file: filename, error: err.message });
    }
  }

  return results;
}

// Allow direct invocation: `node memory-sync.js` for one-off testing.
if (import.meta.url === `file://${process.argv[1]}`) {
  syncMemoryToNotion()
    .then((r) => {
      console.log("Sync complete:", JSON.stringify(r, null, 2));
      process.exit(r.errors.length > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("Sync failed:", err);
      process.exit(1);
    });
}
