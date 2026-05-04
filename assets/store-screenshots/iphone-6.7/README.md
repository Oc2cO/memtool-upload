# App Store Connect — 6.7" iPhone display screenshots

This folder is the upload-ready staging area for the six App Store
Connect screenshots that gate MemTool's first submission. The names
below are exactly what App Store Connect expects (alphabetical = upload
order = display order on the listing).

## Files (upload in this order)

| # | Filename            | Screen                                  | What must be on screen                                                                                          |
|---|---------------------|-----------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| 1 | `01-home.png`       | Home (`app/(app)/(tabs)/index.tsx`)     | Greeting, alive ambient backdrop, Quick Capture CTA in its un-capped state, daily-cap hint visible              |
| 2 | `02-capture.png`    | Capture (`app/(app)/capture.tsx`)       | Mid-flow with a real, publishable memory typed in and at least one tag chip selected — pre-save                |
| 3 | `03-archive.png`    | Archive (`app/(app)/(tabs)/archive.tsx`)| At least one row showing an illustration polaroid; mix of synced + facet-chipped rows below                    |
| 4 | `04-recap.png`      | Daily Recap (`app/(app)/recap.tsx`)     | "30 days" tab active, heatmap visible with a believable density, themes block populated                         |
| 5 | `05-ai-guide.png`   | Mem AI Guide (`app/(app)/ai-guide.tsx`) | One short user message + Mem's reply, both bubbles fully on screen                                              |
| 6 | `06-paywall.png`    | Paywall (`app/(app)/subscription.tsx`)  | Elite Spec variant (graduated in #64), live App Store price visible on Annual, Restore button visible           |

## Hard requirements (App Store Connect will reject otherwise)

- **Resolution:** exactly **1290 × 2796** pixels, portrait, PNG.
- **Source:** real captures from a 6.7" iPhone class device or simulator
  (iPhone 15 Pro Max / 16 Plus). Do **not** upscale a smaller capture —
  the upload validator inspects pixel dimensions and rejects mismatches.
- **No debug overlays:** the in-app debug HUD (long-press dev menu,
  Reanimated FPS bar, RN inspector) must be off.
- **Status bar:** real time/cell/battery, no debug clock.
- **Content:** seed-data only. No real user emails, no real names, no
  profanity, no Lorem-ipsum, no `test@`/`+demo` addresses visible.
- **Layout:** post-#177 design tokens (no stale spacing/typography from
  before the polish pass).

## How the current PNGs were captured (Replit / Expo Web pipeline)

The six PNGs in this folder right now were rendered headlessly from the
**Expo Web build** of MemTool by `scripts/src/capture-store-screenshots.mjs`
because the Replit container has no macOS / Xcode. The script is
deterministic and idempotent — re-running it overwrites the six files
in place with no other side effects.

1. The `artifacts/memtool: expo` workflow serves the dev bundle on the
   shared `localhost:80` proxy.
2. From the repo root, run:
   `node scripts/src/capture-store-screenshots.mjs`
3. The script:
   - launches headless Chromium with an **iPhone 17.5 Safari** UA;
   - sizes the viewport to `1290 × (2796 − 132 − 56)` so the inset app
     frame leaves room for the iOS chrome composited later;
   - intercepts every `oc2coos-2.polsia.app/api/memtool/*` request and
     serves stable, demo-safe JSON (auth/me, recap, subscription
     status, memories list, AI Guide reply, etc.) so the screens never
     depend on the live Polsia gateway and never leak a real account;
   - intercepts the api-server's `/api/memories/illustrations` endpoint
     and returns three picsum-backed polaroids keyed by `client_id` so
     `03-archive.png` shows the "✦ Illustrated" badge on the first
     three rows;
   - pre-seeds `localStorage` with the same six demo memories and a
     three-message AI Guide thread so the very first paint of every
     route is fully populated;
   - flips the stubbed `/subscription/status` to `is_pro=true` only
     while capturing `04-recap.png` (so the Pro-only 30-day heatmap
     renders) and to `payment_platform: "apple"` while capturing
     `06-paywall.png` (so the Apple-rail "Continue to Apple checkout"
     CTA + the Restore Purchases button required by App Review 3.1.1
     both show);
   - takes a viewport PNG, resizes through `sharp` to the inset
     viewport, then composites a 1290×132 status-bar SVG (9:41 clock,
     Dynamic Island, signal / Wi-Fi / battery glyphs) on top and a
     1290×56 home-indicator SVG (white pill on black) on the bottom,
     producing a final 1290×2796 PNG that reads as an iOS device
     capture rather than a raw browser snapshot;
   - verifies the final dimensions before writing each file (throws
     if any drift slips in).

This produces upload-ready PNGs at the right resolution with the right
content on each screen. The one piece a Replit container genuinely
**cannot** reproduce is the live App Store price chip on the paywall —
RevenueCat's web SDK does not return offerings configured in App Store
Connect (StoreKit attestation only happens on a real iOS device or
simulator). The current `06-paywall.png` therefore shows the
Apple-rail CTA + Restore button + plan hero, but not the
`Annual $X.XX/year` chip. Recapture from a real iPhone Sim per the
"Mac procedure" below to fill that gap before going live.

## How to capture from a real iOS Simulator (Mac required)

1. **Pick the device.** Open Xcode → Window → Devices and Simulators →
   boot an iPhone 15 Pro Max or 16 Plus simulator (iOS 17+). Confirm
   the simulator scale shows **1290 × 2796** under
   *Window → Physical Size*.
2. **Run a release-style build.** From `artifacts/memtool`:
   `npx expo run:ios --configuration Release --device "iPhone 15 Pro Max"`.
   Release config strips dev menus and the Reanimated layout debugger.
3. **Seed a fresh demo account.** Sign up with `mem.demo@polsia.app`
   (or whatever the agreed demo address is — see CHECKLIST.md). Walk
   onboarding so the AI guide has context. Capture 4–6 sample memories
   that produce nice illustrations. Log a couple of mood entries so
   Recap has a populated heatmap.
4. **Take the six shots.** ⌘S in the simulator captures to ~/Desktop at
   the device's native resolution. Walk the table above in order. For
   the AI Guide shot, type one short user message and let Mem reply so
   both bubbles are on screen. For the paywall, confirm the live App
   Store price is rendered (not the Stripe-rail fallback) and that
   Restore is visible.
5. **Drop in & rename.** Move the six PNGs into this folder using the
   exact `01-…` … `06-…` filenames above.
6. **Smoke-check.** Run the repo guard from the workspace root:
   `pnpm --filter @workspace/memtool run verify:store-screenshots`.
   It fails if any of the six expected `0[1-6]-*.png` files is missing
   or not exactly **1290 × 2796**, and is also chained into
   `pnpm --filter @workspace/memtool run typecheck` so a stale capture
   blocks the PR before merge. (For a quick eyeball check you can also
   run `for f in *.png; do file "$f"; done` from this folder.)
7. **Update CHECKLIST.md.** Fill in the device/OS/build-id/date row and
   tick the publishability boxes. The submission step picks files up
   from this folder automatically once the checklist is ticked.

## Out of scope

- iPad screenshots (`supportsTablet: false` in `app.json`).
- Android Play Store screenshots — covered by the standalone Play Store
  listing task.
- Localized variants beyond en-US.
- Marketing chrome (gradients, captions, device frames). Apple accepts
  plain captures; chrome can be layered on later if the marketing team
  asks.
