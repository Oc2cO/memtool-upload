import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./AuthContext";

interface SettingsContextType {
  soundEnabled: boolean;
  toggleSound: () => Promise<void>;
  /**
   * "Mute Mem" — silences the Mem coach reactions on the level
   * select + LevelResultOverlay surfaces (Task #324). Defaults to
   * false (Mem coach speaks) so first-run users hear the intro
   * reaction; persisted per-user alongside `soundEnabled` under
   * `settings_<email>`.
   */
  memMuted: boolean;
  toggleMemMuted: () => Promise<void>;
  /**
   * "High Contrast" — accessibility opt-in (Task #339). When true,
   * `useColors()` merges the `darkHighContrast` palette overrides on
   * top of the base dark palette so text and accent contrast jump up
   * into the comfortable end of the WCAG AA range. Persisted per-user
   * alongside `soundEnabled` so the preference survives a logout/login.
   * Default false (standard cosmic dark look).
   *
   * The Settings hook is exported as `SettingsContext` (in addition
   * to `useSettings`) so `useColors()` can read it via `useContext`
   * without throwing in components that mount outside the provider
   * (e.g. tests or +not-found.tsx).
   */
  highContrast: boolean;
  toggleHighContrast: () => Promise<void>;
  isLoading: boolean;
}

export const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [memMuted, setMemMuted] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      if (!user) {
        setSoundEnabled(true);
        setMemMuted(false);
        setHighContrast(false);
        setIsLoading(false);
        return;
      }
      try {
        const stored = await AsyncStorage.getItem(`settings_${user.email}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          setSoundEnabled(parsed.soundEnabled ?? true);
          setMemMuted(parsed.memMuted === true);
          setHighContrast(parsed.highContrast === true);
        } else {
          setSoundEnabled(true);
          setMemMuted(false);
          setHighContrast(false);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, [user]);

  const persist = async (next: {
    soundEnabled: boolean;
    memMuted: boolean;
    highContrast: boolean;
  }) => {
    if (!user) return;
    await AsyncStorage.setItem(
      `settings_${user.email}`,
      JSON.stringify(next),
    );
  };

  const toggleSound = async () => {
    if (!user) return;
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    await persist({ soundEnabled: newValue, memMuted, highContrast });
  };

  const toggleMemMuted = async () => {
    if (!user) return;
    const newValue = !memMuted;
    setMemMuted(newValue);
    await persist({ soundEnabled, memMuted: newValue, highContrast });
  };

  const toggleHighContrast = async () => {
    if (!user) return;
    const newValue = !highContrast;
    setHighContrast(newValue);
    await persist({ soundEnabled, memMuted, highContrast: newValue });
  };

  return (
    <SettingsContext.Provider
      value={{
        soundEnabled,
        toggleSound,
        memMuted,
        toggleMemMuted,
        highContrast,
        toggleHighContrast,
        isLoading,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
};
