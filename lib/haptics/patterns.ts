// Six hand-authored haptic signatures that make up MemTool's "haptic
// vocabulary". The CANONICAL source for each pattern is the matching
// .ahap file in `assets/haptics/<name>.ahap` — those are real Apple
// AHAP (Apple Haptic and Audio Pattern) JSON files that Core Haptics
// can load directly off the iOS app bundle.
//
// Today the JS-side interpreter (`ahapPlayer.ts`) does not have a
// native CHHapticEngine module to call into, so we mirror the AHAP
// data as a TypeScript constant here and let the player approximate
// each event using `expo-haptics`'s built-in primitives. The jest
// test in `patterns.test.ts` proves the bytes in `.ahap` and the
// constants below stay in lock-step — break one, the test fails.
//
// When you edit any .ahap file you MUST also edit the matching entry
// here (or vice versa). The test will tell you which one drifted.

import type { AhapPattern, HapticName } from "./types";

const capture: AhapPattern = {
  Version: 1.0,
  Metadata: {
    Project: "MemTool",
    Pattern: "capture",
    Created: "2026-05-01",
    Description:
      "Soft-then-firm double tap. The 'caught it' confirmation when a memory is saved.",
  },
  Pattern: [
    {
      Event: {
        Time: 0.0,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.45 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.3 },
        ],
      },
    },
    {
      Event: {
        Time: 0.085,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.85 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.55 },
        ],
      },
    },
  ],
};

const linkFormed: AhapPattern = {
  Version: 1.0,
  Metadata: {
    Project: "MemTool",
    Pattern: "link-formed",
    Created: "2026-05-01",
    Description:
      "Two close taps merging into a soft continuous tail. Played when two memories or game cards bond into a pair.",
  },
  Pattern: [
    {
      Event: {
        Time: 0.0,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.6 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.7 },
        ],
      },
    },
    {
      Event: {
        Time: 0.06,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.6 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.7 },
        ],
      },
    },
    {
      Event: {
        Time: 0.12,
        EventType: "HapticContinuous",
        EventDuration: 0.18,
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.35 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.2 },
        ],
      },
    },
  ],
};

const streakExtended: AhapPattern = {
  Version: 1.0,
  Metadata: {
    Project: "MemTool",
    Pattern: "streak-extended",
    Created: "2026-05-01",
    Description:
      "Three rising taps — light, medium, heavy — tightly spaced. The crescendo of momentum when a streak day or run is extended.",
  },
  Pattern: [
    {
      Event: {
        Time: 0.0,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.4 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.55 },
        ],
      },
    },
    {
      Event: {
        Time: 0.07,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.65 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.65 },
        ],
      },
    },
    {
      Event: {
        Time: 0.16,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.95 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.8 },
        ],
      },
    },
  ],
};

const dayRecapReady: AhapPattern = {
  Version: 1.0,
  Metadata: {
    Project: "MemTool",
    Pattern: "day-recap-ready",
    Created: "2026-05-01",
    Description:
      "A gentle three-tap chime over a short shimmer. The 'your day is summarised' arrival cue.",
  },
  Pattern: [
    {
      Event: {
        Time: 0.0,
        EventType: "HapticContinuous",
        EventDuration: 0.3,
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.2 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.15 },
        ],
      },
    },
    {
      Event: {
        Time: 0.05,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.35 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.45 },
        ],
      },
    },
    {
      Event: {
        Time: 0.13,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.5 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.55 },
        ],
      },
    },
    {
      Event: {
        Time: 0.22,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.7 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.65 },
        ],
      },
    },
  ],
};

const error: AhapPattern = {
  Version: 1.0,
  Metadata: {
    Project: "MemTool",
    Pattern: "error",
    Created: "2026-05-01",
    Description:
      "Two firm thumps with a short pause. Distinct from iOS's default warning buzz so users hear 'this is MemTool saying no', not the system.",
  },
  Pattern: [
    {
      Event: {
        Time: 0.0,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.85 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.2 },
        ],
      },
    },
    {
      Event: {
        Time: 0.14,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.85 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.2 },
        ],
      },
    },
  ],
};

const undo: AhapPattern = {
  Version: 1.0,
  Metadata: {
    Project: "MemTool",
    Pattern: "undo",
    Created: "2026-05-01",
    Description:
      "A soft tap that gently retreats — short continuous taper. Reversal feels like 'pulling back', not 'pressing'.",
  },
  Pattern: [
    {
      Event: {
        Time: 0.0,
        EventType: "HapticTransient",
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.45 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.25 },
        ],
      },
    },
    {
      Event: {
        Time: 0.02,
        EventType: "HapticContinuous",
        EventDuration: 0.16,
        EventParameters: [
          { ParameterID: "HapticIntensity", ParameterValue: 0.25 },
          { ParameterID: "HapticSharpness", ParameterValue: 0.1 },
        ],
      },
    },
  ],
};

export const HAPTIC_PATTERNS: Record<HapticName, AhapPattern> = {
  capture,
  "link-formed": linkFormed,
  "streak-extended": streakExtended,
  "day-recap-ready": dayRecapReady,
  error,
  undo,
};

export const HAPTIC_NAMES: readonly HapticName[] = Object.keys(
  HAPTIC_PATTERNS,
) as HapticName[];
