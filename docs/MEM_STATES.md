# Mem Companion Emotional States

Canonical reference for Mem's emotional vocabulary, the surfaces each
state fires on, and the things each state must never convey. This
file is the design-side companion to `lib/memStates.ts` — that module
is the runtime source of truth, this file is the human-readable
contract for designers and future task agents.

> **Hard rule (from BRAND.md):** Mem is nurturing, never punitive.
> This is a wellness app, not a streak-loss enforcer. Even
> `concerned` and `waiting` must read as "I'm here with you" — never
> as guilt-trip, alarm, or disappointment. Any new placement that
> reads as punitive is **rejected**.

## The state set

| State | Meaning | Where it fires today | Must NOT convey |
|---|---|---|---|
| **curious** | First-meeting / greeting. Mem is interested in *you*, not the task. | Onboarding MEET stage, onboarding chat greeting | sales pitch, checklist energy, evaluation |
| **thoughtful** | Listening, holding space while you compose. | Capture form (typing or speaking a memory) | judgement, impatience, hurry |
| **celebrating** | A clear win. | Daily recap reveal (with captures), streak/milestone moments, game-level overlay (existing) | loud confetti, bro energy, score-shaming |
| **glowing** | An insight just landed — themes or mood patterns surfaced. | Daily recap reveal (when AI themes / mood-trend exist) | surveillance vibes, "we caught a pattern" creepiness |
| **waiting** | Gently here, not nagging. Mem is present after a missed check-in. | Home tab when user hasn't captured today | disappointment, guilt, streak-loss alarm |
| **concerned** | Caring presence when something soft is happening. | Reserved for low-mood / sync-error surfaces (separate tasks) | alarm, punishment, medical/clinical tone |
| **resting** | Companion, not surveillance. Mem is just here. | Settings / profile surfaces | evaluation, metrics, "we're watching" vibe |

## How to wire a new placement

1. Pick the state from the table above. If the moment doesn't fit any,
   stop — adding a new state requires updating BRAND.md, this doc,
   and `lib/memStates.ts` together. **Do not invent ad-hoc
   expressions** at call sites; the cast must stay consistent.
2. Render `<MemCharacter expression={MEM_STATES[name].expression} />`
   at a small, supportive size. The brief is "supportive, not
   dominating the screen" — typical sizes are **40–80px** for
   inline accents, **120–160px** only at hero moments (onboarding
   stages, recap reveal hero).
3. Make sure Mem **never blocks tap targets**. She is decorative.
   Wrap her in a `pointerEvents="none"` view if she sits over an
   interactive zone.
4. Reduce-motion: nothing to do per call site. `MemCharacter`
   already subscribes to `AccessibilityInfo.isReduceMotionEnabled()`
   and freezes the blink, bounce, and sparkle pulse when the OS
   preference is on. The static fallback is the same shape as the
   animated form, so the layout doesn't shift.

## Helpers

- `pickRecapState({ hasThemes, hasMoodTrend })` → resolves a
  recap-reveal state. The reveal is a celebratory surface by design,
  so this helper only ever returns `glowing` (themes / mood-trend
  landed) or `celebrating` (captures exist). The empty / missed
  case is handled by the recap empty card with its own copy — Mem's
  `waiting` state lives on Home, not the reveal.
- `pickHomeState({ todayCaptureCount, totalCaptureCount })` →
  resolves the home-greeting companion state.

Both helpers live in `lib/memStates.ts`.

## What this task did NOT do (and why)

- **No new Mem voice / dialog rewrite.** Out of scope; reuse the
  existing brand voice catalog.
- **No new audio.** Covered by the sound design task.
- **No brand-new surfaces.** This task only places Mem on surfaces
  that already exist. New surfaces (e.g. low-mood overlay) will be
  wired in their own follow-up tasks using `concerned`.
