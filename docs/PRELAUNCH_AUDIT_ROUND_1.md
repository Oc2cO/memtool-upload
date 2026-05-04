# Pre-launch Round 1 — Visual & Copy Audit

**Date:** 2026-05-01
**Scope:** Every screen and major modal in the MemTool app.
**Source of truth:** Files under `artifacts/memtool/app/` and `artifacts/memtool/components/`.
**Severity legend:** **Blocker** (would embarrass on launch day) · **Polish** (visible smudge) · **Nitpick** (only the team will notice).

A short [Consistency reference](#consistency-reference) lives at the bottom of this doc — read it before adding new screens.

---

## Screen inventory

| # | Screen | File |
|---|---|---|
| 1 | Splash / dispatcher | `app/index.tsx` |
| 2 | Login & sign-up | `app/login.tsx` |
| 3 | First-run onboarding (4 stages) | `app/onboarding.tsx` |
| 4 | Onboarding chat (Mem intro) | `app/onboarding-chat.tsx` |
| 5 | Not-found fallback | `app/+not-found.tsx` |
| 6 | Home / Today | `app/(app)/(tabs)/index.tsx` |
| 7 | Archive / Library | `app/(app)/(tabs)/archive.tsx` |
| 8 | Progress | `app/(app)/(tabs)/progress.tsx` |
| 9 | Settings | `app/(app)/(tabs)/settings.tsx` |
| 10 | Tab bar | `app/(app)/(tabs)/_layout.tsx` |
| 11 | Capture | `app/(app)/capture.tsx` |
| 12 | Log a Call | `app/(app)/log-call.tsx` |
| 13 | Mem (AI Guide) | `app/(app)/ai-guide.tsx` |
| 14 | Insights | `app/(app)/insights.tsx` |
| 15 | Daily Recap | `app/(app)/recap.tsx` |
| 16 | Memory Match | `app/(app)/memory-match.tsx` |
| 17 | 24 Game | `app/(app)/game-24.tsx` |
| 18 | Subscription / Paywall | `app/(app)/subscription.tsx` |
| 19 | Boost Archive (formerly "Tip Archive") | `app/(app)/tip-archive.tsx` |
| 20 | Wellness Logger | `app/(app)/wellness.tsx` |
| 21 | Pro celebration overlay | `components/ProCelebrationOverlay.tsx` |
| 22 | Error fallback | `components/ErrorFallback.tsx` |
| 23 | Loading screen | `components/LoadingScreen.tsx` |

---

## Findings — fixed in this pass

These were 1–2-line copy / layout changes and were made in this round.

| Severity | Screen | Issue | Fix applied |
|---|---|---|---|
| Polish | Onboarding stage 1 (`onboarding.tsx`) | Tap hint was lowercase `"tap anywhere to continue"` while the Pro celebration overlay used capitalised `"Tap anywhere to continue"`. | Capitalised to match. |
| Polish | Daily Recap upsell card (`recap.tsx`) | Used British spelling `"personalised suggestions"`; rest of the app uses American English (`favorite`, `analyzed`, `personalize`). | Changed to `"personalized"`. |
| Polish | Home screen nav grid (`(tabs)/index.tsx`) | Tile said `"Tip Archive"` but tapping it opens a screen titled **Daily Boost Archive**. Two different names for the same thing. | Renamed tile and a11y label to `"Boost Archive"` so it pairs with the **Daily Boost** tile above it and points clearly at the destination. |
| Polish | Onboarding chat input (`components/ChatThread.tsx`) | Default placeholder was lowercase `"type your answer…"`. All other input placeholders in the app are sentence-case (`"What's on your mind?"`, `"Search memories..."`, `"Tell Mem what's on your mind…"`). | Capitalised to `"Type your answer…"`. |
| Polish | Not-found fallback (`+not-found.tsx`) | Header title `"Oops!"`, body `"This screen doesn't exist."`, link `"Go to home screen!"` — three pieces of copy that all sound a bit "starter template". Body also contained `&apos;` HTML entity. | Header `"Not found"`, body `"We couldn't find that screen."`, link `"Back to home"`. Real apostrophe. |
| Polish | Wellness mood chart empty state (`wellness.tsx`) | `"No data yet"` rendered inside the `flex-end` chart row, sitting at the bottom of the card. Looked like a stray label. | Empty state now replaces the chart and reads `"Log your first stress level to start the chart."` — matches the "Capture your first thought to see it here" pattern from Archive. |

`pnpm --filter memtool exec tsc --noEmit` passes after the edits.

---

## Findings — not fixed (logged as follow-ups below)

Anything bigger than a quick copy/CSS tweak. Each of these has a follow-up task entry at the bottom.

### Vocabulary drift around the core noun
A "memory" is referred to as **memory**, **capture**, **moment**, **log**, **entry**, and **noticed** across the UI. Examples:
- Archive empty state: `"Capture your first thought to see it here"`
- Capture screen: `"You've captured X memories today"`
- Log Call screen: `"You've logged X entries today"`
- Subscription marketing: `"Log as many moments as you want"`
- Insights: `"X captures · Y understood by Mem"`
- Settings export: `"Export my memories"`

Each individual line reads fine, but the user has to mentally unify five words for one concept. → **Follow-up: Vocabulary glossary + sweep**.

### Date format drift
The app shows dates in five different formats depending on the screen. Examples:
- Archive group headers: `"Oct 24, 2026"`
- Archive empty state: `"October 24"`
- Recap header: raw ISO `"2026-04-28"`
- Locked card: `"12 days ago"`
- Wellness x-axis: `"04/28"`

Most are fine in isolation; the Recap raw-ISO and the Wellness `MM/DD` are the obvious offenders. → **Follow-up: Date formatting helpers + sweep**.

### Game over states are inconsistent
Across Memory Match and 24 Game:
- Memory Match win: `"You Won!"` (Title Case + `!`)
- 24 Game win: `"24!"` + body `"Brilliant calculation."` (period)
- 24 Game loss: `"Time's Up"` / `"Game Over"` (Title Case, no punctuation) + body `"Keep practicing!"` (`!`)

Three different punctuation rules in two screens. → **Follow-up: Unify game-over copy**.

### Onboarding palette diverges from the design tokens
`app/onboarding.tsx` and `app/onboarding-chat.tsx` define a local `PALETTE` object (`mem: "#FFD56F"`, `hot: "#B47AFF"`, `cool: …`) instead of using `constants/colors.ts`. The onboarding intentionally has a different feel, but right now those colours are not promoted to tokens, so they're not reusable elsewhere and won't dark/light-mode swap if that gets added. → **Follow-up: Promote onboarding palette to named tokens**.

### `GradientButton` primary is not in the colour tokens
`components/GradientButton.tsx` hardcodes `#5266eb` (blue) for the primary fill. The token file's `primary` is purple `#a78bfa`. So the "primary button" colour and the "primary brand" colour don't match. Visually fine; conceptually messy. → **Follow-up: Reconcile primary token vs primary button**.

### No typography or spacing tokens
Font sizes (`12 / 13 / 14 / 16 / 18 / 20 / 24 / 28 / 32 / 42`), spacing (`8 / 12 / 16 / 24`), and radii (`12 / 16 / 18 / 20 / 24 / 32`) are spread as magic numbers across every `StyleSheet.create`. Each screen is internally consistent, but cross-screen drift is already visible (e.g. `borderRadius: 16` on most cards, `24` on the wellness card, `32` on some empty states). → **Follow-up: Extract typography + spacing tokens**.

### "Daily capture limit reached" copy lives in three places
Same alert title and body shows up in `capture.tsx`, `log-call.tsx`, and on the Home capture button. Task #148 already establishes the "share one source for cooldown copy" pattern — this is the same shape and should follow the same fix. → **Follow-up: Extract daily-cap copy to a shared constant** (parallel to #148, not duplicate).

### Wellness "Coming soon" footer
`wellness.tsx` shows `"Coming soon: automatic heart rate, app usage, and travel tracking (requires advanced device permissions)."` There is no committed plan or date for these. Pre-launch this either needs a real commitment or should be removed so it doesn't look like a stale TODO. → **Follow-up: Confirm or remove Wellness "Coming soon" hint**.

### Settings exposes `Cloud API URL` to every Pro user
The Cloud Sync card lets any Pro user paste `https://your-backend.example.com` as the sync target. That's actually an advanced/dev feature, not something a normal user should ever touch. The placeholder also reveals the BYO-server design out loud. → **Follow-up: Hide Cloud API URL behind a developer toggle** (or move it to a `__DEV__`-only block).

### Misc smaller items worth a single follow-up
- `index.tsx` shows `"24 Streak"` as a stat label — unclear without context what `24` refers to (it's the 24 Game streak). Consider `"24 Game streak"` or just an icon + `"Streak"`.
- `subscription.tsx` `MOST POPULAR` badge is the only ALL-CAPS phrase outside section headers; intentional, but consider sentence-case + accent colour to match the Mem voice.
- `LoadingScreen.tsx` always says `"Loading…"` in pure white on the dark background, even when the rest of the app uses `mutedForeground` for secondary text. Tiny contrast nit.
- `archive.tsx` empty state for a person filter says `"No captures from {Person}"` with no clear button — only a "Clear date filter" / "Clear person filter" appears under specific branches. Verify both empty paths surface the matching clear button.

→ **Follow-up: Misc Round-1 polish leftovers** (one task to cover the bullets above).

---

## Cross-screen consistency check (summary)

| Concept | Inconsistency observed | Action |
|---|---|---|
| What we call a stored item | `memory` / `capture` / `moment` / `log` / `entry` | Follow-up: Vocabulary glossary |
| Date display | 5 different formats across 6+ surfaces | Follow-up: Date helpers |
| Cooldown / cap copy | Same message in 3 files | Already covered by Task #148; same pattern needs extending to daily-cap copy → Follow-up |
| Game over UX | 3 punctuation/casing rules in 2 screens | Follow-up: Unify game-over copy |
| Tile→destination naming | "Tip Archive" tile → "Daily Boost Archive" screen | **Fixed this pass** |
| Tap-hint copy | Lowercase in onboarding, Title in Pro overlay | **Fixed this pass** |
| Spelling | British "personalised" in one card | **Fixed this pass** |
| Apostrophes | `&apos;` HTML entity in `+not-found.tsx` | **Fixed this pass** |
| Placeholder casing | Lowercase `"type your answer…"` in chat | **Fixed this pass** |
| Empty-state placement | Wellness chart empty state inside chart row | **Fixed this pass** |

---

## Consistency reference

Short rules so the next person adding a screen stays aligned. **All current screens follow these unless flagged above.**

### Layout & spacing
- Import from `@/constants/spacing`. Use `spacing.{xs:4, sm:8, md:12, base:16, lgCard:20, lg:24, xlTight:28, xl:32}` and `radius.{sm:12, md:16, lg:24}` instead of raw numbers.
- Outer screen padding: `spacing.lg` for scroll content, `paddingHorizontal: spacing.lg` for the home tab.
- Card inner padding: `spacing.base` (compact rows), `spacing.lgCard` / `spacing.lg` (full cards).
- Vertical rhythm between blocks: `spacing.base` (tight), `spacing.lg` (section gap), `spacing.xlTight`–`spacing.xl` (between major regions).
- Card border radius: `radius.md` (small/list-style cards) or `radius.lg` (large feature cards). **Don't introduce new radii.**
- Cards always use `colors.card` background + `colors.border` 1px border.

### Typography (token scale)
- Import from `@/constants/typography`. Spread a named slot (`...text.body`) instead of restating `fontSize` / `fontWeight` / `fontFamily` triplets.
- `text.brand` (42 / 700) — wordmark only.
- `text.screenTitle` (28 / 700) — largest in-page title (Settings header, Home name).
- `text.cardTitle` (24 / 700) — feature-card title (Quick Capture, onboarding tagline).
- `text.sectionTitle` (20 / 600) — section heading inside a screen ("Train Your Mind", modal headers).
- `text.cardHeading` (18 / 700) — result / recap title, empty-state title.
- `text.cardLabel` (18 / 600) — modal / capture screen title, profile email.
- `text.body` (16 / 400), `text.bodyMedium` (16 / 500), `text.bodySemibold` (16 / 600) — body copy.
- `text.helper` (14 / 500) and `text.helperRegular` (14 / 400) — helper / metadata.
- `text.caption` (12 / 400), `text.captionStrong` (12 / 600) — captions; uppercase section labels (`"THIS MONTH"`) use `captionStrong` + `letterSpacing` (Insights / Recap only).
- `text.tiny` (10 / 400) — chart axes only.
- Font families are baked into each slot — don't hand-roll `fontWeight: "700"` without the matching `fontFamily`. Line height and letterSpacing are intentionally NOT in the token; apply locally.

### Colour
- Always read theme colours from `useColors()`. Do not hardcode hex values in screen files.
- Foreground text: `colors.foreground`.
- Secondary text: `colors.mutedForeground`.
- Accents: `colors.primary` (purple) for "main thing" / `colors.accent` (teal) for "AI / Mem-led" surfaces.
- Destructive: `colors.destructive` only for actually destructive actions (delete profile, game over).
- Primary CTA fill: `colors.dark.primaryAction` / `primaryActionPressed` from `@/constants/colors` — used inside `GradientButton`. Don't re-pick a different blue for primary buttons.
- Onboarding stages: `colors.dark.onboarding.{bg, bgDeep, mem, hot, cool, pink, text, textMuted, card, border}`. Use this group instead of inlining onboarding hex values; keep onboarding stages out of `useColors()` since they are intentionally a fixed warm palette.

### Buttons
- Primary CTA: `<GradientButton variant="primary" />` (everything that's the main action on a screen).
- Secondary CTA: `<GradientButton variant="secondary" />` or a `Pressable` with text-only `colors.primary`.
- Don't use bare `TouchableOpacity` — wrap in `ScalePress`, `RippleTouch`, or `AliveButton` so the whole app has the same press feedback.
- All primary actions trigger `Haptics.impactAsync(Light)` on press; success uses `notificationAsync(Success)`.

### Copy tone
- Voice: warm, second-person, light. Mem talks to the user — `"I help you organize the chaos in your head."`, `"Mem is thinking…"`, `"I'll learn the rest as we go."`
- Casing:
  - **Screen titles, tab labels, button labels, nav-card titles** → Title Case (`Memory Match`, `Daily Recap`, `Sign In`, `Save Stress Level`).
  - **Greetings, body sentences, helper text, empty states, alerts** → sentence case (`"Welcome back,"`, `"What's on your mind?"`, `"No memories found"`, `"Mem is still getting to know you"`).
  - **Section header labels inside Insights/Recap** → ALL CAPS (`THIS MONTH`, `TOP THEMES · LAST 30 DAYS`). Reserved for those two screens.
- Punctuation: end full sentences with a period. Prefer no terminal `!` except in single-word or two-word celebratory lines (`"24!"`, `"Captured!"`).
- Use proper apostrophes (`'`), em dash (`—`) for asides, ellipsis character (`…`) for "in progress" (`"Saving…"`, `"Mem is thinking…"`). Don't mix `--`, `...`, or HTML entities.
- American English (`favorite`, `personalize`, `organize`).
- Reference the assistant as **Mem** — never "the assistant", "AI", or "your AI".
- Reference a stored item as a **memory** in user-facing nouns and **capture** in actions. (Glossary work pending — see follow-up.)

### Dates & numbers
- Until the date helper lands: prefer `toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })` for absolute dates and the existing `formatRelative` / `formatRelativeAge` helpers for "ago" strings. Don't print raw ISO.
- Counters use the form `"X of Y"` (`"3 of 10 captures left today"`), not `"3/10"`.

### Safe-area & navigation
- Every full screen wraps content in `SettleOnMount` and pads `insets.top` (and `insets.bottom` where relevant). Tab screens already get bottom inset from the tab bar.
- Modal/back row: 28px close icon on the left, screen title centered, 40px spacer on the right (matches `wellness.tsx`, `memory-match.tsx`).

### Loading / empty / error
- Loading: `<LoadingScreen />` for full-screen waits. Inline spinners use `<ActivityIndicator size="small" color={colors.primary} />`.
- Empty state: short sentence describing the empty thing + concrete action (`"Capture your first thought to see it here"`, `"Log your first stress level to start the chart."`). Don't ship `"No data"` / `"None"` / `"—"` as a final state.
- Errors: `"We couldn't … "` framing, never `"Error: …"` or stack-trace text in user view (dev modal in `ErrorFallback` is fine).

---

## Follow-up tasks (queued for Task creation)

1. **Vocabulary glossary + sweep.** Pick one canonical noun (memory) and one canonical verb (capture) and rewrite drifted copy.
2. **Date formatting helpers + sweep.** One helper module, applied across Archive / Recap / Insights / Wellness / Locked card.
3. **Unify game-over copy across Memory Match & 24 Game.** One file with `WIN_TITLE`, `WIN_BODY`, `LOSE_TITLE`, `LOSE_BODY`.
4. ~~**Promote onboarding palette to named tokens.**~~ Done — see `colors.dark.onboarding`.
5. ~~**Reconcile primary token vs `GradientButton` primary fill.**~~ Done — `GradientButton` now reads `primaryAction` / `primaryActionPressed` from `constants/colors.ts`.
6. ~~**Extract typography + spacing tokens.**~~ Done — `constants/typography.ts` + `constants/spacing.ts` exist. Migrate the remaining screens (`recap` is migrated; `archive`, `wellness`, `memory-match`, `subscription`, `+not-found`, etc. still pending) in a follow-up sweep.
7. **Extract daily-cap copy to a shared constant** (parallel to Task #148's cooldown copy work, not duplicating it).
8. **Confirm or remove Wellness "Coming soon" hint.** PM decision; if kept, change to a real commitment.
9. **Hide `Cloud API URL` behind a developer toggle** so normal Pro users don't see it.
10. **Misc Round-1 polish leftovers**: `"24 Streak"` label clarity, `MOST POPULAR` badge styling, `LoadingScreen` text contrast, double-check archive person-filter empty state surfaces a clear-filter button.
