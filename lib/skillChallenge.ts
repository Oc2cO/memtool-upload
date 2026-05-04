/**
 * Friend-challenge deep-link encoder/decoder for Skills Bundle 1
 * (Task #337).
 *
 * The link looks like:
 *   memtool://skills/challenge?p=<base64url-payload>
 * (and the universal/HTTPS equivalent — Expo Router resolves both
 * to /skills/challenge.)
 *
 * The payload is a small JSON blob:
 *   { v, s (skill), r (round-seed uint32), n (sender display name),
 *     k (sender score), t (sent-at unix ms) }
 *
 * Pure module: no React, no AsyncStorage, no network. Tests pin
 * encode/decode round-trips on every supported skill plus all the
 * malformed shapes we expect to see in the wild (truncated link,
 * bad base64, wrong skill id, missing fields, future protocol
 * version).
 *
 * The free-friend-challenge round bypass (one round any signed-in
 * user can play even without owning the skill) is handled at the
 * route layer, not here — this module only parses the link.
 */

import type { SkillId } from "./skillsBundle";

export const CHALLENGE_PROTOCOL_VERSION = 1;

const VALID_SKILL_IDS: ReadonlySet<SkillId> = new Set<SkillId>([
  "mem_says",
  "signal_sort",
  "pattern_path",
  "echo_count",
]);

export interface ChallengePayload {
  /** Protocol version. Reject anything we don't recognize. */
  version: number;
  skillId: SkillId;
  /** uint32 round seed. Both players replay the same shape from it. */
  seed: number;
  /** Display name of the sender, trimmed and length-capped. */
  senderName: string;
  /** Sender's final score on the round, non-negative integer. */
  senderScore: number;
  /** Unix ms the link was created. */
  sentAt: number;
}

interface WirePayload {
  v: number;
  s: string;
  r: number;
  n: string;
  k: number;
  t: number;
}

const MAX_NAME_LEN = 32;

function clampName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "A friend";
  return trimmed.length > MAX_NAME_LEN
    ? trimmed.slice(0, MAX_NAME_LEN)
    : trimmed;
}

function base64UrlEncode(s: string): string {
  // Cross-platform base64. globalThis.btoa exists in RN's Hermes
  // (and on web), but only handles latin1 — we JSON-stringify ASCII
  // so that's safe. We then convert the standard alphabet to URL-safe.
  const b64 =
    typeof globalThis.btoa === "function"
      ? globalThis.btoa(s)
      : Buffer.from(s, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string | null {
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const fixed = pad === 0 ? padded : padded + "=".repeat(4 - pad);
    if (typeof globalThis.atob === "function") {
      return globalThis.atob(fixed);
    }
    return Buffer.from(fixed, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function encodeChallengePayload(
  payload: Omit<ChallengePayload, "version">,
): string {
  const wire: WirePayload = {
    v: CHALLENGE_PROTOCOL_VERSION,
    s: payload.skillId,
    r: payload.seed >>> 0,
    n: clampName(payload.senderName),
    k: Math.max(0, Math.floor(payload.senderScore)),
    t: Math.floor(payload.sentAt),
  };
  return base64UrlEncode(JSON.stringify(wire));
}

export function decodeChallengePayload(
  encoded: string,
): ChallengePayload | null {
  if (typeof encoded !== "string" || encoded.length === 0) return null;
  const json = base64UrlDecode(encoded);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const w = parsed as Partial<WirePayload>;
  if (w.v !== CHALLENGE_PROTOCOL_VERSION) return null;
  if (typeof w.s !== "string" || !VALID_SKILL_IDS.has(w.s as SkillId)) {
    return null;
  }
  if (typeof w.r !== "number" || !Number.isFinite(w.r)) return null;
  if (typeof w.n !== "string") return null;
  if (typeof w.k !== "number" || !Number.isFinite(w.k) || w.k < 0) return null;
  if (typeof w.t !== "number" || !Number.isFinite(w.t)) return null;
  return {
    version: w.v,
    skillId: w.s as SkillId,
    seed: w.r >>> 0,
    senderName: clampName(w.n),
    senderScore: Math.floor(w.k),
    sentAt: Math.floor(w.t),
  };
}

/**
 * Build the full deep link the sender shares. The base path defaults
 * to the `memtool://` custom scheme registered in `app.json`; tests
 * inject `https://memtool.app` so universal-link parsing on iOS still
 * resolves to the same query shape.
 */
export function buildChallengeUrl(
  payload: Omit<ChallengePayload, "version">,
  baseUrl = "memtool://skills/challenge",
): string {
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}p=${encodeChallengePayload(payload)}`;
}

/**
 * Extract the encoded payload from a query-string-like input. Accepts
 * either the raw `p=...` value or the full URL with the query string
 * embedded — both shapes appear depending on how Expo Linking dispatches
 * the deep link.
 */
export function decodeChallengeUrl(
  url: string,
): ChallengePayload | null {
  if (typeof url !== "string" || url.length === 0) return null;
  const qIndex = url.indexOf("?");
  const query = qIndex >= 0 ? url.slice(qIndex + 1) : url;
  const params = query.split("&");
  for (const part of params) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    if (key !== "p") continue;
    const rawVal = part.slice(eq + 1);
    let val = rawVal;
    try {
      val = decodeURIComponent(rawVal);
    } catch {
      // Already-unencoded payloads still parse below; fall through.
    }
    return decodeChallengePayload(val);
  }
  return null;
}

/**
 * Short, human-friendly share text for the OS share sheet. Kept here
 * (not in the route file) so paywall/screen-reader copy and analytics
 * "challenge_sent" properties stay aligned in tests.
 */
export function buildChallengeShareText(payload: {
  skillTitle: string;
  senderName: string;
  senderScore: number;
  url: string;
}): string {
  const name = clampName(payload.senderName);
  const score = Math.max(0, Math.floor(payload.senderScore));
  return (
    `${name} just scored ${score} on ${payload.skillTitle} in MemTool. ` +
    `Beat them: ${payload.url}`
  );
}
