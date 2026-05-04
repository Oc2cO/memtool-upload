/**
 * Screen-level coverage for the haptic verbs the AI Guide screen
 * (`app/(app)/ai-guide.tsx`) fires after the Task #203 verb refactor:
 *
 *   - successful Mem reply → `play("day-recap-ready")`
 *     (the existing arrival-cue chime, *not* the system success buzz —
 *     a Mem reply is a calm "your message landed" moment, not a save)
 *   - failed Mem call (AiGuideError or generic network failure) →
 *     `play("error")`
 *
 * Without these, a future refactor of `sendMessage` could silently
 * swap the success verb back to "capture" (which would make every
 * Mem reply feel like a save instead of an arrival) or drop the
 * error verb entirely — either of which would break the verb
 * vocabulary established by Task #203.
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

// Keep the real AiGuideError class so `err instanceof AiGuideError`
// inside the screen still narrows correctly when our mock throws.
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
  // Pure math — never returns atLimit so the input renders.
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
  // See ai-guide.talking.test for rationale — stubbed as a no-op so
  // the AI Guide screen renders without a real navigation context.
  // The blur-stop behavior (Task #294) is covered by the dedicated
  // `useMemSpeech` AppState test.
  useFocusEffect: () => {},
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// ChatThread renders the message list + the input node we hand it.
// Stub it to render only the input node so we can find the
// FreeTextInput's "Send your answer" Pressable directly without
// pulling in the full thread, frost, MemCharacter etc.
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
        null,
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
import { AiGuideError } from "@/lib/aiGuide";

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

describe("AiGuideScreen — useHaptics().play verbs after the Task #203 refactor", () => {
  test("successful reply fires play('day-recap-ready') — the arrival-cue chime, not the generic save buzz", async () => {
    mockSendAiGuideMessage.mockResolvedValueOnce({
      response: "I hear you.",
      mood: "calm",
    });

    const view = render(<AiGuideScreen />);
    // Wait for thread + counter hydration so the input renders.
    await flushAsync();

    fireEvent.changeText(
      view.getByLabelText("Your answer to Mem"),
      "hi mem",
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText("Send your answer"));
    });
    // Flush the in-flight POST and the post-response state updates.
    await flushAsync();

    expect(mockSendAiGuideMessage).toHaveBeenCalledTimes(1);
    expect(mockSendAiGuideMessage).toHaveBeenCalledWith("hi mem");
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("day-recap-ready");
  });

  test("AiGuideError failure fires play('error') — calm two-thump 'MemTool says no'", async () => {
    // `mockImplementationOnce` (not `mockRejectedValueOnce`) — the
    // eager form trips jest's unhandled-rejection watcher.
    mockSendAiGuideMessage.mockImplementationOnce(() =>
      Promise.reject(new AiGuideError("rate_limited", "Too many requests")),
    );

    const view = render(<AiGuideScreen />);
    await flushAsync();

    fireEvent.changeText(
      view.getByLabelText("Your answer to Mem"),
      "hi mem",
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText("Send your answer"));
    });
    await flushAsync();

    expect(mockSendAiGuideMessage).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("error");
    // The success counter must NOT increment on failure — pinning
    // this guards the ordering inside the try-block (haptic is in
    // the catch, bumpAiGuideCounter is in the try).
    expect(mockBumpAiGuideCounter).not.toHaveBeenCalled();
  });

  test("generic network failure also fires play('error') — both error branches share the verb", async () => {
    // Plain Error (not an AiGuideError) → friendly fallback message
    // path. The verb must still be 'error' so all failures feel the
    // same way regardless of whether the lib classified them.
    mockSendAiGuideMessage.mockImplementationOnce(() =>
      Promise.reject(new Error("network down")),
    );

    const view = render(<AiGuideScreen />);
    await flushAsync();

    fireEvent.changeText(
      view.getByLabelText("Your answer to Mem"),
      "hi mem",
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText("Send your answer"));
    });
    await flushAsync();

    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledWith("error");
  });
});
