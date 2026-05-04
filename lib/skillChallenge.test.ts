/**
 * Friend-challenge link round-trip tests (Task #337).
 *
 * The challenge link is the only persistence boundary that crosses
 * device → SMS/email → device, so anything we encode must survive
 * URL escaping, base64 padding, and the user copy-pasting just the
 * `?p=…` fragment. These tests pin those assumptions so a future
 * payload tweak doesn't silently break friend invites already in
 * the wild.
 */

import {
  buildChallengeShareText,
  buildChallengeUrl,
  CHALLENGE_PROTOCOL_VERSION,
  decodeChallengePayload,
  decodeChallengeUrl,
  type ChallengePayload,
} from "./skillChallenge";
import { SKILLS } from "./skillsBundle";

const baseInput = {
  seed: 0xdeadbeef >>> 0,
  senderName: "Sam",
  senderScore: 425,
  sentAt: 1_700_000_000_000,
};

describe("skillChallenge encode/decode", () => {
  it("round-trips every supported skill id", () => {
    for (const skill of SKILLS) {
      const url = buildChallengeUrl({ ...baseInput, skillId: skill.id });
      const decoded = decodeChallengeUrl(url);
      expect(decoded).not.toBeNull();
      expect(decoded?.skillId).toBe(skill.id);
      expect(decoded?.seed).toBe(baseInput.seed);
      expect(decoded?.senderName).toBe(baseInput.senderName);
      expect(decoded?.senderScore).toBe(baseInput.senderScore);
      expect(decoded?.sentAt).toBe(baseInput.sentAt);
      expect(decoded?.version).toBe(CHALLENGE_PROTOCOL_VERSION);
    }
  });

  it("returns null for malformed payload strings", () => {
    expect(decodeChallengePayload("")).toBeNull();
    expect(decodeChallengePayload("not-base64!!!")).toBeNull();
    expect(decodeChallengePayload("dGVzdA")).toBeNull(); // "test" — not JSON
  });

  it("returns null when the link is missing the p param", () => {
    expect(decodeChallengeUrl("memtool://skills/challenge")).toBeNull();
    expect(decodeChallengeUrl("https://example.com/skills/challenge")).toBeNull();
  });

  it("rejects payloads with an unknown skill id", () => {
    const url = buildChallengeUrl({ ...baseInput, skillId: SKILLS[0]!.id });
    const corrupt = url.replace(/p=([^&]+)/, (_, p) => {
      const decoded = decodeChallengePayload(p) as ChallengePayload;
      const wire = {
        v: decoded.version,
        s: "not_a_real_skill",
        r: decoded.seed,
        n: decoded.senderName,
        k: decoded.senderScore,
        t: decoded.sentAt,
      };
      const reencoded = Buffer.from(JSON.stringify(wire))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      return `p=${reencoded}`;
    });
    expect(decodeChallengeUrl(corrupt)).toBeNull();
  });

  it("share text contains the link, sender, and score", () => {
    const url = buildChallengeUrl({ ...baseInput, skillId: "mem_says" });
    const text = buildChallengeShareText({
      skillTitle: "Mem Says",
      senderName: baseInput.senderName,
      senderScore: baseInput.senderScore,
      url,
    });
    expect(text).toContain("Mem Says");
    expect(text).toContain("Sam");
    expect(text).toContain("425");
    expect(text).toContain(url);
  });
});
