/**
 * Screen-level coverage for the sustained-outage banner the AI
 * Guide screen swaps in after two consecutive 5xx replies from the
 * Polsia gateway (Task #397):
 *
 *   - one 5xx → inline retry copy (the existing pink errorBar) — a
 *     single blip is treated as a transient network hiccup
 *   - two 5xx in a row → the calm
 *     `mem-unavailable-banner` is rendered, sitting ABOVE the
 *     normal composer so the user can still attempt a recovery
 *     send (the requirement is that the banner clears on a
 *     successful round-trip — that's only reachable if the input
 *     is still present)
 *   - successful send while bannered → banner disappears, counter
 *     resets to 0
 *   - non-5xx error in between (e.g. 4xx / network blip) → strike
 *     counter resets so a one-off local glitch can't push past
 *     the 2-strike threshold
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockPlay = jest.fn();
const mockSendAiGuideMessage = jest.fn();
const mockBumpAiGuideCounter = jest.fn();
const mockLoadAiGuideCounter = jest.fn();
const mockLoadAiGuideThread = jest.fn();
const mockSaveAiGuideThread = jest.fn();
const mockClearAiGuideThread = jest.fn();
const mockRouterReplace = jest.fn();

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return {
    ...actual,
    useHaptics: () => ({ play: mockPlay }),
  };
});

jest.mock("@/lib/aiGuide", () => {
  const actual = jest.requireActual("@/lib/aiGuide");
  return {
    ...actual,
    sendAiGuideMessage: (...args: unknown[]) => mockSendAiGuideMessage(...args),
  };
});

jest.mock("@/lib/aiGuideLimits", () => ({
  loadAiGuideCounter: (...args: unknown[]) => mockLoadAiGuideCounter(...args),
  bumpAiGuideCounter: (...args: unknown[]) => mockBumpAiGuideCounter(...args),
  getAiGuideLimitState: (sentToday: number, isPro: boolean) => ({
    isPro,
    sentToday,
    remainingToday: 50 - sentToday,
    atLimit: false,
    limit: 50,
  }),
}));

jest.mock("@/lib/aiGuideThread", () => ({
  loadAiGuideThread: (...args: unknown[]) => mockLoadAiGuideThread(...args),
  saveAiGuideThread: (...args: unknown[]) => mockSaveAiGuideThread(...args),
  clearAiGuideThread: (...args: unknown[]) => mockClearAiGuideThread(...args),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
    push: jest.fn(),
    back: jest.fn(),
  }),
  useFocusEffect: () => {},
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/components/ChatThread", () => {
  const ReactLib = require("react");
  const { View: RNView, TextInput, Pressable, Text } = require("react-native");
  return {
    ChatThread: ({ input }: { input: React.ReactNode }) =>
      ReactLib.createElement(RNView, null, input),
    FreeTextInput: ({
      onSubmit,
      placeholder,
      disabled,
    }: {
      onSubmit: (v: string) => void;
      placeholder?: string;
      disabled?: boolean;
    }) => {
      const [val, setVal] = ReactLib.useState("");
      return ReactLib.createElement(
        RNView,
        { testID: "composer" },
        ReactLib.createElement(TextInput, {
          accessibilityLabel: "Your answer to Mem",
          placeholder: placeholder ?? "Type",
          value: val,
          onChangeText: setVal,
        }),
        ReactLib.createElement(
          Pressable,
          {
            accessibilityLabel: "Send your answer",
            disabled,
            onPress: () => onSubmit(val),
          },
          ReactLib.createElement(Text, null, "Send"),
        ),
      );
    },
  };
});

jest.mock("@/components/alive/FrostBackground", () => ({
  FrostBackground: () => null,
}));

jest.mock("@/components/ProUpsellCard", () => ({ ProUpsellCard: () => null }));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "user@example.com" },
  }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: true } }),
}));

import AiGuideScreen from "./ai-guide";
import { AiGuideError, AI_GUIDE_NETWORK_ERROR_MESSAGE } from "@/lib/aiGuide";

beforeEach(() => {
  mockPlay.mockReset();
  mockSendAiGuideMessage.mockReset();
  mockBumpAiGuideCounter.mockReset();
  mockLoadAiGuideCounter.mockReset();
  mockLoadAiGuideThread.mockReset();
  mockSaveAiGuideThread.mockReset();
  mockClearAiGuideThread.mockReset();
  mockRouterReplace.mockReset();
  mockLoadAiGuideThread.mockResolvedValue([]);
  mockLoadAiGuideCounter.mockResolvedValue({ date: "2026-01-01", count: 0 });
  mockSaveAiGuideThread.mockResolvedValue(undefined);
  mockBumpAiGuideCounter.mockResolvedValue({ date: "2026-01-01", count: 1 });
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function send(view: ReturnType<typeof render>, text: string) {
  fireEvent.changeText(view.getByLabelText("Your answer to Mem"), text);
  await act(async () => {
    fireEvent.press(view.getByLabelText("Send your answer"));
  });
  await flushAsync();
}

// After a single non-outage failure the inline errorBar swaps in
// for the composer (existing pre-Task-#397 behavior), so the only
// way to fire a second send is the "Try again" retry button. This
// re-sends the last user message — perfect for getting the strike
// counter to two.
async function pressRetry(view: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent.press(
      view.getByLabelText("Try sending the last message again"),
    );
  });
  await flushAsync();
}

function makeOutage() {
  return new AiGuideError(AI_GUIDE_NETWORK_ERROR_MESSAGE, "upstream 502", {
    isServerOutage: true,
  });
}

describe("AiGuideScreen — sustained-outage banner state machine (Task #397)", () => {
  test("one 5xx shows the inline retry copy, not the unavailable banner", async () => {
    mockSendAiGuideMessage.mockImplementationOnce(() =>
      Promise.reject(makeOutage()),
    );
    const view = render(<AiGuideScreen />);
    await flushAsync();
    await send(view, "hi mem");
    expect(view.queryByTestId("mem-unavailable-banner")).toBeNull();
  });

  test("two consecutive 5xx swap in the calm unavailable banner above the composer", async () => {
    mockSendAiGuideMessage
      .mockImplementationOnce(() => Promise.reject(makeOutage()))
      .mockImplementationOnce(() => Promise.reject(makeOutage()));
    const view = render(<AiGuideScreen />);
    await flushAsync();
    await send(view, "hi mem");
    await pressRetry(view);
    expect(view.getByTestId("mem-unavailable-banner")).toBeTruthy();
    // Composer must remain so the user has a recovery path: a
    // successful send is the only thing that clears the banner.
    expect(view.getByTestId("composer")).toBeTruthy();
  });

  test("banner clears on the next successful round-trip", async () => {
    mockSendAiGuideMessage
      .mockImplementationOnce(() => Promise.reject(makeOutage()))
      .mockImplementationOnce(() => Promise.reject(makeOutage()))
      .mockResolvedValueOnce({ response: "I'm back.", mood: "calm" });
    const view = render(<AiGuideScreen />);
    await flushAsync();
    await send(view, "hi mem");
    await pressRetry(view);
    expect(view.getByTestId("mem-unavailable-banner")).toBeTruthy();
    await send(view, "hello?");
    expect(view.queryByTestId("mem-unavailable-banner")).toBeNull();
  });

  test("a non-outage error between two 5xx resets the strike counter", async () => {
    // 5xx → strike=1, then a 4xx-style AiGuideError (no
    // isServerOutage flag) → strike resets to 0, then another 5xx
    // → strike=1 again. Banner must NOT show after these three
    // failures because no two outage strikes are consecutive.
    mockSendAiGuideMessage
      .mockImplementationOnce(() => Promise.reject(makeOutage()))
      .mockImplementationOnce(() =>
        Promise.reject(new AiGuideError(AI_GUIDE_NETWORK_ERROR_MESSAGE, "4xx")),
      )
      .mockImplementationOnce(() => Promise.reject(makeOutage()));
    const view = render(<AiGuideScreen />);
    await flushAsync();
    await send(view, "a");
    await pressRetry(view);
    await pressRetry(view);
    expect(view.queryByTestId("mem-unavailable-banner")).toBeNull();
  });
});
