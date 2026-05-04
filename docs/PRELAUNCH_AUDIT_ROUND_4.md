# Pre-launch Round 4 — Real-device Day-in-the-Life Test

**Date:** 2026-05-01
**Scope:** A full day of normal use on the user's real iPhone, with a structured diary captured per moment.
**Companion:** `PRELAUNCH_AUDIT_ROUND_1.md` (visual & copy), `PRELAUNCH_AUDIT_ROUND_2.md` (empty / loading / offline states), `PRELAUNCH_AUDIT_ROUND_3.md` (input edge cases).

---

## TL;DR

Rounds 1–3 were code-reading audits. They are good at catching the things that are visible in the source but bad at catching the things that only surface when a tired human carries the phone around for a real day — battery drain after Mem chat, the half-second of jank when the recap auto-scrolls during breakfast, the moment you realise you don't actually know which tab "Today" is on, the airplane-mode pothole on the train.

This round is the bridge from "the code looks right" to "the app feels right." It is split in three parts:

1. **Setup guide** — exactly which build to install, and how to confirm it's the right one.
2. **Day-of testing script** — the things the user is asked to do on purpose, plus a reminder to also use the app naturally.
3. **Diary template** — a short, printable form with one row per moment. ≤ 30 seconds per entry.

After the user runs the day and returns the filled diary, a follow-up pass walks every entry, sorts them into **blocker / important / polish / not-an-issue**, and lands the quick blockers immediately. Anything else becomes a logged follow-up task. **That triage pass is intentionally not done in this task** — it cannot start until the user has actually completed the day.

---

## Quickstart (one page — print this if nothing else)

**Build:** TestFlight build of MemTool `1.0.0` (`com.polsia.memtool`). Not Expo Go.

**Before you start the day:**
1. Install the TestFlight build, sign in, confirm the version on splash matches.
2. Decide *intentionally* on push + calendar permissions and write the choice down.
3. Note: Free or Pro? Battery %? Time?
4. Have the diary printed or open in a notes app.

**During the day, do these on purpose (spread out):**
- Capture **≥ 5 memories**.
- Open **Mem (AI Guide) ≥ 3 times**, in separate sessions.
- Try the **export** flow once.
- If Free → **hit the daily cap** late in the day. If Pro → **open the paywall** from a Pro-locked surface.
- **Kill and reopen** the app at least once (iOS app switcher, full kill).
- **Airplane mode for ≥ 10 minutes** while still using the app — try capture, Mem, Archive, Recap during it.
- View the **Daily Recap** at least once.
- Run a **filtered Archive search** (person, date, free text).
- Glance at **Settings → Cloud API URL**.

**Every time something happens — fill one diary row.** Time, screen, what you wanted, what happened, what you expected, severity (B/I/P/N), how it felt. Aim for ≤ 30 seconds per row.

**At bedtime:** answer the three reflection questions at the bottom of the diary, hand the diary back to the agent.

**That's it.** Everything below is the longer version of the same instructions.

---

## Part 1 — Setup guide

### Goal

Install the app the way a real App Store user will get it, on the user's real iPhone, signed in to a real (or realistic) account. Expo Go is **not** acceptable for this round — it bypasses the production JS bundle, dev-only logging, native build settings, and the production paywall.

### What build to install

In order of preference:

1. **TestFlight build** (preferred). Produced by `eas build --profile production --platform ios` and submitted via `eas submit` (see Task #65). Once it appears in TestFlight, accept the email invite on the test device, install, and open. This is the closest possible thing to the real App Store experience and is what Round 5 testers will also use.
2. **Internal preview build** if no production build is available yet. Produced by `eas build --profile preview --platform ios`. Install via the EAS-issued install link on the device. Behaviourally close to production, but not identical (no App Store receipts, RevenueCat sandbox).
3. **Do not** use `expo start` / Expo Go for this round. Findings from Expo Go are not actionable for launch.

### Pre-flight checks before the day starts

Run these once, the morning of the day, before the diary begins:

- [ ] Build version on splash matches the version in `artifacts/memtool/app.json` (`expo.version`, currently `1.0.0`) and the build number from EAS.
- [ ] Bundle ID in TestFlight matches `com.polsia.memtool`.
- [ ] Sign in works with a real account (or a fresh signup flow — note which one in the diary header).
- [ ] iCloud / system backup of the device is recent. (Not because we expect a wipe — because if anything goes truly wrong, rollback is cheap.)
- [ ] Push notification permission has been **declined or accepted intentionally**, not by accident, and the choice is recorded in the diary header.
- [ ] Calendar permission has been **declined or accepted intentionally** (recap surface uses `expo-calendar`), and the choice is recorded.
- [ ] Phone is at ≥ 80% battery at start. Battery % is recorded at start, mid-day, and end.
- [ ] Note in the diary header whether the test account is **Free** or **Pro** — the day-of script changes a bit depending on which.
- [ ] **Run the Core Haptics smoke test (`HAPTICS_REAL_DEVICE_CHECKLIST.md`)** once on the same device. The Swift bridge in `expo-core-haptics` has no automated coverage — the JS unit tests can't tell the rich Core Haptics version of a signature from the JS approximation. The bench is a deep link (`memtool://haptics-debug`) and the full pass is ~5 minutes. A fail on any row blocks the TestFlight upload; record the result line in the build's release notes.

### What to bring

- The phone (with the build installed and signed in).
- The diary form, either printed or open as a note. Printed is easier — it doesn't fight for screen time with the app being tested.
- A pen, if printed.
- A watch or the phone's clock for the time column.

---

## Part 2 — Day-of testing script

### Background rule

**Live your normal day.** The diary is for everything you do with the app, including things that go right. Don't perform the app — use it.

### Things to do on purpose during the day

These are the structured prompts. Spread them across the day; don't batch them in one sitting.

| # | Prompt | When | Notes |
|---|---|---|---|
| 1 | Capture **at least 5 memories** | Across the day, not all at once | Mix short and long ones. At least one with the keyboard in landscape if possible. |
| 2 | Open **Mem (the AI Guide) chat** at least 3 separate times | Different times of day | At least one of them should be a follow-up question to a previous answer in the same session. |
| 3 | Try the **export memories** flow once | Any time after capturing a few | Note where the exported file ends up and whether you'd be able to find it again without help. |
| 4 | If on Free tier — intentionally **hit the daily capture cap** | Late in the day | Note exactly which screen tells you, and whether the message matches across capture, log-call, and the home prompt (per the "share one cooldown source" follow-up). |
| 5 | If on Pro tier — intentionally **open the paywall** from at least one Pro-locked surface | Any time | You won't subscribe again; just look. Verify Restore is visible and the copy is honest. |
| 6 | **Kill and reopen the app** at least once during the day | Any time after capturing some memories | Use the iOS app switcher to fully kill it. Note whether you land back where you expected. |
| 7 | **Airplane mode for ≥ 10 minutes** while actively using the app | Any time | During those 10 minutes: try to capture, try to open Mem, try to scroll Archive, try to open Recap. Note exactly what each surface does. |
| 8 | At least one **Daily Recap** view | When the recap is naturally available | Watch for the cold-start nudge and the auto-scroll. Note if anything jumps. |
| 9 | At least one **filtered Archive search** | Any time | Filter by person, by date, and by free-text search. Note any laggy moment. |
| 10 | Open **Settings → Cloud API URL** and look at it | Any time | Don't change it. Just verify the value shown is what you expect, and the field shows your real account. |

### Things to look for in the background, all day

These don't have a specific moment — they're patterns the user notices and writes down whenever they happen:

- Battery drain spikes. (Compare 8am, noon, 6pm, bedtime.)
- Heat. Has the phone gotten warm during a Mem chat?
- Any haptic that fires when you didn't expect one, or fails to fire when you did.
- Any animation that drops frames or any tap that feels "delayed."
- Any moment where you had to **think** about how to do something. Friction = a finding.
- Any copy that made you smile, frown, or re-read. Both directions matter.
- Anything that made you reach for a screenshot.

### What ends the day

The day ends at bedtime, or after ~12 active hours, whichever comes first. Final entry in the diary is a **freeform reflection** (Part 3, bottom).

---

## Part 3 — Diary template

Print one page per ~10 entries, or duplicate the table in a note app. Each entry should take **under 30 seconds**.

### Header — fill in once at the start of the day

```
Date:                          Build version / number:
Account:  [ ] Free  [ ] Pro    Account email or alias:
Device & iOS version:
Push permission:    [ ] granted  [ ] declined
Calendar permission:[ ] granted  [ ] declined
Battery at start:        %      Battery at mid-day:        %      Battery at end:        %
```

### Entry table — one row per moment

| # | Time | Screen | What I was trying to do | What happened | What I expected | Severity (B / I / P / N) | How I felt (free text) |
|---|---|---|---|---|---|---|---|
| 1 |   |   |   |   |   |   |   |
| 2 |   |   |   |   |   |   |   |
| 3 |   |   |   |   |   |   |   |
| 4 |   |   |   |   |   |   |   |
| 5 |   |   |   |   |   |   |   |
| 6 |   |   |   |   |   |   |   |
| 7 |   |   |   |   |   |   |   |
| 8 |   |   |   |   |   |   |   |
| 9 |   |   |   |   |   |   |   |
| 10 |   |   |   |   |   |   |   |

**Severity legend:**
- **B = Blocker** — would embarrass on launch day, or a crash, or data loss.
- **I = Important** — clearly wrong but won't stop launch by itself.
- **P = Polish** — visible smudge, post-launch is fine.
- **N = Not-an-issue / observation** — notable but probably correct behavior. Still worth writing down.

**Tip:** if a moment doesn't fit one row (e.g. an airplane-mode session that touched 4 screens), use 4 rows with the same time stamp and a `(1/4)` … `(4/4)` marker in the "What I was trying to do" column.

### End-of-day reflection

Three short paragraphs at the bottom of the diary. Don't aim for polish — first draft is fine.

1. **The single best moment.** What was the one interaction today that felt like the app worked exactly the way it should?
2. **The single worst moment.** What was the one moment you'd most want to fix before the App Store sees this?
3. **Would you keep using it?** If this were just an app you downloaded today (not one you built) — would tomorrow's version of you open it again? Why or why not?

---

## Part 4 — Triage pass (deferred — runs after the user returns the diary)

This section is intentionally left as a **placeholder**. The agent will fill it in during the follow-up pass once the user returns the filled diary. The plan for that pass is:

1. Walk every diary row in order.
2. Sort each into **Blocker / Important / Polish / Not-an-issue** and write a one-line rationale.
3. Group findings by surface so duplicates are obvious.
4. Land the quick **Blocker** fixes in the same pass (anything ≤ ~30 minutes of edit + verify).
5. For everything else — file a follow-up task with: surface, severity, observed-vs-expected, suggested fix, and a link back to the diary entry number.
6. The end-of-day reflection becomes its own short note in the same triage doc.

When that pass runs, results will land below this line as a `## Triage` section.

---

## Why this round exists at all

The previous three rounds caught real bugs — a 100k-character paste that the embedding endpoint silently dropped, an offline state that quietly retried forever, an Archive person filter chip with no empty state. Every one of those findings was visible from the source. None of them were felt.

This round catches the felt ones. It is also the dress rehearsal for Round 5, where 5–10 outside testers do roughly the same thing without the diary structure. If the day-of script reveals a blocker, Round 5 should not start until that blocker is fixed — the cost of a bad first impression on outside testers is higher than the cost of delaying the invite by a day.
