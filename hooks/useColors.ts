import { useContext } from "react";
import { useColorScheme } from "react-native";

import colors from "@/constants/colors";
import { SettingsContext } from "@/context/SettingsContext";

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * If the user has flipped Settings → "High Contrast" (Task #339), the
 * `darkHighContrast` overrides are merged on top of the base dark
 * palette. We read the SettingsContext directly (instead of via
 * `useSettings`) so this hook is safe to call from screens/components
 * mounted outside the SettingsProvider — tests in particular don't
 * always wrap with the full provider tree, and a missing provider
 * should mean "standard contrast", never a runtime crash.
 */
export function useColors() {
  const scheme = useColorScheme();
  const settings = useContext(SettingsContext);

  const base =
    scheme === "dark" && "dark" in colors
      ? ((colors as unknown as Record<string, typeof colors.light>).dark ??
        colors.light)
      : colors.light;

  const palette =
    settings?.highContrast === true
      ? mergeHighContrast(base, colors.darkHighContrast)
      : base;

  return { ...palette, radius: colors.radius };
}

function mergeHighContrast(
  base: typeof colors.light,
  hc: typeof colors.darkHighContrast,
): typeof colors.light {
  return {
    ...base,
    ...hc,
    onboarding: { ...base.onboarding, ...(hc.onboarding ?? {}) },
  } as typeof colors.light;
}
