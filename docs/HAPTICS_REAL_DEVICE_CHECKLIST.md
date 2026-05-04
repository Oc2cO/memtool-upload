# Core Haptics real-device smoke test (Task #227)

Status: required check before every TestFlight / App Store build.
Owner: MemTool.
Reference: `artifacts/memtool/modules/expo-core-haptics/`,
`artifacts/memtool/lib/haptics/ahapPlayer.ts`,
`artifacts/memtool/lib/haptics/coreHaptics.test.ts`.

## Why this checklist exists

The JS surface of the local `expo-core-haptics` module is unit-tested
in `artifacts/memtool/lib/haptics/coreHaptics.test.ts` — those tests
prove the JS / native router prefers Core Haptics when available,
falls back to the JS `expo-haptics` approximation when it isn't, and
correctly forwards / cancels the handle. **They do not exercise the
Swift bridge itself.** Jest cannot:

- start a real `CHHapticEngine`,
- parse an AHAP dictionary through `CHHapticPattern(dictionary:)`,
- restart the engine after `engineWasReset` fires (incoming call,
  Siri, audio-session interruption),
- distinguish a rich Core Haptics signature (smooth ramps, true
  continuous events, frequency control) from the JS approximation
  (`UIImpactFeedbackGenerator` taps spaced by `setTimeout`).

Only a tester holding a physical iPhone can confirm those. This
checklist is that tester's script.

## Pre-requisites

- A **real iPhone** (the iOS simulator has no Taptic Engine and the
  bench will report `hardware_not_supported`).
- A **development EAS build** containing the `expo-core-haptics`
  native module:

  ```bash
  pnpm --filter memtool exec eas build --profile development --platform ios
  ```

  Expo Go cannot load the module — it will report
  `module_not_linked` and every play will go through the JS
  approximation, defeating the point of this checklist.
- iPhone **Settings → Sounds & Haptics → System Haptics** is **on**.
  This master switch silences Core Haptics for the entire OS; if it's
  off, even a perfectly working bridge produces no buzz.
- Phone is **not** in silent / do-not-disturb modes that suppress
  haptics (per-user setting — verify on the test device).

## How to reach the bench

The screen is not linked from any user-facing surface and is gated
on `__DEV__` (in a production build the route renders a "dev-only"
notice and nothing else). On a development build:

- Deep link: open `memtool://haptics-debug` from Notes / Safari, or
- From the dev client / a debug shell:
  `router.push("/haptics-debug")`.

The first card on the screen shows the live `getAvailability()`
result polled every ~750ms. If it says **"Core Haptics unavailable"**
with a `reason:` other than `null`, **stop and resolve that first**
— every "play" below will silently fall through to the JS path and
the checklist will be meaningless. The card explains each reason.

## The checks

For each row: tap the named control on the bench, hold the phone
still, and answer the "Pass if" question with **yes / no / unsure**.
A single "no" means the bridge regressed; a single "unsure" means
play it again (and consider whether the test device's haptics are
audibly distinct enough — older iPhones have a coarser Taptic Engine
and the rich/JS difference can be subtle on hardware older than
iPhone 11).

### Section A — each signature plays its rich version, audibly better than the JS fallback

The user-facing test: do the six signatures **feel different from
each other** on a real phone, and do they feel **noticeably richer
than the JS approximation**? The richness shows up most in the
signatures that have a continuous event or a tight three-tap ramp.

**A/B procedure for every row below.** Confirm the **Force JS
fallback** switch on the bench is **OFF** (hint reads "OFF — plays
use Core Haptics when the engine is up"). Tap the named control and
hold the phone still. Then flip the switch **ON**, immediately tap
the same control again, and feel the difference. Each Log line ends
with `[core]` or `[JS]`, so you can audit after the run that you
actually compared the two paths and didn't accidentally tap twice
in the same mode. The "Pass if" column describes what the **rich
(Core Haptics) version** should feel like; the difference vs the
**JS** version is the secondary check that the rich engine is
actually doing something the JS approximation can't.

A row passes only if (a) the Core version matches the description
**and** (b) you can feel a clear difference between the `[core]`
and `[JS]` taps on this device. On older iPhones (pre-iPhone 11) the
difference can be subtle; if you're unsure, replay the pair a few
times and pay attention to the continuous tails (`link-formed`,
`day-recap-ready`, `undo`) — that's where the JS fallback is
weakest and the gap is widest.

| # | Tap | Pass if (rich version) |
|---|---|---|
| A1 | `capture` | Two taps in quick succession; the second is firmer than the first. Feels like a confident "got it", not two equal thumps. JS-fallback version sounds like two more-equal `UIImpactFeedbackGenerator` thumps. |
| A2 | `link-formed` | Two close taps that fade into a soft continuous tail. The tail is smooth on Core Haptics; on the JS fallback it's an audible stutter of `selectionAsync` ticks. This is the easiest A/B to feel — start here if you're calibrating. |
| A3 | `streak-extended` | A clear rising 1–2–3 crescendo (light → medium → heavy). The third tap is the strongest. JS version is three discrete thumps without the smooth ramp between intensities. |
| A4 | `day-recap-ready` | A short shimmer underneath a three-tap chime that climbs in intensity. The shimmer should be felt, not just heard. JS version drops the shimmer entirely — you only feel the three taps. |
| A5 | `error` | Two **firm** thumps with a pause. Distinct from iOS's default `notificationAsync(Warning)` — softer pause, no "buzz buzz" rattle. JS version is close (it's two transient impacts in both paths), so this row is about confirming the rich version still has the right pause and weight, not necessarily a wide A/B gap. |
| A6 | `undo` | A soft tap that gently retreats — single tap then a quiet taper. Feels like a withdrawal, not a press. JS version loses the smooth taper and feels like a single tap followed by silence (or a stutter of selection ticks). |
| A7 | "Play all 6 back-to-back" | The six signatures fire in order with a clear ~900ms gap between each. The tester can name which one just played without looking at the log. Repeat with the switch on; the same six signatures should now feel flatter / less distinct from each other. |

### Section B — cancel mid-play actually stops the engine

Use the longer signatures (`day-recap-ready`, `link-formed`, `undo`)
for these — their continuous tail is what makes a stuck cancel
audible.

| # | Steps | Pass if |
|---|---|---|
| B1 | Tap `day-recap-ready`, then within ~150ms tap **Cancel**. | The remaining three taps + shimmer **do not fire**. The phone goes silent immediately. |
| B2 | Tap "Play all 6", then tap **Cancel** while signatures 2–3 are playing. | Signatures 4–6 **never fire**. The Log shows the `✕ cancel` line with `queued` ≥ 3. |
| B3 | Tap `link-formed`, then immediately swipe up to background the app. | The continuous tail stops as the app loses foreground; foregrounding the app does not "resume" the cancelled pattern. |

### Section C — backgrounding doesn't leave the engine stuck

This is the regression check for `CHHapticEngine.stoppedHandler` /
`engineWasReset` wiring. The Apple guidance is: when the system
interrupts the engine (incoming call, audio session steal, Siri),
the engine stops itself and the next `start()` must succeed. If our
Swift code doesn't restart on `engineWasReset`, the *first play after
returning to the foreground* will silently no-op or throw.

| # | Steps | Pass if |
|---|---|---|
| C1 | Tap `streak-extended`. Confirm it played. Swipe up to background. Wait 5s. Foreground the app. The availability card stays green (or flips back to green within ~1s). Tap `streak-extended` again. | The second tap fires the rich version, not silence and not the JS fallback. The Log shows two `▶ streak-extended` lines. |
| C2 | Tap `capture`. Trigger Siri (long-press the side button). Dismiss Siri. Tap `capture` again. | The post-Siri tap still plays the rich `capture`. Availability remains green throughout (a brief flip to `engine_start_failed` is acceptable — Apple tears the engine down for Siri — as long as it recovers before the second tap). |
| C3 | Tap `day-recap-ready`. While it is playing, lock the phone. Wait 5s. Unlock. Tap `error`. | The lock interrupted the in-flight pattern (expected — system audio session steal). The `error` tap after unlock plays its rich version. No "stuck buzzing" or completely-silent failure. |
| C4 | (If possible) Place a real call into the test device while a long pattern is mid-play. Decline the call. Tap `link-formed`. | The interrupting call cancels the in-flight pattern. The post-call tap plays the rich version. |

## Recording the run

After running the checklist, paste a one-line summary into the
build's TestFlight release notes (or the launch-PR description if
no TestFlight submission is involved):

> **Haptics smoke test (Task #227 checklist):** Pass / Fail —
> `<device model + iOS version>`, `<date>`, `<tester name>`. Notes:
> `<anything unusual>`.

A "Fail" on any row blocks the TestFlight upload. File a follow-up
task referencing the failing row(s); the bridge regression is almost
always in `ios/CoreHapticsModule.swift` (engine restart, AHAP parse,
or stop-handle bookkeeping).

## When to re-run

- **Before every TestFlight / App Store submission** (added to the
  release-prep notes in `PRELAUNCH_AUDIT_ROUND_4.md`).
- **After any change to**:
  - `artifacts/memtool/modules/expo-core-haptics/ios/CoreHapticsModule.swift`
  - `artifacts/memtool/modules/expo-core-haptics/index.ts`
  - `artifacts/memtool/lib/haptics/ahapPlayer.ts`
  - any `.ahap` file in `artifacts/memtool/assets/haptics/`
  - `artifacts/memtool/lib/haptics/patterns.ts`
- **After the iOS major version bumps** on the test device (Apple
  has changed CHHapticEngine semantics between iOS 13 → 14 → 16 →
  17; assume iOS 27+ might too).

## Bench source

`artifacts/memtool/app/(app)/haptics-debug.tsx`. The screen comments
explain what each control exercises and why it's safe to leave in
the bundle (it's a no-op in production builds via `__DEV__`).
