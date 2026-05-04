import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { act, render, fireEvent } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

import { useHaptic } from "./haptics";
import { useHandleManageSubscription } from "./useHandleManageSubscription";

jest.mock("./haptics", () => ({ useHaptic: jest.fn() }));
import {
  MANAGE_APPLE_OPEN_FAILED_MESSAGE,
  MANAGE_STRIPE_OPEN_FAILED_MESSAGE,
  type ManageOutcome,
} from "./manageSubscriptionFlow";

interface HostProps {
  outcome: ManageOutcome;
  rail?: "apple" | "stripe";
  onPaymentsConfiguredChange?: (next: boolean) => void;
}

function Host(props: HostProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [paymentsConfigured, setPaymentsConfigured] = useState<
    boolean | null
  >(null);

  const handleManage = useHandleManageSubscription({
    rail: props.rail ?? "apple",
    setActionError,
    setActionPending,
    setPaymentsConfigured: (next: boolean) => {
      setPaymentsConfigured(next);
      props.onPaymentsConfiguredChange?.(next);
    },
    actionPending,
    runFlow: async () => props.outcome,
  });

  return (
    <View>
      <Pressable onPress={handleManage} accessibilityLabel="Run manage">
        <Text>Run manage</Text>
      </Pressable>
      {actionError !== null && (
        <Text testID="action-error">{actionError}</Text>
      )}
      <Text testID="payments-configured">
        {paymentsConfigured === null
          ? "unset"
          : paymentsConfigured
            ? "true"
            : "false"}
      </Text>
      <Text testID="pending">{actionPending ? "pending" : "idle"}</Text>
    </View>
  );
}

async function tapAndFlush(
  getByLabelText: ReturnType<typeof render>["getByLabelText"],
) {
  await act(async () => {
    fireEvent.press(getByLabelText("Run manage"));
  });
}

let mockHapticPlayer: jest.Mock;

beforeEach(() => {
  mockHapticPlayer = jest.fn();
  // `useHaptic` returns a `HapticPlayer` (`{ play }`); the hook calls
  // `errorHaptic.play()`, so we must wrap the spy in that shape rather
  // than handing back a bare function (which would crash with
  // "play is not a function" before the haptic is ever recorded).
  (useHaptic as jest.Mock).mockReturnValue({ play: mockHapticPlayer });
  (Haptics.impactAsync as jest.Mock).mockClear();
});

describe("useHandleManageSubscription — fires the right side effects per branch", () => {
  test("opened_apple → marks payments configured, no error banner, no error haptic", async () => {
    const setPaymentsConfigured = jest.fn();
    const view = render(
      <Host
        outcome={{ kind: "opened_apple" }}
        onPaymentsConfiguredChange={setPaymentsConfigured}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(setPaymentsConfigured).toHaveBeenCalledWith(true);
    expect(view.getByTestId("payments-configured").props.children).toBe(
      "true",
    );
    expect(view.queryByTestId("action-error")).toBeNull();
    expect(mockHapticPlayer).not.toHaveBeenCalled();
  });

  test("opened_stripe → marks payments configured, no error banner, no error haptic", async () => {
    const setPaymentsConfigured = jest.fn();
    const view = render(
      <Host
        outcome={{ kind: "opened_stripe" }}
        rail="stripe"
        onPaymentsConfiguredChange={setPaymentsConfigured}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(setPaymentsConfigured).toHaveBeenCalledWith(true);
    expect(view.getByTestId("payments-configured").props.children).toBe(
      "true",
    );
    expect(view.queryByTestId("action-error")).toBeNull();
    expect(mockHapticPlayer).not.toHaveBeenCalled();
  });

  test("not_configured → flips paymentsConfigured to false, no error banner, no error haptic", async () => {
    const setPaymentsConfigured = jest.fn();
    const view = render(
      <Host
        outcome={{ kind: "not_configured" }}
        rail="stripe"
        onPaymentsConfiguredChange={setPaymentsConfigured}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(setPaymentsConfigured).toHaveBeenCalledWith(false);
    expect(view.getByTestId("payments-configured").props.children).toBe(
      "false",
    );
    expect(view.queryByTestId("action-error")).toBeNull();
    expect(mockHapticPlayer).not.toHaveBeenCalled();
  });

  test("error (Apple) → surfaces 'couldn't open the App Store' copy and fires error haptic", async () => {
    const setPaymentsConfigured = jest.fn();
    const view = render(
      <Host
        outcome={{
          kind: "error",
          message: MANAGE_APPLE_OPEN_FAILED_MESSAGE,
        }}
        onPaymentsConfiguredChange={setPaymentsConfigured}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("action-error").props.children).toBe(
      "Couldn't open the App Store — try again",
    );
    expect(setPaymentsConfigured).not.toHaveBeenCalled();
    expect(mockHapticPlayer).toHaveBeenCalledTimes(1);
  });

  test("error (Stripe) → surfaces 'couldn't open Stripe' copy and fires error haptic", async () => {
    const setPaymentsConfigured = jest.fn();
    const view = render(
      <Host
        outcome={{
          kind: "error",
          message: MANAGE_STRIPE_OPEN_FAILED_MESSAGE,
        }}
        rail="stripe"
        onPaymentsConfiguredChange={setPaymentsConfigured}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("action-error").props.children).toBe(
      "Couldn't open Stripe — try again",
    );
    expect(setPaymentsConfigured).not.toHaveBeenCalled();
    expect(mockHapticPlayer).toHaveBeenCalledTimes(1);
  });

  test("pending flag flips back to idle after the flow settles", async () => {
    const view = render(
      <Host
        outcome={{
          kind: "error",
          message: MANAGE_APPLE_OPEN_FAILED_MESSAGE,
        }}
      />,
    );
    expect(view.getByTestId("pending").props.children).toBe("idle");
    await tapAndFlush(view.getByLabelText);
    expect(view.getByTestId("pending").props.children).toBe("idle");
  });
});
