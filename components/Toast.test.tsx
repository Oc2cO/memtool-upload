import React from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { render } from "@testing-library/react-native";

import { Toast } from "./Toast";

// useSafeAreaInsets() pulls from a context that isn't installed in
// these tests. The real value doesn't influence anything we assert on
// — the announcement effect doesn't depend on insets — so a static
// stub is enough to let the component mount.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The four real toast messages the Archive screen shows when the
// user-triggered "Sync all" pass finishes. If these strings drift,
// the Archive call sites have changed and this test should be
// updated alongside them.
const ARCHIVE_TOAST_MESSAGES = [
  "All 5 memories synced",
  "3 of 5 synced — 2 still pending",
  "Still offline — 2 memories pending",
  "Still offline — try again later",
] as const;

// The real toast messages the Capture (`app/(app)/capture.tsx`) and
// Log-a-call (`app/(app)/log-call.tsx`) screens show after a
// successful save or an offline save. VoiceOver/TalkBack users rely
// on these confirmations just like the Archive sync ones, so we lock
// the exact strings in here. If these drift, the capture/log-call
// call sites have changed and this list should be updated alongside
// them.
const CAPTURE_AND_LOG_CALL_TOAST_MESSAGES = [
  "Captured!",
  "Call logged",
  "Saved offline — will sync when reconnected",
] as const;

function setPlatformOS(os: "ios" | "android") {
  // jest.replaceProperty restores automatically between tests via the
  // restoreMocks behaviour of jest-expo's preset, but we also defend
  // against drift by resetting in afterEach below.
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    get: () => os,
  });
}

describe("Toast accessibility announcements", () => {
  let announceSpy: jest.SpyInstance;
  const originalOS = Platform.OS;

  beforeEach(() => {
    announceSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    announceSpy.mockRestore();
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      get: () => originalOS,
    });
  });

  describe("iOS VoiceOver announcement", () => {
    beforeEach(() => {
      setPlatformOS("ios");
    });

    test.each(ARCHIVE_TOAST_MESSAGES)(
      "announces %p exactly once when the toast becomes visible",
      (message) => {
        const view = render(
          <Toast message={message} visible={false} />,
        );
        // Mounting hidden must not announce — VoiceOver users would
        // hear ghost messages every time the screen mounts otherwise.
        expect(announceSpy).not.toHaveBeenCalled();

        view.rerender(<Toast message={message} visible={true} />);

        expect(announceSpy).toHaveBeenCalledTimes(1);
        expect(announceSpy).toHaveBeenCalledWith(message);
      },
    );

    test.each(CAPTURE_AND_LOG_CALL_TOAST_MESSAGES)(
      "announces capture/log-call message %p exactly once when the toast becomes visible",
      (message) => {
        // Same contract as the Archive messages above — we re-assert
        // it for the capture and log-call confirmation strings so a
        // future copy change or call-site refactor on those screens
        // can't silently drop the VoiceOver announcement.
        const view = render(
          <Toast message={message} visible={false} />,
        );
        expect(announceSpy).not.toHaveBeenCalled();

        view.rerender(<Toast message={message} visible={true} />);

        expect(announceSpy).toHaveBeenCalledTimes(1);
        expect(announceSpy).toHaveBeenCalledWith(message);
      },
    );

    test("re-rendering with the same (visible, message) does not re-announce", () => {
      const view = render(
        <Toast message="All 5 memories synced" visible={true} />,
      );
      expect(announceSpy).toHaveBeenCalledTimes(1);

      // Simulate an unrelated re-render (e.g. parent state change,
      // theme flip, safe-area update). The dep array includes
      // insets.top so this exercises the guard ref.
      view.rerender(
        <Toast message="All 5 memories synced" visible={true} />,
      );
      view.rerender(
        <Toast message="All 5 memories synced" visible={true} />,
      );

      expect(announceSpy).toHaveBeenCalledTimes(1);
    });

    test("swapping message while visible stays true triggers a fresh announcement", () => {
      const view = render(
        <Toast
          message="3 of 5 synced — 2 still pending"
          visible={true}
        />,
      );
      expect(announceSpy).toHaveBeenCalledTimes(1);
      expect(announceSpy).toHaveBeenLastCalledWith(
        "3 of 5 synced — 2 still pending",
      );

      // The Archive screen fires this exact pattern when one sync
      // pass's toast is still on screen and the next pass finishes.
      // Without a fresh announcement, the second outcome is silent
      // for VoiceOver users.
      view.rerender(
        <Toast
          message="Still offline — 2 memories pending"
          visible={true}
        />,
      );

      expect(announceSpy).toHaveBeenCalledTimes(2);
      expect(announceSpy).toHaveBeenLastCalledWith(
        "Still offline — 2 memories pending",
      );
    });

    test("hiding then re-showing the same message announces again", () => {
      const view = render(
        <Toast message="All 5 memories synced" visible={true} />,
      );
      expect(announceSpy).toHaveBeenCalledTimes(1);

      view.rerender(
        <Toast message="All 5 memories synced" visible={false} />,
      );
      view.rerender(
        <Toast message="All 5 memories synced" visible={true} />,
      );

      expect(announceSpy).toHaveBeenCalledTimes(2);
      expect(announceSpy).toHaveBeenLastCalledWith(
        "All 5 memories synced",
      );
    });

    test("an empty message does not announce even when visible flips true", () => {
      // The toast container is initialised with message: "" before
      // the first real sync outcome — we shouldn't announce a blank
      // string to VoiceOver.
      const view = render(<Toast message="" visible={false} />);
      view.rerender(<Toast message="" visible={true} />);
      expect(announceSpy).not.toHaveBeenCalled();
    });
  });

  describe("Android live region", () => {
    // accessibilityLiveRegion is the Android-only equivalent of
    // VoiceOver's announce call. We assert the prop independent of
    // Platform.OS because RN sets the prop on the view tree
    // unconditionally and TalkBack reads it on Android devices.
    beforeEach(() => {
      setPlatformOS("android");
    });

    test.each(ARCHIVE_TOAST_MESSAGES)(
      "renders accessibilityLiveRegion='polite' while visible for %p",
      (message) => {
        const view = render(<Toast message={message} visible={true} />);
        const alert = view.getByRole("alert");
        expect(alert.props.accessibilityLiveRegion).toBe("polite");
        expect(alert.props.accessibilityLabel).toBe(message);
      },
    );

    test.each(CAPTURE_AND_LOG_CALL_TOAST_MESSAGES)(
      "renders accessibilityLiveRegion='polite' while visible for capture/log-call message %p",
      (message) => {
        // TalkBack picks up these capture/log-call confirmations via
        // the live region, so we lock the prop alongside the exact
        // copy string to guard against silent regressions on those
        // screens.
        const view = render(<Toast message={message} visible={true} />);
        const alert = view.getByRole("alert");
        expect(alert.props.accessibilityLiveRegion).toBe("polite");
        expect(alert.props.accessibilityLabel).toBe(message);
      },
    );

    test("renders accessibilityLiveRegion='none' while hidden", () => {
      const view = render(
        <Toast message="All 5 memories synced" visible={false} />,
      );
      // While hidden the toast also sets
      // importantForAccessibility="no-hide-descendants", which causes
      // the default react-native-testing-library queries to hide the
      // node. We opt into hidden elements explicitly so we can assert
      // the live-region prop is correctly downgraded.
      const alert = view.getByRole("alert", { includeHiddenElements: true });
      expect(alert.props.accessibilityLiveRegion).toBe("none");
    });

    test("flipping visible flips the live region prop on the same view", () => {
      const view = render(
        <Toast message="All 5 memories synced" visible={false} />,
      );
      expect(
        view.getByRole("alert", { includeHiddenElements: true }).props
          .accessibilityLiveRegion,
      ).toBe("none");

      view.rerender(
        <Toast message="All 5 memories synced" visible={true} />,
      );
      expect(
        view.getByRole("alert", { includeHiddenElements: true }).props
          .accessibilityLiveRegion,
      ).toBe("polite");

      view.rerender(
        <Toast message="All 5 memories synced" visible={false} />,
      );
      expect(
        view.getByRole("alert", { includeHiddenElements: true }).props
          .accessibilityLiveRegion,
      ).toBe("none");
    });
  });

  describe("non-iOS platforms skip the announce call", () => {
    test("Android does not call AccessibilityInfo.announceForAccessibility", () => {
      setPlatformOS("android");
      const view = render(
        <Toast message="All 5 memories synced" visible={false} />,
      );
      view.rerender(
        <Toast message="All 5 memories synced" visible={true} />,
      );
      // TalkBack picks the toast up via accessibilityLiveRegion, not
      // via the iOS announce API. Calling announceForAccessibility on
      // Android would double-speak the message.
      expect(announceSpy).not.toHaveBeenCalled();
    });
  });
});
