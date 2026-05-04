/**
 * MemTool spacing & radius tokens.
 *
 * The numbers here are exactly the ones already in use across the app
 * — extracting them just gives the values names so screens can stop
 * sprinkling magic numbers and so cross-screen drift becomes visible
 * (any new spacing value that isn't in this scale is a smell).
 *
 *   spacing.lg          // 24
 *   borderRadius: radius.md  // 16
 *
 * Scale: 4 / 8 / 12 / 16 / 24 / 32 — the "T-shirt sizes" most React
 * Native apps converge on. Anything outside this scale should either
 * be a deliberate one-off (and commented as such) or get added here.
 */
export const spacing = {
  /** 4 — hairline gap, icon padding inside a button. */
  xs: 4,
  /** 8 — tight stack (icon ↔ label, badge ↔ chip). */
  sm: 8,
  /** 12 — compact row gap. */
  md: 12,
  /** 16 — default card padding, default vertical rhythm. */
  base: 16,
  /** 20 — slightly larger card padding (suggestion / group cards). */
  lgCard: 20,
  /** 24 — outer screen padding, large card padding. */
  lg: 24,
  /** 28 — between major regions. */
  xlTight: 28,
  /** 32 — between major regions, large empty-state breathing room. */
  xl: 32,
} as const;

export const radius = {
  /** 12 — small/list-style controls (chips, tab segments, recent rows). */
  sm: 12,
  /** 16 — standard card border radius. */
  md: 16,
  /** 24 — large feature cards (capture, recap result, wellness). */
  lg: 24,
} as const;

export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radius;
