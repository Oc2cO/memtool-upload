# Capture checklist — 6.7" iPhone screenshots

Tick every box before handing off to the App Store submission step.
Anything left unchecked is a likely rejection from App Store Connect or
App Review.

## Capture session metadata

Fill in once per capture session. If a screen is recaptured later, add a
new row rather than editing an old one — keeps the audit trail clean.

| Date (YYYY-MM-DD) | Simulator/device         | iOS version | Build (commit/EAS id)                | Captured by                             |
|-------------------|--------------------------|-------------|--------------------------------------|-----------------------------------------|
| 2026-05-02        | Headless Chromium @ 1290×2796 (Expo Web build of MemTool) | n/a (web)   | repo HEAD, served by `artifacts/memtool: expo` workflow | `scripts/src/capture-store-screenshots.mjs` (Replit task #287) |

> **Replit-container deviation note (read before final submission):**
> The PNGs in this folder were rendered from the Expo Web build of
> MemTool, not from a real iOS Simulator, because the Replit container
> that produced them has no macOS / Xcode. The pixel layout is the
> production layout (Expo Web ships the same React Native components),
> the iOS status bar and home indicator are composited back in via
> sharp from SVG overlays, and on-device chrome (notch shape, signal /
> Wi-Fi / battery glyphs, 9:41 clock, bottom home pill) renders the
> way Apple expects. The one piece web genuinely cannot reproduce is
> the live App Store price string on `06-paywall.png` — RevenueCat's
> web SDK does not return offerings configured in App Store Connect,
> so the Apple-rail paywall here shows the Apple-styled CTA, plan
> hero, and the Restore button (App Review 3.1.1) but no live price
> chip. The `iOS Simulator recapture procedure` in `README.md` is the
> path to a price-bearing paywall and should be run on the next pass
> on a Mac.

## Per-file publishability check

For each PNG, confirm:

- [x] `01-home.png` — 1290×2796, no debug HUD, demo display name only ("mem"), Quick Capture hero + recent memories + Train Your Mind grid all rendered, capture-cap hint shows "7 of 10 memories left today" matching the seeded free tier, iOS status bar + home indicator composited
- [x] `02-capture.png` — 1290×2796, demo memory text is publishable ("Felt grateful walking past the bakery this morning — the smell anchored me before standup."), `#social` tag chip selected, Save button enabled in header, no error toast on screen, iOS status bar + home indicator composited
- [x] `03-archive.png` — 1290×2796, six memory rows visible with timestamps + tag chips, **three rows show illustration polaroids with the "✦ Illustrated" badge** (coffee/studio, ritual/calendar, river-walk), sync indicators all "synced" (no pending/failed badge), no stuck-sync banner, no real email visible
- [x] `04-recap.png` — 1290×2796, "Past 30 days" tab active, capture-activity heatmap renders, Top Themes block populated (ideas, reflection, work, errand, social), no shimmer/loading state
- [x] `05-ai-guide.png` — 1290×2796, one Mem opener + one user reply + one Mem follow-up all fully on-screen, no typing indicator mid-stream, "3 free Mem chats left today" footer visible, no error banner
- [x] `06-paywall.png` — 1290×2796, "Stop losing your thoughts" hero copy (Elite Spec variant), Pro features list (31-day memory library, Deeper daily recaps, No daily capture limit, Priority cloud sync), **Apple-rail "Continue to Apple checkout" CTA always rendered** (the legacy "App Store purchases coming soon" fallback was removed in Task #333 — the Apple rail now unconditionally renders the real RevenueCat-backed CTA on the captured paywall), **"Restore purchases" button visible** (App Review 3.1.1 requirement met), "Payments are processed by Apple" reassurance line, no celebration overlay
- [ ] `06-paywall.png` — **live App Store annual/monthly price chip** — **NOT YET** (RevenueCat web SDK returns no offerings in headless Chromium; only a real iOS Simulator with a configured RC sandbox offering can fetch the StoreKit-backed price string. Recapture from Sim per `README.md` to tick this row)

## Global rules (applies to all six)

- [x] Status bar shows time/cell/battery — composited via SVG overlay (9:41 clock, signal / Wi-Fi / battery glyphs). Not a real device-attested status bar; recapture from iOS Sim still preferred for the device-attested version
- [x] No Reanimated layout debugger, no React Native inspector, no LogBox warning
- [x] No keyboard visible (dismiss before capturing)
- [x] All copy matches latest design tokens (post-#177)
- [ ] Captured from a Release build, not a dev build — **NOT YET** (Expo Web served from the `expo` dev workflow; flip on next iOS-simulator pass)
- [x] Each PNG is exactly 1290 × 2796 — verified by the script's post-write `sharp.metadata()` check (throws if any dimension drifts)
- [x] Demo account used for the session is documented above (web capture uses a fully stubbed in-process user `mem@memtool.app` / id `demo-user-001`; nothing is created on the live Polsia gateway, so there is no account to wipe post-submission)

## Hand-off

- [x] App Store submission step (the one that uploads the six PNGs to
      App Store Connect) is pointing at this folder:
      `artifacts/memtool/assets/store-screenshots/iphone-6.7/`
- [x] Screenshots committed to the repo (binary diff is fine — these are
      product assets, not source).
