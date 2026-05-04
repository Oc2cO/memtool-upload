# Cognitive Sound + Haptic Layer

Task #341 ships an opt-in ambient sound layer and audits MemTool's
existing haptic vocabulary against the cognitive touchpoints the
task calls out.

## Goal

Match sonic / tactile feedback to the brain state we're trying to
support per context:

| Context  | Bed                                    | Binaural | Brain state |
|----------|----------------------------------------|----------|-------------|
| capture  | rain / forest                          | ~6 Hz    | theta — reflective |
| recap    | warm ambient music                     | ~10 Hz   | alpha — open / receptive |
| games    | subtle UI bed                          | ~14 Hz   | light beta — focus |
| sleep    | slow instrumental / white noise        | ~2 Hz    | delta — wind-down |

The layer is **off by default** and is enhancement, never required.
Every feature has a visual-only path.

## Defaults

- master switch — **off**
- binaural sub-layer — **off**
- master volume — **0.4** (low; sits under foreground audio)
- headphones-recommended hint — shown the first time binaural is
  on; tracked in AsyncStorage so the same install never re-nags

## Architecture

```
artifacts/memtool/lib/cognitiveAudio/
├── index.ts            # public surface
├── types.ts            # CognitiveAudioContext + per-context labels / Hz
├── preferences.ts      # AsyncStorage-backed master / binaural / volume
├── registry.ts         # asset map per context (bundled WAVs)
├── headphones.ts       # best-effort wired-output detection
├── service.ts          # singleton playback owner (expo-audio)
└── useCognitiveAudio.ts # screen-side hook: mount = play, unmount = stop
```

### Wiring

The hook is mounted by every cognitive surface:

| Screen                             | Context |
|------------------------------------|---------|
| `app/(app)/capture.tsx`            | capture |
| `app/(app)/voice-capture.tsx`*     | capture (planned) |
| `app/(app)/recap.tsx`              | recap   |
| `app/(app)/memory-match.tsx`       | games   |
| `app/(app)/game-24.tsx`            | games   |
| `app/(app)/wellness.tsx`           | sleep   |

\* voice-capture already owns its own `expo-audio` recorder and is
intentionally NOT layered with the cognitive bed today — recording
should never have to compete with ambience.

### Fades

Every `playContext()` ramps from 0 to target volume over 600 ms;
every `stop()` / cross-fade ramps the previous players from
current volume down to 0 over 500 ms before tearing them down. The
fades are scheduled with `setInterval` so they survive even when
the surrounding promise chain is suspended. `applyLiveMasterVolume`
updates the steady-state targets without disturbing an in-flight
fade — the fade loop picks up the new target on its next tick.

### Audio session policy

`service.ts` calls `setAudioModeAsync` with:

- `playsInSilentMode: false` — respects the iOS silent switch.
- `shouldPlayInBackground: false` — the layer is contextual, not
  meditation-app persistent.
- `interruptionMode: "mixWithOthers"` (iOS) — system audio (calls,
  navigation, foreground music) dominates; our bed rides under.
- `interruptionModeAndroid: "duckOthers"` — equivalent on Android.

iOS AVAudioSession auto-pauses us during a phone call interruption
because we're not registering with a `playback` category.

### Asset story

The four ambient beds and four binaural sub-tones ship in the
binary under `artifacts/memtool/assets/audio/cognitive/`. They're
synthesized procedurally by
`scripts/src/generate-cognitive-audio.ts` (run with
`pnpm --filter @workspace/scripts run generate:cognitive-audio`)
so the layer is license-clean and has no external sample
dependencies.

Per-file size: each bed is ~220–530 KB (mono 16-bit / 22050 Hz,
5–10s loops) and each binaural tone is ~350–530 KB (stereo
16-bit, 4–6s loops). Total impact ≈ 2.8 MB. The service loops at
the player level, so a 6-second source feels continuous.

The bed envelopes are intentionally subtle:

- **capture** — heavily low-passed pink noise with a slow
  amplitude shimmer (rain-like)
- **recap** — three-layer warm sine pad over a breath of pink
- **games** — high-passed pink at quarter amplitude
- **sleep** — low sine drone over a soft pink wash

Binaural tones are stereo with the left ear at the carrier and the
right ear at carrier + delta, where delta = `BINAURAL_HZ[ctx]`
(6 / 10 / 14 / 2 Hz).

To re-tune any of these (carriers, amplitudes, durations), edit
the BedSpec / ToneSpec arrays in the generator script and re-run.

## Settings panel

`COGNITIVE SOUND` section, immediately above the haptic demo. It
has:

- **Sound layer** master switch (testID `cognitive-audio-master-toggle`)
- **Binaural sub-layer** switch (testID `cognitive-audio-binaural-toggle`),
  disabled when master is off
- One-time **headphones-recommended hint** (testID
  `cognitive-audio-headphones-hint`) shown the first time binaural
  is enabled, gated by `headphonesHintShown` in storage and a
  best-effort headphones probe (`lib/cognitiveAudio/headphones.ts`).
  When detection isn't available we err on the side of showing the
  hint once — the worst case is a wired-up user sees it and taps
  "Got it"
- **Master volume** as a 5-step picker (0 / 25 / 50 / 75 / 100)
  with live preview via `applyLiveMasterVolume()`
- Per-context audit rows (testID `cognitive-audio-context-<ctx>`)

## Haptic audit

The task's four haptic touchpoints (capture confirm, recap reveal,
milestone celebration, game feedback) all map onto signatures
already shipped in Tasks #226 / #243 / #252. No new patterns are
needed for v1; Task #341 documents the mapping so future haptic
work doesn't accidentally duplicate signatures:

| Touchpoint            | Signature           | Source |
|-----------------------|---------------------|--------|
| capture confirm       | `capture`           | `lib/haptics/patterns.ts` |
| recap reveal          | `day-recap-ready`   | `lib/haptics/patterns.ts` |
| milestone celebration | `streak-extended`   | `lib/haptics/patterns.ts` |
| game correct          | `link-formed`       | `lib/haptics/patterns.ts` |
| game wrong            | `error`             | `lib/haptics/patterns.ts` |
| undo                  | `undo`              | `lib/haptics/patterns.ts` |

All six respect the master "Haptics" switch, the per-signature
mute map, and the system reduce-motion / silent settings via the
existing `useHaptic` playback gate (Task #243 / #252).

## QA on real devices

See `docs/HAPTICS_REAL_DEVICE_CHECKLIST.md` for the haptic side.
For the cognitive audio side, on a real iOS + Android device:

1. Confirm master OFF → no audio under any context.
2. Toggle master ON in Settings → context wiring lights up the
   moment you push capture / recap / a game / wellness.
3. Toggle binaural ON → `cognitive-audio-headphones-hint` appears.
4. Hardware silent switch → audio stops (iOS).
5. Receive a phone call mid-bed → bed pauses, resumes after.
6. Start system audio (Music / Maps voice) → bed ducks under.
7. Drag the volume picker → playback updates live without restart.
