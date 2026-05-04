# Pre-launch Round 5 — TestFlight / Internal Beta with Outside Testers

**Date:** 2026-05-01
**Scope:** 5–10 real humans (not the user) take a TestFlight build for ~5–7 days, fill a structured feedback form, and the responses get triaged into fix-now / fix-after-launch / won't-fix.
**Companion:** `PRELAUNCH_AUDIT_ROUND_1.md` (visual & copy), `PRELAUNCH_AUDIT_ROUND_2.md` (empty / loading / offline states), `PRELAUNCH_AUDIT_ROUND_3.md` (input edge cases), `PRELAUNCH_AUDIT_ROUND_4.md` (real-device day-in-the-life).
**Coordinates with:** Task #65 (EAS production build & App Store submission).

---

## TL;DR

Rounds 1–3 read the code. Round 4 put the app in *one* real human's pocket for a real day. Round 5 puts it in **5–10 other people's** pockets for a week and asks them — in a structured way — what worked, what confused them, what they'd pay for, and whether they'd open it tomorrow.

Outside testers catch the things the user has gone blind to: the tab label that's obvious if you built the app and meaningless if you didn't, the onboarding step that everyone reads twice, the paywall that lands fine on iPhone 15 Pro and looks broken on iPhone SE.

This document contains everything needed to run the round end-to-end:

1. **A pre-flight check** that the distribution channel actually exists and a build is installable.
2. **A one-page tester onboarding doc** ready to send to invitees as-is.
3. **A structured feedback form** — written tool-agnostically so it can be pasted into Google Forms, Tally, or Typeform in ~10 minutes.
4. **A tester tracking sheet template.**
5. **A triage framework** for the post-beta pass.
6. **A "what we learned" summary template.**

Steps 5 and 6 are intentionally **deferred** — they cannot run until real testers return real feedback. They are scaffolded here so the follow-up pass has nowhere to drift.

---

## Part 1 — Confirm the distribution channel exists

Before any tester is invited, **two questions must have a confident yes answer**. If either is no, stop and resolve before sending invites.

### iOS (TestFlight) — required

- [ ] A production or preview build exists in TestFlight under the team for `com.polsia.memtool`.
  - Source of truth: Task #65. The "successful upload" line in `eas submit` output is the canonical confirmation.
  - If only a preview build exists, that is acceptable for Round 5 — preview builds install via TestFlight too, and behaviorally match production within RevenueCat sandbox limits.
- [ ] The build is in **"Ready to Test"** state in App Store Connect (TestFlight tab), not "Processing" and not "Missing Compliance".
- [ ] An **internal testing group** (or external testing group, if the user wants more than 100 testers — but for 5–10, internal is enough and skips Beta App Review) is created and the build is attached to it.
- [ ] The TestFlight invite link or "public link" is copied somewhere durable — it goes in the onboarding doc below.
- [ ] At least one tester slot has been confirmed manually by the user installing on a fresh device (or the same device used in Round 4 — Round 4 already covers this if the build there was the TestFlight one).

### Android (internal distribution) — optional for this round

The product target is still iOS-first for v1 launch, but the Android distribution channel is now **wired and ready** (Task #209) so a Round 5b Android wave — or any v1.0.x stability beta on Android — can start without multi-day setup work.

**Channel configuration (already done):**

- `app.json` → `android.package = "com.polsia.memtool"` (matches the iOS `bundleIdentifier`), adaptive icon set, `RECORD_AUDIO` permission declared for Speak-a-memory.
- `eas.json` → `build.preview` and `build.development` produce APKs (`buildType: "apk"`) so they can be sideloaded directly from the EAS build page or an emailed install link. `build.production` produces an AAB (`buildType: "app-bundle"`) for Play Store submission. `versionCode` is sourced remotely (`appVersionSource: "remote"`) — EAS bumps it automatically, no need to edit `app.json` per build.
- `eas.json` → `submit.production.android` is configured for the Play Console **internal testing** track, releaseStatus `draft`, reading the service-account JSON from `./google-play-service-account.json` (gitignored — see below).

**Two distribution paths are available; pick one per Android wave:**

1. **EAS internal distribution (APK)** — preferred for a quick beta. No Play Console setup, no service account needed. One command:
   ```
   eas build --profile preview --platform android
   ```
   EAS returns an install-page URL that testers open on their Android device, tap "Install", and accept the unknown-sources prompt. Up to ~100 registered devices per Expo project — plenty for 5–10 testers. Use this path for the first Android wave.

2. **Play Console internal testing track** — for a longer-running channel that mirrors how the production app will install. Requires three one-time setup steps before `eas submit` works:
   1. Create the app in Play Console with package name `com.polsia.memtool` and upload one signed AAB manually (Play requires the first track upload to come from the console, not the API).
   2. Create a Google Cloud service account with the **Service Account User** role and grant it **Release manager** access in Play Console → Setup → API access.
   3. Download the service-account JSON key, save it at `artifacts/memtool/google-play-service-account.json` (the path is in `.gitignore` so it can never be committed), then:
      ```
      eas build --profile production --platform android
      eas submit --profile production --platform android
      ```
   For CI, upload the same JSON as an EAS Secret instead of keeping it on disk:
   ```
   eas secret:create --scope project --name GOOGLE_SERVICE_ACCOUNT_KEY --type file --value ./google-play-service-account.json
   ```
   and switch `serviceAccountKeyPath` to read from the secret.

**Pre-flight check before inviting Android testers (verify install on a real device):**

- [x] `eas build --profile preview --platform android` produced an installable APK (or `eas submit --profile production --platform android` pushed a build to the internal track).
- [x] At least one Android device has installed the build, opened it, signed in, and captured a memory end-to-end. **This is the gate** — until one human has actually run the APK on Android hardware, the channel is configured but unverified.
- [x] The install link (EAS build URL) or Play Console internal-track opt-in URL is copied somewhere durable, ready to paste into the tester onboarding doc.

> **Status (2026-05-02):** Hardware QA pass complete (Task #222). An EAS preview APK (`eas build --profile preview --platform android`) was installed on a mid-range Android device (Pixel 6a, Android 14, gesture nav enabled). All three pre-flight boxes are ticked — APK built and installed, end-to-end memory captured, EAS build install link preserved in the project notes for Round 5b tester invites. The per-screen table below was walked and every row passed. No Android-specific issues requiring inline fixes or follow-up bugs were found.

**Code-level Android polish (Task #218 — done):**

A read-the-code Android pass landed before the hardware QA pass. The fixes are intentionally narrow — only the issues that can be caught and fixed without a device — so the hardware pass that follows is the *only* remaining gate:

- Root layout mounts `expo-status-bar` with `style="light"` + `translucent` so the system clock / battery icons stay visible against the dark theme on Android (the system default follows the device's appearance setting and would otherwise render dark icons over the dark background).
- Root layout calls `expo-system-ui`'s `setBackgroundColorAsync("#0a0a0f")` so the native Android root view matches the dark theme — kills the white flash that would otherwise show between the splash hide and the first React render. iOS already gets this from `splash.backgroundColor`; Android's root activity background is independent.
- `app.json` → top-level `androidStatusBar` (`barStyle: "light-content"`, transparent background, `translucent: true`) and `androidNavigationBar` (`barStyle: "light-content"`, `backgroundColor: "#0a0612"`) are set so the status bar icons render light over the dark app background and the system gesture / 3-button bar matches the dark theme on devices where the OS still colours it (older Android, and edge-to-edge fall-backs). These keys live at the root of the `expo` config, not nested under `android` — the `@expo/config-types` schema is explicit about that.
- `voice-capture.tsx` registers a `BackHandler` listener that intercepts the Android hardware back button: while recording it stops the recorder cleanly and returns to idle (without it, the audio session would hold the mic until GC); during drafting it triggers the same "Discard this memory?" alert the close button uses (without it, the user's draft would be silently dropped). Other phases (idle, processing, saving) still fall through to the default Stack pop. iOS doesn't fire BackHandler events, so this is a no-op there and doesn't interfere with the swipe-to-dismiss modal gesture.

**Hardware QA pass (per-screen — required before flipping the recommendation):**

Run on a real Android device (mid-range phone preferred — Pixel 6a / Galaxy A-series / similar, gesture nav enabled). For each row, "OK" means the screen looks and behaves the same as on iOS modulo the platform conventions; anything else is an Android-specific issue and either gets fixed inline or filed as its own follow-up with a screenshot.

| Screen | What to check on Android | Result |
|---|---|---|
| Splash → first frame | No white flash between splash hide and dark home (system UI background fix). | OK |
| Status bar (every screen) | Time / battery icons visible (light icons over dark background). | OK |
| System nav bar (every screen) | Dark background, light icons. No light bar on dark screen. | OK |
| Onboarding (`/onboarding`, `/onboarding-chat`) | Hardware back doesn't escape onboarding into a logged-out state. Keyboard on `/onboarding-chat` doesn't cover the text input. | OK |
| Login (`/login`) | OAuth sheet returns cleanly. Hardware back from login closes the app rather than going to a half-rendered state. | OK |
| Home (`(tabs)/index`) | Tab bar reads correctly with system gesture bar. Quick Capture haptic fires (Android vibration). | OK |
| Capture (`/capture`) | Keyboard pushes the input above the save button (KeyboardAvoidingView `height` mode). Hardware back closes the modal. Daily-cap upsell card renders on `limitReached`. | OK |
| Voice Capture (`/voice-capture`) | Mic permission prompt appears the first time. Hardware back during *recording* stops the recorder; hardware back during *drafting* shows the discard alert. The hold-to-record button responds to long-press without the system grabbing the gesture. | OK |
| Archive (`(tabs)/archive`) | Person filter chip and date range picker render full-width. Memory list scroll doesn't overlap the tab bar. | OK |
| Recap (`/recap`) | Heatmap / charts render with no clipped axes. | OK |
| Paywall (`/subscription`) | RevenueCat purchase sheet opens (or shows the "coming soon" fallback in dev). The bottom CTA isn't covered by the system nav bar. | OK |
| Settings (`(tabs)/settings`) | Export-share opens the Android share sheet (not iOS UTI fallback). Sign-out lands on `/login`. | OK |
| Sign-in / sign-out round trip | After sign-out and re-sign-in, RevenueCat identity bridge restores Pro state if applicable. | OK |

Each of the above is **eyeballed once** on a single device. If any row fails, the issue is fixed inline (preferred) or filed as a follow-up task with a screenshot before the recommendation flips.

**Default recommendation for Round 5 itself:** Android welcome from Round 5. The hardware QA pass (Task #222, 2026-05-02) walked every row in the table above on a real Android device — all rows passed. The per-screen checklist is archived in the v1.0 launch notes. Use the EAS internal-distribution channel above for Round 5b Android testers or for v1.0.x post-launch Android testing.

### Pre-flight blockers

If Round 4's day-of test surfaced any **B (blocker)** items, **fix them before sending Round 5 invites**. The cost of a bad first impression on outside testers is much higher than the cost of delaying the invite by a day or two. Use the Round 4 triage section to confirm.

---

## Part 2 — Tester onboarding doc (send this to invitees as-is)

Everything below the next horizontal rule is meant to be **copy-pasted to the testers** — by email, DM, or pinned in a shared chat. It is intentionally one page, plain language, no jargon, no emoji.

The user only needs to fill in the three `[ … ]` placeholders before sending: the TestFlight link, the feedback form link, and a contact channel for urgent bugs.

---

> # Welcome to the MemTool beta
>
> Thanks for trying this out. You're one of about ten people seeing this app before anyone else.
>
> ### What MemTool is, in two sentences
>
> MemTool is an iPhone app for capturing small life moments — a memory, a phone call you want to remember, a tip someone gave you — and getting them back later through a private AI guide and a daily recap. It's meant to feel like a notebook that pays attention.
>
> ### How to install
>
> 1. On your iPhone, install **TestFlight** from the App Store if you don't have it.
> 2. Open this invite link on the same iPhone: **`[ TestFlight invite link ]`**
> 3. Tap "Accept", then "Install".
> 4. Open MemTool. Sign in or sign up with email — a fresh account is fine.
>
> If the install fails or the app crashes on first open, message the contact below and try again later — don't try to debug it yourself.
>
> ### What to try (about 15–20 minutes total, spread over a few days)
>
> Use the app the way you'd actually use it. In addition, please make sure you do each of these at least once during the week:
>
> 1. **Capture a memory.** Use the main capture button. Type something real — a thing that happened today.
> 2. **Talk to Mem (the AI guide).** Open the chat surface. Ask it about something you captured.
> 3. **Try the export.** Find the "export memories" option in settings or the archive. See where the file ends up.
> 4. **Hit the paywall.** At some point, the app will offer to upgrade to Pro. Open that screen and read it. **You don't need to actually subscribe** — just look. If you're curious, you can read the Restore Purchases option too.
> 5. **Open the Daily Recap** at least once when it's available.
>
> Beyond that, just live with it for a few days. Open it when you'd open a notes app. The point is to find out whether it's actually useful, not just to check off a list.
>
> ### How to give feedback
>
> Two channels:
>
> - **The form** — please fill this in once at the end of the week (about 10 minutes): **`[ Feedback form link ]`**.
>   You can also fill it in earlier and add to it as you go.
> - **Urgent bugs / crashes / "the app is unusable"** — message **`[ contact channel — text / email / Signal / etc. ]`** directly so they can be looked at while the beta is still running. Please include: what you were doing, what happened, your iPhone model, and your iOS version. A screenshot helps a lot.
>
> ### What's in scope to give feedback on
>
> Everything. Bugs, things that confused you, things that delighted you, copy that felt off, things that felt slow, things you wished existed. There is no wrong answer and no feedback that's "too small."
>
> ### What's *not* in scope
>
> - Don't worry about the app icon, the splash screen, or visual polish that's clearly a work-in-progress — those are tracked separately.
> - Don't subscribe to Pro for real unless you actually want it. Sandbox subscriptions during a TestFlight beta don't charge you, but if the app is ever re-installed from the real App Store later, that's a different story. **If you do subscribe in TestFlight, it auto-renews on a sandbox 1-day cycle and is free — you can cancel anytime in Settings → App Store → Sandbox Account.**
>
> ### A note on privacy
>
> You'll be using a real account. Anything you capture is stored against that account. After the beta, you can delete the account from inside the app — settings → delete account. Don't capture anything you wouldn't want associated with your name during the test window. (For most people, this isn't a real concern — but it's worth saying out loud.)
>
> Thank you. Genuinely — this is the most useful feedback the app will ever get.

---

(End of copy-paste block.)

---

## Part 3 — Feedback form (paste into Google Forms / Tally / Typeform)

Tool choice is the user's call — the questions below are **tool-agnostic** so they can be pasted into whichever the user already has an account for. If the user has no preference, **Tally** is the recommended default: free tier covers 5–10 testers easily, no Google account required to submit, and exports to CSV cleanly.

> The agent should ask the user which form tool they want **before actually creating the form** — building it in the wrong tool wastes time. This doc is the source-of-truth for the questions; whichever tool gets used, this is what goes into it.

### Form metadata

- **Title:** *MemTool beta — your feedback*
- **Description (top of form):**
  > Thanks for testing MemTool. This is one form, about 10 minutes, fillable on phone or laptop. There are no wrong answers. The "free text" boxes are the most valuable part — write whatever you want, even one sentence. — *the team*
- **Settings:**
  - Anonymous OK (testers can leave their name blank — see Q1).
  - Allow editing responses after submission.
  - Send a copy of the response to the submitter (helps them remember what they said).

### Questions

**Section 1 — About you**

1. **Your name or alias** *(short text, optional)* — *helps us match feedback to people we invited; leave blank if you'd rather be anonymous.*
2. **iPhone model** *(short text)* — *e.g. "iPhone 13", "iPhone 15 Pro", "iPhone SE 2nd gen".*
3. **iOS version** *(short text)* — *Settings → General → About → Software Version. Just the number is fine.*
4. **Roughly how many days did you use the app?** *(single choice)* — *0–1 / 2–3 / 4–5 / 6–7 / more than a week.*
5. **Roughly how many memories did you capture?** *(single choice)* — *0 / 1–2 / 3–5 / 6–10 / more than 10.*

**Section 2 — What you actually did**

6. **Which of these did you try at least once?** *(multi-select)*
   - Capture a memory
   - Open the Mem AI Guide chat
   - Export memories
   - View the Daily Recap
   - Search or filter the Archive
   - Open the paywall / upgrade screen
   - Tap "Restore Purchases"
   - Use the app while offline / on airplane mode
   - Force-quit and reopen the app
   - None of these — *(if selected, please say why in question 14)*
7. **Did anything stop you from doing one of the things above?** *(long text, optional)* — *If yes, which one and what happened?*

**Section 3 — Reactions**

8. **What worked well — what felt good, surprising, or actually useful?** *(long text, required)* — *One sentence is fine. Three sentences is great. Be specific if you can: a screen, a moment, a phrase.*
9. **What confused you — anywhere you had to stop and think, re-read something, or guess what to tap?** *(long text, required)* — *Same rules: be specific. "I didn't know what 'Mem' was the first time I saw it" is the kind of feedback we want.*
10. **Did you find any bugs or visible glitches?** *(long text, optional)* — *Quick description per bug is fine. Don't worry about reproducing them perfectly.*
11. **For each bug above, how bad was the worst one?** *(single choice, only shown if Q10 has any answer)*
    - **Severe** — the app crashed, data disappeared, or I couldn't continue.
    - **Important** — clearly wrong, but I worked around it.
    - **Polish** — visible smudge, didn't actually block me.
    - I didn't find any bugs.

**Section 4 — The big questions**

12. **Would you keep using MemTool tomorrow?** *(single choice — yes / no / maybe)*
13. **Why?** *(long text, required)* — *This is the most important answer in the whole form. Be honest — "no" is genuinely useful. If "maybe" — what would tip it to yes?*
14. **Would you pay for the Pro tier as it's currently described?** *(single choice — yes / no / maybe / I didn't see the paywall)*
15. **Why?** *(long text, required)* — *Same rules — honest is more useful than polite. If you'd pay a different amount, or for different features, say so.*

**Section 5 — Wishlist & freeform**

16. **If you could wave a magic wand and add one thing, what would it be?** *(long text, optional)*
17. **Anything else — anything we didn't ask?** *(long text, optional)* — *Including positive things. We'd love to know what made you smile.*
18. **Can we follow up with a 10-minute call if your feedback raises questions?** *(single choice — yes / no)*

### Wiring after the form is built

- Paste the form's public link into the onboarding doc above where it says `[ Feedback form link ]`.
- Make sure responses are exportable as CSV (all three of Google Forms, Tally, Typeform support this on the free tier).
- Confirm a test submission works end-to-end before sending a single tester invite.

---

## Part 4 — Tester tracking sheet

A spreadsheet (Google Sheets, Numbers, or even a markdown table in this doc) keeps the round honest — without it, "did Alice respond?" turns into a vague guess after day three.

### Template

| # | Tester name / alias | Contact | Invite sent (date) | TestFlight accepted | First-open confirmed | Feedback submitted | Notes / urgent issues raised |
|---|---|---|---|---|---|---|---|
| 1 |   |   |   | ☐ | ☐ | ☐ |   |
| 2 |   |   |   | ☐ | ☐ | ☐ |   |
| 3 |   |   |   | ☐ | ☐ | ☐ |   |
| 4 |   |   |   | ☐ | ☐ | ☐ |   |
| 5 |   |   |   | ☐ | ☐ | ☐ |   |
| 6 |   |   |   | ☐ | ☐ | ☐ |   |
| 7 |   |   |   | ☐ | ☐ | ☐ |   |
| 8 |   |   |   | ☐ | ☐ | ☐ |   |
| 9 |   |   |   | ☐ | ☐ | ☐ |   |
| 10 |   |   |   | ☐ | ☐ | ☐ |   |

### How to fill it in

- **Invite sent:** the date the email/DM with the TestFlight link went out.
- **TestFlight accepted:** App Store Connect's TestFlight tab shows accepted invites; tick when it appears there.
- **First-open confirmed:** App Store Connect also reports first launch per tester. Tick when seen.
- **Feedback submitted:** tick when their response shows up in the form's response sheet. (Match by name / alias / email — that's why Q1 of the form exists.)
- **Notes / urgent issues raised:** anything they messaged directly via the urgent-bug channel.

### Reminder cadence (suggested)

- **Day 0:** invite goes out.
- **Day 2:** light nudge to anyone with no first-open.
- **Day 5:** reminder to fill the form to anyone who hasn't.
- **Day 7:** soft close — collect anything outstanding, thank everyone, close the round.

The cadence is just a default — adjust to the tester pool.

---

## Part 5 — Pause for the user

**This is where the agent stops and waits.** The next steps cannot start until:

1. The user has invited the testers (the agent does not have addresses or contact channels, and shouldn't).
2. The 5–7 day beta window has actually elapsed.
3. Form responses are exported to CSV and either pasted into this doc or attached as a file the agent can read.

When the user comes back with the responses, the next pass picks up at Part 6.

---

## Part 6 — Triage framework (deferred — runs after responses come back)

This section is intentionally a **placeholder**. The agent will fill it in during the follow-up pass. The plan for that pass is:

1. **Read all responses end-to-end first**, before sorting anything. The shape of the feedback often tells a story — e.g. "everyone misunderstood the same thing" — that gets lost if you triage row-by-row.
2. **Group findings by theme**, not by tester. One row in the triage table per distinct issue, with a count of how many testers raised it. Themes likely to emerge: capture friction, Mem AI Guide quality, paywall clarity, recap legibility, naming consistency (`memory` vs `moment` vs `entry` — see existing follow-up).
3. **Sort each theme into one of three buckets**, with a one-line rationale:
   - **Fix before launch** — anything raised by ≥ 2 testers or marked Severe by even 1 tester, or that breaks a core path (capture, Mem, export, paywall).
   - **Fix after launch** — important but workaround-able; goes into the post-launch backlog as its own follow-up task.
   - **Won't fix** — with a written reason. "Three testers wanted feature X, but X conflicts with the product thesis of Y" is a valid and useful won't-fix.
4. **Land the fix-before-launch quick wins in the same triage pass** — anything ≤ ~30 min of edit + verify. Anything bigger becomes its own task.
5. **Cross-check against existing follow-ups.** Some themes will likely echo follow-ups already on the board (e.g. cooldown copy consistency, naming consistency, daily-cap surfacing). When that happens, the triage entry should reference the existing follow-up rather than duplicate it.
6. **For every "would you keep using it?" *no* or *maybe*, treat the *why* as its own row** even if it overlaps another theme — the *why* is the strongest signal in the entire form.
7. **Record the paywall verdict separately.** Q14/Q15 are the only commercial signal in the round. The triage table should have a one-paragraph summary of how the paywall was received, with quotes.

When the pass runs, results land below this line as a `## Triage results` section, structured as:

```
### Theme: [name]
- Raised by: N of M testers
- Severity: [Severe / Important / Polish]
- Verbatim quotes: …
- Bucket: [Fix before launch / Fix after launch / Won't fix]
- Action: [task ID, or "fixed in this pass — see commit X"]
- Reasoning: …
```

---

## Part 7 — "What we learned" summary (deferred — runs after triage)

A short, plain-language doc the user can re-read post-launch and again before v1.1. **One page max.** Sections:

1. **The headline.** One paragraph: did testers like it, would they use it tomorrow, would they pay. No hedging.
2. **What we changed before launch because of this round.** Bullet list of the fixes that landed in the triage pass, with task IDs / commit links.
3. **What we deferred and why.** Bullet list of the post-launch follow-ups created, with task IDs.
4. **What we won't fix and why.** The won't-fix list with reasoning, so future-us doesn't relitigate the same decision.
5. **Surprises.** The two or three things that genuinely surprised us — positive or negative. These are the things most likely to inform v1.1.
6. **Quotes worth keeping.** A handful of verbatim lines, good and bad. The good ones for marketing copy and team morale; the bad ones for keeping us honest.

When written, this lands as `PRELAUNCH_AUDIT_ROUND_5_SUMMARY.md` in the same docs folder, so it's findable on its own without scrolling past triage tables.

---

---

## Pre-submit cleanup pass — resolved items (Task #297, 2026-05-02)

The following issues were identified and fixed before the App Store submission. Each item had been flagged as a potential rejection risk or a reviewer-trust concern.

| Item | Status | Resolution |
|------|--------|------------|
| Dead / mislabeled links | ✅ Resolved | `/insights` is a fully implemented screen (themes, people, mood, 90-day strip). `MemNoticedCard` correctly navigates there. Home tab "Daily Recap" card subtitle changed from "AI insights" (misleading) to "Today's summary" to match its `/recap` destination. |
| Wellness tab placeholder copy | ✅ Resolved | Removed the "Coming soon: automatic heart rate, app usage, and travel tracking" footer from `wellness.tsx`. The screen now shows only real, functional content (stress logger + 7-day mood chart). |
| Splash image | ✅ Resolved | `app.json` updated to use `assets/brand/splash-9x16.png` with `resizeMode: "cover"` instead of reusing the app icon. |
| Settings `your-backend.example.com` placeholder | ✅ Resolved | The Cloud API URL input field (including the `your-backend.example.com` placeholder text) is now gated behind `__DEV__`. Production and TestFlight builds show only the "Sync now" control for Pro users. |
| Developer-only screens reachable in production | ✅ Resolved | `haptics-debug.tsx` was already gated. `foundation-models-spike.tsx` now has the same `if (!__DEV__) { return <dev-only notice> }` guard, matching the haptics-debug pattern. |
| `lib/aiEngine.ts` placeholder-vectors comment | ✅ Resolved | The empty `embedding: []` shadow-entry pattern is now documented with a clear inline comment explaining that it is intentional, that no dot-product math touches it, and that real ranking goes through the server's `/patterns` endpoint. |
| Reviewer account seeding script | ✅ Resolved | `scripts/src/seed-appreview.ts` created. Seeds 20 realistic memories spread across 14 days. Run command documented in `app-store/STORE_LISTING.md` § 10. Idempotent. |

---

## Why this round exists at all

Round 4 caught the things one tired human notices in one real day. Round 5 catches the things **other people** notice — which is a strictly larger set, because the user has been staring at this app for months and has gone blind to large parts of it.

It is also the last gate before the App Store sees this. After Round 5's triage:

- If "would you keep using it?" comes back majority-yes, launch.
- If it comes back majority-maybe, fix the top theme behind the maybes, then launch.
- If it comes back majority-no — **stop, re-read the *why* answers carefully, and have a hard conversation about whether v1 is shipping the right thing.** That's a worse outcome than a delayed launch. Five "no"s from real testers is a gift, not a failure.
