import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { act, render, fireEvent } from "@testing-library/react-native";

import { useHandleRestore } from "./useHandleRestore";

// `useHaptic(name)` returns a `HapticPlayer` shaped like `{ play }` —
// mocking it as a bare function (the previous `jest.fn(() => jest.fn())`)
// made `captureHaptic.play()` / `errorHaptic.play()` blow up with
// "play is not a function". Return the right shape so the success and
// error branches of the hook can fire haptics under test.
jest.mock("./haptics", () => ({
  useHaptic: jest.fn(() => ({ play: jest.fn() })),
}));
import {
  RESTORE_GENERIC_ERROR_MESSAGE,
  RESTORE_NO_ENTITLEMENT_MESSAGE,
  RESTORE_NOT_CONFIGURED_MESSAGE,
  type RestoreOutcome,
} from "./restoreFlow";

interface HostProps {
  paymentsConfigured: boolean | null;
  outcome: RestoreOutcome;
  onPaymentsConfiguredChange?: (next: boolean) => void;
  onRefresh?: () => void;
}

function Host({
  paymentsConfigured,
  outcome,
  onPaymentsConfiguredChange,
  onRefresh,
}: HostProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [livePaymentsConfigured, setLivePaymentsConfigured] = useState<
    boolean | null
  >(paymentsConfigured);

  const handleRestore = useHandleRestore({
    paymentsConfigured: livePaymentsConfigured,
    setPaymentsConfigured: (next: boolean) => {
      setLivePaymentsConfigured(next);
      onPaymentsConfiguredChange?.(next);
    },
    refresh: () => {
      onRefresh?.();
    },
    setActionError,
    setActionPending,
    setRestoreSuccess,
    actionPending,
    runFlow: async () => outcome,
  });

  return (
    <View>
      <Pressable onPress={handleRestore} accessibilityLabel="Run restore">
        <Text>Run restore</Text>
      </Pressable>
      {actionError !== null && (
        <Text testID="action-error">{actionError}</Text>
      )}
      {restoreSuccess && (
        <Text testID="success-banner">Purchases restored successfully</Text>
      )}
      <Text testID="pending">{actionPending ? "pending" : "idle"}</Text>
    </View>
  );
}

async function tapAndFlush(
  getByLabelText: ReturnType<typeof render>["getByLabelText"],
) {
  await act(async () => {
    fireEvent.press(getByLabelText("Run restore"));
  });
}

describe("useHandleRestore — renders the right inline message per branch", () => {
  test("success_pro → shows success banner, no error text", async () => {
    const refresh = jest.fn();
    const setPaymentsConfigured = jest.fn();
    const view = render(
      <Host
        paymentsConfigured={null}
        outcome={{ kind: "success_pro" }}
        onRefresh={refresh}
        onPaymentsConfiguredChange={setPaymentsConfigured}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(view.queryByTestId("success-banner")?.props.children).toBe(
      "Purchases restored successfully",
    );
    expect(view.queryByTestId("action-error")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setPaymentsConfigured).toHaveBeenCalledWith(true);
  });

  test("success_no_entitlement → 'No active subscription found to restore'", async () => {
    const refresh = jest.fn();
    const view = render(
      <Host
        paymentsConfigured={true}
        outcome={{
          kind: "success_no_entitlement",
          message: RESTORE_NO_ENTITLEMENT_MESSAGE,
        }}
        onRefresh={refresh}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("action-error").props.children).toBe(
      "No active subscription found to restore",
    );
    expect(view.queryByTestId("success-banner")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("not_configured → calm 'try again in a moment' copy, no refresh", async () => {
    const refresh = jest.fn();
    const setPaymentsConfigured = jest.fn();
    const view = render(
      <Host
        paymentsConfigured={false}
        outcome={{
          kind: "not_configured",
          message: RESTORE_NOT_CONFIGURED_MESSAGE,
        }}
        onRefresh={refresh}
        onPaymentsConfiguredChange={setPaymentsConfigured}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("action-error").props.children).toBe(
      "Purchases can't be restored right now — try again in a moment.",
    );
    expect(view.queryByTestId("success-banner")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(setPaymentsConfigured).toHaveBeenCalledWith(false);
  });

  test("error → generic 'Couldn't restore purchases — try again' copy", async () => {
    const refresh = jest.fn();
    const view = render(
      <Host
        paymentsConfigured={true}
        outcome={{ kind: "error", message: RESTORE_GENERIC_ERROR_MESSAGE }}
        onRefresh={refresh}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("action-error").props.children).toBe(
      "Couldn't restore purchases — try again",
    );
    expect(view.queryByTestId("success-banner")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("pending flag flips back to idle after the flow settles", async () => {
    const view = render(
      <Host
        paymentsConfigured={true}
        outcome={{ kind: "error", message: RESTORE_GENERIC_ERROR_MESSAGE }}
      />,
    );
    expect(view.getByTestId("pending").props.children).toBe("idle");
    await tapAndFlush(view.getByLabelText);
    expect(view.getByTestId("pending").props.children).toBe("idle");
  });
});
