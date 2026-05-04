/**
 * Wiring contract for Settings → "High Contrast" (Task #339).
 *
 * The toggle in Settings only matters if `useColors()` actually
 * returns the merged `darkHighContrast` palette when the flag flips.
 * A future refactor of `useColors` or `SettingsContext` could silently
 * disconnect them and we'd only learn from a user complaint, so we
 * pin the wiring here:
 *
 *   1. Inside a real `SettingsProvider`, calling `toggleHighContrast()`
 *      must change `foreground` / `mutedForeground` / `primary` from
 *      the base dark palette to the `darkHighContrast` overrides.
 *
 *   2. Without any provider mounted (the auth-screen / +not-found
 *      case), `useColors()` must fall back to the standard palette
 *      instead of throwing.
 */
import React from "react";
import { act, render } from "@testing-library/react-native";

import colors from "@/constants/colors";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import { useColors } from "@/hooks/useColors";

const mockAuthState: {
  current: { user: { email: string; id: string } | null };
} = {
  current: { user: { email: "hc@example.com", id: "user-hc" } },
};

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockAuthState.current.user,
    isLoading: false,
  }),
}));

type Captured = {
  colors: ReturnType<typeof useColors> | null;
  settings: ReturnType<typeof useSettings> | null;
};

function ProviderConsumer({ handle }: { handle: Captured }) {
  handle.colors = useColors();
  handle.settings = useSettings();
  return null;
}

function StandaloneConsumer({
  handle,
}: {
  handle: { colors: ReturnType<typeof useColors> | null };
}) {
  handle.colors = useColors();
  return null;
}

async function flush() {
  // SettingsProvider's hydrate effect resolves on the next microtask;
  // one flush is enough to settle it before assertions.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockAuthState.current = { user: { email: "hc@example.com", id: "user-hc" } };
});

describe("useColors() + SettingsContext High Contrast wiring (Task #339)", () => {
  test("flipping toggleHighContrast switches the returned palette to darkHighContrast", async () => {
    const handle: Captured = { colors: null, settings: null };
    render(
      <SettingsProvider>
        <ProviderConsumer handle={handle} />
      </SettingsProvider>,
    );
    await flush();

    expect(handle.colors).not.toBeNull();
    expect(handle.settings).not.toBeNull();

    // Standard palette before the flip.
    expect(handle.settings!.highContrast).toBe(false);
    expect(handle.colors!.foreground).toBe(colors.dark.foreground);
    expect(handle.colors!.mutedForeground).toBe(colors.dark.mutedForeground);
    expect(handle.colors!.primary).toBe(colors.dark.primary);

    await act(async () => {
      await handle.settings!.toggleHighContrast();
    });

    // High Contrast overrides now applied.
    expect(handle.settings!.highContrast).toBe(true);
    expect(handle.colors!.foreground).toBe(colors.darkHighContrast.foreground);
    expect(handle.colors!.mutedForeground).toBe(
      colors.darkHighContrast.mutedForeground,
    );
    expect(handle.colors!.primary).toBe(colors.darkHighContrast.primary);

    // Sanity: the HC values are actually different from the base ones,
    // so the assertions above can't pass by accident if the merge
    // becomes a no-op.
    expect(colors.darkHighContrast.foreground).not.toBe(
      colors.dark.foreground,
    );
    expect(colors.darkHighContrast.mutedForeground).not.toBe(
      colors.dark.mutedForeground,
    );
    expect(colors.darkHighContrast.primary).not.toBe(colors.dark.primary);
  });

  test("returns the standard palette when no SettingsProvider is mounted", () => {
    const handle: { colors: ReturnType<typeof useColors> | null } = {
      colors: null,
    };
    render(<StandaloneConsumer handle={handle} />);

    expect(handle.colors).not.toBeNull();
    expect(handle.colors!.foreground).toBe(colors.dark.foreground);
    expect(handle.colors!.mutedForeground).toBe(colors.dark.mutedForeground);
    expect(handle.colors!.primary).toBe(colors.dark.primary);
    expect(handle.colors!.radius).toBe(colors.radius);
  });
});
