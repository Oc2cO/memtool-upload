import React, { useEffect } from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

import {
  __resetHapticMutePrefsForTests,
  setHapticMuted,
  setHapticsMasterEnabled,
} from "./preferences";
import { useHaptic, useHaptics } from "./useHaptic";

function PlayOnMount({
  name,
  ignoreMute,
}: {
  name: Parameters<typeof useHaptic>[0];
  ignoreMute?: boolean;
}) {
  const haptic = useHaptic(name);
  useEffect(() => {
    haptic.play(ignoreMute ? { ignoreMute: true } : undefined);
  }, [haptic, ignoreMute]);
  return <Text>{name}</Text>;
}

describe("useHaptic", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Haptics.impactAsync as jest.Mock).mockClear();
    (Haptics.selectionAsync as jest.Mock).mockClear();
    __resetHapticMutePrefsForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("plays the named pattern when .play() is called", () => {
    render(<PlayOnMount name="capture" />);
    jest.runAllTimers();
    expect(Haptics.impactAsync).toHaveBeenCalled();
  });

  it("cancels pending events when the component unmounts", () => {
    const view = render(<PlayOnMount name="day-recap-ready" />);
    view.unmount();
    jest.runAllTimers();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it("useHaptics().play(name) plays multiple distinct signatures", () => {
    function Multi() {
      const haptics = useHaptics();
      useEffect(() => {
        haptics.play("capture");
        haptics.play("error");
      }, [haptics]);
      return <Text>multi</Text>;
    }
    render(<Multi />);
    jest.runAllTimers();
    // capture (2 transients) + error (2 transients) = 4 impactAsync calls
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(4);
  });

  // ---- Per-signature mute gating (Task #243) ----------------------

  it("skips playback when the signature has been muted via setHapticMuted", async () => {
    // Mute synchronously so the next play() consults the live cache.
    void setHapticMuted("capture", true);
    render(<PlayOnMount name="capture" />);
    jest.runAllTimers();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("only mutes the targeted signature — other patterns still play", async () => {
    void setHapticMuted("error", true);
    function Both() {
      const haptics = useHaptics();
      useEffect(() => {
        haptics.play("error");
        haptics.play("capture");
      }, [haptics]);
      return <Text>both</Text>;
    }
    render(<Both />);
    jest.runAllTimers();
    // error (muted, 0 calls) + capture (2 transients) = 2 impactAsync calls
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  });

  it("ignoreMute: true bypasses the gate so the demo can re-play a disabled signature", async () => {
    void setHapticMuted("capture", true);
    render(<PlayOnMount name="capture" ignoreMute />);
    jest.runAllTimers();
    // The mute is honoured for normal play() but explicitly bypassed
    // for the Settings demo so users can re-evaluate before turning
    // a signature back on.
    expect(Haptics.impactAsync).toHaveBeenCalled();
  });

  // ---- Master switch gate (Task #252) ----------------------------

  it("skips playback for every signature when the master switch is off", () => {
    // setHapticsMasterEnabled flips the in-memory cache synchronously
    // — same contract as setHapticMuted — so the very next play()
    // already sees it.
    void setHapticsMasterEnabled(false);
    function Many() {
      const haptics = useHaptics();
      useEffect(() => {
        haptics.play("capture");
        haptics.play("error");
        haptics.play("undo");
      }, [haptics]);
      return <Text>many</Text>;
    }
    render(<Many />);
    jest.runAllTimers();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it("ignoreMute: true bypasses the master gate too — the demo can still preview when haptics are off", () => {
    // Acceptance criterion: a user who's just disabled haptics
    // app-wide must still be able to feel a signature from the
    // "Try a haptic" demo so they can re-evaluate before flipping
    // the master back on. The demo passes ignoreMute:true; the gate
    // honours it for both the per-signature mute AND the master.
    void setHapticsMasterEnabled(false);
    render(<PlayOnMount name="capture" ignoreMute />);
    jest.runAllTimers();
    expect(Haptics.impactAsync).toHaveBeenCalled();
  });

  it("re-enabling the master switch lets play() fire again without remounting", () => {
    void setHapticsMasterEnabled(false);
    function Toggle() {
      const haptics = useHaptics();
      useEffect(() => {
        haptics.play("undo"); // master off — skipped
        void setHapticsMasterEnabled(true);
        haptics.play("undo"); // master back on — plays
      }, [haptics]);
      return <Text>master-toggle</Text>;
    }
    render(<Toggle />);
    jest.runAllTimers();
    // Undo's transient is impactAsync; seeing exactly one proves
    // the gate let only the second call through.
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it("master OFF wins over a signature being unmuted — composes with the per-signature gate", () => {
    // Both gates can independently silence a pattern. With the
    // master off and no per-signature mute set, the master must
    // still skip the play.
    void setHapticsMasterEnabled(false);
    render(<PlayOnMount name="capture" />);
    jest.runAllTimers();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("master ON + signature muted still skips that one signature — per-signature mutes survive a master toggle", () => {
    // Sanity-check the composition the other direction: re-enabling
    // the master must NOT silently un-mute individual signatures
    // the user previously disabled.
    void setHapticMuted("capture", true);
    void setHapticsMasterEnabled(true);
    render(<PlayOnMount name="capture" />);
    jest.runAllTimers();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("re-enabling a signature lets play() fire again without remounting", () => {
    // setHapticMuted updates the in-memory cache synchronously
    // (before AsyncStorage resolves), so we can mute → play → unmute
    // → play in a single tick and prove the gate consults the live
    // cache on every call instead of capturing a stale value.
    void setHapticMuted("undo", true);
    function Toggle() {
      const haptics = useHaptics();
      useEffect(() => {
        haptics.play("undo"); // muted — skipped
        void setHapticMuted("undo", false);
        haptics.play("undo"); // unmuted — plays
      }, [haptics]);
      return <Text>toggle</Text>;
    }
    render(<Toggle />);
    jest.runAllTimers();
    // The first play() (muted) must produce zero events; the second
    // play() (unmuted) plays the undo pattern. Undo's transient is
    // the only impactAsync emitted, so seeing exactly one is proof
    // the gate let the unmuted call through and *only* that one.
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect((Haptics.selectionAsync as jest.Mock).mock.calls.length)
      .toBeGreaterThan(0);
  });
});
