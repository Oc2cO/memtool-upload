import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, Easing, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";

/**
 * Per-row sync indicator. Lives next to the timestamp on each Memory
 * card so the user always has a passive signal that the row is safe on
 * the server (synced) or still in flight (pending) or stuck (failed).
 *
 * Visual contract:
 *   - synced    → tiny cloud-done icon, muted color (the default state
 *                 — quiet enough to ignore on a long list)
 *   - pending   → spinning dot, primary tint (only while the outbox
 *                 entry is mid-flight — the heartbeat keeps this short
 *                 so the user rarely sees it linger)
 *   - failed    → muted warning glyph (entry has failed at least once
 *                 but the 24h banner hasn't fired yet)
 *
 * Accessibility:
 *   - `accessibilityLabel` is set per state so screen readers announce
 *     "Synced" / "Syncing now" / "Saved offline, tap to retry sync"
 *     instead of reading the raw icon name. The pending state is
 *     deliberately distinct from the failed state — a screen-reader
 *     user inspecting a mid-flight row must NOT be told it failed.
 *   - When the failed badge is tappable (failed + onRetry), it also
 *     exposes an `accessibilityHint` describing the action so VoiceOver
 *     reads "Saved offline, tap to retry sync. Double tap to retry
 *     syncing this entry." — assistive-tech users get a clear label +
 *     action pair instead of an unexplained button. The exact wording
 *     is locked down by tests so an accidental icon-only refactor
 *     surfaces immediately.
 *
 * Tap-to-retry:
 *   - When `onRetry` is provided AND status is `failed`, the indicator
 *     becomes a Pressable so the user can manually nudge the outbox
 *     for that one row.
 *   - The pending state is ALWAYS passive even when an `onRetry` is
 *     supplied: the entry is already mid-flight, the outbox lock would
 *     serialize a manual retry behind the in-flight attempt anyway,
 *     and announcing "Saved offline, tap to retry" on a row that is
 *     actively syncing right now is just wrong.
 *   - The synced state stays a passive View — there's nothing to retry.
 *   - Without an `onRetry` handler the indicator stays passive
 *     everywhere (used by surfaces like the home recent-captures list
 *     where per-row retry isn't wired).
 *
 * Why a separate component:
 *   - Both the Archive list and the (eventual) home recent-captures
 *     list need this indicator. Centralizing it here keeps the icon
 *     vocabulary, sizing, and a11y labels consistent across surfaces.
 */
export type SyncStatus = "synced" | "pending" | "failed";

interface Props {
  status: SyncStatus;
  /** When provided, the FAILED indicator becomes tappable and invokes
   *  this callback. The Archive screen wires this to
   *  `retryMemorySync(id)` so a user can flush a stuck row without
   *  waiting for the next heartbeat. The pending state intentionally
   *  ignores `onRetry` and stays passive — see the component-level
   *  docblock for the reasoning. */
  onRetry?: () => void;
}

export function MemorySyncStatus({ status, onRetry }: Props) {
  const colors = useColors();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status !== "pending") {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [status, spin]);

  if (status === "pending") {
    const rotate = spin.interpolate({
      inputRange: [0, 1],
      outputRange: ["0deg", "360deg"],
    });
    const inner = (
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Ionicons name="sync-outline" size={12} color={colors.primary} />
      </Animated.View>
    );
    // Pending is always passive — see component-level docblock. We
    // intentionally ignore `onRetry` here so a mid-flight row never
    // exposes the misleading "Saved offline, tap to retry sync" label
    // and never fires a redundant retry that the outbox would just
    // serialize behind the already-in-flight attempt.
    return (
      <View
        style={styles.container}
        accessibilityRole="image"
        accessibilityLabel="Syncing now"
      >
        {inner}
      </View>
    );
  }

  if (status === "failed") {
    const glyph = (
      <Ionicons
        name="cloud-offline-outline"
        size={12}
        color={colors.mutedForeground}
      />
    );
    if (onRetry) {
      return (
        <Pressable
          onPress={onRetry}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Saved offline, tap to retry sync"
          accessibilityHint="Retries syncing this memory"
          style={({ pressed }) => [styles.container, pressed && styles.pressed]}
        >
          {glyph}
        </Pressable>
      );
    }
    return (
      <View
        style={styles.container}
        accessibilityRole="image"
        accessibilityLabel="Sync failed, will retry"
      >
        {glyph}
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      accessibilityRole="image"
      accessibilityLabel="Synced"
    >
      <Ionicons name="cloud-done-outline" size={12} color={colors.mutedForeground} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.5,
  },
});
