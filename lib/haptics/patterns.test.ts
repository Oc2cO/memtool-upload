import { readFileSync } from "fs";
import { join } from "path";

import { HAPTIC_NAMES, HAPTIC_PATTERNS } from "./patterns";
import type { AhapPattern, HapticName } from "./types";

// The .ahap files in `assets/haptics/` are the canonical, hand-authored
// haptic vocabulary; the TypeScript constants in `patterns.ts` are a
// machine-readable mirror used by the JS player. They MUST stay in
// sync. If this test fails, edit whichever copy is stale so the bytes
// match again — they describe the same patterns and a real Core Haptics
// native module will load the .ahap files directly off the iOS bundle.

const ASSETS_DIR = join(__dirname, "..", "..", "assets", "haptics");

function loadAhap(name: HapticName): AhapPattern {
  const filePath = join(ASSETS_DIR, `${name}.ahap`);
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as AhapPattern;
}

describe("haptic patterns vocabulary", () => {
  it("has six named signatures", () => {
    expect(HAPTIC_NAMES).toHaveLength(6);
    expect(new Set(HAPTIC_NAMES).size).toBe(HAPTIC_NAMES.length);
  });

  it.each(
    ([
      "capture",
      "link-formed",
      "streak-extended",
      "day-recap-ready",
      "error",
      "undo",
    ] as const).map((name) => [name]),
  )(
    "the .ahap file for '%s' matches the TypeScript constant byte-for-byte",
    (name) => {
      const fromDisk = loadAhap(name);
      expect(HAPTIC_PATTERNS[name]).toEqual(fromDisk);
    },
  );

  it.each(HAPTIC_NAMES.map((name) => [name]))(
    "'%s' has at least one event and a valid Version",
    (name) => {
      const pattern = HAPTIC_PATTERNS[name];
      expect(pattern.Version).toBe(1.0);
      expect(pattern.Pattern.length).toBeGreaterThan(0);
      for (const entry of pattern.Pattern) {
        expect(entry.Event.Time).toBeGreaterThanOrEqual(0);
        const intensity = entry.Event.EventParameters.find(
          (p) => p.ParameterID === "HapticIntensity",
        );
        const sharpness = entry.Event.EventParameters.find(
          (p) => p.ParameterID === "HapticSharpness",
        );
        expect(intensity?.ParameterValue).toBeGreaterThanOrEqual(0);
        expect(intensity?.ParameterValue).toBeLessThanOrEqual(1);
        expect(sharpness?.ParameterValue).toBeGreaterThanOrEqual(0);
        expect(sharpness?.ParameterValue).toBeLessThanOrEqual(1);
        if (entry.Event.EventType === "HapticContinuous") {
          expect(entry.Event.EventDuration).toBeGreaterThan(0);
        }
      }
    },
  );
});
