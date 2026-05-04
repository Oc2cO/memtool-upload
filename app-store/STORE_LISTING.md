# App Store Connect listing — `com.polsia.memtool` (App Apple ID `6765775373`)

Source-of-truth copy + answers for the MemTool App Store Connect (ASC) listing.
Paste each section into the corresponding ASC field.
Last updated: May 2, 2026.

ASC is **dashboard-only** — no in-repo automation uploads this for you. When the
release engineer opens ASC → MemTool → App Information / Pricing and
Availability / Version 1.0 → iOS App, walk this document top-to-bottom.

**iOS-only build target.** MemTool ships exclusively to App Store Connect.
There is no Play Store build target, no `play-store/` listing folder, and
no Android EAS profile. Do not re-introduce one — see `eas.json` (no
`android` block), `app.json` (no `expo.android` block), and the
`audit:prelaunch` Submit-Blocker check that hard-fails if either reappears.

---

## 1. App Information (set once per app, not per version)

### Name (max 30 chars)

```
MemTool
```

(7 chars. Matches `expo.name` in `artifacts/memtool/app.json`. Do not append a
tagline here — Apple shows the name with the icon in many places where extra
words wrap badly.)

### Subtitle (max 30 chars)

```
Capture. Recap. Understand.
```

(28 chars. Three beats matching the three core flows: Capture (mic / type),
Recap (daily heatmap + summary), Understand (Mem AI Guide). The Play Store
short description is longer because it has 80 chars to play with.)

### Bundle ID

```
com.polsia.memtool
```

### Primary language

```
English (U.S.)
```

### Category

- **Primary:** Lifestyle
- **Secondary:** Productivity

(Same primary as the Play Store listing. Lifestyle is the closest fit for a
journaling / reflection app; Productivity is a defensible secondary because
of the daily-recap loop.)

### Content Rights — does it contain, show, or access third-party content?

**No.**

(All AI illustrations are user-generated from the user's own captures via
OpenAI's API; the user prompts and owns them. We are not redistributing
third-party content.)

### Age Rating

Walk the questionnaire (App Store Connect → App Information → Age Rating).
Answer **None** to every category. Expected result: **4+**.

| Category | Frequency |
|----------|-----------|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Prolonged Graphic or Sadistic Realistic Violence | None |
| Profanity or Crude Humor | None |
| Mature/Suggestive Themes | None |
| Horror/Fear Themes | None |
| Medical/Treatment Information | None |
| Alcohol, Tobacco, or Drug Use or References | None |
| Simulated Gambling | None |
| Sexual Content or Nudity | None |
| Graphic Sexual Content and Nudity | None |
| Unrestricted Web Access | No |
| Gambling and Contests | No |

(MemTool is not designed for kids — leave the "Made for Kids" section
unchecked. The 4+ rating is purely a content-rating outcome, not a kids-app
classification.)

---

## 2. Version 1.0 (per-release fields)

### Promotional Text (max 170 chars, editable any time without resubmission)

```
Your day, captured in seconds. Mem reads it back to you each evening — gentle, private, and AI-powered. Built with care by the Oc2cO universe.
```

(151 chars. Designed to be tweakable: seasonal promos, new-feature shouts,
"now with X" can all swap in here without resubmitting the binary.)

### Description (max 4000 chars)

```
Stop losing your thoughts. Start understanding yourself.

MemTool is the journaling app for people whose best ideas show up at the worst times — on a walk, mid-shower, halfway through a meeting. Capture them in seconds, then let MemTool's AI connect the dots across your day.

CAPTURE IN SECONDS
• Type a memory, or speak it — MemTool transcribes on-device using Apple's Speech framework, so your raw audio never leaves your iPhone.
• Quick-capture from the home screen with a single tap.
• Works offline. Memories sync to the cloud the moment you're back online.

DAILY RECAPS THAT ACTUALLY CONNECT THE DOTS
• Every evening, MemTool reads back the moments you captured and surfaces the patterns: what you thought about, how your mood shifted, which ideas keep coming up.
• Recaps pull in gentle context from your local calendar (read-only, on-device) so the day reads like a story, not a list.
• Tag your captures or let MemTool's AI suggest tags — both work.

MEM — YOUR AI GUIDE
• Ask Mem, your personal guide, to surface a memory ("what was I thinking about my project last Tuesday?"), summarize a week, or help you reflect.
• Mem only sees the memories you've already saved. Nothing is sent to the AI without you asking.

ILLUSTRATE A MOMENT
• Turn a memory into a polaroid-style AI illustration. Free users get one illustration per day; Pro is unlimited.
• Illustrations live in your Archive next to the memory that inspired them.

BRAIN GAMES (FUSE & ECHO)
• Two short, calm cognitive games designed to fit between memories — Fuse (number-fusion) and Echo (memory-match).
• No timers, no streaks-shaming. Play one, log it as a memory, and move on.

PRIVATE BY DESIGN
• On-device transcription for voice captures. Raw audio never uploads.
• Calendar access is read-only and stays on the device — only the recap summary text is sent to the server.
• No ads. No third-party trackers. We don't sell your data and we don't train AI models on it.
• Export or delete your account any time from Settings, or by emailing support@polsia.com.

MEMTOOL PRO
Upgrade to MemTool Pro for:
• A 31-day memory library (free tier keeps the most recent few days)
• Deeper, longer daily recaps that connect more dots
• Unlimited captures per day
• Unlimited AI illustrations
• Priority cloud sync across all your devices

Pro is offered as an auto-renewing subscription. The annual plan starts with a 14-day free trial, then $29.99/year. Monthly is also available. Subscriptions auto-renew unless you turn off auto-renew at least 24 hours before the billing period ends. Manage or cancel any time from Settings → Apple ID → Subscriptions.

Privacy policy: https://oc2coos-2.polsia.app/privacy
Support: support@polsia.com

From Oc2cO. With heart.
```

(approx 2,750 chars — well under the 4,000 cap. If you trim or expand, recount
before pasting: `wc -c < /tmp/desc.txt`.)

### Keywords (max 100 chars, comma-separated, NO spaces after commas)

```
journal,diary,memory,notes,voice,reflection,mindfulness,recap,AI,gratitude,mood,tracker,wellness
```

(98 chars. Apple counts every char including commas. Do NOT include spaces
after commas — they waste characters. Do NOT repeat words from the app name
or subtitle — Apple already indexes those for search.)

### Support URL

```
https://oc2coos-2.polsia.app/privacy
```

(The privacy host doubles as a support landing for now. Swap to a marketing
site URL when one exists. Confirm it returns 200 before submitting — Apple
rejects URLs that 404.)

### Marketing URL (optional)

Leave blank for v1.0. Add one when a real marketing site exists.

### Copyright

```
© 2026 Oc2cO LLC
```

### Version Number

```
1.0
```

(Matches `expo.version` in `artifacts/memtool/app.json`. EAS sets the build
number automatically via `autoIncrement: true` in `eas.json` →
`build.production`.)

### What's New in This Version (max 4000 chars — only required for v1.1+)

For v1.0, ASC will pre-fill this with "First version." Leave it as-is.
Keep the per-release template below for v1.1 onward:

```
What's new in MemTool {VERSION}:

• [Feature] short user-facing sentence
• [Fix] short user-facing sentence
• [Polish] short user-facing sentence

From Oc2cO. With heart.
```

---

## 3. App Privacy (Privacy Nutrition Labels)

Path: ASC → MemTool → App Privacy → **Edit**.

The source-of-truth for what we collect is **Privacy data inventory** in
`replit.md` (under Task #273) — do not invent categories that don't appear
there. The user-facing privacy policy is at
`artifacts/api-server/src/routes/privacy.ts`.

### Privacy Policy URL

```
https://oc2coos-2.polsia.app/privacy
```

### Data collection — high-level

- **Does this app collect data?** → **Yes**

### Data Types — fill in exactly these and only these

For every data type below, **Linked to User = Yes** unless explicitly noted.
**Used for Tracking = No** for every row (we have no third-party advertising
SDKs and `NSPrivacyTracking` is `false` in `app.json`).

| Data Type | Collected? | Linked to User | Purposes |
|-----------|-----------|----------------|----------|
| **Contact Info → Email Address** | Yes | Yes | App Functionality (account login), App Functionality (subscription entitlement lookup) |
| **Identifiers → User ID** | Yes | Yes | App Functionality (auth identifier issued at sign-up) |
| **User Content → Other User Content** | Yes | Yes | App Functionality (the user's own captures / memories — sent to the server so they sync across devices and feed daily recaps + Mem AI Guide) |
| **User Content → Photos or Videos** | Yes | Yes | App Functionality (only when the user taps "Illustrate" — the resulting AI image is stored on the user's account) |
| **Usage Data → Product Interaction** | Yes | Yes | Analytics (basic funnel events: paywall viewed, upgrade tapped, capture saved — no third-party advertising trackers) |
| **Diagnostics → Crash Data** | Yes | No (anonymized) | App Functionality / diagnostics |
| **Diagnostics → Performance Data** | Yes | No (anonymized) | App Functionality / diagnostics |
| **Purchases → Purchase History** | Yes | Yes | App Functionality (which Pro tier the user is on, when it renews) |

### Data Types we do NOT collect (for clarity — leave unchecked)

- **Audio → Audio Data** — voice is captured to disk, transcribed on-device by
  `modules/whisper-kit` (and the Apple Speech fallback), and the audio file is
  then deleted. Raw audio never leaves the device. **Do not check this box.**
- **Health & Fitness** — none collected.
- **Financial Info → Other Financial Info** — Apple processes the actual
  payment; we only see entitlement state via RevenueCat. **Do not check this
  box.**
- **Location** — none collected; the app does not request location permission.
- **Sensitive Info** — none collected.
- **Contacts** — none collected.
- **Search History** — none collected.
- **Browsing History** — none collected.
- **Other Data** — none.

### Data Sharing

For every "Collected" row above, **Shared = No**. Vendors who process data on
our behalf (RevenueCat for entitlement lookup, OpenAI for AI summaries +
illustrations, the cloud database / hosting provider) are **service providers
under contract**, NOT third-party data recipients per Apple's definition.

---

## 4. Pricing and Availability

### Price Tier

**Tier 0 (Free)** — the app itself is free. MemTool Pro is sold as in-app
auto-renewing subscriptions:

- **Monthly:** Tier 4 ($3.99/mo) — product ID
  `com.polsia.memtool.pro.monthly`
- **Annual:** Tier 30 ($29.99/yr) with a 14-day free trial — product ID
  `com.polsia.memtool.pro.annual`

(Subscription product IDs and tier choices live in
`artifacts/memtool/lib/revenuecat.ts` → `OFFERING_IDS`. Confirm before
submitting that the IDs in ASC → Subscriptions match the IDs the app
requests.)

### Availability

- **Make this app available in:** All countries / regions Apple supports for
  the Lifestyle category.
- **Pre-orders:** No.

### Tax Category

- **App:** Default (App)
- **Subscriptions:** App (in-app subscriptions inherit the app's tax category)

---

## 5. App Review Information

### Sign-In Information (test account for App Review)

Apple's reviewer needs a working account to test the app end-to-end.
Generate a dedicated test account before submitting; do NOT use the
developer's personal account.

```
Username: appreview@polsia.com
Password: <set in 1Password "App Review test account" before submitting>
```

(If sign-in is required to use the app — and it is — Apple **will** reject
any submission that doesn't provide a working test account.)

### Notes for the reviewer

```
MemTool is a private journaling app. To exercise the full flow:

1. Sign in with the test account above.
2. Tap the home-screen capture button and either type a memory or tap the
   microphone to speak one. (The mic prompt asks for Microphone +
   Speech-Recognition permission — granting both is required to test
   voice capture; transcription happens on-device.)
3. Tap "Recap" in the bottom tab to see the daily-recap heatmap. The test
   account has a few seeded memories from the last 7 days so the recap is
   non-empty on first launch.
4. Tap "Mem" in the bottom tab to chat with the AI Guide. Ask
   something like "what did I think about on Tuesday?" — Mem will reply
   based on the seeded memories.
5. The "Illustrate" button on any memory in the Archive turns the memory
   into a polaroid-style AI image (1/day on the free tier, unlimited on
   Pro — the test account is on Pro so the illustration cap will not be
   hit during review).
6. The "Brain Games" tab contains two short cognitive games (Fuse and
   Echo) that work offline.

Calendar permission is optional — granting it adds gentle context
("you had 3 meetings today") to the daily recap, but the recap works
without it.

In-app purchase: the paywall is reachable from Settings → Upgrade and
from the gentle nudge after the 4th capture of a free-tier day. Both
the monthly and annual products are configured in App Store Connect and
should be visible to the sandbox account used for review.

SELF-SERVICE ACCOUNT MANAGEMENT (Task #299):
Users can manage their account directly from Settings → ACCOUNT:
• Edit profile — change display name and profile photo.
• Export my memories — download a copy of all memories as JSON or CSV.
• Delete account — permanently and fully deletes the user's
  account. The endpoint is fail-closed: it first deletes the
  upstream identity record (Polsia auth) and only on confirmed
  success deletes all server-side user data (memories, AI
  profile, embeddings, rate-limit state, subscription mapping)
  and clears every per-user key from on-device storage. If the
  upstream deletion can't be confirmed, the user is told the
  account was NOT deleted so they can retry. A confirmation alert
  is shown before deletion. After successful deletion the user is
  signed out and redirected to the sign-in screen.
• Forgot password — on the sign-in screen, tap "Forgot password?"
  to receive a password-reset link by email.

DATA DELETION: All data linked to a user account is deleted by the
"Delete account" action described above. This satisfies Apple's data-
deletion requirement for apps that collect data linked to identity.

Privacy policy: https://oc2coos-2.polsia.app/privacy
Support: support@polsia.com
```

### Contact Information (for App Review only — not shown to users)

```
First name: <release engineer first name>
Last name:  <release engineer last name>
Phone:      <release engineer phone (any country code)>
Email:      support@polsia.com
```

---

## 6. Version Release

- **Manually release this version** — recommended for v1.0 so the team can
  publish at a chosen time once Apple approves.
- **Phased Release for Automatic Updates** — leave OFF for v1.0; turn ON
  for v1.1+ to ramp updates over 7 days.

---

## 7. Screenshots (per device class)

ASC requires at least one screenshot per supported device class. iPhone 6.7"
is the largest required class; ASC will scale 6.7" screenshots down for
smaller iPhone classes if you don't upload class-specific sets, but uploading
6.7" + 6.5" + 5.5" gives crisper renders on each.

### iPhone 6.7" (1290 × 2796, max 10 screenshots, RGB no-alpha)

Source files (raw recordings, RGBA from the simulator):

```
artifacts/memtool/assets/store-screenshots/iphone-6.7/01-home.png
artifacts/memtool/assets/store-screenshots/iphone-6.7/02-capture.png
artifacts/memtool/assets/store-screenshots/iphone-6.7/03-archive.png
artifacts/memtool/assets/store-screenshots/iphone-6.7/04-recap.png
artifacts/memtool/assets/store-screenshots/iphone-6.7/05-ai-guide.png
artifacts/memtool/assets/store-screenshots/iphone-6.7/06-paywall.png
```

ASC-ready files (RGB no-alpha, ready to upload):

```
artifacts/memtool/app-store/assets/screenshots-marketing/raw-rgb-01-home.png
artifacts/memtool/app-store/assets/screenshots-marketing/raw-rgb-02-capture.png
artifacts/memtool/app-store/assets/screenshots-marketing/raw-rgb-03-archive.png
artifacts/memtool/app-store/assets/screenshots-marketing/raw-rgb-04-recap.png
artifacts/memtool/app-store/assets/screenshots-marketing/raw-rgb-05-ai-guide.png
artifacts/memtool/app-store/assets/screenshots-marketing/raw-rgb-06-paywall.png
```

Regen command (if the source recordings change):

```sh
cd artifacts/memtool/assets/store-screenshots/iphone-6.7
for f in *.png; do
  magick "$f" -background "#0A0F1E" -alpha remove -alpha off -strip \
    "../../../app-store/assets/screenshots-marketing/raw-rgb-$f"
done
```

**Branded marketing screenshots (with Memora / Sagous + caption overlays)**
will be added to the same folder under filenames `marketing-01-home.png`
through `marketing-06-paywall.png` as a follow-up; see
`.local/tasks/branded-app-store-screenshots.md`.

### iPhone 6.5" (1242 × 2688)

Apple will downscale the 6.7" set for the 6.5" class automatically. Skip
unless we want pixel-perfect 6.5" renders.

### iPad Pro 12.9" (2048 × 2732)

`expo.ios.supportsTablet` is `false` in `app.json` — iPad screenshots are
NOT required. Do not upload any iPad set; it would force ASC to flip the
"iPad supported" flag and that would mismatch the binary's UISupportedDevices.

---

## 7b. App Preview videos (per device class)

App Previews are short, autoplaying portrait videos that show real product
flows in App Store search results and on the product page. Apple allows up
to **three** App Previews per device class, each ≤ 30 s, no audio voiceover
required. The 6.7" iPhone slot accepts **886 × 1920** or **1080 × 1920**
H.264 MP4.

Source files (portrait MP4, ASC-ready):

```
artifacts/memtool/app-store/assets/app-previews/iphone-6.7/01-capture-and-recap.mp4
artifacts/memtool/app-store/assets/app-previews/iphone-6.7/02-mem-ai-guide.mp4
artifacts/memtool/app-store/assets/app-previews/iphone-6.7/03-illustrate-a-moment.mp4
```

Specs the regen script enforces (see
`artifacts/memtool/app-store/assets/app-previews/README.md`):

- Container: MP4 (H.264 video, no audio track)
- Frame size: 886 × 1920 (portrait)
- Duration: ≤ 30 s
- Frame rate: 30 fps
- Each preview is built from the same brand surfaces the screenshot pass
  uses (Memora hero, capture flow, recap heatmap), composited to portrait
  and rendered through ffmpeg.

ASC dashboard checklist (in addition to the screenshot upload):

- [ ] ASC → Version 1.0 → Media (iPhone 6.7") → drag the three MP4s above
      into the App Preview slots, in the order listed.
- [ ] For each preview, set the **Poster Frame** to the second when the
      Memora character is most clearly on-screen (App Store shows it as
      the still until the user taps).
- [ ] Confirm Apple's preview validator accepts each file (it shows a
      green checkmark; reject + reupload if it shows a red X).

---

## 7c. Dashboard-only checklist (App Store Connect + RevenueCat — no in-repo automation)

These are the values that must be entered by hand in the App Store
Connect / RevenueCat dashboards. Nothing in this repo can set them for
you, so walk this checklist top-to-bottom on every fresh release. The
exact strings are pinned here so two release engineers can't disagree.

### App Store Connect (ASC)

- [ ] **Name** = `MemTool`
- [ ] **Subtitle** = `Capture. Recap. Understand.`
- [ ] **Bundle ID** = `com.polsia.memtool`
- [ ] **Primary category** = `Lifestyle`
- [ ] **Secondary category** = `Productivity`
- [ ] **Content Rights — third-party content?** = `No`
- [ ] **Age Rating questionnaire** — answer `None` to every category
      (Cartoon/Realistic/Sadistic Violence, Profanity, Mature/Suggestive,
      Horror, Medical, Alcohol/Tobacco/Drug, Simulated Gambling, Sexual
      Content, Graphic Sexual Content, Unrestricted Web Access, Gambling
      and Contests). Expected outcome: **4+**.
- [ ] **App-Specific Shared Secret** —
      ASC → MemTool → App Information → **App-Specific Shared Secret** →
      **Generate** (or **View** if one already exists) → copy the
      32-char hex string. Paste into RevenueCat → Project settings →
      Apps → MemTool (iOS) → **App-Specific Shared Secret**. Without
      this, RevenueCat cannot validate App Store Server Notifications
      and entitlement state will silently fall out of sync. Rotate the
      secret only when explicitly required — rotation invalidates every
      pending ASC notification.
- [ ] **App Store Server Notifications V2 — Production Server URL** =
      `https://memtool.replit.app/api/iap/apple-notifications`
      (set in ASC → MemTool → App Information → **App Store Server
      Notifications** → **Production Server URL**, Version = `Version 2`).
- [ ] **App Store Server Notifications V2 — Sandbox Server URL** =
      `https://memtool.replit.app/api/iap/apple-notifications`
      (set in the same ASC panel under **Sandbox Server URL**, Version
      = `Version 2`. Same URL as production — the endpoint inspects the
      `signedPayload.environment` field to branch internally.)
- [ ] **Privacy Policy URL** = `https://oc2coos-2.polsia.app/privacy`
      (also entered into App Privacy → Privacy Policy URL).
- [ ] **Support URL** = `https://oc2coos-2.polsia.app/privacy`
- [ ] **Copyright** = `© 2026 Oc2cO LLC`

### RevenueCat dashboard

- [ ] App-Specific Shared Secret pasted in (matches the ASC value above).
- [ ] iOS app's **Bundle ID** = `com.polsia.memtool`.
- [ ] In-App Purchase API key uploaded (the same `.p8` referenced by
      `eas.json` — re-upload only if RC reports it expired).
- [ ] Two products are present in the catalog and tied to a single
      offering: `com.polsia.memtool.pro.monthly`,
      `com.polsia.memtool.pro.annual`. (Source of truth in
      `artifacts/memtool/lib/revenuecat.ts` → `OFFERING_IDS`.)

### User-dashboard blockers (resolve before submitting)

- [ ] `https://memtool.replit.app/api/iap/apple-notifications` is
      **deployed and reachable** — Apple silently disables a
      notification URL that returns non-2xx for too long. Verify with
      `curl -I` before pasting it into ASC.
- [ ] Production secrets (`APP_STORE_SHARED_SECRET`, RevenueCat keys,
      Polsia auth keys) are set in the deployment environment — they
      are not committed to the repo.
- [ ] Live App Store price chip on the paywall screenshot is captured
      from a **macOS / iOS Simulator** with a configured RevenueCat
      sandbox offering. The web-built `06-paywall.png` shows the Apple
      CTA + Restore button but no live price; ASC will accept the
      submission either way, but the price-bearing screenshot is much
      more compelling. Tracked as a follow-up in
      `artifacts/memtool/assets/store-screenshots/iphone-6.7/CHECKLIST.md`.

---

## 8. Submit checklist (Save Draft → Submit for Review)

Once every field above is filled in:

1. ASC → App Information → **Save**.
2. ASC → Pricing and Availability → confirm Tier 0 + the in-app subscription
   tiers → **Save**.
3. ASC → App Privacy → walk the questionnaire per Section 3 → **Publish**.
4. ASC → App Review Information → confirm the reviewer test-account password
   is real and the notes match Section 5 → **Save**.
5. ASC → Version 1.0 → upload the 6 RGB screenshots from Section 7 → fill in
   Promotional Text + Description + Keywords + Support URL → **Save**.
5b. ASC → Version 1.0 → Media → upload the 3 App Preview MP4s from Section
    7b → set poster frames → **Save**.
6. ASC → Version 1.0 → Build → select the build from EAS submit (uploaded by
   `eas submit --platform ios --id <buildId> --non-interactive` — see
   `replit.md` → "App Store pre-review checklist" → step 8).
7. ASC → Version 1.0 → **Submit for Review**.

The listing draft is not user-visible until Apple approves. Approval typically
takes 24–48 hours for v1.0; subsequent versions are usually faster.

---

## 9. Known launch blockers (resolve before submitting)

| Blocker | Fix |
|---------|-----|
| `.asc-keys/AuthKey_7XBJCGMS4R.p8` missing on disk (referenced in `eas.json` → `submit.production.ios.ascApiKeyPath`) | Re-download the App Store Connect API key from ASC → Users and Access → Keys → 7XBJCGMS4R, save to `.asc-keys/AuthKey_7XBJCGMS4R.p8`, `chmod 600`. The key is in `replit.md` → "App Store pre-review checklist" instructions. |
| `EXPO_APPLE_APP_SPECIFIC_PASSWORD` is set in env but conflicts with API-key auth | Unset before running `eas submit`: `unset EXPO_APPLE_APP_SPECIFIC_PASSWORD`. The submit command should pick up the API key from `eas.json` only. |
| Reviewer test account `appreview@polsia.com` not yet seeded with memories | Create the account, sign in once to register it, then run the seed script (see below) so the recap and Mem chat are non-empty when the reviewer looks. |
| Branded marketing screenshots not yet generated | Optional for v1.0 — raw RGB screenshots in Section 7 are sufficient. Marketing variants are tracked in `.local/tasks/branded-app-store-screenshots.md`. |

---

## 10. Reviewer account seeding script

Before submitting, populate the `appreview@polsia.com` test account with a realistic spread of memories so the reviewer sees Recap, Archive, and Mem AI Guide working on first login.

**Prerequisites:**
1. Create the `appreview@polsia.com` account via the app (sign up once, then sign out).
2. Store the account password in 1Password under **"App Review test account"**.
3. Ensure the account is on the **Pro** tier (grant via RevenueCat dashboard, or use the `seedRevenueCat.ts` script with a sandbox entitlement).

**Run the seed script:**

```sh
export API_BASE_URL="https://oc2coos-2.polsia.app"
export APPREVIEW_PASSWORD="<password from 1Password 'App Review test account'>"
pnpm --filter @workspace/scripts exec tsx src/seed-appreview.ts
```

The script is idempotent — if the account already has ≥ 20 memories it exits without writing anything new. On success it prints the credentials to paste into App Store Connect → App Review Information.

**What gets seeded:**
- 20 realistic text memories and call logs spread across the past 14 days
- A variety of tags (habits, work, family, nature, mindset) so pattern-detection has signal
- Enough day-spread for the Recap heatmap to show multiple active days

**After seeding, verify:**
- [ ] Sign in as `appreview@polsia.com` in the app (or Expo Go build).
- [ ] Recap tab shows at least 5 days with entries.
- [ ] Archive shows the seeded memories in reverse-chronological order.
- [ ] Mem AI Guide can answer "what did I think about this week?" with specific content.
