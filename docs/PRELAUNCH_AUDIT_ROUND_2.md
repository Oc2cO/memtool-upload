# Pre-launch Round 2 — Empty / Error / Loading / Offline States Sweep

**Date:** 2026-05-01
**Scope:** Every screen, modal, and major surface in the MemTool app.
**Companion:** `PRELAUNCH_AUDIT_ROUND_1.md` (visual & copy audit).
**Method:** Read every screen file in `artifacts/memtool/app/`, every shared state component in `artifacts/memtool/components/`, and every relevant context in `artifacts/memtool/context/`. Verified offline / 401 / cap behavior by re-reading the contracts in `lib/auth.ts`, `lib/aiGuide.ts`, `lib/memories.ts`, `lib/syncOutbox.ts`, and `context/SubscriptionContext.tsx`.

A short [Reusable building blocks](#reusable-building-blocks) reference lives at the bottom — read it before adding new screens.

---

## TL;DR

The app's "happy path" is well covered. Where it does have weak cells they cluster around three things:

1. **Cold-start / no-data screens** that render zeroed-out charts instead of guidance. Fixed Progress in this pass.
2. **Server requests that have no client-side timeout**, which can pin a screen on a permanent spinner if the socket stalls instead of failing. Fixed `authFetch` (covers AI Guide, Subscription, Insights, Memories, Profile, Recap, Login) in this pass.
3. **Optional permission denials that fail silently**, where the user is left wondering whether the feature is broken. Logged as follow-ups, not blockers.

There were two **blocker** findings (a runtime crash on the Sync All button, and an indefinite "Mem is thinking…" spinner). Both are fixed in this pass.

---

## States matrix

Columns: **Empty** (no data yet) · **Loading** (initial fetch) · **Slow** (3 s+ network) · **Offline** (airplane mode) · **Server error** (5xx / malformed body) · **Permission denied** · **Signed-out / 401** (token rejected mid-session).

| Screen / surface | Empty | Loading | Slow | Offline | Server error | Permission denied | 401 / expired |
|---|---|---|---|---|---|---|---|
| Splash / dispatcher (`app/index.tsx`) | n/a | Auth context `LoadingScreen` until user resolves; 12 s hard cap on splash video so a stuck asset can't deadlock cold launch. | Same. | Loads token from `AsyncStorage` (offline-tolerant). | If `apiMe` 5xx, AuthContext keeps the cached user and routes to `(app)/(tabs)`. | n/a | `apiMe` 401 → `clearToken()` → `setUser(null)` → routed to `/login`. |
| Login / sign-up (`app/login.tsx`) | n/a | `submitting` disables the form and rewrites the button label ("Signing in…"). | Now bounded by the 20 s `authFetch` timeout — a stalled network surfaces "Couldn't reach the server — check your connection" instead of hanging. | Same friendly "Couldn't reach the server" string from `AuthError`. | `friendlyMessage()` maps every status (400/401/403/404/409/422/5xx) to a calm sentence; raw SDK text never surfaces. | n/a | n/a (this *is* the re-auth screen). |
| Onboarding (`app/onboarding.tsx`) | n/a | Local only; no fetch. | n/a | Local only. | n/a | n/a | If user is null it redirects back to `/login`. |
| Onboarding chat (`app/onboarding-chat.tsx`) | Local intro script; renders without a fetch. | `phase === "saving"` overlay during profile save. | Bounded by `authFetch` timeout. | `errorMsg` alert if profile save fails; the user can retry. | `errorMsg` alert with retry. | n/a | 401 from save bubbles up as an `AuthError`; surfaced as the same alert with retry. |
| Not-found (`app/+not-found.tsx`) | n/a | n/a | n/a | n/a | n/a | n/a | n/a — pure visual fallback. |
| Home / Today (`(tabs)/index.tsx`) | New user shows "Welcome back, Explorer" plus the navigation tile grid; the `Recent Captures` section is hidden when there are no memories. Tips/facts always have a default if their fetch fails. | Gated by `AppLayout` global `LoadingScreen`. | Same. | Memories render from `AsyncStorage` cache; `MemorySyncStatus` indicators on each row show pending/failed badges. | Memory fetch failure is silent (cache fallback). Tips fall back to defaults. | n/a | Caught at the layout boundary → `/login`. |
| Archive (`(tabs)/archive.tsx`) | `EmptyState` with dynamic copy: "Capture your first thought" or "No captures on [Date]" if the date filter is active. | `RefreshControl` spinner; pull-to-refresh available. | Bounded by `authFetch` timeout. | Renders cached memories. `SyncWarningBanner` if any entry has been failing ≥ 24 h, plus a "Sync all" header button and per-row "Saved offline" badges with tap-to-retry. | "Still offline — try again later" toast on retry failure. Refresh failure is silent (cache stays). | n/a | Same layout-level guard. |
| Progress (`(tabs)/progress.tsx`) | **Was:** four zeroed stat tiles, blank chart, "-" rows on game bests — looked like a loading bug. **Now:** dedicated `EmptyState` with "No progress to show yet" copy and a "Capture a memory" CTA when both memories and games are empty. | Pure derivation from contexts; no spinner needed. | n/a | Reads from local memories + `GameStatsContext` cache. | n/a (no direct fetch). | n/a | Layout-level guard. |
| Settings (`(tabs)/settings.tsx`) | Profile tags fall back to "No traits yet". | "Loading…" inline in the profile section while `profileLoading`. Export shows `isExporting` progress. | Bounded by timeout. | Profile shows last cached or "Loading…" until an `onMount` retry. Sync/Export show explicit error banners. | Sync: "Sync failed" inline. Export: `handleExportError` renders a banner; 401 routes to `/login`. | Share-sheet permission failures are caught by `expo-sharing` and surfaced via the export error handler. | Export 401 → `/login`. Other 401s caught by the layout guard. |
| Mem (AI Guide, `(app)/ai-guide.tsx`) | Local "Hi — I'm Mem…" intro renders before any fetch. | `sending` shows "Mem is thinking…" typing bubble. | **Was:** unbounded — could pin the typing indicator forever if the request stalled. **Now:** `authFetch` 20 s timeout fires the same `AI_GUIDE_NETWORK_ERROR_MESSAGE` "Try again" bar. | `errorBar` with "Try again" + `lastUserMessage` retry. | 5xx and malformed body → calm `AiGuideError` message + retry. 429 → distinct `AI_GUIDE_RATE_LIMIT_MESSAGE` ("Mem is being asked a lot right now"). | n/a | 401 → `router.replace("/login")` immediately (the auth layer cleared the token). |
| Capture (`(app)/capture.tsx`) | n/a (input form). | None — text-only form, save is bounded by the timeout. | Bounded. | Toast: "Saved offline — will sync when reconnected" via the sync outbox. | `CaptureBlockedError` → dedicated cooldown alert; `CaptureLimitReachedError` → routed to `/subscription`; anything else re-throws to the global `ErrorBoundary`. | n/a — capture is text-only at launch (no mic/camera/location). | Auth 401 from `addMemory` re-throws to layout guard → `/login`. |
| Log a Call (`(app)/log-call.tsx`) | n/a (input form). | Same as Capture. | Same. | Same outbox path; same offline toast. | Same envelope. | n/a — text-only. | Same. |
| Insights (`(app)/insights.tsx`) | `view === "cold_start"` → "Mem is still getting to know you" + "Capture a memory" CTA. | `ActivityIndicator` centered. | Bounded by `authFetch` timeout (server pattern fetches inside `aiEngine`). | Renders from `loadStoredPatterns` (`AsyncStorage`) — works fully offline once first sync has happened. | First-time generation failure leaves the user in `cold_start` (acceptable — no data yet). Logged as follow-up to surface a soft "Couldn't refresh" line. | n/a | Layout guard. |
| Daily Recap (`(app)/recap.tsx`) | `showEmpty` → "No captures yet today" + "Go to capture" button. | `showInitialLoading` → sparkles icon, "Analyzing your day…", and `Shimmer` placeholder lines (no blank pane). | Bounded; same fallback. | `showError` → "Couldn't load your recap" + "Try again". When stale data is present, a non-blocking `showRefreshErrorBanner` appears instead of replacing the screen. | Same `showError` / `showRefreshErrorBanner` envelope. | Calendar permission denied → tomorrow-events list quietly empty. **Logged as follow-up** to add a "Connect calendar" inline hint. | Layout guard. |
| Subscription / Paywall (`(app)/subscription.tsx`) | n/a (product copy is always present). | "Loading your plan…" + `Shimmer`; CTA shows `ActivityIndicator` while `actionPending`. | Bounded. | `showError` → "Couldn't load your plan" + "Try again". | Same. Purchase failures show `actionError` alert with the user-friendly message from `lib/subscription.ts`. | n/a | 401 surfaces same as other Polsia screens. |
| Wellness Logger (`(app)/wellness.tsx`) | "Log your first stress level to start the chart." | n/a — local only. | n/a | Mood writes go via `MoodContext.upsertToday`, which writes to cache first and silently flags `pendingSync` if the network is down. The next `setStress` call retries via `replayPending`. | Same — sync errors are kept locally and replayed. | Footer text already labels future advanced sensors as "requires advanced device permissions". | Mood sync 401 is treated as a transient sync failure (kept locally); next layout-level fetch will re-route. |
| Memory Match / 24 Game / Boost Archive | n/a or `ListEmptyComponent`. | n/a — local logic. | n/a | Fully offline-capable. | Local errors crash to the global `ErrorBoundary`. | n/a | Layout guard. |
| Pro celebration overlay | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Error fallback (`components/ErrorFallback.tsx`) | n/a | n/a | n/a | n/a | This *is* the catch-all: friendly "Something went wrong" + "Try Again" reload button. Dev-only modal exposes the stack trace. | n/a | n/a |
| Loading screen (`components/LoadingScreen.tsx`) | n/a | Used by `AuthContext` and `AppLayout` while bootstrapping. Just the activity indicator + "Loading…" — never shown for more than the cold-launch window. | n/a | n/a | n/a | n/a | n/a |

---

## Findings — fixed in this pass

These were small, high-confidence changes made in this round.

| Severity | Surface | Issue | Fix applied |
|---|---|---|---|
| **Blocker** | All `authFetch`-backed screens (esp. AI Guide) | `fetch()` had no client-side timeout. A stalled socket pinned the "Mem is thinking…" indicator (and the Subscription / Insights / Recap / Login spinners) indefinitely, with no error envelope ever surfacing. | Added `fetchWithTimeout()` in `lib/auth.ts` with a 20 s ceiling. On expiry, the socket is aborted and the same friendly "Couldn't reach the server" `AuthError` fires that a flat-out network failure already produced — every existing retry button now works for stalled sockets too. |
| **Blocker** | Archive (`(tabs)/archive.tsx`) | The **Sync all** header button referenced `pinnedMemories.length`, a name that doesn't exist anywhere in the file. Tapping the button would crash the screen to the global `ErrorBoundary`. | Replaced with `filteredMemories.filter(isPendingOrFailed).length`, mirroring the same predicate `splitPinnedMemories` already uses to populate the pinned section. The "X of Y synced — N still pending" toast now reflects exactly what was visible at tap time. |
| Polish | Progress (`(tabs)/progress.tsx`) | New users with no memories and no game plays saw four zeroed stat tiles, an empty bar chart, and "-" rows on every game best — visually it reads as a loading bug, with no CTA toward what to do next. | Added a guarded `EmptyState` ("No progress to show yet" + "Capture a memory" CTA) that renders only when both memories and games are empty. Hooks order preserved so the conditional return doesn't violate the Rules of Hooks. |

---

## Findings — logged as follow-ups

These are real but either lower-impact or larger than a one-line change.

| Severity | Surface | Issue | Why deferred |
|---|---|---|---|
| Polish | Recap (`(app)/recap.tsx`) | Calendar permission denied → tomorrow-events list quietly empty. The user can't tell whether they have nothing scheduled or whether they need to grant access. | Needs new copy + a "Connect calendar" inline hint button. Logged as a follow-up. |
| Polish | Insights (`(app)/insights.tsx`) | If the first server pattern generation fails, the user stays on the cold-start view with no error feedback. They can't tell that anything was attempted. | Needs a small "Couldn't refresh — try again" inline pill. Logged as a follow-up. |
| Polish | Wellness (`(app)/wellness.tsx`) | If `AsyncStorage.writeCache` itself throws (rare device-level failure), the save crashes to the global `ErrorBoundary`. | Needs a calm inline error toast. Storage failures are extremely rare; logged as a follow-up rather than over-engineered now. |
| Polish | Settings (`(tabs)/settings.tsx`) | If `refreshPending` (the per-row sync count) fails, the count silently shows `0`. | Acceptable for launch (the SyncWarningBanner re-surfaces real problems). Logged as a follow-up. |
| Polish | Login (`app/login.tsx`) | No "Connection looks slow" hint for cellular users on a bad link. | The 20 s `authFetch` timeout already prevents an infinite spinner. A "slow" inline hint is a polish-level addition; logged as a follow-up. |

These follow-ups overlap heavily so they were rolled into a single Pre-launch Round 2 cleanup task rather than five tiny ones.

---

## Special-attention items called out by the brief

The task brief asked me to verify four scenarios in detail. The findings:

1. **Offline memory capture — does it queue and sync?**
   Yes. `addMemory` in `MemoriesContext` calls `enqueueOutboxEntry` whenever the network call fails, the row is rendered immediately with a `pendingSync` flag, the home + archive screens both render a "Saved offline" badge, and `useSyncOutbox` heart-beats every reconnect to drain the queue with backoff. `SyncWarningBanner` re-surfaces any entry stuck ≥ 24 h. The Round 1 audit and the existing `syncOutbox.test.ts` cover the contract.

2. **Expired session in the middle of a chat with Mem AI Guide.**
   `sendAiGuideMessage` rethrows the `AuthError` with `status === 401` unchanged; the screen catches it and runs `router.replace("/login")` immediately. The auth layer has already cleared the token from storage, so the next launch starts at login. Verified by reading `lib/aiGuide.ts` lines 175-198 against `app/(app)/ai-guide.tsx` lines 283-289. The new `authFetch` timeout also covers the case where the network stalls mid-thread instead of returning a 401.

3. **Denied microphone / camera / location permissions on the capture flow.**
   Capture is text-only at launch — `app/(app)/capture.tsx` and `app/(app)/log-call.tsx` use `<TextInput>` only; there is no `expo-av`, `expo-camera`, or `expo-location` import in either file. The only permission used anywhere in the app is `expo-calendar` inside Recap (silent fallback, see follow-up above). Wellness's footer note explicitly labels future heart-rate/usage tracking as "requires advanced device permissions" so users have correct expectations.

4. **Pro user opens the app and RevenueCat fails to verify their subscription.**
   `SubscriptionContext.refresh()` runs three checks in parallel — Polsia status, server-side RevenueCat REST proxy (`fetchServerEntitlement`), and the local SDK `getCurrentEntitlementIsPro` — and OR-merges the result. The implementation comment is explicit: "We never downgrade a user based on a single failing source." So a single RevenueCat verification failure does **not** strip the Pro flag as long as either the SDK or Polsia confirms Pro. Verified at `context/SubscriptionContext.tsx` lines 80-118. The cold-launch entitlement bridge in `_layout.tsx` (`patchProStatus`) also lets a known-Pro SDK result short-circuit the spinner before any UI renders.

---

## Reusable building blocks

When adding a new screen, prefer these over hand-rolling:

- **`components/EmptyState.tsx`** — empty state with icon, title, body, and one CTA. Used by Archive and now Progress.
- **`components/LoadingScreen.tsx`** — centered spinner + "Loading…". Use only at the cold-launch / auth-bootstrap boundary; never inline inside a tab. Inline use should be `ActivityIndicator` or a `Shimmer` placeholder so the chrome stays.
- **`components/ErrorBoundary.tsx`** + **`components/ErrorFallback.tsx`** — global crash handler, mounted at `_layout.tsx`. Anything thrown out of a render path lands here.
- **`components/Toast.tsx`** — short-lived success / sync toast, used by Capture, Archive, and Settings.
- **`components/SyncWarningBanner.tsx`** — surfaces ≥ 24 h-stuck outbox entries on Archive.
- **`lib/auth.ts`** — `authFetch` (Bearer-authed) and `publicFetch` (login/register) both go through `fetchWithTimeout` (20 s ceiling) and `friendlyMessage()` so server errors arrive as calm sentences, never raw SDK text.
- **`lib/aiGuide.ts`** — error envelope for the AI Guide. `AiGuideError.userMessage` is the only string a screen should ever render for these failures; `.message` may carry raw debug text and is for logs only.

If you find yourself rendering `err.message` directly in JSX, route through one of these instead.
