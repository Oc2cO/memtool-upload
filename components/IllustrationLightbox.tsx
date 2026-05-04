import React from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

// Full-screen viewer for an AI-illustrated memory. Tap the backdrop
// (or the close glyph) to dismiss. The image renders at the largest
// square that fits inside the safe area; the memory's text snippet
// hangs beneath it as a caption so the viewer doubles as a "this is
// what your memory looks like" reveal.
//
// When `onRegenerate` and/or `onRemove` are provided (Task #210), a
// pair of action buttons sit beneath the caption — "Regenerate" to
// re-roll the image (consumes a free-tier quota slot, same as a
// fresh illustrate) and "Remove" to discard the polaroid entirely.
// Both actions show a destructive-style confirmation alert before
// firing so a stray tap doesn't burn the user's daily slot or wipe
// a painting they still wanted to keep.
//
// Implemented as a React Native `Modal` (rather than a navigation
// route) so it can be summoned from any card without re-deriving the
// route's `<Stack>` config and so backdropping a tap stays purely
// local. The backdrop is a 70% black scrim — strong enough to make
// the polaroid pop but light enough that the underlying screen
// stays vaguely visible (which feels less jarring than a full
// blackout when the user dismisses).
export interface IllustrationLightboxProps {
  visible: boolean;
  imageUrl: string | null;
  caption?: string | null;
  onClose: () => void;
  /** Re-roll the illustration. The lightbox closes immediately on
   *  tap so the parent can swap in its own loading state (the
   *  Archive row's painting loader); the lightbox itself does NOT
   *  block on the regenerate. */
  onRegenerate?: () => void;
  /** Discard the illustration entirely. Lightbox closes on tap. */
  onRemove?: () => void;
  /** When true, action buttons render disabled with a small spinner
   *  in place of the regenerate icon. Used to disable a double-tap
   *  while a previous regen is in flight from another surface
   *  (rare but possible — both archive and capture screens reuse
   *  the same lightbox via IllustrationPolaroid). */
  busy?: boolean;
}

export function IllustrationLightbox({
  visible,
  imageUrl,
  caption,
  onClose,
  onRegenerate,
  onRemove,
  busy = false,
}: IllustrationLightboxProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const showActions = Boolean(onRegenerate || onRemove);

  // Square image that fits inside the safe area with comfortable
  // breathing room. We cap at 90% of the smaller axis so the
  // surrounding scrim is always visible (helps the dismiss tap
  // feel discoverable). When action buttons render below the
  // caption, leave a bit more headroom for them.
  const safeWidth = width - 32;
  const reservedForActions = showActions ? 220 : 160;
  const safeHeight = height - insets.top - insets.bottom - reservedForActions;
  const side = Math.min(safeWidth, safeHeight, 540);

  const handleRegenerate = () => {
    if (!onRegenerate || busy) return;
    Alert.alert(
      "Regenerate illustration?",
      "This will use one of your daily illustration slots and replace the current painting.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Regenerate",
          style: "default",
          onPress: () => {
            onClose();
            onRegenerate();
          },
        },
      ],
    );
  };

  const handleRemove = () => {
    if (!onRemove || busy) return;
    Alert.alert(
      "Remove illustration?",
      "This won't refund your daily illustration slot.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            onClose();
            onRemove();
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.spacer} />
        {imageUrl ? (
          <View style={styles.frame}>
            {/* Stop the backdrop press from firing when the user is
                interacting with the image, caption, or buttons. */}
            <Pressable onPress={() => {}}>
              <Image
                // expo-image so the full-resolution PNG hits the same
                // shared disk cache as the polaroid's thumbnail. After
                // the first lightbox open the file is local, so a
                // second open from a backgrounded app is instant.
                source={{ uri: imageUrl }}
                style={[
                  styles.image,
                  {
                    width: side,
                    height: side,
                    borderRadius: 12,
                    backgroundColor: colors.card,
                  },
                ]}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={150}
                accessibilityLabel="Illustrated memory"
              />
              {caption ? (
                <Text
                  numberOfLines={4}
                  style={[
                    styles.caption,
                    { color: colors.foreground, maxWidth: side },
                  ]}
                >
                  {caption}
                </Text>
              ) : null}
              {showActions ? (
                <View
                  style={[
                    styles.actionsRow,
                    { maxWidth: side, opacity: busy ? 0.6 : 1 },
                  ]}
                >
                  {onRegenerate ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Regenerate illustration"
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={handleRegenerate}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.regenerateBtn,
                        {
                          backgroundColor: "rgba(255,255,255,0.14)",
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.foreground}
                        />
                      ) : (
                        <Ionicons
                          name="refresh"
                          size={16}
                          color={colors.foreground}
                        />
                      )}
                      <Text
                        style={[
                          styles.actionText,
                          { color: colors.foreground },
                        ]}
                      >
                        Regenerate
                      </Text>
                    </Pressable>
                  ) : null}
                  {onRemove ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove illustration"
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={handleRemove}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.removeBtn,
                        {
                          backgroundColor: "rgba(220,80,80,0.18)",
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color="#ff8a8a"
                      />
                      <Text style={[styles.actionText, { color: "#ff8a8a" }]}>
                        Remove
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </Pressable>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[
            styles.closeBtn,
            {
              top: insets.top + 12,
              backgroundColor: "rgba(255,255,255,0.12)",
            },
          ]}
        >
          <Ionicons name="close" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.spacer} />
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  spacer: {
    flex: 0.1,
  },
  frame: {
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    // shadow doesn't render on the image itself in RN; the polaroid
    // frame is intentionally minimal in the lightbox — the scrim
    // already provides the depth cue.
  },
  caption: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    letterSpacing: 0.1,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 20,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  regenerateBtn: {},
  removeBtn: {},
  actionText: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
