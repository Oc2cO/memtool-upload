# Input Edge-Case Checklist

This checklist is the reusable rubric created during Pre-launch Round 3. Run it against **every** new user input — text field, picker, slider, file/photo picker, voice input, search box, even URL params used as a "filter" — before shipping the feature. The Round 3 audit found that almost every input had a robust *business-rule* layer (cap math, Pro gating) but no defenses at the *keyboard layer*; this checklist exists so that pattern doesn't repeat.

When in doubt, prefer caps from `lib/inputLimits.ts` over picking new ones.

---

## Per-field input checklist

For every editable surface, walk through these eleven cases. The "good answer" column is what the field should do; if it doesn't, file a fix or — if the deviation is intentional — write the rationale into the source comment so the next reviewer knows it was a choice and not an oversight.

| # | Case | What to try | Good answer |
|---|---|---|---|
| 1 | **Empty submit** | Tap Save with the field blank. | Save is disabled OR shows a calm inline error; never sends an empty value to the server. |
| 2 | **Whitespace-only** | Type `"   "` (just spaces / tabs / newlines). | `trim()` runs **before** the empty check, so the submit is treated as empty (#1). The trimmed value is what reaches the server. |
| 3 | **Single character** | Type `"a"` and submit. | Saves successfully if the field has no minimum length. If a minimum is enforced (e.g. password), the inline error names the rule, not the input ("Password must be at least 8 characters"). |
| 4 | **Very long (5,000+ chars)** | Paste a 100,000-character article. | A `maxLength` prop truncates at the `lib/inputLimits.ts` cap. An inline "you've reached the limit" hint shows once they're at the cap. The field never sends an over-cap value to the server (defense in depth). |
| 5 | **Emoji-only** | Type only emoji (`"🎉🎉🎉"`). | Saves cleanly. The field doesn't reject emoji as a category; if it must (e.g. an email field), the rejection comes from a real validator, not a regex on character set. |
| 6 | **Mixed RTL text (Arabic / Hebrew)** | Type `"שלום عالم"`. | Renders correctly via system bidi handling. The trim/length math is the same as for LTR. (Note: `string.length` is UTF-16 code units, so a 100-emoji string counts as 200 against a length cap; usually fine for the generous caps in `inputLimits.ts`.) |
| 7 | **Special characters and quotes** | Type `<script>alert("xss")</script>`, `'`, `"`, `;`, `\n`. | Round-trips cleanly through the outbox / API. Renders as literal text on the read side (RN's `<Text>` doesn't interpret HTML). URL-bound values are encoded with `encodeURIComponent`. No regex-based "sanitisation" — escape at the boundary, not at the input. |
| 8 | **Paste from rich text** | Copy a styled paragraph from a webview, paste into the field. | RN strips formatting; the plain-text value is captured. No inline HTML or styling artefacts reach the server. |
| 9 | **Autocorrect interference** | On iOS: type a password / URL / email; let autocorrect "fix" it. | `autoCorrect={false}` and `autoCapitalize="none"` are set on email, password, URL, and any field where autocorrect would corrupt the value. Search and free-text body inputs leave autocorrect on (it's a help, not a hindrance, in those contexts). |
| 10 | **Rapid double-submit** | Mash the Save button 5 times in 200 ms. | `handleSave` is gated by a `submitting` boolean (early-returns if already in flight, also OR'd into the button's `disabled` prop). The button label flips to "Saving…" so the second tap also gets a visual cue. The flag is cleared on stay-on-screen error branches so the user can retry. |
| 11 | **Invalid format for the field's purpose** | URL field: type `"yes"`. Email: type `"not-an-email"`. Number: type `"abc"`. | A real validator runs **before** persistence and renders an inline error in the destructive color. The error text says what's wrong **and** is actionable ("URL must start with `http://` or `https://`"), not a stack trace. The error clears when the user starts editing again. |

---

## Per-feature environment checklist

For every input that touches local state, sync, dates, or storage, also walk these nine cases. These are the "real-world" environment gotchas — you won't find them by typing into the field, but a real user **will** find them.

| # | Case | What to try | Good answer |
|---|---|---|---|
| 12 | **Phone clock set to past** | Manually set the device clock back 1 day, capture a memory. | The memory's timestamp is whatever the device reports. The cap math doesn't accept the rolled-back day as a "free reset" (server-side abuse heuristic catches the rotated `localDay` keys). The library window correctly treats the future-from-server-perspective memory as in-window. |
| 13 | **Phone clock set to future** | Manually set the device clock forward 1 year. | Future-dated memories are treated as in-window by `getLibraryWindowState` (better than silently locking a brand-new entry). Cap math doesn't break. |
| 14 | **Timezone change mid-session** | Open the app in NYC, fly to Tokyo, open the app again. | `getLocalDayKey` recomputes on every read, so the next capture buckets correctly into the new local day. Server's claim store buckets by the same key. |
| 15 | **Daylight savings boundary** | Capture at 1:30 AM the night DST starts/ends. | `getLocalDayKey` uses `getFullYear / getMonth / getDate`, all DST-stable. No double-counting and no skipped-day gaps. |
| 16 | **Very low free storage** | Fill the device to 99 % and try the action. | AsyncStorage writes can throw `ENOSPC`. The action either retries gracefully or surfaces a calm inline error; **never** crashes silently. (The capture / log-call paths are queued for explicit `ENOSPC` handling — see follow-up tasks.) |
| 17 | **Low battery mode** | Enable iOS Low Power Mode, exercise the feature. | No app-level effect — RN doesn't expose battery state to JS by default. If a future feature ever **does** opt into `expo-battery`, also re-validate this cell. |
| 18 | **App backgrounded mid-action** | Start typing a memory, swipe the app to the background for 30s, return. | Component state is preserved (RN keeps the JS bundle warm). Sync outbox replays any committed work on the next foreground tick. |
| 19 | **App force-killed mid-action** | Start typing a memory, force-kill the app, relaunch. | Committed memories survive (outbox). In-progress unsaved input is lost — the screen reopens fresh. (Round 3 logged a follow-up to add 1-second-debounced draft persistence for the capture body.) |
| 20 | **Low memory pressure** | Open ~10 apps, return to MemTool. | The screen may unmount. `MemoriesContext` is rooted at the layout, so the memories list is preserved. In-progress capture body is lost (same as #19). |

---

## Per-account edge-case checklist

For every input or surface that depends on subscription tier, day-cap state, or account size, run these six cases. These are the "what users actually look like" cases — fresh signup, power user, paying customer at the boundary.

| # | Case | What to try | Good answer |
|---|---|---|---|
| 21 | **Brand new account, zero memories** | Sign up, open every screen. | Every empty surface has a calm `EmptyState` with a clear primary action (capture, log call, talk to Mem). Round 2 verified all of these. |
| 22 | **Account with 1,000+ memories** | Seed 1k+ memories, open Archive / Insights / Recap. | `apiListMemories` paginates at 20; Archive uses a virtualized `FlatList`; `memoriesFetchExport.test.ts` covers the export path. Insights derives from the local list which is bounded by what's loaded. |
| 23 | **Free user at exactly the daily limit** | Capture exactly `FREE_DAILY_CAPTURE_LIMIT` memories. | `getCaptureLimitState` returns `atLimit: true`; capture and log-call both swap their form for the upsell card; home hint says "0 of 10 left today". |
| 24 | **Pro user whose subscription expired today** | Manually expire the entitlement, open the app. | `SubscriptionContext.refresh()` runs on mount + on subscription-screen focus. The cap returns; cached memories beyond the free window flip to the locked tease. |
| 25 | **User who upgraded in another device session** | Go Pro on device A, open device B. | Device B's `SubscriptionContext` re-fetches on subscription-screen focus. The Pro UI appears once status flips. |
| 26 | **User who restored purchases on a fresh install** | Wipe the app, reinstall, sign in, restore. | `restoreFlow.test.ts` covers this end-to-end. Pro flag rehydrates from the SDK + server check. |

---

## How to use this for a new feature

1. Skim the **per-field** rows; if any cell isn't trivially "yes, that's correct", file a fix before merging.
2. Skim the **per-feature** rows; only the relevant ones — a pure UI screen with no inputs only needs #18-#20.
3. Skim the **per-account** rows; only the relevant ones — a logged-out screen only needs #21.
4. Update **`lib/inputLimits.ts`** if the feature introduces a new kind of input (don't add a one-off cap inline).
5. If a deviation is intentional, leave a code comment on the deviation explaining **why**. The next reviewer should be able to tell oversight from policy at a glance.

The audit document this checklist was extracted from is `PRELAUNCH_AUDIT_ROUND_3.md` (next to this file).
