# MEMTOOL VOICE CAPTURE SOT

Purpose: Voice Capture sub-brain for completed connection work and parked visual system work.

## Current Status

Completed lane:
- LANE 27S-D - Voice Capture Connection Patch 1

Commit:
- `dd81a7a fix: clarify voice transcription availability`

Parked lane:
- LANE 27S-D2 - Voice Capture Modal + Bubble/Text Sync Visual System

## Completed Work

Voice Capture Connection Patch 1:
- Clarified voice transcription availability.
- Clarified `module_not_linked` / installed-build messaging.
- Preserved file-based STT as V1 connection path.
- Kept streaming/live captions disabled for now.
- Validated with typecheck and targeted tests at the time of completion.

## Current Truth

Native STT cannot be proven in Expo Go or older installed builds.

Actual on-device transcription requires an installed iOS build/dev client/TestFlight binary that includes the local SpeechToText native module.

Do not spend EAS/build credits unless Steve explicitly approves.

## Parked Work

LANE 27S-D2 should handle:
- Premium voice capture modal/system.
- Voice-activatable and/or tap-to-talk direction.
- Bubble/voice/text sync.
- Memora/Oc2cO visual alignment.
- Removal/replacement of stale hold-to-talk scaffolding.
- No default/generic/robot voice direction.

## Next Lane / Stage

Next voice work should be opened only when Steve explicitly chooses to resume Voice Capture.

Likely next lane:
- LANE 27S-D2 - Voice Capture Modal + Bubble/Text Sync Visual System

## No-Touch Rules

- Do not touch Voice Capture during Home lanes unless compile safety requires it.
- Do not run EAS build.
- Do not spend build credits.
- Do not change native/prebuild/build config unless Steve explicitly opens that lane.
- Do not add voice/lip-sync implementation during unrelated lanes.

## Screenshots / Assets

Voice screenshots or voice UI references belong in:
- `MEMTOOL_IMAGE_MANIFEST.md`
- `MEMTOOL_SCREENSHOT_INTAKE.md`

Voice-specific assets should remain reference-only until a Voice Capture lane chooses app-ready exports.
