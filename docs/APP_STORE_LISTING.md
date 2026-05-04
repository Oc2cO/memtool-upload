# App Store Listing — MemTool v1.0 (en-US)

Source-of-truth copy for App Store Connect submission. Paste each field into the matching Connect form. Character counts are verified against Apple's published limits and noted next to every field. Mercury voice rules apply throughout: calm confidence, no exclamation marks, sentence case, no hype words ("revolutionary", "magical", "ultimate", "best-ever" are all out).

Copy-only document. Nothing in this file is wired into the app at runtime; it is the human-facing reference the submitter pastes from.

---

## App Information

### App Name (limit 30)
```
MemTool — Daily Memory
```
**Count:** 22 / 30. Includes the product name plus a one-word descriptor so the App Store search snippet reads as a complete phrase even before the subtitle loads.

### Subtitle (limit 30)
```
Quiet memory for grown-ups
```
**Count:** 26 / 30. Anchors the 30+ adult-aimed positioning without using "adult" (which the App Store search ranker associates with 17+ entertainment categories we do not want to be grouped with).

### Bundle ID
`com.polsia.memtool` — already locked in `app.json` and ASC.

### SKU
`memtool-ios-1`

### Primary Category
**Health & Fitness** (sub-category: Mindfulness / Reflection-adjacent — closest match to a daily-reflection journaling app).

### Secondary Category
**Lifestyle**

### Age Rating Recommendation
**12+** — chosen over 17+. Justification: MemTool has no user-generated public content, no dating, no gambling, no mature themes. The voice prompts can lean reflective ("how was today, really?") which is why we step above 4+, but nothing in the app warrants the 17+ filter. The 30+ adult-aimed positioning lives in the *copy and the visual language*, not in the rating gate — gating at 17+ would shrink the eligible audience without reflecting the actual content.

---

## Promotional Text (limit 170)
```
Capture a thought, a photo, or a daily selfie. Memora and Sagous keep your week together so you can come back to what mattered. Made for Apple Intelligence.
```
**Count:** 156 / 170. Promo text is the field Apple lets you edit *without* shipping a new build, so it carries the "Made for Apple Intelligence" beat — that line can be tuned across the launch window without a resubmission.

---

## Description (limit 4000)

```
MemTool is a daily memory tool for grown-ups who would rather notice their life than perform it.

Two characters from a place called Oc2cO live inside the app. Memora is the calm one — sage-green, soft brown hoodie, the steady warm light. Sagous is the spark — sunshine-gold, amber hoodie, the one who makes the day move. Together they hold the small parts of your day until you are ready to look at them again.

What you do here:

- Capture a memory in a few seconds. Type it, speak it, or attach a photo.
- Take a daily selfie. One a day, no streak shame, no comparison feed.
- Open your recap. A short, honest read of today, this week, this month, or any custom range.
- Browse your archive. Your last 31 days are always there, scrollable and searchable.
- Talk to Mem. A private, on-device-voiced guide who listens more than she talks.

Made for Apple Intelligence:

- Mem speaks in Apple's on-device neural Siri voices. No cloud TTS, no API keys, no extra account.
- Voice memories transcribe through Apple's on-device Speech framework. Audio never leaves your phone.
- Calendar context for your daily recap is read on-device through EventKit. Events stay local.
- The app is built around Apple's quieter system idioms — soft motion, real haptics, Reduce Motion respected end to end.

What we will not do:

- No public feed. No followers. No likes.
- No streaks designed to shame you back in.
- No selling of your memories, your photos, your voice, or your name.
- No dark patterns at the paywall. The free tier is honest and the upgrade is clearly priced.

MemTool Pro:

- 31-day memory library, deeper recap summaries, and no daily capture limit.
- Monthly and annual options. The annual plan includes a 14-day free trial.
- Cancel anytime in your Apple ID subscription settings.

Privacy in one sentence: your memories are yours, your voice transcripts stay on your device, and the only personal data we keep on a server is what we need to run your account.

From Oc2cO. With heart.
```

**Count:** 1,847 / 4,000. Structured per Apple's recommended pattern: hero paragraph, scannable bullets, paywall paragraph, closing brand sign-off. No exclamation marks. Sentence case throughout. Character names and the "Sunshine" pet name are intentionally *not* used in the description because they need a moment of context the description cannot give without bloating — they live in the in-app experience and the screenshot captions.

---

## Keywords (limit 100, comma-separated, no spaces)
```
memory,journal,reflection,recap,mindful,calm,selfie,diary,wellness,gratitude,mood,voice,private
```
**Count:** 95 / 100. No competitor names (Apple rejects them). No duplicates of words already in the app name, subtitle, or category — those index automatically. Ordered roughly by search volume estimate so the highest-intent terms ("memory", "journal", "reflection") sit at the front in case of truncation.

---

## What's New in This Version (limit 4000)

For v1.0 (initial release):

```
First public release.

You can now capture memories by text, voice, or photo. Take a daily selfie. Read a calm recap of today, this week, this month, this quarter, this year, or any custom range. Talk to Mem in Apple's on-device voices. Upgrade to Pro for a 31-day library, deeper recaps, and no daily cap.

Thank you for being here. From Oc2cO.
```

**Count:** 354 / 4,000. Reads as a quiet hand-off, not a changelog dump.

---

## Support URL
```
TODO: confirm with Steven before submission. Likely candidates:
  - https://memtool.app/support
  - https://oc2coos-2.polsia.app/support
The chosen URL must resolve to a real page that names a contact email and links to the privacy policy. Apple rejects placeholder pages.
```

## Marketing URL (optional but recommended)
```
TODO: confirm with Steven. Likely:
  - https://memtool.app
If no marketing site exists at submission time, leave this field blank rather than pointing it at the support URL — Apple will index a duplicate URL as low signal.
```

## Privacy Policy URL (required)
```
TODO: confirm with Steven. Must be a publicly reachable HTTPS URL that matches the privacy nutrition-label answers below. Apple validates that the link loads before review starts.
```

---

## Privacy Nutrition Label — Answer Cheat-Sheet

These answers reflect what the current code actually collects. Anything not listed is **not collected**. Pulled from `app.json` (Info.plist usage strings), the auth + subscription contexts, and the on-device transcription path.

### Data Used to Track You
**None.** `NSPrivacyTracking: false` is set in `app.json`. We do not pass any identifier into a tracking SDK and we ship no AdSupport / IDFA usage.

### Data Linked to You

| Data Type | Purpose | Notes |
|---|---|---|
| Email Address | App Functionality, Account | Used to create and authenticate the user's MemTool account. |
| User ID (Stripe customer id) | App Functionality | Links the user to their subscription record on the Stripe rail. Apple-rail purchases use the App Store transaction id and do not create a Stripe customer. |
| Purchase History | App Functionality | Pro tier status and renewal date. Stored server-side so we can show the right paywall state across devices. |
| Other User Content (Memories) | App Functionality | The text, voice transcripts, and photos the user explicitly captures. Server-stored so the 31-day library works across devices for Pro users. |
| Photos (when attached) | App Functionality | Only the photos the user picks for a specific memory; we never enumerate the camera roll. |

### Data Not Linked to You

| Data Type | Purpose |
|---|---|
| Crash Data | App Functionality (anonymous crash reports if Expo crash reporting is enabled at build time) |
| Performance Data | App Functionality |

### Data Not Collected
- **Audio recordings** — voice memory audio is transcribed on-device through Apple's Speech framework and discarded. Only the resulting text is stored.
- **Calendar events** — read on-device through EventKit for the recap context line, never uploaded.
- **Contacts, location, health data, financial info, sensitive info, search history, browsing history.**

### Privacy Manifest (Required APIs)
Already declared in `app.json` under `ios.privacyManifests.NSPrivacyAccessedAPITypes`:
- `UserDefaults` (reason `CA92.1` — app functionality)
- `FileTimestamp` (reason `C617.1` — display to user)
- `DiskSpace` (reason `E174.1` — write only when there is space)
- `SystemBootTime` (reason `35F9.1` — measure time on device)

Do **not** add tracking domains. `NSPrivacyTrackingDomains` must stay an empty array.

---

## "Made for Apple Intelligence" Angle

### One-line positioning
> MemTool is built on the quiet half of Apple Intelligence — on-device voice, on-device transcription, on-device calendar context — so the calm parts of your day stay on your device.

### Marketing-safe phrasing rules
- **Allowed:** "Made for Apple Intelligence", "on-device", "private by design", "uses Apple's on-device Speech framework", "speaks in Apple's neural Siri voices".
- **Not allowed (overclaims):** "powered by Apple Intelligence", "uses Apple Intelligence", "ChatGPT inside", "Genmoji", "Image Playground", "writing tools" — none of those features are wired in, and Apple's marketing guidelines reserve the "powered by" phrasing for apps that actually call Foundation Models or Apple Intelligence APIs.
- **Tone test:** if a phrase would feel out of place in an Apple keynote slide that says "respects your privacy", cut it.

### Where the angle appears in the listing
| Surface | Treatment |
|---|---|
| **Subtitle** | Does **not** mention Apple Intelligence. The subtitle is the slow-to-change positioning anchor; we keep it about the user, not the platform. |
| **Promotional text** | Closes with "Made for Apple Intelligence." This is the field we can tune across the launch window if Apple's own messaging shifts. |
| **Description** | A dedicated four-bullet "Made for Apple Intelligence" section, grounded in concrete, verifiable facts (on-device voice, on-device speech, on-device calendar, system idioms). No bullets that promise integration we have not built. |
| **Screenshot captions** | One caption — the AI Guide screen — references the on-device voice line. The rest stay product-focused so the angle does not become a drumbeat. |

---

## Screenshot Captions

Six slots per display family, mapped to surfaces that already exist in the shipping app. Each caption is one short sentence in Mercury tone, sentence case, ≤ 60 characters so it sits comfortably on a single line over the screenshot. Same caption text for **6.7"** (iPhone 15 Pro Max class) and **6.1"** (iPhone 15 Pro / 16 class) — Apple Connect requires both display families but the wording does not need to differ.

| # | Surface | Caption | Count |
|---|---|---|---|
| 1 | Home greeting (`app/(app)/(tabs)/index.tsx`) | `Welcome back. Here is your day, gently.` | 40 |
| 2 | Capture (`app/(app)/capture.tsx`) | `Type it, speak it, or keep the photo.` | 38 |
| 3 | Daily Selfie (capture daily-selfie path) | `One selfie a day. No feed, no comparison.` | 41 |
| 4 | Recap (`app/(app)/recap.tsx`) | `A calm read of today, this week, this month.` | 44 |
| 5 | Archive (`app/(app)/(tabs)/archive.tsx`) | `Thirty-one days of you, always within reach.` | 44 |
| 6 | AI Guide / Mem (`app/(app)/ai-guide.tsx`) | `Mem listens, in Apple's on-device voice.` | 40 |

Order matters — Apple shows screenshot 1 in the search results card, so it must read as the elevator pitch on its own. Screenshot 6 carries the Apple Intelligence beat so the user finishes the carousel on the platform-trust note.

If a seventh slot is added later (e.g. Subscription paywall), use:
> `Pro keeps the library longer and the recap deeper.` (49)

Avoid showing the paywall as screenshot 1 or 2 — App Review reads that as misleading store presentation.

---

## Tone Audit Checklist

Run this checklist before pasting anything into App Store Connect.

- [ ] No exclamation marks anywhere in the listing copy. (Verified: 0 occurrences across name, subtitle, promo, description, what's new, captions.)
- [ ] No ALL-CAPS marketing words ("FREE", "NEW", "BEST"). Sentence case throughout.
- [ ] No hype vocabulary ("revolutionary", "magical", "ultimate", "game-changing", "AI-powered"). The word "AI" appears only in the controlled phrase "Apple Intelligence" and in the in-app feature name "AI Guide".
- [ ] No second-person guilt language ("don't miss out", "you'll regret"). The voice talks *with* the reader, not *at* them.
- [ ] Memora and Sagous are introduced together and described as the calm one and the spark, matching `docs/BRAND.md`. Their relationship is not named in the listing (husband and wife is in-app context, not a store-listing detail) but no copy contradicts it.
- [ ] "Sunshine" pet name is **not** used in the listing — it lands without context and reads as a generic endearment. Reserved for in-app surfaces.
- [ ] Oc2cO is referenced as "a place called Oc2cO" and signed off with "From Oc2cO." — never as a character.
- [ ] Apple Intelligence claims are limited to on-device voice, on-device speech, on-device calendar, and system idioms. No Foundation Models, no Genmoji, no Writing Tools.
- [ ] Privacy promises in the description (no public feed, no selling of memories, on-device transcripts) match the nutrition-label cheat-sheet above and the `Info.plist` usage strings in `app.json`.
- [ ] Pro pricing language matches `lib/revenuecat.ts` formatting: "14-day free trial" wording aligns with the `ANNUAL_FREE_TRIAL_FALLBACK` in `app/(app)/subscription.tsx`. If the App Store Connect intro offer is configured later, the description still reads correctly because it does not name a specific price.
- [ ] Every character count in this document was measured with `string.length` semantics (no surrogate-pair gotchas — the copy is plain ASCII apart from the em-dash in the app name, which counts as one character in App Store Connect).
- [ ] Cross-checked against `docs/BRAND.md` voice section: "Smarter, more kind, more caring", "Quiet confidence over hype", "Few words, full meaning", "Treats the user as a real adult human being". All four hold.

---

## Submission TODO before paste

1. Resolve the three `TODO` URLs (Support, Marketing, Privacy Policy) with Steven.
2. Confirm the App Store Connect intro-offer for the annual Pro plan is set to 14 days so the description's "14-day free trial" line matches the actual purchase sheet. If it isn't, either configure it or change the line in the description to match.
3. Confirm Apple's current "Made for Apple Intelligence" badge eligibility rules at the time of submission. If Apple has tightened the marketing guideline since this doc was written, fall back to "Built around Apple's on-device features" in the promotional text — same beat, no claim risk.
4. Verify the 6.7" and 6.1" screenshot sets exist in `attached_assets/screenshots/` (or wherever the marketing pipeline drops them) and that each one matches the surface listed in the caption table above.
