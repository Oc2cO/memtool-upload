# Pre-EAS Production Build Audit
**Date:** 2026-05-03  
**Auditor:** Agent (Task #353)  
**Purpose:** Verify `app.json` and `eas.json` are clean before running `eas build --platform ios --profile production`

---

## 1. Bundle ID & Version

| Field | Value | Status |
|---|---|---|
| `ios.bundleIdentifier` | `com.polsia.memtool` | PASS |
| `android.package` | `com.polsia.memtool` | PASS |
| `expo.version` | `1.0.0` | PASS |
| `owner` | `oc2co` | PASS |
| `extra.eas.projectId` | `d461ab5b-e271-4215-a336-8fdcb6ac6ed3` | PASS |

No mismatches found. Version `1.0.0` matches the pinned value; no bump was made.

---

## 2. EAS Identifiers (production submit block)

| Field | Value | Status |
|---|---|---|
| `appleTeamId` | `7JDY7C3VR5` | PASS |
| `ascAppId` | `6765775373` | PASS |
| `ascApiKeyId` | `7XBJCGMS4R` | PASS |
| `ascApiKeyPath` | `$EXPO_ASC_API_KEY` (EAS file secret) | PASS |
| `ascApiKeyIssuerId` | `$EXPO_APPLE_ISSUER_ID` (env var) | PASS |
| `EXPO_PUBLIC_AUTH_API_BASE_URL` | `https://oc2coos-2.polsia.app/api/memtool` | PASS |
| `EXPO_PUBLIC_REPLIT_API_BASE_URL` | `https://memtool.replit.app` | FLAG (see §6) |
| `build.production.ios.credentialsSource` | `remote` | PASS |
| `build.production.autoIncrement` | `true` | PASS |

The `appleTeamId` lives in the `submit.production.ios` block, which is the correct location for `eas submit`. The `build.production.ios` block uses `credentialsSource: remote`, which fetches signing credentials from the EAS credentials store — no `appleTeamId` is needed there.

---

## 3. iOS Permissions — All KEPT

### `infoPlist` usage descriptions

| Permission | Kept/Removed | Justification |
|---|---|---|
| `NSMicrophoneUsageDescription` | **KEPT** | `expo-audio` / `useAudioRecorder` is actively used in `app/(app)/voice-capture.tsx` for the "Speak a memory" capture mode. |
| `NSSpeechRecognitionUsageDescription` | **KEPT** | Apple's `SFSpeechRecognizer` is used via `lib/speechToText.ts` + `modules/speech-to-text/ios/SpeechToTextModule.swift` for on-device transcription. |
| `NSCalendarsUsageDescription` | **KEPT** | `expo-calendar` is imported and used in `app/(app)/recap.tsx` (lines 24, 348–376) to read events for Daily Recap context. Required on iOS ≤16. |
| `NSCalendarsFullAccessUsageDescription` | **KEPT** | Same calendar feature; Apple requires this string on iOS 17+ in addition to the base string. |

All description strings are accurate and tight. No unused permission strings found.

### `NSPrivacyAccessedAPITypes`

| API Category | Reason Code | Kept/Removed | Justification |
|---|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | CA92.1 | **KEPT** | `@react-native-async-storage/async-storage` uses `NSUserDefaults` on iOS. Used throughout the app (notifications, settings, draft store, game stats, etc.). |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | C617.1 | **KEPT** | `expo-file-system` accesses file timestamps (audio file URIs from voice recording). Also required by `react-native-reanimated`. |
| `NSPrivacyAccessedAPICategoryDiskSpace` | E174.1 | **KEPT** | Required by `expo-file-system` / `expo-audio` SDK internals. Apple requires disclosure even for transitive SDK usage. |
| `NSPrivacyAccessedAPICategorySystemBootTime` | 35F9.1 | **KEPT** | Required by `react-native-reanimated` (uses `CACurrentMediaTime` / boot-relative timestamps for animation timing). |

---

## 4. Android Permissions — All KEPT

| Permission | Kept/Removed | Justification |
|---|---|---|
| `android.permission.RECORD_AUDIO` | **KEPT** | Required by `expo-audio` for microphone recording in the "Speak a memory" voice capture feature. |

No unused Android permissions found.

---

## 5. Plugins — All KEPT

| Plugin | Kept/Removed | Justification |
|---|---|---|
| `expo-router` | **KEPT** | Core app router; the entire app is built on Expo Router file-based routing. |
| `expo-font` | **KEPT** | `useFonts()` is called in `app/_layout.tsx` (line 417) to load Inter/custom fonts. |
| `expo-web-browser` | **KEPT** | Used in `lib/legal.ts`, `lib/paymentLinks.ts`, and `app/(app)/licenses.tsx` to open external links in-app. |
| `expo-video` | **KEPT** | `useVideoPlayer` / `VideoView` are used in `app/onboarding.tsx` and `app/(app)/about.tsx` for the Memora splash/intro video. |
| `expo-audio` | **KEPT** | `useAudioRecorder` / `useAudioRecorderState` are used in `app/(app)/voice-capture.tsx` for microphone recording. |
| `./plugins/withVoiceProcessingLiveActivityWidget` | **KEPT** | Plugin file exists at `plugins/withVoiceProcessingLiveActivityWidget.js`; the `modules/voice-processing-live-activity` native module is referenced from `voice-capture.tsx`. The `EXPO_LIVE_ACTIVITIES_REQUIRED=1` env var is set in the production build profile. |

No orphan plugins found.

---

## 6. Flagged Items (no change made — Steven must sign off)

### FLAG 1 — `expo-router` origin points to `https://replit.com/`
**Location:** `app.json` → `plugins[0][1].origin`  
**Risk:** Low for native builds (deep links use the `memtool://` scheme), but semantically wrong for a production store build and could appear in crash/analytics metadata.  
**Recommendation:** Confirm with Steven whether to remove this field entirely (native-only mode) or update it to the production domain before the next EAS build. Tracked as follow-up task #361.

### FLAG 2 — `EXPO_PUBLIC_REPLIT_API_BASE_URL` points to `memtool.replit.app`
**Location:** `eas.json` → `build.production.env.EXPO_PUBLIC_REPLIT_API_BASE_URL`  
**Risk:** If the Replit deployment is the intended production API host, this is fine. If Polsia intends to host this API on a Polsia-owned domain, the URL needs updating before store submission. The auth URL (`EXPO_PUBLIC_AUTH_API_BASE_URL`) already correctly points to `https://oc2coos-2.polsia.app`.  
**Recommendation:** Steven to confirm `memtool.replit.app` is the intentional production deployment. Tracked as follow-up task #362.

---

## 7. Pull-to-Refresh Check

| Screen | Pull-to-refresh present? |
|---|---|
| `app/(app)/(tabs)/archive.tsx` (memories list) | **YES** — `RefreshControl` with `onRefresh` wired at line 888 |
| `app/(app)/(tabs)/index.tsx` (home/today) | Not present (Apple review did not previously flag this screen) |

The memories/archive list — the screen Apple called out in a previous review — has pull-to-refresh intact. No changes made.

---

## 8. Summary

**No changes were required to `app.json` or `eas.json`.** All permissions, plugins, identifiers, and versions checked out cleanly. Two items are flagged for Steven's sign-off before the EAS build runs (see §6), but neither is a blocking issue for the build itself — they are policy/intent confirmations.

**The project is ready for `eas build --platform ios --profile production`** once Steven reviews the two flagged items.
