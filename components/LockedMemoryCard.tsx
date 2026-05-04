import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { AliveButton } from "@/components/alive/AliveButton";
import { LiftPress } from "@/components/alive/LiftPress";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { PRO_LIBRARY_DAYS } from "@/lib/subscription";
import { formatRelativeAge } from "@/lib/dates";

/**
 * "Tease" card the Archive renders in place of a real memory card
 * when the underlying memory is older than the user's library window
 * (free: 7 days, Pro: 31 days). The actual content snippet is
 * rendered behind an `expo-blur` overlay so the user sees that there
 * IS something there, but can't read it — Apple guidelines allow
 * showing "you have content" but not the content itself once it's
 * gated behind a paywall, and the blur communicates that state much
 * more honestly than a redacted block.
 *
 * `expo-blur`'s native blur is iOS/Android only; on web it falls back
 * to a translucent overlay automatically. We wrap the snippet in the
 * BlurView regardless so the layout is identical across platforms.
 *
 * The two interactions:
 *   - Tap the card → /subscription (gentle, LiftPress)
 *   - Tap the explicit CTA → /subscription (loud, gradient button)
 * Both deep link to the same place; the dual affordance is just for
 * discoverability since locked cards mixed in with editable ones can
 * be mistaken for "tap to read" otherwise.
 *
 * NEVER reward a tap-through with anything beyond the paywall — App
 * Store guideline 3.1.2 requires the gate to be unambiguous, and we
 * also don't want to game users into upgrades. Honest tease only.
 */
export interface LockedMemoryCardProps {
  /** ISO timestamp shown as a relative date (e.g. "12 days ago"). */
  timestamp: string;
  /** Short preview text rendered behind the blur overlay. */
  snippet: string;
  /**
   * Reason copy from `getLibraryWindowState(...).lockedReason`. We
   * surface it verbatim so the same string the context uses for the
   * thrown error matches what the user sees here — easier to debug,
   * and tier copy stays in one place (lib/captureLimits.ts).
   */
  lockedReason: string;
}

export function LockedMemoryCard({
  timestamp,
  snippet,
  lockedReason,
}: LockedMemoryCardProps) {
  const colors = useColors();
  const router = useRouter();

  const goToPaywall = React.useCallback(() => {
    // Navigation tap to the paywall — upgrade success haptic fires
    // inside the subscription flow.
    Haptics.selectionAsync().catch(() => {});
    router.push("/subscription");
  }, [router]);

  // BlurView intensity is muted enough to suggest text without
  // letting it be read, even in screenshots — important because a
  // user could otherwise screenshot the Archive list and OCR the
  // snippet.
  const blurIntensity = 28;
  const isBlurNative = Platform.OS === "ios" || Platform.OS === "android";

  return (
    <LiftPress
      onPress={goToPaywall}
      // `backgroundColor` on the outer wrapper is required for Android
      // to cast the `elevation` shadow with the right rounded contour
      // (Android only paints elevation shadows for views with an opaque
      // background). The inner view paints the same color, so visually
      // there's no double-paint.
      style={[styles.cardOuter, { backgroundColor: colors.card }]}
      // Solid card surface — finishes Mercury Recipe E (lift + shadow
      // bump) so the press feels grounded. The outer wrapper carries
      // the shadow geometry and intentionally has NO `overflow: "hidden"`
      // (iOS clips a layer's shadow when the layer is masked-to-bounds),
      // while the inner `cardInner` view does the actual clipping for
      // the BlurView snippet. Without this split the iOS half of
      // Recipe E (shadowOpacity 0.04 → 0.10) would be clipped away and
      // only the Android elevation 2 → 6 lift would land.
      liftShadow
      accessibilityLabel={`Locked memory from ${formatRelativeAge(
        timestamp,
      )}. ${lockedReason}. Tap to unlock with MemTool Pro.`}
    >
      <View
        style={[
          styles.cardInner,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.snippetWrap}>
          <Text
            numberOfLines={3}
            style={[styles.snippetText, { color: colors.foreground }]}
          >
            {snippet || "Memory locked — unlock to read."}
          </Text>
          {/* The blur sits ON TOP of the text so it stays unreadable
              even if a future style accidentally lifts opacity. */}
          <BlurView
            intensity={blurIntensity}
            tint={colors.background === "#ffffff" ? "light" : "dark"}
            style={StyleSheet.absoluteFill}
          >
            {/* Web fallback: BlurView on web is a no-op, so we layer a
                semi-opaque scrim that achieves the same "hidden but
                there" effect without any platform branching at the
                call site. */}
            {!isBlurNative && (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: colors.card, opacity: 0.92 },
                ]}
              />
            )}
          </BlurView>
          <View style={styles.lockGlyphWrap} pointerEvents="none">
            <Ionicons name="lock-closed" size={28} color={colors.primary} />
          </View>
        </View>

        <View style={styles.metaRow}>
          <Text
            style={[styles.metaText, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {formatRelativeAge(timestamp)} · {lockedReason}
          </Text>
        </View>

        <Text style={[styles.heading, { color: colors.foreground }]}>
          Unlock your past memories
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Go Pro to read and edit memories from up to {PRO_LIBRARY_DAYS} days
          ago.
        </Text>

        <AliveButton
          onPress={goToPaywall}
          style={styles.ctaWrapper}
          glowColor="#a78bfa"
          glowIntensity={0.6}
          screenKey="locked-memory"
          accessibilityLabel={`Unlock ${PRO_LIBRARY_DAYS}-Day Memory Library`}
        >
          <LinearGradient
            colors={["#a78bfa", "#5eead4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.ctaButton}
          >
            <Ionicons name="rocket-outline" size={16} color="#0a0612" />
            <Text style={styles.ctaText}>
              Unlock {PRO_LIBRARY_DAYS}-Day Memory Library
            </Text>
          </LinearGradient>
        </AliveButton>
      </View>
    </LiftPress>
  );
}

const styles = StyleSheet.create({
  // Outer wrapper: bears the press-lift shadow. Must NOT clip
  // (`overflow: "hidden"`), or iOS masks-to-bounds and the layer's
  // shadow disappears. shadowColor/offset/radius are required for the
  // shadow to render at all on iOS — `LiftPress` only animates
  // `shadowOpacity`/`elevation` and explicitly leaves geometry to the
  // parent style. The `borderRadius` here matches `cardInner` so the
  // shadow contour follows the visible card edge.
  cardOuter: {
    // 20: deliberate one-off, between radius.md (16) and radius.lg (24).
    borderRadius: 20,
    marginBottom: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    // Baseline shadowOpacity / elevation are intentionally omitted so
    // `LiftPress` falls back to its Recipe E defaults (0.04 → 0.10 on
    // iOS, elevation 2 → 6 on Android) without us having to restate
    // them here.
  },
  // Inner surface: paints the card and clips the BlurView snippet to
  // the rounded corners. `borderRadius` must match `cardOuter` so the
  // shadow lines up with the visible edge.
  cardInner: {
    // 20: deliberate one-off, between radius.md (16) and radius.lg (24).
    borderRadius: 20,
    borderWidth: 1,
    padding: spacing.base,
    overflow: "hidden",
  },
  snippetWrap: {
    position: "relative",
    minHeight: 56,
    borderRadius: radius.sm,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  snippetText: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16).
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
    padding: spacing.sm,
  },
  lockGlyphWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  metaRow: { flexDirection: "row", marginBottom: 10 },
  metaText: {
    flex: 1,
    ...text.caption,
  },
  heading: {
    ...text.body,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  body: {
    ...text.helperRegular,
    lineHeight: 20,
    marginBottom: 14,
  },
  ctaWrapper: { borderRadius: radius.sm, overflow: "hidden", alignSelf: "stretch" },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  ctaText: {
    color: "#0a0612",
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
