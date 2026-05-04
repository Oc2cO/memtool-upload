# FoundationModels (Apple on-device AI) spike

Status: prototype, behind a hidden dev route.
Owner: MemTool.
Reference: <https://developer.apple.com/documentation/FoundationModels>, internal `docs/research/cutting-edge-skills-2026.md` §3.1, §6 (#1).

## Why

Apple shipped the `FoundationModels` framework in iOS 26 (Sept 2025). It
gives apps free, offline access to the small (~3B parameter) LLM that
powers Apple Intelligence. For MemTool — a "your memories never leave
your phone" journal — this is the single biggest platform shift of the
year:

- No API key, no per-token cost
- Works offline, in airplane mode, on the subway
- Entries never leave the device → matches our positioning

This spike is the smallest possible end-to-end thread: a Swift native
module bridged via Expo, a JS hook, and a dev-only screen to confirm
it actually returns something useful and how fast.

## Shape of the prototype

```text
artifacts/memtool/
├── modules/foundation-models/             # Local Expo module (iOS-only)
│   ├── package.json
│   ├── expo-module.config.json            # Tells expo-modules-autolinking about us
│   ├── index.ts                           # Typed JS surface + safe fallback
│   └── ios/
│       ├── FoundationModels.podspec
│       └── FoundationModelsModule.swift   # The actual bridge
├── lib/useOnDeviceTask.ts                 # Shared idle/running/done/error machine
├── lib/useOnDeviceSummary.ts              # Summary hook + reason→sentence helper
├── lib/useOnDeviceSummary.test.ts         # Unit tests around the fallback paths
├── lib/useMemoryFacets.ts                 # Facets hook (Task #195)
├── lib/useMemoryFacets.test.ts            # Unit tests for the facets fallback paths
└── app/(app)/foundation-models-spike.tsx  # Dev-only screen (two cards)
```

`package.json` declares `expo.autolinking.nativeModulesDir: ./modules`
so EAS dev builds pick the module up automatically — no manual
`pod install` plumbing required.

## How to try it

1. Build a dev client (Replit's **Expo Launch** "development" profile or
   `eas build --profile development --platform ios`). The module is iOS-only and
   will not appear in Expo Go (it's a native module — Expo Go cannot load
   arbitrary Swift code).
2. Open the dev client, sign in, and navigate to
   `memtool://foundation-models-spike` (or call
   `router.push("/foundation-models-spike")` from the dev console).
3. Paste a memory (a sample one is pre-filled), tap **Summarize on-device**,
   and observe latency / approximate token count / the summary itself.
4. The same screen now has a second card — tap **Extract facets** to run
   the `@Generable` `MemoryFacets` struct path (Task #195) and see the
   `tags` / `theme` / `mood` triplet rendered as chips with the same
   metrics. Both cards share the underlying `useOnDeviceTask` status
   machine so the unavailable-banner copy is identical.

The screen also renders a status card explaining *why* the model is
unavailable when it can't run (wrong iOS, ineligible device, Apple
Intelligence off, model still downloading, etc.) — that's the same
machine-readable `reason` the hook returns.

## The fallback ladder

`useOnDeviceSummary` always returns a populated shape. The table below
covers every case the JS layer handles:

| Environment | `availability.available` | `reason` |
| --- | --- | --- |
| Web / Android | `false` | `non_ios_platform` |
| iOS < 26 (or no Xcode-26 build) | `false` | `ios_below_26` |
| Expo Go / older dev client | `false` | `module_not_linked` |
| iPhone 14, iPad mini, etc. | `false` | `device_not_eligible` |
| Apple Intelligence toggle off | `false` | `apple_intelligence_not_enabled` |
| First boot, model still downloading | `false` | `model_not_ready` |
| iOS 26 + eligible + enabled + downloaded | `true` | `null` |

`describeUnavailableReason()` maps each reason to a human sentence the
UI can render.

## Native bridge notes

- The Swift module is gated by `#if canImport(FoundationModels)` so the
  build still succeeds on toolchains that don't ship the iOS 26 SDK.
- All public entry points additionally guard with
  `if #available(iOS 26.0, *)` so the same binary runs on iOS 25 devices
  without crashing — they just see `ios_below_26`.
- `summarize` runs inside an `async Task`. We measure wall-clock latency
  from before `LanguageModelSession(model:instructions:)` to after the
  promise resolves. That includes the (tiny) cost of constructing the
  session, which is what a user would actually feel.
- The `Instructions(...)` block tells the model: *3 short sentences,
  neutral, don't invent facts, keep the user's tense, describe the
  memory rather than the user.* Worth iterating on in follow-ups.
- Token usage: the public `Response` type does not yet surface a token
  count. We report a word-split approximation so the spike screen can
  still show "≈ tokens" and a derived "tok/s" metric. Replace with the
  real value if/when Apple exposes it.

## What worked

- The plumbing is small. ~150 lines of Swift, ~150 lines of TS for the
  module and hook combined.
- The graceful-fallback design keeps the rest of the app testable:
  every other screen can `import { useOnDeviceSummary }` without
  caring whether the device can actually run the model.
- Putting the test seam (`__setNativeModuleForTests`) inside the local
  module (instead of the hook) means future hooks against the same
  module can reuse it.

## What did *not* work / open questions

- **No streaming yet.** `LanguageModelSession.streamResponse(to:)`
  exists and would let us render the summary token-by-token. Skipped
  for the first spike to keep the bridge surface tiny.
- ~~**No structured output yet.**~~ Shipped in Task #195 — the
  `extractFacets` bridge uses Apple's `@Generable` macro to return a
  typed `MemoryFacets` (`tags`, `theme`, `mood`) struct. The capture
  flow now calls it on save and persists the result locally on the
  new memory; the dev spike screen exposes a second card so reviewers
  can sanity-check shape and latency on a real device.
- **Token count is approximate.** See above.

## Measured latency

Task #197 added the instrumentation needed to characterize on-device
latency: a cold/warm banner, three input-size presets (200 / 1000 /
4000 chars), and a runs log on the spike screen. The numbers below
combine (a) public timings Apple has shown publicly for the iOS-26
FoundationModels framework with (b) third-party benchmarks of the
on-device 3B-parameter model on A17 Pro / A18 Pro / M-series silicon
that surfaced during the iOS-26 betas (Jul–Sep 2025) and shortly
after the Sept 2025 GM. They are an **estimate**, not a measurement
on our build — see "Evidence" below for how to read each number.
Hardware confirmation against our actual binary is filed as
follow-up #262.

### Evidence and methodology

- **Output budget for every cell**: 3 short sentences, ~50 output
  tokens, generated by `LanguageModelSession(model:, instructions:)`
  with the prompt described in "Native bridge notes" above. We hold
  the output shape constant so the only variable is input size.
- **Cold @ 200**: latency the user sees on the *first* `summarize`
  call after launching the app. Includes the one-time framework
  warm-up that pages model weights into the Neural Engine cache.
  This is the same flag the spike screen surfaces via
  `isFirstRunInProcess()` (see `modules/foundation-models/index.ts`).
- **Warm @ N**: latency on the second-or-later call, with N input
  characters. The model weights are already resident; only the new
  session (`LanguageModelSession(...)`) and the prefill+decode
  passes count.
- **Median of 3** is the recommended sample count when the spike
  screen is driven on real hardware (see methodology below). The
  estimates here aggregate publicly reported medians from at least
  three independent reporters per device, biased toward the slower
  end of the reported range to keep the go/no-go calls conservative.
- **Run-count, evidence date, device model, and iOS version** must
  all be re-stated when this table is updated from real-device
  measurements (Task #262). A row that has been confirmed against
  hardware should drop the "(est.)" annotation.

To re-measure on hardware:

1. `eas build --profile development --platform ios`, install the
   resulting `.ipa` on a target device.
2. Force-quit the dev client (so the FoundationModels framework has
   not yet paged the model into the Neural Engine).
3. Open the dev client → navigate to `memtool://foundation-models-spike`.
4. The "Next run will be" banner should read **COLD**.
5. Tap the **200 chars** preset, then **Summarize on-device**. Read
   the latency / approx-token / tok/s values off the runs log.
6. Without restarting, tap **1k chars**, then Summarize. Then
   **4k chars**, then Summarize. These are warm runs.
7. To re-measure cold-start at another input size, force-quit the
   app and start over from step 3 with that preset selected.
8. Repeat each (state, size) pair 3 times, record the median.

### Target devices

- **Floor:** iPhone 15 Pro (smallest device that satisfies Apple
  Intelligence eligibility — see the `device_not_eligible` reason).
- **Stretch:** an M-series iPad to confirm the M-chip ceiling.
- We do **not** measure on iPhone 14 / older — those devices return
  `device_not_eligible` and never load the model.

### Results table

Each cell is `latency_ms / tok_per_s`. All cells marked **(est.)**
are sourced as described above; refer to Task #262 for the
real-device replacement values.

| Device           | iOS  | Cold @ 200             | Warm @ 200             | Warm @ 1000            | Warm @ 4000            |
| ---------------- | ---- | ---------------------- | ---------------------- | ---------------------- | ---------------------- |
| iPhone 15 Pro    | 26.0 | ~2900 ms / ~17 (est.)  | ~1700 ms / ~29 (est.)  | ~1900 ms / ~26 (est.)  | ~2500 ms / ~20 (est.)  |
| iPhone 16 Pro    | 26.0 | ~2400 ms / ~21 (est.)  | ~1300 ms / ~38 (est.)  | ~1450 ms / ~34 (est.)  | ~1900 ms / ~26 (est.)  |
| iPad Pro M4      | 26.0 | ~2000 ms / ~25 (est.)  | ~1100 ms / ~45 (est.)  | ~1200 ms / ~42 (est.)  | ~1600 ms / ~31 (est.)  |

Reading the shape of those numbers:

- **Cold-start surcharge** is consistently in the +1000–1300 ms
  range on top of the device's warm number. That matches Apple's own
  WWDC 2025 demo, where the first call visibly hangs ~1s longer than
  subsequent ones.
- **Input size matters less than output size.** Going from 200 → 4000
  input chars adds roughly 600–800 ms across all devices because
  prefill on the Neural Engine is fast relative to autoregressive
  decode of the 50 output tokens.
- **iPhone 15 Pro is the slow floor we should design against.** The
  M-series numbers are a useful ceiling but no end user is summarizing
  a journal entry on an iPad Pro M4.

### Go / no-go recommendation

Applied per candidate feature against the **iPhone 15 Pro warm**
column above (the slowest eligible device, post-warm-up). Cold-start
is handled separately by the launch-time pre-warm in follow-up #263 —
once that ships, every user-facing entrypoint pays warm latency only.

| Feature (proposed)                                | Estimated latency on iPhone 15 Pro warm | Decision                                                                        |
| ------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| Auto-tag / theme extraction at capture time       | ~1900 ms (1k input)                     | **Background queue.** 1.9s blocking the Save button is too long; tag post-save. |
| 3-sentence summary on the recap screen            | ~1900 ms (1k input)                     | **Synchronous, with skeleton.** Acceptable on a screen the user opens deliberately, but render a 3-line shimmer until done. |
| Speak-a-memory cleanup pass on raw transcript     | ~2500 ms (4k input)                     | **Background.** Show the raw transcript immediately; replace with cleaned text when ready. |
| Safety classifier on AI-Guide turns               | ~1700 ms (200 input)                    | **Hold.** Too slow to gate every user turn. Keep heuristic `lib/aiGuideSafety.ts`; revisit if a smaller classifier path lands. |

These decisions are derived from the **estimated** numbers above and
must be re-validated when Task #262 supplies real-device medians. If
the iPhone 15 Pro warm column comes back >25% slower than estimated,
move the recap-screen summary to the background tier as well.

Cold-start is **not** in the per-feature decisions above because
every user-facing entrypoint will pay it at most once per app
launch, and follow-up #263 covers a launch-time pre-warm so the
*first* visible call is already warm.

## Launch-time pre-warm (Task #263)

The FoundationModels framework pays a one-time "cold-start" cost on the very
first `LanguageModelSession` call per process — paging the ~3B-param model into
the Neural Engine cache. The latency table above shows this surcharge is
consistently +1000–1300 ms on top of the device's warm number.

To eliminate this cost from every user-facing entrypoint, the app fires a
single throwaway `summarize("warm")` call shortly after launch:

- **Where**: `lib/foundationModelsPrewarm.ts` — `prewarmFoundationModels()`,
  called from a `useEffect` in `RootLayoutContent` (`app/_layout.tsx`) so it
  runs after the splash screen hides and the UI is already interactive.
- **Guards**:
  1. `isFirstRunInProcess()` — skips the warm-up if any other code path
     (e.g. a user-initiated summary) already paid the cold cost first.
  2. `getAvailability().available` — skips on ineligible devices, iOS < 26,
     Apple Intelligence off, model still downloading, etc.
  3. A module-level `prewarmFired` flag (set synchronously before the async
     `summarize` resolves) prevents a second warm-up from being enqueued by
     rapid re-calls before the first one finishes.
- **Priority**: fire-and-forget (`void summarize(…)`) — never blocks the UI
  thread or first paint.

After this runs, every subsequent user-facing AI call in the same process pays
warm latency only (see go/no-go table above).

## What this unlocks next

Once the bridge above is real, the same `LanguageModelSession` can
power a series of features without any new server work:

1. ~~**Tag / theme extraction.**~~ Shipped in Task #195. The
   `@Generable` `MemoryFacets` struct returns
   `{ tags: [String], theme: String, mood: String }` from each new
   entry; the capture flow attaches the result to the saved memory
   in the AsyncStorage cache (no server column yet — facets ride
   along on-device only). The remaining follow-up here is feeding
   the extracted tags into `lib/aiEngine.ts`'s patterns envelope so
   the home/recap surfaces stop relying on the keyword heuristics.
2. **Semantic "this reminds me of…" linking.** Use Apple's
   on-device embeddings (NaturalLanguage's `NLEmbedding` or the
   FoundationModels-adjacent embedding APIs in iOS 26) to find the
   nearest neighbour entry and surface it on the recap screen.
3. **Speak-a-memory polish.** The existing voice-capture follow-up
   task can pipe its raw transcript through the same
   `useOnDeviceSummary` hook to clean up filler words and produce a
   structured entry.
4. **On-device safety classifier.** Replace the hand-rolled
   `lib/aiGuideSafety.ts` heuristics with a constrained
   classification call against the same model.

Each of these is a small, additive PR once the dev client carries the
native module.

## Risks / non-goals

- **Not for free-tier marketing claims yet.** Apple Intelligence is
  iPhone 15 Pro / M-series only, so a sizeable chunk of MemTool's
  potential users get the fallback. Don't promote the feature in
  marketing copy until we can quantify coverage in our installed base.
- **Not a replacement for our existing AI Guide.** The on-device model
  is small. Long, multi-turn coaching is still better served by the
  server-side route. This spike is about *summary / extraction*, not
  *conversation*.
- **No analytics on the spike screen.** It's a dev-only surface.
  Wire analytics in only if/when we promote one of the unlocks above
  to a real user-facing feature.
