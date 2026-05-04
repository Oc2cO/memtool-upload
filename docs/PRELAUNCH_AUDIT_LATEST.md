# Pre-Launch Readiness Audit

**Generated:** 2026-05-03 04:49:56 UTC
**Project:** MemTool (`com.polsia.memtool`)

## Summary

| Status | Count |
|--------|-------|
| ✅ PASS | 17 |
| ⚠️  WARN | 4 |
| ❌ FAIL | 1 |
| **Total** | **22** |

> **1 FAIL(s) detected — resolve before submitting.**

---

## 1. Submit Blockers

| Status | Check | Detail |
|--------|-------|--------|
| ⚠️  WARN | ASC API key file present | Skipped in CI (CI=true): .asc-keys/AuthKey_7XBJCGMS4R.p8 is a local-only credential and is provided to eas submit out of band. Verify locally before tagging a release. |
| ✅ PASS | .env.example documents required env vars | All 5 required vars present |
| ✅ PASS | app.json icon asset exists | ./assets/images/icon.png found and non-empty |
| ✅ PASS | app.json splash asset exists | ./assets/brand/splash-9x16.png found and non-empty |
| ❌ FAIL | app.json is iOS-only (no expo.android block) | expo.android block found in app.json — MemTool ships iOS-only; remove the android block |
| ✅ PASS | privacyManifests block present in app.json | expo.ios.privacyManifests block found |

## 2. Dead-Link / Orphan-Route Detection

| Status | Check | Detail |
|--------|-------|--------|
| ✅ PASS | All router.push/href targets resolve | 23 unique route targets checked — all resolve to files in app/ |
| ✅ PASS | Dev-only screens isolated to app/(dev)/ and gated by __DEV__ | All 0 dev-only screen(s) are wrapped in a guard condition |
| ⚠️  WARN | Potentially orphaned screens (no inbound navigation found) | 11 screen(s) have no detected router.push/href pointing to them:   - artifacts/memtool/app/(app)/_dev/foundation-models-spike.tsx (route: /foundation-models-spike)   - artifacts/memtool/app/(app)/_dev/haptics-debug.tsx (route: /haptics-debug)   - artifacts/memtool/app/(app)/game-24.tsx (route: /game-24)   - artifacts/memtool/app/(app)/memory-match.tsx (route: /memory-match)   - artifacts/memtool/app/(app)/recap.tsx (route: /recap)   - artifacts/memtool/app/(app)/skills/challenge.tsx (route: /challenge)   - artifacts/memtool/app/(app)/skills/echo-count.tsx (route: /echo-count)   - artifacts/memtool/app/(app)/skills/mem-says.tsx (route: /mem-says)   - artifacts/memtool/app/(app)/skills/pattern-path.tsx (route: /pattern-path)   - artifacts/memtool/app/(app)/skills/signal-sort.tsx (route: /signal-sort)   - artifacts/memtool/app/(app)/tip-archive.tsx (route: /tip-archive)   Verify each is intentionally navigable (e.g., deep-link-only) before submission. |
| ✅ PASS | Dev-only debug screens are not routable | 2 formerly routable dev path(s) confirmed absent from route map and navigation calls |

### ⚠️  WARN: Potentially orphaned screens (no inbound navigation found)

```
11 screen(s) have no detected router.push/href pointing to them:
  - artifacts/memtool/app/(app)/_dev/foundation-models-spike.tsx (route: /foundation-models-spike)
  - artifacts/memtool/app/(app)/_dev/haptics-debug.tsx (route: /haptics-debug)
  - artifacts/memtool/app/(app)/game-24.tsx (route: /game-24)
  - artifacts/memtool/app/(app)/memory-match.tsx (route: /memory-match)
  - artifacts/memtool/app/(app)/recap.tsx (route: /recap)
  - artifacts/memtool/app/(app)/skills/challenge.tsx (route: /challenge)
  - artifacts/memtool/app/(app)/skills/echo-count.tsx (route: /echo-count)
  - artifacts/memtool/app/(app)/skills/mem-says.tsx (route: /mem-says)
  - artifacts/memtool/app/(app)/skills/pattern-path.tsx (route: /pattern-path)
  - artifacts/memtool/app/(app)/skills/signal-sort.tsx (route: /signal-sort)
  - artifacts/memtool/app/(app)/tip-archive.tsx (route: /tip-archive)
  Verify each is intentionally navigable (e.g., deep-link-only) before submission.
```

## 3. Stale Copy / TODO Scan

| Status | Check | Detail |
|--------|-------|--------|
| ⚠️  WARN | Stale copy: "coming soon" | 5 occurrence(s):   - artifacts/memtool/app/(app)/(tabs)/settings.tsx:1712: {bundled ? label.subtitle : `${label.subtitle} (bed coming soon)`}   - artifacts/memtool/app/(app)/skills/paywall.tsx:54: "App Store purchases coming soon",   - artifacts/memtool/app/(app)/skills/paywall.tsx:74: "Coming soon",   - artifacts/memtool/app/(app)/skills/paywall.tsx:88: "App Store purchases coming soon",   - artifacts/memtool/app/(app)/skills/paywall.tsx:122: "App Store purchases coming soon", |
| ✅ PASS | No "your-backend.example.com" stale copy | Pattern not found in user-facing source files |
| ✅ PASS | No "TBD placeholder text" stale copy | Pattern not found in user-facing source files |
| ✅ PASS | No "placeholder text (non-prop)" stale copy | Pattern not found in user-facing source files |

### ⚠️  WARN: Stale copy: "coming soon"

```
5 occurrence(s):
  - artifacts/memtool/app/(app)/(tabs)/settings.tsx:1712: {bundled ? label.subtitle : `${label.subtitle} (bed coming soon)`}
  - artifacts/memtool/app/(app)/skills/paywall.tsx:54: "App Store purchases coming soon",
  - artifacts/memtool/app/(app)/skills/paywall.tsx:74: "Coming soon",
  - artifacts/memtool/app/(app)/skills/paywall.tsx:88: "App Store purchases coming soon",
  - artifacts/memtool/app/(app)/skills/paywall.tsx:122: "App Store purchases coming soon",
```

## 4. Asset Reference Integrity

| Status | Check | Detail |
|--------|-------|--------|
| ✅ PASS | Asset reference integrity | All 27 checked asset reference(s) resolve to files on disk |
| ✅ PASS | No zero-byte assets in assets/images and assets/brand | All image/brand assets have content |

## 5. Store-Listing Completeness

| Status | Check | Detail |
|--------|-------|--------|
| ✅ PASS | App Store (iOS): no gap/TODO markers in STORE_LISTING.md | Listing appears complete |
| ✅ PASS | App Store (iOS): required screenshots present | All 6 screenshot(s) present |

## 6. Client-Server Contract

| Status | Check | Detail |
|--------|-------|--------|
| ✅ PASS | OpenAPI spec exists | lib/api-spec/openapi.yaml |
| ✅ PASS | OpenAPI codegen up-to-date (no diff after codegen) | Generated API client and Zod schemas match openapi.yaml — no drift detected |
| ⚠️  WARN | Raw fetch() calls in lib/ bypass the generated API client | 13 file(s) contain raw fetch() calls not going through the codegen hooks:   - artifacts/memtool/lib/accountApi.ts (lines 28, 162)   - artifacts/memtool/lib/aiEngine.ts (lines 182, 214)   - artifacts/memtool/lib/annotations.ts (line 31)   - artifacts/memtool/lib/auth.ts (line 107)   - artifacts/memtool/lib/forceUpdate.ts (line 104)   - artifacts/memtool/lib/illustrations.ts (line 50)   - artifacts/memtool/lib/memories.ts (line 441)   - artifacts/memtool/lib/memoryPhotos.ts (lines 93, 268)   - artifacts/memtool/lib/profile.ts (line 71)   - artifacts/memtool/lib/recallMemory.ts (line 27)   - artifacts/memtool/lib/serverEntitlement.ts (line 58)   - artifacts/memtool/lib/skillsEntitlement.ts (line 40)   - artifacts/memtool/lib/streak.ts (line 84)   Review each call: if intentional (auth wrapper, streaming, non-OpenAPI endpoint), add a comment explaining why. |

### ⚠️  WARN: Raw fetch() calls in lib/ bypass the generated API client

```
13 file(s) contain raw fetch() calls not going through the codegen hooks:
  - artifacts/memtool/lib/accountApi.ts (lines 28, 162)
  - artifacts/memtool/lib/aiEngine.ts (lines 182, 214)
  - artifacts/memtool/lib/annotations.ts (line 31)
  - artifacts/memtool/lib/auth.ts (line 107)
  - artifacts/memtool/lib/forceUpdate.ts (line 104)
  - artifacts/memtool/lib/illustrations.ts (line 50)
  - artifacts/memtool/lib/memories.ts (line 441)
  - artifacts/memtool/lib/memoryPhotos.ts (lines 93, 268)
  - artifacts/memtool/lib/profile.ts (line 71)
  - artifacts/memtool/lib/recallMemory.ts (line 27)
  - artifacts/memtool/lib/serverEntitlement.ts (line 58)
  - artifacts/memtool/lib/skillsEntitlement.ts (line 40)
  - artifacts/memtool/lib/streak.ts (line 84)
  Review each call: if intentional (auth wrapper, streaming, non-OpenAPI endpoint), add a comment explaining why.
```

## 7. Test Coverage Signal

| Status | Check | Detail |
|--------|-------|--------|
| ✅ PASS | Test suite passes | 1432 test(s) passed |
