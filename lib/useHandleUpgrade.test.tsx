import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { act, render, fireEvent } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import type { PurchasesPackage } from "react-native-purchases";

import { useHaptic } from "./haptics";
import { useHandleUpgrade } from "./useHandleUpgrade";

jest.mock("./haptics", () => ({ useHaptic: jest.fn() }));
import {
  UPGRADE_APPLE_FAILED_MESSAGE,
  UPGRADE_STRIPE_FAILED_MESSAGE,
  type UpgradeOutcome,
} from "./upgradeFlow";
import type {
  PackagePricingDisplay,
  ProPackages,
} from "./revenuecat";

// Real PurchasesPackage shape is heavy; the hook only forwards the
// reference along, so a tagged stub is enough for the analytics
// branch logic (it compares by reference to proPackages.annual).
const monthlyPkg = { __id: "monthly" } as unknown as PurchasesPackage;
const annualPkg = { __id: "annual" } as unknown as PurchasesPackage;

const TEST_REPOLL_DELAY_MS = 1500;

const monthlyPricing: PackagePricingDisplay = {
  headlinePrice: "$4.99",
  cadence: "/month",
  introOffer: null,
  freeTrial: null,
  pricePerMonth: null,
};
const annualPricing: PackagePricingDisplay = {
  headlinePrice: "$39.99",
  cadence: "/year",
  introOffer: "$0.00 for 7 days",
  freeTrial: null,
  pricePerMonth: "$3.33",
};

interface HostProps {
  outcome: UpgradeOutcome;
  rail?: "apple" | "stripe";
  selectedPlan?: "monthly" | "annual";
  proPackages?: ProPackages;
  monthlyPricing?: PackagePricingDisplay | null;
  annualPricing?: PackagePricingDisplay | null;
  onPaymentsConfiguredChange?: (next: boolean) => void;
  onCelebrationChange?: (next: boolean) => void;
  onRefresh?: () => void;
  onGetCurrentEntitlement?: () => void;
  onTrackEvent?: (
    name: string,
    properties: Record<string, string | number | boolean | null>,
  ) => void;
  postPurchaseRepollDelayMs?: number;
}

function Host(props: HostProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [paymentsConfigured, setPaymentsConfigured] = useState<
    boolean | null
  >(null);

  const handleUpgrade = useHandleUpgrade({
    rail: props.rail ?? "apple",
    selectedPlan: props.selectedPlan ?? "annual",
    proPackages:
      props.proPackages ?? { monthly: monthlyPkg, annual: annualPkg },
    monthlyPricing:
      props.monthlyPricing === undefined ? monthlyPricing : props.monthlyPricing,
    annualPricing:
      props.annualPricing === undefined ? annualPricing : props.annualPricing,
    refresh: () => {
      props.onRefresh?.();
    },
    setActionError,
    setActionPending,
    setPaymentsConfigured: (next: boolean) => {
      setPaymentsConfigured(next);
      props.onPaymentsConfiguredChange?.(next);
    },
    setCelebrationVisible: (next: boolean) => {
      setCelebrationVisible(next);
      props.onCelebrationChange?.(next);
    },
    actionPending,
    runFlow: async () => props.outcome,
    getCurrentEntitlementIsPro: async () => {
      props.onGetCurrentEntitlement?.();
      return true;
    },
    trackEvent: (name, properties) => {
      props.onTrackEvent?.(name, properties ?? {});
    },
    postPurchaseRepollDelayMs:
      props.postPurchaseRepollDelayMs ?? TEST_REPOLL_DELAY_MS,
  });

  return (
    <View>
      <Pressable onPress={handleUpgrade} accessibilityLabel="Run upgrade">
        <Text>Run upgrade</Text>
      </Pressable>
      {actionError !== null && (
        <Text testID="action-error">{actionError}</Text>
      )}
      <Text testID="celebration">
        {celebrationVisible ? "celebrating" : "idle"}
      </Text>
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
    fireEvent.press(getByLabelText("Run upgrade"));
  });
}

let mockHapticPlayer: jest.Mock;

beforeEach(() => {
  mockHapticPlayer = jest.fn();
  // `useHaptic` returns a `HapticPlayer` (`{ play }`); the hook calls
  // `errorHaptic.play()`, so we must wrap the spy in that shape. The
  // previous bare-function mock crashed with "play is not a function"
  // inside the error branch, which also prevented the trailing
  // `pro_upgrade_failed` `trackEvent` from firing — that's why both
  // the haptic *and* the funnel-event assertions were red.
  (useHaptic as jest.Mock).mockReturnValue({ play: mockHapticPlayer });
  (Haptics.impactAsync as jest.Mock).mockClear();
});

describe("useHandleUpgrade — fires the right side effects per branch", () => {
  test("purchased_apple → flips payments, refreshes, shows celebration, tracks conversion, schedules re-poll", async () => {
    jest.useFakeTimers();
    try {
      const refresh = jest.fn();
      const setPaymentsConfigured = jest.fn();
      const setCelebrationVisible = jest.fn();
      const getCurrentEntitlement = jest.fn();
      const trackEvent = jest.fn();

      const view = render(
        <Host
          outcome={{ kind: "purchased_apple" }}
          onRefresh={refresh}
          onPaymentsConfiguredChange={setPaymentsConfigured}
          onCelebrationChange={setCelebrationVisible}
          onGetCurrentEntitlement={getCurrentEntitlement}
          onTrackEvent={trackEvent}
        />,
      );
      await tapAndFlush(view.getByLabelText);

      expect(setPaymentsConfigured).toHaveBeenCalledWith(true);
      expect(getCurrentEntitlement).toHaveBeenCalledTimes(1);
      // refresh fires once inline; the setTimeout re-poll hasn't run yet.
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(setCelebrationVisible).toHaveBeenCalledWith(true);
      expect(view.getByTestId("celebration").props.children).toBe(
        "celebrating",
      );
      expect(view.queryByTestId("action-error")).toBeNull();
      expect(trackEvent).toHaveBeenCalledTimes(2);
      expect(trackEvent).toHaveBeenNthCalledWith(1, "pro_upgrade_started", {
        plan: "annual",
        rail: "apple",
      });
      expect(trackEvent).toHaveBeenNthCalledWith(2, "pro_upgrade_completed", {
        plan: "annual",
        intro_offer: true,
        rail: "apple",
      });

      // Advance the post-purchase re-poll timer; the second refresh
      // should fire in the background without being awaited.
      await act(async () => {
        jest.advanceTimersByTime(TEST_REPOLL_DELAY_MS);
      });
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test("purchased_apple with monthly selection → trackEvent reports plan='monthly'", async () => {
    jest.useFakeTimers();
    try {
      const trackEvent = jest.fn();
      const view = render(
        <Host
          outcome={{ kind: "purchased_apple" }}
          selectedPlan="monthly"
          onTrackEvent={trackEvent}
        />,
      );
      await tapAndFlush(view.getByLabelText);

      expect(trackEvent).toHaveBeenNthCalledWith(1, "pro_upgrade_started", {
        plan: "monthly",
        rail: "apple",
      });
      expect(trackEvent).toHaveBeenNthCalledWith(2, "pro_upgrade_completed", {
        plan: "monthly",
        intro_offer: false,
        rail: "apple",
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("opened_stripe → marks payments configured, no celebration, no entitlement re-read; tracks pro_upgrade_started only", async () => {
    const refresh = jest.fn();
    const setPaymentsConfigured = jest.fn();
    const setCelebrationVisible = jest.fn();
    const getCurrentEntitlement = jest.fn();
    const trackEvent = jest.fn();

    const view = render(
      <Host
        outcome={{ kind: "opened_stripe" }}
        rail="stripe"
        onRefresh={refresh}
        onPaymentsConfiguredChange={setPaymentsConfigured}
        onCelebrationChange={setCelebrationVisible}
        onGetCurrentEntitlement={getCurrentEntitlement}
        onTrackEvent={trackEvent}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(setPaymentsConfigured).toHaveBeenCalledWith(true);
    expect(setCelebrationVisible).not.toHaveBeenCalled();
    expect(view.getByTestId("celebration").props.children).toBe("idle");
    expect(getCurrentEntitlement).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith("pro_upgrade_started", {
      plan: "annual",
      rail: "stripe",
    });
    expect(view.queryByTestId("action-error")).toBeNull();
  });

  test("cancelled → quiet, no state setters fire, no error banner; pro_upgrade_started fires but pro_upgrade_failed does NOT", async () => {
    const refresh = jest.fn();
    const setPaymentsConfigured = jest.fn();
    const setCelebrationVisible = jest.fn();
    const trackEvent = jest.fn();

    const view = render(
      <Host
        outcome={{ kind: "cancelled" }}
        onRefresh={refresh}
        onPaymentsConfiguredChange={setPaymentsConfigured}
        onCelebrationChange={setCelebrationVisible}
        onTrackEvent={trackEvent}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(setPaymentsConfigured).not.toHaveBeenCalled();
    expect(setCelebrationVisible).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith("pro_upgrade_started", {
      plan: "annual",
      rail: "apple",
    });
    expect(
      trackEvent.mock.calls.some(
        ([name]: [string]) => name === "pro_upgrade_failed",
      ),
    ).toBe(false);
    expect(view.queryByTestId("action-error")).toBeNull();
    expect(mockHapticPlayer).not.toHaveBeenCalled();
  });

  test("not_configured → flips paymentsConfigured to false, no celebration, no error banner; tracks pro_upgrade_failed with reason='not_configured'", async () => {
    const setPaymentsConfigured = jest.fn();
    const setCelebrationVisible = jest.fn();
    const trackEvent = jest.fn();

    const view = render(
      <Host
        outcome={{ kind: "not_configured" }}
        onPaymentsConfiguredChange={setPaymentsConfigured}
        onCelebrationChange={setCelebrationVisible}
        onTrackEvent={trackEvent}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(setPaymentsConfigured).toHaveBeenCalledWith(false);
    expect(setCelebrationVisible).not.toHaveBeenCalled();
    expect(view.getByTestId("payments-configured").props.children).toBe(
      "false",
    );
    expect(view.queryByTestId("action-error")).toBeNull();
    expect(mockHapticPlayer).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenNthCalledWith(1, "pro_upgrade_started", {
      plan: "annual",
      rail: "apple",
    });
    expect(trackEvent).toHaveBeenNthCalledWith(2, "pro_upgrade_failed", {
      reason: "not_configured",
      rail: "apple",
    });
  });

  test("error (Apple) → surfaces inline error copy, fires error haptic, tracks pro_upgrade_failed with reason='purchase_failed'", async () => {
    const setCelebrationVisible = jest.fn();
    const trackEvent = jest.fn();

    const view = render(
      <Host
        outcome={{ kind: "error", message: UPGRADE_APPLE_FAILED_MESSAGE }}
        onCelebrationChange={setCelebrationVisible}
        onTrackEvent={trackEvent}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("action-error").props.children).toBe(
      "Couldn't complete purchase — try again",
    );
    expect(setCelebrationVisible).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenNthCalledWith(1, "pro_upgrade_started", {
      plan: "annual",
      rail: "apple",
    });
    expect(trackEvent).toHaveBeenNthCalledWith(2, "pro_upgrade_failed", {
      reason: "purchase_failed",
      rail: "apple",
    });
    expect(mockHapticPlayer).toHaveBeenCalledTimes(1);
  });

  test("error (Stripe) → surfaces 'couldn't open Stripe' copy, fires error haptic, tracks pro_upgrade_failed with reason='checkout_failed'", async () => {
    const trackEvent = jest.fn();
    const view = render(
      <Host
        outcome={{ kind: "error", message: UPGRADE_STRIPE_FAILED_MESSAGE }}
        rail="stripe"
        onTrackEvent={trackEvent}
      />,
    );
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("action-error").props.children).toBe(
      "Couldn't open Stripe — try again",
    );
    expect(trackEvent).toHaveBeenNthCalledWith(1, "pro_upgrade_started", {
      plan: "annual",
      rail: "stripe",
    });
    expect(trackEvent).toHaveBeenNthCalledWith(2, "pro_upgrade_failed", {
      reason: "checkout_failed",
      rail: "stripe",
    });
    expect(mockHapticPlayer).toHaveBeenCalledTimes(1);
  });

  test("pending flag flips back to idle after the flow settles", async () => {
    const view = render(
      <Host
        outcome={{ kind: "error", message: UPGRADE_APPLE_FAILED_MESSAGE }}
      />,
    );
    expect(view.getByTestId("pending").props.children).toBe("idle");
    await tapAndFlush(view.getByLabelText);
    expect(view.getByTestId("pending").props.children).toBe("idle");
  });
});
