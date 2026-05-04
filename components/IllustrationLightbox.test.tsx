/**
 * Coverage for the lightbox confirmation alerts (Task #210).
 *
 * The lightbox surfaces "Regenerate" and "Remove" buttons that each
 * gate their action behind a destructive-style confirmation alert
 * before firing. The contract this suite locks in:
 *
 *   1. Tapping Regenerate fires `Alert.alert` with the regenerate
 *      title/copy + Cancel/Regenerate buttons; pressing Regenerate
 *      calls `onClose` BEFORE `onRegenerate` so the parent's loading
 *      state owns the visual transition (the lightbox itself does
 *      not block on the regen).
 *   2. Tapping Remove fires the matching destructive alert; pressing
 *      Remove also calls `onClose` BEFORE `onRemove`.
 *   3. When `busy` is true, both action buttons short-circuit before
 *      `Alert.alert` fires (so a stale double-tap from a previous
 *      surface can't burn a daily slot or wipe the painting twice),
 *      and both render with `accessibilityState.disabled=true` so
 *      assistive tech reflects the locked-out state.
 *
 * Without these, a future refactor that flipped the order to
 * "fire callback then close" or that forgot to honor `busy`
 * could ship a regression that only the user notices at runtime.
 */

import React from "react";
import { Alert } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

// Stub useColors to a deterministic palette so we don't have to
// boot the appearance machinery for an interaction test.
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#222",
    border: "#ccc",
    primary: "#007aff",
    primaryForeground: "#fff",
    mutedForeground: "#888",
  }),
}));

// react-native-safe-area-context isn't wired through the test
// renderer; a static stub keeps useSafeAreaInsets() resolving.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// expo-image's native <Image> doesn't render in jest-expo; swap it
// for a plain <View> so the lightbox's frame mounts. We don't need
// to assert on the image itself (covered in IllustrationPolaroid.test).
jest.mock("expo-image", () => {
  const ReactActual = require("react");
  const { View } = require("react-native");
  return {
    Image: (props: { accessibilityLabel?: string }) =>
      ReactActual.createElement(View, {
        testID: "lightbox-image",
        accessibilityLabel: props.accessibilityLabel,
      }),
  };
});

// @expo/vector-icons' Icon resolves the icon font asynchronously,
// which fires a setState after the test body returns and triggers
// a noisy "not wrapped in act(...)" warning. We don't assert on
// glyph contents — swap for a static stub so the icons render
// synchronously and the warnings stay out of the test output.
jest.mock("@expo/vector-icons", () => {
  const ReactActual = require("react");
  const { View } = require("react-native");
  const Stub = (props: { name?: string }) =>
    ReactActual.createElement(View, { testID: `icon-${props.name ?? ""}` });
  return { Ionicons: Stub };
});

import { IllustrationLightbox } from "./IllustrationLightbox";

type AlertButton = {
  text?: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

type AlertCall = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
};

function lastAlert(spy: jest.SpyInstance): AlertCall {
  const call = spy.mock.calls[spy.mock.calls.length - 1] as
    | [string, string?, AlertButton[]?]
    | undefined;
  if (!call) throw new Error("Alert.alert was not called");
  return { title: call[0], message: call[1], buttons: call[2] };
}

function findButton(buttons: AlertButton[] | undefined, text: string): AlertButton {
  const btn = buttons?.find((b) => b.text === text);
  if (!btn) throw new Error(`Alert button "${text}" not found`);
  return btn;
}

describe("IllustrationLightbox — Regenerate / Remove confirmation alerts (Task #210)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("Regenerate tap → confirmation alert; pressing Regenerate calls onClose BEFORE onRegenerate", () => {
    const calls: string[] = [];
    const onClose = jest.fn(() => calls.push("close"));
    const onRegenerate = jest.fn(() => calls.push("regenerate"));

    const view = render(
      <IllustrationLightbox
        visible
        imageUrl="http://example.com/img.png"
        caption="quiet morning"
        onClose={onClose}
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.press(view.getByLabelText("Regenerate illustration"));

    // The alert must fire with the regenerate title — copy locked
    // in here so a future tweak that drops the "Regenerate" wording
    // (and turns the destructive confirm into a silent re-roll) is
    // caught before it ships.
    const alert = lastAlert(alertSpy);
    // Verbatim copy lock-in: a future tweak that drops the
    // "Regenerate" wording (or softens the slot warning into
    // something less explicit) MUST be a deliberate test update,
    // not an accidental string drift.
    expect(alert.title).toBe("Regenerate illustration?");
    expect(alert.message).toBe(
      "This will use one of your daily illustration slots and replace the current painting.",
    );

    const cancel = findButton(alert.buttons, "Cancel");
    expect(cancel.style).toBe("cancel");
    const confirm = findButton(alert.buttons, "Regenerate");
    expect(confirm.style).toBe("default");

    // Pre-condition: neither callback has fired just from opening
    // the alert — only confirm should trigger them.
    expect(onClose).not.toHaveBeenCalled();
    expect(onRegenerate).not.toHaveBeenCalled();

    // Cancel path: pressing Cancel must NOT fire either parent
    // callback. This is the core safety net — if a future refactor
    // wires the cancel button to a no-op that still closes (or
    // worse, still re-rolls), the user's daily quota slot would
    // burn on a stray tap.
    cancel.onPress?.();
    expect(onClose).not.toHaveBeenCalled();
    expect(onRegenerate).not.toHaveBeenCalled();

    confirm.onPress?.();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    // Order matters: the parent owns the loading state during the
    // re-roll, so the lightbox MUST close first or the user sees
    // the old painting until the regen resolves.
    expect(calls).toEqual(["close", "regenerate"]);
  });

  test("Remove tap → destructive confirmation alert; pressing Remove calls onClose BEFORE onRemove", () => {
    const calls: string[] = [];
    const onClose = jest.fn(() => calls.push("close"));
    const onRemove = jest.fn(() => calls.push("remove"));

    const view = render(
      <IllustrationLightbox
        visible
        imageUrl="http://example.com/img.png"
        caption="quiet morning"
        onClose={onClose}
        onRemove={onRemove}
      />,
    );

    fireEvent.press(view.getByLabelText("Remove illustration"));

    const alert = lastAlert(alertSpy);
    // Important contract: removing must NOT promise a refund — if
    // this copy ever changes to "and refund your slot" the server
    // contract (which deliberately doesn't refund) would lie to
    // the user. Verbatim equality so any drift is a deliberate
    // test update.
    expect(alert.title).toBe("Remove illustration?");
    expect(alert.message).toBe(
      "This won't refund your daily illustration slot.",
    );

    const cancel = findButton(alert.buttons, "Cancel");
    expect(cancel.style).toBe("cancel");
    const confirm = findButton(alert.buttons, "Remove");
    expect(confirm.style).toBe("destructive");

    expect(onClose).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();

    // Cancel path: a stray tap into the destructive confirm must
    // be fully recoverable — pressing Cancel cannot wipe the
    // polaroid or close the lightbox.
    cancel.onPress?.();
    expect(onClose).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();

    confirm.onPress?.();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    // Same close-then-callback ordering as Regenerate, for the same
    // reason: the parent's "Removing…" state owns the transition.
    expect(calls).toEqual(["close", "remove"]);
  });

  test("busy=true short-circuits both action presses (no alert) and surfaces accessibilityState.disabled", () => {
    const onClose = jest.fn();
    const onRegenerate = jest.fn();
    const onRemove = jest.fn();

    const view = render(
      <IllustrationLightbox
        visible
        imageUrl="http://example.com/img.png"
        caption="quiet morning"
        onClose={onClose}
        onRegenerate={onRegenerate}
        onRemove={onRemove}
        busy
      />,
    );

    const regenBtn = view.getByLabelText("Regenerate illustration");
    const removeBtn = view.getByLabelText("Remove illustration");

    // Assistive tech surface: both buttons must report disabled so a
    // VoiceOver user can't accidentally fire a re-roll while one is
    // already in flight from another surface.
    expect(regenBtn.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    expect(removeBtn.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );

    fireEvent.press(regenBtn);
    fireEvent.press(removeBtn);

    // No alert and no action callbacks — `busy` is the lock-out.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
