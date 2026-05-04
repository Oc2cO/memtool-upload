import { buildCachedExportFileNote } from "./exportCacheWarning";
import type { Memory } from "./memories";

/**
 * Pure export builders — no I/O, no react-native imports, fully typed.
 * All memory-body escaping happens here so callers stay clean.
 *
 * JSON: top-level object with two keys (stable, do not rename):
 *         _export_metadata — { cached, exported_at, note? }
 *         memories         — array of memory rows (full Memory shape)
 *       The metadata block is the in-file equivalent of the share-sheet
 *       "Cached copy" warning — anyone opening the saved file later (or
 *       a recipient who never saw the share dialog) can see at a glance
 *       whether the dataset is complete.
 *
 * CSV:  RFC 4180 with stable header row:
 *       created_at, kind, body, tags, person, is_starred, mood
 *       Handles commas, embedded double-quotes (`"` → `""`), and
 *       embedded newlines inside quoted fields. Null/undefined fields
 *       render as an empty cell — never the literal string "undefined".
 *       When `usedCache` is true the file is prefixed with a leading
 *       `# Cached export — ...` comment row carrying the same warning.
 *
 * Data-portability rule: never gate by tier.
 * Do NOT log memory contents here or anywhere in the export path.
 */

/**
 * Options shared by both builders. Both fields default at call time
 * (`usedCache` → false, `exportedAt` → new Date().toISOString()) so
 * existing single-arg callers keep working. Tests inject a fixed
 * `exportedAt` for deterministic snapshots.
 */
export interface ExportOptions {
  usedCache?: boolean;
  exportedAt?: string;
}

/**
 * Canonical JSON memory-row schema (stable — do not rename keys
 * across versions):
 *   id / client_id    — the client-assigned stable identifier
 *   server_id         — Polsia's server id, null if never synced
 *   kind              — "memory" | "call"
 *   body              — full text content (renamed from `content` for clarity)
 *   tags              — array of tag strings
 *   mood              — server-held mood string, null when unset
 *   is_starred        — server-held starred flag, false when unset
 *   location          — null (not captured in v1)
 *   person            — linked contact name, null if absent
 *   linked_event_id   — linked event, null if absent
 *   created_at        — ISO-8601 timestamp (device clock)
 *   updated_at        — ISO-8601 timestamp; equals created_at when no update tracked
 *
 * Intentionally uses snake_case / user-friendly keys instead of the
 * internal camelCase `Memory` fields so the exported file reads naturally
 * in any spreadsheet, script, or import tool without camelCase conversion.
 */
export function buildJsonExport(
  memories: Memory[],
  options: ExportOptions = {},
): string {
  const usedCache = options.usedCache ?? false;
  const exportedAt = options.exportedAt ?? new Date().toISOString();

  const rows = memories.map((m) => ({
    id: m.id,
    client_id: m.id,
    server_id: m.serverId ?? null,
    kind: m.kind,
    body: m.content,
    tags: m.tags ?? [],
    mood: m.mood ?? null,
    is_starred: m.isStarred ?? false,
    location: null,
    person: m.person ?? null,
    linked_event_id: m.linkedEventId ?? null,
    created_at: m.timestamp,
    updated_at: m.timestamp,
  }));

  // `note` is only present when the export came from the offline
  // cache so the absence of the key is itself a positive "fresh
  // server data" signal for downstream tooling.
  const metadata: {
    cached: boolean;
    exported_at: string;
    note?: string;
  } = {
    cached: usedCache,
    exported_at: exportedAt,
  };
  if (usedCache) {
    metadata.note = buildCachedExportFileNote(exportedAt);
  }

  return JSON.stringify(
    { _export_metadata: metadata, memories: rows },
    null,
    2,
  );
}

// Accepts unknown so callers can hand in `undefined`, `null`, booleans,
// numbers — anything that might come off a Memory field — without a
// per-call coalesce. Null and undefined become an empty cell (NOT
// the literal "null" / "undefined" strings).
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvExport(
  memories: Memory[],
  options: ExportOptions = {},
): string {
  const usedCache = options.usedCache ?? false;
  const exportedAt = options.exportedAt ?? new Date().toISOString();

  const header = [
    "created_at",
    "kind",
    "body",
    "tags",
    "person",
    "is_starred",
    "mood",
  ].join(",");
  const rows = memories.map((m) => {
    const tags = (m.tags ?? []).join(";");
    // is_starred renders as "true"/"false" so it round-trips through
    // any spreadsheet without locale quirks. Undefined → empty cell.
    const isStarred =
      m.isStarred === undefined || m.isStarred === null
        ? ""
        : m.isStarred
          ? "true"
          : "false";
    return [
      csvEscape(m.timestamp),
      csvEscape(m.kind),
      csvEscape(m.content),
      csvEscape(tags),
      csvEscape(m.person),
      csvEscape(isStarred),
      csvEscape(m.mood),
    ].join(",");
  });

  // The cached-copy banner is a leading `#`-prefixed line. Most CSV
  // readers (Excel, Google Sheets, Numbers) will surface it as a
  // visible first row rather than dropping it silently, which is
  // exactly what we want — silent dropping would re-create the bug
  // this task is fixing.
  const lines = usedCache
    ? [`# ${buildCachedExportFileNote(exportedAt)}`, header, ...rows]
    : [header, ...rows];
  return lines.join("\r\n");
}
