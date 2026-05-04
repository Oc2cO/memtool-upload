/**
 * MemTool typography tokens.
 *
 * Each entry bundles `fontSize`, `fontWeight`, and `fontFamily` so a
 * style can spread the whole token in one go:
 *
 *   <Text style={[text.body, { color: colors.foreground }]}>…</Text>
 *
 * Always pair the weight with the matching `Inter_*` family — React
 * Native on Android does not auto-substitute weights, so a bare
 * `fontWeight: "700"` without `fontFamily: "Inter_700Bold"` falls back
 * to the system font and looks visibly different from the rest of the
 * app.
 *
 * Line height and letterSpacing are intentionally NOT baked in here.
 * Different surfaces want different rhythm (e.g. recap body uses
 * `lineHeight: 28` for a 16pt body, fact card uses `20`), so callers
 * still apply those locally. The token guarantees size + weight +
 * family agree.
 */
import type { TextStyle } from "react-native";

const FONT_FAMILY = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

type TypographyToken = Pick<TextStyle, "fontSize" | "fontWeight" | "fontFamily">;

export const text = {
  /** App / brand wordmark only. 42 / 700. */
  brand: {
    fontSize: 42,
    fontWeight: "700",
    fontFamily: FONT_FAMILY.bold,
  },
  /** Largest in-screen title (Settings header, Home name). 28 / 700. */
  screenTitle: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: FONT_FAMILY.bold,
  },
  /** Card-level title (Quick Capture, onboarding tagline). 24 / 700. */
  cardTitle: {
    fontSize: 24,
    fontWeight: "700",
    fontFamily: FONT_FAMILY.bold,
  },
  /** Section heading inside a screen ("Train Your Mind"). 20 / 600. */
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    fontFamily: FONT_FAMILY.semibold,
  },
  /** Result / recap title, empty-state title. 18 / 700. */
  cardHeading: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: FONT_FAMILY.bold,
  },
  /** Modal / capture screen title, profile email. 18 / 600. */
  cardLabel: {
    fontSize: 18,
    fontWeight: "600",
    fontFamily: FONT_FAMILY.semibold,
  },
  /** Standard body copy. 16 / 400. */
  body: {
    fontSize: 16,
    fontWeight: "400",
    fontFamily: FONT_FAMILY.regular,
  },
  /** Body emphasised (greeting, nav-card title, settings row title). 16 / 500. */
  bodyMedium: {
    fontSize: 16,
    fontWeight: "500",
    fontFamily: FONT_FAMILY.medium,
  },
  /** Body emphasised stronger (Save buttons, secondary CTA labels). 16 / 600. */
  bodySemibold: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: FONT_FAMILY.semibold,
  },
  /** Helper / metadata default. 14 / 500. */
  helper: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: FONT_FAMILY.medium,
  },
  /** Helper regular (fact card, suggestion text). 14 / 400. */
  helperRegular: {
    fontSize: 14,
    fontWeight: "400",
    fontFamily: FONT_FAMILY.regular,
  },
  /** Caption (settings row subtitle, very small text). 12 / 400. */
  caption: {
    fontSize: 12,
    fontWeight: "400",
    fontFamily: FONT_FAMILY.regular,
  },
  /** Strong caption — section labels (THIS MONTH), badge text. 12 / 600. */
  captionStrong: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: FONT_FAMILY.semibold,
  },
  /** Tiny — chart axis labels only. 10 / 400. */
  tiny: {
    fontSize: 10,
    fontWeight: "400",
    fontFamily: FONT_FAMILY.regular,
  },
} satisfies Record<string, TypographyToken>;

export const fontFamily = FONT_FAMILY;

export type TextToken = keyof typeof text;
