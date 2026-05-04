// Sentry must be the very first import so its error handlers are
// installed before any other module can throw. Safe to call at module
// load — `initSentry` is idempotent and a no-op when the DSN env var
// is missing (local dev / web preview).
import { initSentry, Sentry } from "@/lib/sentry";
initSentry();

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import React, { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Linking, Platform, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { prewarmFoundationModels } from "@/lib/foundationModelsPrewarm";
import {
  bootstrapHapticPreferences,
  useHapticPreferencesReady,
} from "@/lib/haptics";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { MemoriesProvider } from "@/context/MemoriesContext";
import { GameStatsProvider } from "@/context/GameStatsContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { MoodProvider } from "@/context/MoodContext";
import { ProfileProvider } from "@/context/ProfileContext";
import { SubscriptionProvider, useSubscription } from "@/context/SubscriptionContext";
import { SkillsProvider } from "@/context/SkillsContext";
import { TipsProvider } from "@/context/TipsContext";

import {
  getCurrentEntitlementIsPro,
  initializeRevenueCat,
  useRevenueCatIdentity,
} from "@/lib/revenuecat";
import {
  maybeRequestReview,
  recordAccountFirstSeen,
  recordAppOpen,
} from "@/lib/reviewPrompt";
import {
  checkForUpdate,
  dismissSoftUpdate,
  getCurrentVersion,
  isSoftUpdateDismissed,
  type UpdateCheckResult,
} from "@/lib/forceUpdate";
import { resolveReplitApiBase } from "@/lib/config";
import { setupApiClientBaseUrl } from "@/lib/setupApiClient";
import { registerOnDeviceSpeechToText } from "@/lib/speechToText";
import { cleanUpStaleProcessingActivities } from "@/lib/voiceProcessingLiveActivity";

// Wire the codegen `customFetch` client at module load. Returns
// `false` when `EXPO_PUBLIC_REPLIT_API_BASE_URL` is missing or
// resolves to an invalid value (e.g. `https://undefined`); we capture
// that flag here and surface a `CrashScreen` from `RootLayoutContent`
// instead of letting the first post-login fetch fail with a malformed
// URL. See `lib/setupApiClient.ts` and Task #285 for the full story.
const API_CLIENT_BASE_URL_OK = setupApiClientBaseUrl();

// Configure the Apple In-App Purchase SDK as early as possible so the
// subscription screen can call `purchaseProSubscription` synchronously
// when the user taps Upgrade. `initializeRevenueCat` is idempotent and
// never throws — if env vars are missing (the pre-seed-script state
// or the web dev preview) it just records the reason and
// `isRevenueCatConfigured()` returns false so the screen renders its
// non-purchase fallback UX without crashing.
initializeRevenueCat();

// Register the on-device speech-to-text provider as early as possible
// so the voice-capture screen's `isSpeechToTextAvailable()` check is
// already `true` by the time the user navigates in. The bridge is
// idempotent and never throws — when the dev client wasn't built with
// the local `speech-to-text` Expo module (Expo Go, web, an older
// binary), the registration is a no-op and the voice-capture screen
// falls back to its calm "voice transcription not available on this
// build" placeholder.
// Same module-load placement as `initializeRevenueCat()` above so the
// two boot bridges keep the same "fire once at startup" contract.
registerOnDeviceSpeechToText();

// Sweep up any leftover voice-processing Live Activities at cold
// start (Task #247). The voice-capture screen ends its activity
// on every normal exit (save, discard, re-record, unmount), so in
// the happy path this finds nothing to do. The case it covers is a
// force-quit (or OS-kill) mid-recording: ActivityKit keeps the
// "Processing memory…" pill alive on the lock screen / Dynamic
// Island across app restarts, and without an explicit cleanup it
// would just sit there until the user manually swiped it away or
// iOS hit its 8-hour stale-date timeout. Fire-and-forget at module
// load (matching the `registerOnDeviceSpeechToText()` pattern
// above) so the sweep is in flight before the user can navigate
// to voice-capture and start a fresh recording. The helper is a
// no-op on Android, web, Expo Go, iOS < 16.1, and any dev client
// built before the WidgetKit extension was linked in, and it
// swallows every failure path internally — app launch can never
// crash because of leftover-pill cleanup.
void cleanUpStaleProcessingActivities();

// Kick off the haptic preference reads (per-signature mute map +
// global "Haptics" master switch) at module load — i.e. before any
// component mounts (Task #272). Pairs with the `useHapticPreferencesReady()`
// gate inside `RootLayoutContent` below, which blocks the first
// render until both AsyncStorage reads have resolved. Without this
// gate, a screen that fires a haptic on its very first frame could
// buzz a signature the user previously muted, or fire while the
// master switch is off, for the few-frame window between launch and
// `useHaptics()` mounting at the root navigator.
//
// Starting the bootstrap here (in parallel with font loading,
// `initializeRevenueCat()`, and `registerOnDeviceSpeechToText()`)
// means AsyncStorage is almost always answered by the time fonts
// finish — the gate adds zero perceptible latency in the common
// case but provides a hard guarantee in the worst case. The helper
// is idempotent and never throws.
void bootstrapHapticPreferences();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const APP_BG = "#0a0a0f";

// Match the native root view background to the dark theme so Android
// doesn't flash the system default white between the splash hide and
// the first React render. Fire-and-forget — this runs once at module
// load and never throws (the SDK is a no-op on web). iOS already gets
// the right colour via `splash.backgroundColor`, but Android's root
// activity background is independent and needs to be set explicitly.
if (Platform.OS !== "web") {
  SystemUI.setBackgroundColorAsync(APP_BG).catch(() => {});
}

/**
 * Mounts the `useRevenueCatIdentity` effect inside `AuthProvider` so
 * the IAP SDK gets logged in / out alongside the rest of the app.
 * Renders nothing — it's a side-effect-only component because the
 * underlying hook needs `useAuth` and React rules require it to be
 * called inside a component, not at module scope.
 */
function RevenueCatIdentityBridge() {
  useRevenueCatIdentity();
  return null;
}

/**
 * Cold-launch entitlement check — Apple IAP compliance.
 *
 * Must be mounted inside `SubscriptionProvider` so it can call
 * `patchProStatus`. On the very first render after initialization,
 * this queries the RevenueCat SDK for a locally cached CustomerInfo
 * (no network hop) and, if the user has an active Pro entitlement,
 * immediately patches the subscription context before routed content
 * renders. This ensures returning Pro subscribers are recognized on
 * cold launch without waiting for the Polsia/server round-trip.
 *
 * A second, authoritative refresh will follow from the
 * `SubscriptionProvider`'s own mount effect — this bridge only
 * provides the fast optimistic path.
 */
function LaunchEntitlementBridge() {
  const { patchProStatus } = useSubscription();
  useEffect(() => {
    getCurrentEntitlementIsPro()
      .then((isPro) => {
        if (isPro === true) patchProStatus(true);
      })
      .catch(() => {});
    // Run only once on cold launch — dependency array is intentionally
    // empty. Subsequent refreshes are handled by SubscriptionProvider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Side-effect bridge for the in-app App Store review prompt.
 *
 * Two responsibilities:
 *   1. Record `mt_account_first_seen_<email>` the first time we see
 *      the user signed in on this device. The User type from the
 *      server doesn't carry a `created_at`, so this is the only way
 *      to enforce the ≥ 7-day account-age gate Apple expects before
 *      we ask for a review.
 *   2. On every transition from background → foreground, call the
 *      gated prompt. All filtering (asked-once, age ≥ 7d, SDK
 *      availability) lives in `lib/reviewPrompt.ts:maybeRequestReview`,
 *      so this bridge stays a thin wiring layer.
 *
 * Renders nothing — the hook needs `useAuth`, which forces it inside
 * a component.
 */
function ReviewPromptBridge() {
  const { user } = useAuth();
  const previousAppStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!user?.email) return;
    recordAccountFirstSeen(user.email).catch(() => {});
  }, [user?.email]);

  useEffect(() => {
    if (!user?.email) return;
    const email = user.email;
    // Record today as an open-day on every foreground event so
    // `maybeRequestReview` can enforce its MIN_OPEN_DAYS gate.
    recordAppOpen(email).catch(() => {});
    const sub = AppState.addEventListener("change", (next) => {
      const prev = previousAppStateRef.current;
      previousAppStateRef.current = next;
      // Only fire on the explicit background/inactive → active edge
      // so a quick tap on the screen doesn't trigger anything.
      if (prev !== "active" && next === "active") {
        recordAppOpen(email).catch(() => {});
        maybeRequestReview(email).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [user?.email]);

  return null;
}

/**
 * Force-update / soft-update bridge (Task #300).
 *
 * Runs the version check on cold launch and on every foreground
 * event (rate-limited to once per 4 h by `checkForUpdate`'s cache).
 * When a force update is needed, sets `onForceUpdate` state in the
 * parent so `RootLayoutContent` can replace `<Slot />` with a blocking
 * screen. For soft updates, shows a dismissible banner above the
 * normal UI.
 */
function ForceUpdateBridge({
  onResult,
}: {
  onResult: (result: UpdateCheckResult) => void;
}) {
  const previousAppStateRef = useRef<AppStateStatus>(AppState.currentState);

  const runCheck = React.useCallback(() => {
    const base = resolveReplitApiBase();
    if (!base) return;
    checkForUpdate(base)
      .then(onResult)
      .catch(() => {});
  }, [onResult]);

  useEffect(() => {
    runCheck();
    const sub = AppState.addEventListener("change", (next) => {
      const prev = previousAppStateRef.current;
      previousAppStateRef.current = next;
      if (prev !== "active" && next === "active") {
        runCheck();
      }
    });
    return () => sub.remove();
  }, [runCheck]);

  return null;
}

/**
 * Blocking force-update screen. Replaces the entire navigator content
 * when the installed build is below the minimum supported version.
 * The CTA opens the store listing; there's no dismiss — the user must
 * update to continue.
 */
function ForceUpdateScreen({ storeUrl }: { storeUrl?: string }) {
  const version = getCurrentVersion();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0a0a0f",
        padding: 32,
        justifyContent: "center",
        alignItems: "center",
      }}
      testID="force-update-screen"
    >
      <Text
        style={{
          color: "#a78bfa",
          fontSize: 48,
          marginBottom: 24,
          fontFamily: "monospace",
        }}
      >
        ⚠️
      </Text>
      <Text
        style={{
          color: "#ffffff",
          fontSize: 22,
          fontWeight: "700",
          textAlign: "center",
          marginBottom: 12,
        }}
      >
        Please update MemTool
      </Text>
      <Text
        style={{
          color: "#9ca3af",
          fontSize: 15,
          textAlign: "center",
          lineHeight: 22,
          marginBottom: 32,
        }}
      >
        Version {version} is no longer supported. Download the latest
        version to keep your memories safe and in sync.
      </Text>
      {storeUrl ? (
        <Pressable
          onPress={() => Linking.openURL(storeUrl).catch(() => {})}
          style={({ pressed }) => ({
            backgroundColor: "#a78bfa",
            paddingHorizontal: 28,
            paddingVertical: 14,
            borderRadius: 14,
            opacity: pressed ? 0.8 : 1,
          })}
          accessibilityRole="link"
          accessibilityLabel="Update MemTool"
          testID="force-update-cta"
        >
          <Text
            style={{
              color: "#0a0a0f",
              fontSize: 16,
              fontWeight: "700",
            }}
          >
            Update MemTool
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Dismissible soft-update banner. Shown above the normal navigator
 * when a newer version is available but not yet required. Disappears
 * permanently for the current `latestVersion` once dismissed.
 */
function SoftUpdateBanner({
  latestVersion,
  storeUrl,
  onDismiss,
}: {
  latestVersion: string;
  storeUrl?: string;
  onDismiss: () => void;
}) {
  return (
    <View
      style={{
        backgroundColor: "#1c1c2e",
        borderBottomWidth: 1,
        borderBottomColor: "#5eead4",
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 8,
      }}
      testID="soft-update-banner"
    >
      <Text style={{ color: "#5eead4", fontSize: 14, flex: 1 }}>
        MemTool {latestVersion} is available
      </Text>
      {storeUrl ? (
        <Pressable
          onPress={() => Linking.openURL(storeUrl).catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel="Update now"
        >
          <Text
            style={{ color: "#a78bfa", fontSize: 14, fontWeight: "600" }}
          >
            Update
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss update banner"
        testID="soft-update-dismiss"
      >
        <Text style={{ color: "#6b7280", fontSize: 18, lineHeight: 18 }}>
          ×
        </Text>
      </Pressable>
    </View>
  );
}

function CrashScreen({ error }: { error: Error }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#000", padding: 24, justifyContent: "center" }}>
      <Text style={{ color: "#f00", fontSize: 16, fontFamily: "monospace" }}>{error.message}</Text>
      {error.stack ? (
        <Text style={{ color: "#f00", fontSize: 12, fontFamily: "monospace", marginTop: 16 }}>{error.stack}</Text>
      ) : null}
    </View>
  );
}

function RootLayoutContent() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Force-update / soft-update state (Task #300). `updateResult` is
  // null until the first check completes (no UI shown). When it
  // resolves to "force_update", the normal navigator is replaced with a
  // blocking screen. When it resolves to "soft_update" and the user
  // hasn't dismissed the banner for this version, a dismissible banner
  // is shown above the normal UI.
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [softDismissed, setSoftDismissed] = useState(false);

  const handleUpdateResult = React.useCallback(async (result: UpdateCheckResult) => {
    if (result.status === "soft_update" && result.latestVersion) {
      const dismissed = await isSoftUpdateDismissed(result.latestVersion);
      setSoftDismissed(dismissed);
    }
    setUpdateResult(result);
  }, []);

  const handleDismissSoftBanner = React.useCallback(() => {
    if (updateResult?.latestVersion) {
      void dismissSoftUpdate(updateResult.latestVersion);
    }
    setSoftDismissed(true);
  }, [updateResult?.latestVersion]);

  // Hard cold-start gate (Task #272). The hook flips to `true` once
  // `bootstrapHapticPreferences()` (kicked off at module load above)
  // resolves both AsyncStorage reads — the per-signature mute map
  // and the master switch. Holding the first render until then is
  // the only way to guarantee a screen that fires a haptic on its
  // very first frame respects the user's saved mute preferences.
  // In practice the reads finish well before fonts load, so this
  // adds zero perceptible latency.
  const hapticPrefsReady = useHapticPreferencesReady();

  useEffect(() => {
    if ((fontsLoaded || fontError) && hapticPrefsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, hapticPrefsReady]);

  // Pre-warm the FoundationModels Neural Engine cache (Task #263). Fires once
  // after the splash screen hides — at which point the UI is already
  // interactive and the throwaway summarize call runs in the background at low
  // priority. `prewarmFoundationModels` is a no-op on ineligible devices, when
  // the cold cost has already been paid, and on every platform except iOS 26+.
  useEffect(() => {
    if ((fontsLoaded || fontError) && hapticPrefsReady) {
      prewarmFoundationModels();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsLoaded, fontError, hapticPrefsReady]);

  if (!fontsLoaded && !fontError) return null;
  if (!hapticPrefsReady) return null;

  // Caught at module load by `setupApiClientBaseUrl` — surface a
  // calm, deterministic crash screen instead of letting the first
  // codegen-client fetch after login blow up with `https://undefined`.
  if (!API_CLIENT_BASE_URL_OK) {
    return (
      <CrashScreen
        error={
          new Error(
            "Server not configured. Please reinstall the latest build.",
          )
        }
      />
    );
  }

  // Force-update blocking: replace the navigator entirely when the
  // installed build is below the minimum supported version.
  const isForceUpdate = updateResult?.status === "force_update";
  const isSoftUpdate =
    updateResult?.status === "soft_update" && !softDismissed;

  return (
    <SafeAreaProvider>
      {/*
        Force light status-bar icons app-wide. The MemTool theme is
        dark-only, so the system default (which follows the device
        appearance setting on Android) would render dark icons over
        the dark background and hide the time / battery indicators.
        `translucent` lets each screen extend under the status bar
        and rely on `useSafeAreaInsets().top` for its own padding —
        the pattern every screen here already uses.
      */}
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <ErrorBoundary
        onError={(error, stack) => {
          console.error(error, stack);
          // Forward render-time crashes to Sentry so a white-screen
          // ErrorBoundary fallback in production still produces an
          // event we can investigate. No-op when DSN is missing.
          try {
            Sentry.captureException(error, { contexts: { react: { componentStack: stack } } });
          } catch {
            // never let the reporter itself crash the boundary
          }
        }}
      >
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: APP_BG }}>
            <KeyboardProvider>
              <AuthProvider>
                <RevenueCatIdentityBridge />
                <ReviewPromptBridge />
                {/* Force-update bridge runs outside SubscriptionProvider
                    so the check fires even before the user signs in. */}
                <ForceUpdateBridge onResult={(r) => { void handleUpdateResult(r); }} />
                <SubscriptionProvider>
                  <LaunchEntitlementBridge />
                  <MemoriesProvider>
                    <TipsProvider>
                      <GameStatsProvider>
                        <SkillsProvider>
                        <SettingsProvider>
                          <MoodProvider>
                            <ProfileProvider>
                              {isForceUpdate ? (
                                <ForceUpdateScreen
                                  storeUrl={updateResult?.storeUrl}
                                />
                              ) : (
                                <View style={{ flex: 1 }}>
                                  {isSoftUpdate && (
                                    <SoftUpdateBanner
                                      latestVersion={updateResult!.latestVersion!}
                                      storeUrl={updateResult?.storeUrl}
                                      onDismiss={handleDismissSoftBanner}
                                    />
                                  )}
                                  <Slot />
                                </View>
                              )}
                            </ProfileProvider>
                          </MoodProvider>
                        </SettingsProvider>
                        </SkillsProvider>
                      </GameStatsProvider>
                    </TipsProvider>
                  </MemoriesProvider>
                </SubscriptionProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  try {
    return <RootLayoutContent />;
  } catch (error) {
    console.error("RootLayout render crash:", error);
    return error instanceof Error ? <CrashScreen error={error} /> : <CrashScreen error={new Error(String(error))} />;
  }
}
