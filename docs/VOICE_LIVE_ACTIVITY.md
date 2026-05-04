# Voice-processing Live Activity (Task #200 + Task #228)

Status: **Shipped** — JS surface, Swift Expo module, WidgetKit extension,
and Expo config plugin all landed.
Owner: MemTool.
Reference: <https://developer.apple.com/documentation/ActivityKit>,
<https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension>

## Why

The "Speak a memory" capture flow (Task #171) shows an in-app
"Processing memory…" banner while the transcript is being turned into
a structured draft. The original brief calls for the same feedback to
appear on the iOS lock screen / Dynamic Island so the user gets it
even if they put the phone down or switch apps mid-walk.

ActivityKit Live Activities are the iOS 16.1+ platform answer:

- A `WidgetKit`-rendered widget controlled by ActivityKit
- Renders on the lock screen on every supported iPhone
- Renders inside the Dynamic Island on iPhone 14 Pro and newer
- Tap → deep-link back into the app via `widgetURL(_:)`

## Shipped file tree

```text
artifacts/memtool/
├── modules/voice-processing-live-activity/
│   ├── package.json
│   ├── expo-module.config.json            # Tells expo-modules-autolinking
│   ├── index.ts                           # Typed JS surface + safe fallback
│   └── ios/
│       ├── VoiceProcessingLiveActivity.podspec          # Local pod for autolinking
│       ├── VoiceProcessingAttributes.swift              # ActivityAttributes + ContentState
│       │                                                  (compiled into BOTH targets)
│       ├── VoiceProcessingLiveActivityModule.swift      # Expo module → main app target
│       └── VoiceProcessingLiveActivityWidget/
│           ├── Info.plist                               # Extension Info.plist
│           └── VoiceProcessingLiveActivityWidget.swift  # WidgetBundle + SwiftUI layouts
│                                                          (lock screen + Dynamic Island)
├── plugins/
│   └── withVoiceProcessingLiveActivityWidget.js  # Config plugin (adds extension target)
├── lib/voiceProcessingLiveActivity.ts            # Lifecycle wrapper called by the screen
├── lib/voiceProcessingLiveActivity.test.ts       # Unit tests around the wrapper
└── app/(app)/voice-capture.tsx                   # Calls start/markReady/end on phase changes
```

`package.json` declares `expo.autolinking.nativeModulesDir: ./modules` so
the module is discovered by expo-modules-autolinking automatically.

The config plugin is registered in `app.json` plugins array:
```json
"./plugins/withVoiceProcessingLiveActivityWidget"
```

At `expo prebuild` / `eas build` the plugin:
1. Sets `NSSupportsLiveActivities = YES` in the main app's Info.plist.
2. Adds `com.apple.developer.live-activities` to the Entitlements file.
3. Copies the widget Swift sources into `ios/VoiceProcessingLiveActivityWidget/`.
4. Creates the `VoiceProcessingLiveActivityWidget` PBXNativeTarget
   (`com.apple.product-type.app-extension`) with Sources / Frameworks
   (WidgetKit + SwiftUI) / Resources build phases and embeds the
   `.appex` into the app bundle.

## JS contract

`modules/voice-processing-live-activity/index.ts` is the only file
the rest of the app imports from. The Swift bridge implements:

```ts
getAvailability(): { available: boolean; reason: string | null };
startActivity({ deepLinkUrl }): Promise<{ status: "ok"; activityId: string }
                              | { status: "unavailable"; reason: string }>;
updateActivity(activityId, "processing" | "ready"): Promise<...>;
endActivity(activityId): Promise<...>;
```

Failure reasons:

- `ios_below_16_1` — ActivityKit not available
- `live_activities_disabled` — user turned them off in Settings
- `module_not_linked` — the WidgetKit extension isn't in this build
- `non_ios_platform` — Android, web, or Expo Go
- `no_active_activity` — `update`/`end` called with an unknown id
- `start_failed` / `update_failed` / `end_failed` — ActivityKit
  refused the request
- `unknown` — fallback for unrecognized reason strings (forward-compat)

## Lifecycle the screen drives

`app/(app)/voice-capture.tsx`:

1. **Press release / 60s auto-stop** → `startProcessingActivity()`
   awaited, handle stored in a ref. Activity title:
   "Processing memory…" + indeterminate progress indicator.
2. **Extraction completes** → `markProcessingActivityReady(handle)`
   flips the activity to "Memory ready — tap to review." Tap →
   deep-link `memtool:///voice-capture`.
3. **Save success / discard / re-record / error** →
   `endProcessingActivity(handle)` dismisses the activity.
4. **Screen unmount** → defensive `endProcessingActivity` so an
   activity can never outlive its session.

## Swift implementation notes

### VoiceProcessingAttributes.swift

Defines `VoiceProcessingAttributes: ActivityAttributes` (holds
`deepLinkUrl`) and `VoiceProcessingContentState` (holds `phase:
.processing | .ready`). This file is shared between both targets —
copied into the widget extension folder by the config plugin so neither
target needs cross-target imports.

### VoiceProcessingLiveActivityModule.swift

Expo module (class `VoiceProcessingLiveActivityModule`) compiled into
the main app target. All ActivityKit calls are guarded by:
- `#if canImport(ActivityKit)` — compile-time guard for simulators /
  older SDKs that shipped without ActivityKit.
- `if #available(iOS 16.1, *)` — runtime guard for devices below the
  minimum OS.
- iOS 16.1 / 16.2 API split — uses the legacy `contentState:` overload
  on 16.1 and the modern `ActivityContent` overload on 16.2+.

`Activity<VoiceProcessingAttributes>.activities` is used to look up an
existing activity by id for `update` and `end` calls.

### VoiceProcessingLiveActivityWidget.swift

Contains `@main VoiceProcessingLiveActivityWidgetBundle` (the
WidgetKit entry point) and `VoiceProcessingLiveActivityWidget` — an
`ActivityConfiguration` with:

- **Lock screen / banner** (`LockScreenView`): icon circle + title +
  subtitle + progress spinner (processing) or chevron (ready).
- **Dynamic Island expanded**: leading icon, trailing spinner/chevron,
  bottom title+subtitle.
- **Dynamic Island compact**: leading icon + trailing spinner or
  "Ready" label.
- **Dynamic Island minimal**: icon glyph.

`widgetURL` wires the tap gesture to `deepLinkUrl` on every layout.

## EAS / Apple Developer portal prerequisites

The config plugin handles the project-side wiring (entitlements file,
Info.plist keys, widget extension target). EAS managed credentials
**also** need the capability enabled on the Apple Developer portal
App ID, otherwise TestFlight / App Store builds get rejected at
signing with an entitlements mismatch.

### One-time Apple Developer portal setup

(Apple Developer account → Certificates, Identifiers & Profiles →
Identifiers):

- App ID `com.polsia.memtool` → Capabilities → enable **Live Activities**
- App ID `com.polsia.memtool.VoiceProcessingLiveActivityWidget`
  (widget extension) — register it if missing and enable the same
  capability there too

### How EAS picks the capability up

`eas.json` wires the iOS production build profile so EAS managed
credentials sync the entitlement to the portal automatically:

```jsonc
"build": {
  "production": {
    "autoIncrement": true,
    "env": { "EXPO_LIVE_ACTIVITIES_REQUIRED": "1" },
    "ios": {
      "credentialsSource": "remote", // EAS manages signing + capability sync
      "image": "latest"              // Xcode new enough for ActivityKit/WidgetKit
    },
    "android": { "buildType": "app-bundle" }
  }
}
```

Capability sync requires an App Store Connect API key with the
"App Manager" role; `eas.json`'s `submit.production.ios` block points
at the existing key (`ascApiKeyPath`, `ascApiKeyId`), which EAS Build
also re-uses for in-build capability sync when
`credentialsSource: "remote"`.

### Build hook guardrail

To prevent silent regressions of either side of the wiring, the
project ships `scripts/verify-live-activities-config.js` and runs it
as the `eas-build-pre-install` npm hook. On every EAS Build worker the
script asserts (before `npm install` even runs) that:

1. The config plugin file still adds `com.apple.developer.live-activities`.
2. `app.json`'s `expo.plugins` array still registers the plugin.
3. `expo.ios.bundleIdentifier` is set (the widget bundle id is derived from it).
4. `eas.json`'s `build.production.ios.credentialsSource === "remote"` and
   `image` is pinned, and `EXPO_LIVE_ACTIVITIES_REQUIRED=1` is in
   `build.production.env`.
5. `eas.json`'s `submit.production.ios` has an ASC API key wired up.

A regression on any of those exits the build with a descriptive error
instead of producing a signed-but-broken binary. The same script runs
locally via `npm run verify:live-activities`.

## Building

```bash
# 0. (Optional) Verify the Live Activities config locally before kicking
#    off an EAS build. Same script EAS runs as eas-build-pre-install.
npm run verify:live-activities

# 1. Generate the native ios/ directory (required before any Xcode build).
npx expo prebuild --platform ios --no-install

# 1a. To build and run on device via EAS:
eas build --platform ios --profile development

# 2. Open the resulting .xcworkspace in Xcode and verify the
#    VoiceProcessingLiveActivityWidget target appears under the
#    project navigator alongside the main app target.

# 3. To test on a device without a full EAS build, run:
npx expo run:ios --device
#    then select the widget target in Xcode's scheme picker and
#    attach to the running process.
```

## On-device verification checklist

- [ ] Lock screen pill appears when the user releases the mic button
- [ ] Pill transitions from "Processing memory…" → "Memory ready" after extraction
- [ ] Tapping the pill from the lock screen deep-links to the voice-capture screen
- [ ] Dynamic Island compact pill shows the waveform icon on iPhone 14 Pro+
- [ ] Dynamic Island expanded shows title + subtitle + progress on long-press
- [ ] Pill dismisses immediately when the user taps Save / Discard / Re-record
- [ ] No stale pill survives a force-quit / screen unmount

> **Status (Task #246, May 2026):** Prebuild **fixed**. The
> `VoiceProcessingLiveActivityWidget` target is now correctly registered
> in the generated Xcode project. On-device verification is unblocked
> (requires physical device + Apple credentials — see below).

## Verification status

### Prebuild step — PASSING (fixed in Task #246)

**Last verified:** May 2026

```bash
cd artifacts/memtool
npx expo prebuild --platform ios --no-install
# ✔ Finished prebuild
```

All success criteria confirmed:

- `npx expo prebuild --platform ios --no-install` exits 0
- `artifacts/memtool/ios/MemTool.xcodeproj/project.pbxproj` contains a
  `PBXNativeTarget` named `VoiceProcessingLiveActivityWidget` of
  product type `com.apple.product-type.app-extension`
- The main app target gains an "Embed Foundation Extensions"
  copy-files phase referencing `VoiceProcessingLiveActivityWidget.appex`
- The widget target's Sources phase compiles
  `VoiceProcessingLiveActivityWidget.swift` and
  `VoiceProcessingAttributes.swift`
- The widget target's Frameworks phase links `WidgetKit.framework` and
  `SwiftUI.framework`
- Re-running prebuild a second time is idempotent (no duplicate target)
- The main app's Info.plist contains `NSSupportsLiveActivities = true`
- The main app's entitlements contain
  `com.apple.developer.live-activities = true`

**What was wrong (Task #228 / #233).** The original plugin called
`addToPbxFileReferenceSection`, `addToPbxBuildFileSection`,
`addToPbxNativeTargetSection`, and similar methods with a
`{ key, obj: {...} }` shape. The `xcode@3.0.1` library expects the
file fields (`fileRef`, `basename`, `path`, `sourceTree`, …) at the
**top level** of the argument, so `file.path` was always `undefined`
and `.replace` threw immediately. Additionally, several methods the
plugin called (`addToPbxSourcesBuildPhaseSection`,
`addToPbxResourcesBuildPhaseSection`, etc.) do not exist in the
library at all. The fix rewrites `withWidgetTarget` to directly
manipulate `project.hash.project.objects`, the internal hash that
the library serialises to `project.pbxproj`.

### On-device verification — NOT STARTED

Requires Xcode, Apple developer credentials, an iPhone running iOS
16.1+ with Dynamic Island (e.g. iPhone 14 Pro or newer), and a second
iPhone running iOS 16.1+ without Dynamic Island (e.g. iPhone XR /
iPhone 12). Replit's container environment cannot satisfy any of these.

## Testing limits

Jest tests in `lib/voiceProcessingLiveActivity.test.ts` cover the JS
wrapper (availability fallback, lifecycle ordering, failure paths).
Native ActivityKit behavior (real lock-screen pill, Dynamic Island
animation) requires a physical iPhone running iOS 16.1+ and can only
be verified against a dev-client build via EAS.
