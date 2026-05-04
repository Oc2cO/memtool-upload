/**
 * MemTool design tokens — dark-first, purple-to-teal accent system.
 *
 * Two palettes ship: `dark` (the default cosmic look) and `darkHighContrast`
 * (a nudged variant for users who flip "High Contrast" in Settings — see
 * Task #339). Both share the brand identity (cosmic navy backdrop, purple
 * primary, teal accent) but the HC palette pushes text toward the brighter
 * end of the safe range and bumps accent saturation only where the standard
 * palette sits close to the WCAG AA floor on glassmorphic surfaces.
 *
 * The audit that produced these values lives at
 * `artifacts/memtool/docs/ACCESSIBILITY_AUDIT.md`.
 */

const dark = {
  // Cosmic navy — the canonical BRAND.md "Base" token. Aligning the
  // in-code background with the brand bible keeps marketing screenshots
  // and the live app visually identical.
  background: "#0A0F1E",
  // Soft off-white instead of pure #FFFFFF — pure white on near-black is
  // fatiguing over a long session (see ACCESSIBILITY_AUDIT.md). #f5f3ff
  // tests at ~17:1 against `background` and ~15:1 against `card`,
  // well above the 4.5:1 AA floor.
  foreground: "#f5f3ff",

  card: "#15102a",
  cardForeground: "#f5f3ff",

  // Brand "Secondary glow" violet from BRAND.md. Tests at 5.7:1 on the
  // cosmic navy background — clears WCAG AA for normal text.
  primary: "#9B7AE8",
  primaryForeground: "#0A0F1E",

  // Primary action (CTA) fill — the colour rendered by `GradientButton`'s
  // primary variant, the home screen's Quick Capture, and any other
  // "main button on a screen" surface. Kept distinct from `primary`
  // (the brand purple used as an accent / icon colour) on purpose:
  //   - `primary` answers "what's our brand colour?"  (purple)
  //   - `primaryAction` answers "what colour is the primary CTA?" (blue)
  // Promoting the blue out of GradientButton.tsx into the token file
  // makes this the single source of truth — no screen should hardcode
  // these hex values.
  primaryAction: "#5266eb",
  primaryActionPressed: "#4354c8",

  secondary: "#1f1740",
  secondaryForeground: "#e9e4ff",

  muted: "#1a1430",
  mutedForeground: "#9ca0c2",

  // Brand "Primary glow" cyan from BRAND.md (Memora's signature). Tests
  // at 12.2:1 on the cosmic navy background — well above WCAG AAA.
  accent: "#00E5FF",
  accentForeground: "#0A0F1E",

  destructive: "#f87171",
  destructiveForeground: "#0A0F1E",

  border: "#241a47",
  input: "#1a1430",

  /**
   * Onboarding-only palette. The first-run experience deliberately
   * uses warmer, more saturated colours than the rest of the app
   * ("organized chaos"). They live here so onboarding screens stop
   * defining a local PALETTE object and so future onboarding-style
   * surfaces (e.g. a re-onboard from settings) can reuse them.
   */
  onboarding: {
    bg: "#0A0F1E",
    bgDeep: "#050811",
    mem: "#FFD56F",
    hot: "#B47AFF",
    cool: "#6FE5FF",
    pink: "#FF8FB1",
    text: "#F4EEFF",
    textMuted: "#9B91B5",
    card: "rgba(180, 122, 255, 0.10)",
    border: "rgba(180, 122, 255, 0.25)",
  },
};

/**
 * High-contrast variant. Only the values that change from `dark` are
 * listed here; `useColors()` merges this on top of the base palette
 * when the user flips Settings → "High Contrast". The goal is **not**
 * a different brand — it's a small nudge that:
 *   - lifts muted secondary text out of the borderline 4.5:1 zone,
 *   - bumps accent/primary saturation so cyan/purple stay readable
 *     even on the most translucent glassmorphic surfaces,
 *   - tightens border contrast so card edges remain visible to users
 *     with low contrast sensitivity.
 */
type DarkPalette = typeof dark;
type HighContrastOverrides = {
  [K in keyof DarkPalette]?: K extends "onboarding"
    ? Partial<DarkPalette["onboarding"]>
    : DarkPalette[K];
};

const darkHighContrast: HighContrastOverrides = {
  // Push body text the rest of the way to near-white. Stops just short
  // of #FFFFFF to avoid the bloom that pure white has on OLED.
  foreground: "#FAFAFF",
  cardForeground: "#FAFAFF",
  // Lift muted text from ~7.5:1 to ~10.5:1 against the cosmic
  // background, well above AA for body copy.
  mutedForeground: "#C8CCE6",
  // Brighter, more saturated brand purple — still recognisably the
  // same hue, but ~9:1 on `card` instead of ~7:1.
  primary: "#C0AFFF",
  // Brighter teal accent so chip/tag text stays readable on the most
  // translucent glass cards.
  accent: "#7DF3DD",
  // Visible borders — the standard #241a47 disappears on bright
  // ambient light; #3A2F70 keeps card edges legible.
  border: "#3A2F70",
  secondaryForeground: "#FAFAFF",
  destructive: "#FF8A8A",
  onboarding: {
    text: "#FFFFFF",
    textMuted: "#C8C0DC",
    hot: "#C99CFF",
    cool: "#9CF0FF",
    pink: "#FFA9C2",
    border: "rgba(180, 122, 255, 0.40)",
  },
};

const colors = {
  light: dark,
  dark,
  darkHighContrast,
  radius: 16,
};

export type Palette = typeof dark;
export default colors;
