# Pre-launch Round 3 — Edge-case Input & Environment Sweep

**Date:** 2026-05-01
**Scope:** Every input field and environmentally-sensitive feature in the MemTool app.
**Companion:** `PRELAUNCH_AUDIT_ROUND_1.md` (visual & copy), `PRELAUNCH_AUDIT_ROUND_2.md` (empty / loading / offline states).
**Method:** Walked every screen in `app/`, every shared input component in `components/`, and every input-touching helper in `lib/`. Verified each input against `INPUT_EDGE_CASE_CHECKLIST.md` (saved alongside this file as a reusable reference for future features).

---

## TL;DR

The app's existing inputs were almost all defended at the **business-rule** layer (cap math, Pro gating, sync outbox) but mostly **un-bounded at the keyboard layer**. A user could paste a 100,000-character article into the capture box, the app would happily store it locally, and the embedding endpoint would silently refuse it later. There were also two real double-submit races on the Save buttons.

This pass focuses on hardening the input boundary itself — adding length caps, basic validators, double-submit guards, and a single source of truth (`lib/inputLimits.ts`) so a future input never silently inherits the unlimited default. All quick fixes landed in the same pass; one polish-level finding was already covered by Round 2 work.

---

## Inputs inventory

Every text field, picker, slider, and structured input in the shipped app, with the surface that owns it. (Voice / camera / location aren't shipped at launch — Round 2 verified that capture and log-call are text-only and the only permission used anywhere is `expo-calendar` on the recap surface.)

| # | Surface | Field | Type | Prior cap | New cap |
|---|---|---|---|---|---|
| 1 | `app/login.tsx` | Email | text | none | `EMAIL_MAX_LENGTH` (254) |
| 2 | `app/login.tsx` | Password | secure text | none | `PASSWORD_MAX_LENGTH` (200) |
| 3 | `app/login.tsx` | Display name (signup) | text | none | `DISPLAY_NAME_MAX_LENGTH` (80) |
| 4 | `app/onboarding-chat.tsx` | Free-text answer | text | 200 (via `FreeTextInput`) | unchanged |
| 5 | `app/onboarding-chat.tsx` | Trait chips | multi-select | min/max enforced | unchanged |
| 6 | `app/(app)/capture.tsx` | Memory body | multiline text | **none** | `MEMORY_CONTENT_MAX_LENGTH` (5,000) |
| 7 | `app/(app)/capture.tsx` | Tag chips | multi-select | suggested-pool only | unchanged |
| 8 | `app/(app)/log-call.tsx` | Person name | text | **none** | `PERSON_NAME_MAX_LENGTH` (120) |
| 9 | `app/(app)/log-call.tsx` | Call note | multiline text | **none** | `MEMORY_CONTENT_MAX_LENGTH` (5,000) |
| 10 | `app/(app)/ai-guide.tsx` | Mem chat message | multiline text | 200 (via `FreeTextInput`) | unchanged |
| 11 | `app/(app)/(tabs)/archive.tsx` | Search | text | **none** | `SEARCH_QUERY_MAX_LENGTH` (200) |
| 12 | `app/(app)/(tabs)/archive.tsx` | Person filter chip | tap-to-clear | n/a | unchanged |
| 13 | `app/(app)/(tabs)/archive.tsx` | Date filter | URL param | n/a | unchanged |
| 14 | `app/(app)/tip-archive.tsx` | Search | text | **none** | `SEARCH_QUERY_MAX_LENGTH` (200) |
| 15 | `app/(app)/tip-archive.tsx` | Category filter | radio | enum guarded | unchanged |
| 16 | `app/(app)/wellness.tsx` | Stress level | 1-5 picker | enum guarded | unchanged |
| 17 | `app/(app)/(tabs)/settings.tsx` | Cloud API URL | text | **none, no validation** | `API_URL_MAX_LENGTH` (500) + `validateApiUrl` |
| 18 | `app/(app)/(tabs)/settings.tsx` | Theme / motion / haptic toggles | boolean | n/a | unchanged |
| 19 | `app/(app)/game-24.tsx` | Number tile picks | structured | enum guarded | unchanged |
| 20 | `app/(app)/memory-match.tsx` | Card flips | structured | game-state guarded | unchanged |

The 5 surfaces that were already capped — onboarding chat, AI Guide chat, wellness picker, the two games — were left as-is; their existing limits are appropriate for their use case.

---

## Findings — fixed in this pass

| Severity | Surface | Issue | Fix applied |
|---|---|---|---|
| **Blocker** | Capture (`capture.tsx`) + Log-call (`log-call.tsx`) | Memory body and call note had **no length cap**. A user pasting a 5,000+ character article would silently overrun Polsia's embed endpoint (8,000-char limit per item) on the next AI engine sync, causing the memory to never embed and never appear in patterns. | Added `MEMORY_CONTENT_MAX_LENGTH = 5,000` in the new `lib/inputLimits.ts`. RN's `<TextInput maxLength>` truncates a paste at this length so the user sees the limit being enforced, plus an inline "you've reached the limit" hint shows once they hit the cap. The cap stays under the embed limit so any saved memory is guaranteed to embed successfully. |
| **Blocker** | Capture (`capture.tsx`) + Log-call (`log-call.tsx`) | A rapid double-tap on **Save** (typical on iOS when the haptic engine fires twice) executed `handleSave` twice before the disabled-state could react, enqueueing two outbox entries for the same memory. The duplicate then synced as a separate row. | Added a `submitting` boolean that gates the entry to `handleSave` (early-returns if already in flight) and is also OR'd into the Save button's `disabled` prop. The button label flips to "Saving…" so the second tap also gets a visual cue. The flag is cleared on the cooldown-error branch so the user can edit and try again without the form staying inert. |
| **Blocker** | Settings (`settings.tsx`) | The "Cloud API URL" field accepted **any string** — including `"yes"`, `javascript:alert(1)`, or a 100KB pasted blob — and silently wrote it to AsyncStorage. Every subsequent fetch then failed with an opaque parse error. | New `validateApiUrl` helper in `lib/inputLimits.ts` enforces (1) the input parses as a `URL`, (2) the protocol is `http:` or `https:` (explicitly blocking `javascript:` / `file:`), and (3) hostname is non-empty. The Save button refuses non-conforming input and renders the validator's reason inline in the destructive color; the input border also turns destructive while the error is showing. Empty input still clears the override (that's a valid action). Capped at `API_URL_MAX_LENGTH = 500`. |
| Polish | Login (`login.tsx`) | Email field was passed to the API as raw, so a paste-with-trailing-newline (a common mobile-keyboard quirk when long-pressing a saved address) would reach the server as `"a@b.com\n"`. Polsia bounces that with a generic "invalid credentials" error indistinguishable from a real password typo. | `email.trim()` (and `displayName.trim()`) now happen **before** both the validation check and the API call, so the cleaned value is what the server sees. Also added `maxLength` props (254 / 200 / 80 chars) so the keyboard layer can't accept absurd inputs. |
| Polish | Archive (`archive.tsx`) + Tip Archive (`tip-archive.tsx`) | Search inputs had no length cap. A pasted essay as a "search query" was always a mistake but the app would happily issue the request. | Capped both at `SEARCH_QUERY_MAX_LENGTH = 200`. The archive search was already debounced (250 ms) so pasting + immediate edit doesn't produce a request storm. |

---

## Findings — logged as follow-ups

These are real but either lower-impact, larger than a one-line change, or already covered by a queued task.

| Severity | Surface | Issue | Why deferred |
|---|---|---|---|
| Polish | Capture / Log-call cap math (`captureLimits.ts`) | The cap is bucketed by **device-local midnight**. A traveler crossing the international date line mid-day will see their cap shift by a day, and a user who manually rolls their device clock backward could reset their cap. The clock-rollback case is already partially mitigated by the **server-side abuse heuristic** (`SERVER_CAPTURE_BLOCKED_CODE` / `Pre-launch follow-up: Page on-call automatically when an auto-blocked user keeps trying to capture` task). The legitimate-traveler case is acceptable for v1. | Logged on the existing `captureLimits.ts` header comment; no further action needed for launch. |
| Polish | All inputs | No explicit RTL handling. `<TextInput>` does correctly render Arabic / Hebrew (the system handles bidi), but our trim/length math counts UTF-16 code units, so 100 emoji characters (each 2 code units) will hit a 200-char cap at 100 visible chars. This is acceptable for v1 since the caps are deliberately generous. | Logged as follow-up: "Use `Intl.Segmenter` for grapheme-aware length math on inputs". Cosmetic only. |
| Polish | Capture / Log-call (`capture.tsx`, `log-call.tsx`) | We don't show a live "X / 5,000" counter on the body field — only the "you've reached the limit" hint at the cap. | Acceptable for v1: the cap is high enough that a real journaling note never approaches it, so a counter would just add visual noise. Logged as a follow-up in case real users tell us otherwise. |
| Polish | Pro user with a subscription that expired today | `SubscriptionContext.refresh()` runs on mount + on focus. The first foreground after expiry will downgrade them, but a user mid-session at midnight UTC could still see the Pro UI for one navigation. | Existing `EAS production build and App Store submission` and `Survive restarts for free-tier daily capture claims too` queued tasks already cover the subscription-edge work; this is a sub-case. No new task. |
| Polish | App backgrounded mid-capture | `KeyboardAvoidingView` + Expo's foreground/background lifecycle preserves the unsent body as long as the JS bundle isn't evicted. We have **no explicit draft persistence**, so a force-kill loses the in-progress note. | Logged as a follow-up: "Persist in-progress capture body to AsyncStorage every 1s so a force-kill doesn't lose the note". Real but lower-impact than the Round-3 fixes. |

---

## Special-attention items called out by the brief

The task brief asked me to verify a specific edge-case checklist. Findings:

### 1. Input edge-case checklist (per field)
| Check | Capture body | Log-call note | Login email | Archive search | Cloud API URL |
|---|---|---|---|---|---|
| Empty submit | Save disabled (good) | Save disabled (good) | Inline error (good) | Empty = list view (good) | Empty = clear override (good) |
| Whitespace-only | `content.trim()` rejects (good) | `person.trim()` + `content.trim()` reject (good) | Trim before send (FIXED) | `q.trim()` rejects (good) | `trim()` rejects (good) |
| Single character | Saves successfully | Saves successfully | Sent to API; server rejects | 250 ms debounced | Now requires URL parse (FIXED) |
| **Very long (5,000+ chars)** | **CAPPED at 5,000 (FIXED)** | **CAPPED at 5,000 (FIXED)** | **CAPPED at 254 (FIXED)** | **CAPPED at 200 (FIXED)** | **CAPPED at 500 (FIXED)** |
| Emoji-only | Saves; embedding may underperform but won't fail | Saves | Server rejects (good) | Searches as literal | Validator rejects (FIXED) |
| Mixed RTL text | Renders correctly via system bidi | Renders correctly | Submitted as-is | Searches as literal | Validator rejects unless valid host |
| Special chars / quotes | Round-trips through outbox cleanly | Round-trips cleanly | Forwarded to server unchanged | URL-encoded by `encodeURIComponent` | Validator rejects unless valid URL |
| Paste from rich text | RN strips formatting; plain-text is captured | Same | Same | Same | `URL` constructor rejects styled HTML |
| Autocorrect interference | `autoCorrect={false}` on email & URL (good) | n/a (free-form note) | Email `autoCorrect={false}` (good) | n/a | `autoCorrect={false}` (good) |
| **Rapid double-submit** | **Guarded by `submitting` flag (FIXED)** | **Guarded by `submitting` flag (FIXED)** | Already guarded by `submitting` | Debounced 250 ms (good) | Sync action (no race) |

### 2. Environment edge-case checklist
- **Phone clock past:** `isTimestampToday` uses local clock — a memory tagged with a past timestamp still counts as "today" if the user rolled the clock back, which is correct behaviour. Cap could be reset by manual clock manipulation; mitigated by the server-side abuse block (`SERVER_CAPTURE_BLOCKED_CODE`).
- **Phone clock future:** Future-dated memories are correctly treated as in-window by `getLibraryWindowState`. No regression.
- **Timezone change mid-session:** `getLocalDayKey` recomputes on every read, so a flight that changes the device TZ mid-day will compute a fresh local-day-key on the next capture. Server's claim store buckets by the same key, so the local-server contract stays in sync.
- **DST boundary:** `getLocalDayKey` uses `getFullYear / getMonth / getDate`, all of which are DST-stable. Verified.
- **Very low free storage:** AsyncStorage writes can throw with `ENOSPC`. `MemoriesContext.addMemory` doesn't currently catch that; an existing follow-up task ("Wellness storage failure → calm error toast") covers wellness; logging a follow-up for capture is queued under "Polish the small empty/error gaps the pre-launch sweep flagged".
- **Low battery mode:** No app-level effect — RN doesn't expose battery state to JS by default; we don't run background tasks that would be throttled.
- **App backgrounded mid-action:** Sync outbox already covers this (Round 2 verified). In-progress capture text is held in component state; a backgrounded-but-not-killed app preserves it.
- **App force-killed mid-action:** Outbox covers committed memories. In-progress unsaved capture body is lost — logged as a follow-up draft-persistence task above.
- **Low memory pressure:** RN may unmount the component; `MemoriesContext` is rooted at the layout, so the memories list is preserved. In-progress capture body is lost (same as force-kill).

### 3. Account edge-case checklist
- **Brand new account, zero memories:** Round 2 already verified the empty states across Home / Archive / Progress / Insights / Recap.
- **1,000+ memories:** `apiListMemories` paginates at `limit=20`. The Archive screen renders a `FlatList` (virtualized). No regression at high counts; the existing test `memoriesFetchExport.test.ts` covers a 1k-row fetch.
- **Free user at exactly the daily limit:** Verified — `getCaptureLimitState` returns `atLimit: true` at exactly `FREE_DAILY_CAPTURE_LIMIT`, the form is replaced with the upsell card on capture and log-call.
- **Pro user whose subscription expired today:** `SubscriptionContext.refresh()` will downgrade them on next focus. Acceptable for v1 (one stale render at most).
- **User who upgraded in another device session:** `SubscriptionContext` re-fetches on subscription-screen focus, so a return from Stripe in the other device shows up the next time they open the app.
- **User who restored purchases on a fresh install:** `restoreFlow.test.ts` covers this. Verified.

---

## Reusable building block

`lib/inputLimits.ts` is now the single source of truth for:
- `MEMORY_CONTENT_MAX_LENGTH` (5,000)
- `PERSON_NAME_MAX_LENGTH` (120)
- `SEARCH_QUERY_MAX_LENGTH` (200)
- `EMAIL_MAX_LENGTH` (254)
- `PASSWORD_MAX_LENGTH` (200)
- `DISPLAY_NAME_MAX_LENGTH` (80)
- `API_URL_MAX_LENGTH` (500)
- `validateApiUrl(input) → { ok: true, url } | { ok: false, reason }`

**When you add a new input, import the appropriate constant from this file rather than picking your own. The whole point of having one file is that a future ad-hoc cap on one screen can't silently disagree with the cap on another.**

Locked by `lib/inputLimits.test.ts`:
- All constants are positive integers
- `MEMORY_CONTENT_MAX_LENGTH < 8,000` (server embed limit)
- `PERSON_NAME_MAX_LENGTH < MEMORY_CONTENT_MAX_LENGTH`
- `EMAIL_MAX_LENGTH === 254` (RFC 3696)
- `validateApiUrl` accepts http(s), trims whitespace, and rejects empty / `javascript:` / `file:` / over-cap / unparseable inputs

The companion `INPUT_EDGE_CASE_CHECKLIST.md` is the reusable rubric to run against any future input field before shipping it.
