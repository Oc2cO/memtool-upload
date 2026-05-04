import React from "react";
import { Image, ImageStyle, StyleProp, View } from "react-native";

export type BrandHeroVariant =
  | "memora-fullbody"
  | "memora-fullbody-dark"
  | "memora-head"
  | "memora-hero-chat"
  | "sagous-fullbody"
  | "sagous-fullbody-dark"
  | "sagous-head"
  | "couple-hero";

const SOURCES: Record<BrandHeroVariant, number> = {
  "memora-fullbody": require("@/assets/brand/memora-fullbody.png"),
  "memora-fullbody-dark": require("@/assets/brand/memora-fullbody-dark.png"),
  "memora-head": require("@/assets/brand/memora-head-512.png"),
  "memora-hero-chat": require("@/assets/brand/mem-hero-chat.png"),
  "sagous-fullbody": require("@/assets/brand/oc2co-fullbody.png"),
  "sagous-fullbody-dark": require("@/assets/brand/oc2co-fullbody-dark.png"),
  "sagous-head": require("@/assets/brand/oc2co-head-512.png"),
  "couple-hero": require("@/assets/brand/couple-hero.png"),
};

const A11Y_LABELS: Record<BrandHeroVariant, string> = {
  "memora-fullbody": "Memora, the calm cyan companion",
  "memora-fullbody-dark": "Memora, the calm cyan companion",
  "memora-head": "Memora portrait",
  "memora-hero-chat": "Memora ready to chat",
  "sagous-fullbody": "Sagous, the warm amber spark",
  "sagous-fullbody-dark": "Sagous, the warm amber spark",
  "sagous-head": "Sagous portrait",
  "couple-hero": "Memora and Sagous together",
};

interface BrandHeroProps {
  variant: BrandHeroVariant;
  size?: number;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "contain" | "cover";
  accessibilityLabel?: string;
  decorative?: boolean;
}

/**
 * Photo-style brand assets (Memora / Sagous / couple). Distinct from
 * the vector `<MemCharacter />` which handles dynamic expressions and
 * lip-sync — use BrandHero for static reveal moments and emotional
 * anchors (onboarding MEET reveal, REFLECT close, home greeting,
 * subscription warmth, ai-guide empty state).
 *
 * Asset filenames keep the legacy `oc2co-*` prefix for Sagous art per
 * BRAND.md (the rename to sagous-* is pending). Variant names here
 * are the canonical ones.
 */
export function BrandHero({
  variant,
  size,
  style,
  resizeMode = "contain",
  accessibilityLabel,
  decorative = false,
}: BrandHeroProps) {
  const dim = size ? { width: size, height: size } : undefined;
  return (
    <View accessibilityRole="image" pointerEvents="none">
      <Image
        source={SOURCES[variant]}
        style={[dim, style]}
        resizeMode={resizeMode}
        accessible={!decorative}
        accessibilityLabel={
          decorative ? undefined : accessibilityLabel ?? A11Y_LABELS[variant]
        }
        accessibilityElementsHidden={decorative}
        importantForAccessibility={decorative ? "no-hide-descendants" : "yes"}
      />
    </View>
  );
}
