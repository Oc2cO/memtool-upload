import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { useColors } from "@/hooks/useColors";
import { IllustrationLightbox } from "./IllustrationLightbox";

// Polaroid-framed presentation of an AI illustration. White card,
// extra padding at the bottom (the "where the caption goes" gap on
// a real polaroid), soft drop shadow. Tapping opens
// `IllustrationLightbox` for the full-screen view.
//
// The "✦ Illustrated" badge floats at the top-right of the frame so
// even at archive-row scale the user can see at a glance which
// memories have been illustrated. The brand glyph (✦) matches the
// loader's center mark for a consistent visual language.
export interface IllustrationPolaroidProps {
  /** Full-resolution URL. Used by the lightbox when the polaroid is
   *  tapped, and as the thumbnail fallback when `thumbUrl` is
   *  absent (legacy server responses). */
  imageUrl: string;
  /** Small (256×256) variant served by the api-server. Preferred
   *  for the polaroid itself so the Archive can scroll without
   *  pulling the 1MB full-res PNG per row. expo-image's disk +
   *  memory cache means subsequent renders are instant and a
   *  backgrounded app comes back without a flicker. */
  thumbUrl?: string;
  caption?: string | null;
  size?: number;
  /** When true, suppresses the corner badge — useful inside the
   *  lightbox or any context where the "this is an illustration"
   *  framing is already obvious. */
  hideBadge?: boolean;
  /** Optional regenerate handler forwarded to the lightbox (Task
   *  #210). When provided, the lightbox surfaces a "Regenerate"
   *  action; otherwise the action is hidden. */
  onRegenerate?: () => void;
  /** Optional remove handler forwarded to the lightbox (Task #210).
   *  When provided, the lightbox surfaces a "Remove" action. */
  onRemove?: () => void;
  /** Forwarded to the lightbox to disable both actions while a
   *  related mutation (regen or delete) is already in flight. */
  actionsBusy?: boolean;
}

export function IllustrationPolaroid({
  imageUrl,
  thumbUrl,
  caption,
  size = 180,
  hideBadge = false,
  onRegenerate,
  onRemove,
  actionsBusy = false,
}: IllustrationPolaroidProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  // Polaroid color is intentionally NOT theme-tinted: a real
  // polaroid is always cream/white regardless of the surrounding
  // room. This keeps the paintings readable in dark mode without
  // the polaroid frame disappearing into the card behind it.
  const FRAME_COLOR = "#fbfaf3";

  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel="View illustration"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.frameOuter,
          {
            backgroundColor: FRAME_COLOR,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          },
        ]}
      >
        <View
          style={[
            styles.imageWrap,
            { width: size, height: size, backgroundColor: "#e8e4d4" },
          ]}
        >
          <Image
            // expo-image: disk + memory cache by default. We feed
            // the small thumbnail when the server has one (the
            // Archive's source of "instant scroll") and fall back
            // to the full-res URL for legacy records that pre-date
            // the thumbnail variant. `cachePolicy='memory-disk'`
            // is the explicit version of the default and is set
            // here for forward-compat with future expo-image
            // releases that may change the implicit default.
            source={{ uri: thumbUrl ?? imageUrl }}
            style={styles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            recyclingKey={thumbUrl ?? imageUrl}
            accessibilityLabel="Illustration thumbnail"
          />
          {!hideBadge ? (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: colors.primary,
                },
              ]}
            >
              <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>
                ✦ Illustrated
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.captionRow}>
          <Text
            numberOfLines={1}
            style={styles.captionText}
          >
            {caption ?? "memory"}
          </Text>
        </View>
      </Pressable>
      <IllustrationLightbox
        visible={open}
        imageUrl={imageUrl}
        caption={caption}
        onClose={() => setOpen(false)}
        onRegenerate={onRegenerate}
        onRemove={onRemove}
        busy={actionsBusy}
      />
    </>
  );
}

const styles = StyleSheet.create({
  frameOuter: {
    alignSelf: "flex-start",
    padding: 8,
    paddingBottom: 24,
    borderRadius: 4,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  imageWrap: {
    borderRadius: 2,
    overflow: "hidden",
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  captionRow: {
    marginTop: 6,
    paddingHorizontal: 4,
  },
  captionText: {
    color: "#5a4a30",
    fontSize: 11,
    fontStyle: "italic",
  },
});
