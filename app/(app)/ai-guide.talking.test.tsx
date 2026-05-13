/**
 * Screen-level coverage for the talking-Mem stage on the AI Guide
 * screen (Task #283).
 *
 * Coverage:
 *   - The dedicated Mem stage renders ("Tap Mem to skip the current
 *     voice" Pressable) — proves the stage is mounted at the top of
 *     the screen on /ai-guide.
 *   - The header mute toggle is present and toggles between
 *     "Mute Mem's voice" and "Unmute Mem's voice" labels.
 *   - The in-bubble Mem avatar is hidden on the AI Guide screen
 *     (verified by passing `showAvatars={false}` to the mocked
 *     ChatThread). This is the no-regression check for onboarding-
 *     chat, which still uses the default `showAvatars` (true) and
 *     keeps its in-bubble avatars.
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
const mockSetMemVoiceMuted = jest.fn();
const mockEnsureHydrated: jest.Mock<Promise<boolean>, [string]> = jest.fn(
  (_u: string) => Promise.resolve(false),
);
const mockHasIntroBeenSpoken: jest.Mock<Promise<boolean>, [string]> = jest.fn(
  (_u: string) => Promise.resolve(true),
);
const mockMarkIntroSpoken: jest.Mock<Promise<void>, [string]> = jest.fn(
  (_u: string) => Promise.resolve(),
);
const mockHasSkipHintBeenSeen: jest.Mock<Promise<boolean>, [string]> = jest.fn(
  (_u: string) => Promise.resolve(true),
);
const mockMarkSkipHintSeen: jest.Mock<Promise<void>, [string]> = jest.fn(
  (_u: string) => Promise.resolve(),
);

const mockSpeak = jest.fn();
const mockSpeechStop = jest.fn();
// jest.mock factories may only reference variables prefixed with
// "mock" (case insensitive). The mute pref hook reads off this
// shared boolean so the test's setMemVoiceMuted mock can flip it,
// and a tiny pub/sub forces components subscribed via the mocked
// `useMemVoiceMuted` hook to re-render when the value changes.
let mockMutedState = false;
const mockMutedListeners = new Set<() => void>();
const mockSetMutedState = (next: boolean) => {
  mockMutedState = next;
  mockMutedListeners.forEach((l) => l());
};

jest.mock("@/lib/haptics", () => {
  const actual = jest.requireActual("@/lib/haptics");
  return { ...actual, useHaptics: () => ({ play: mockPlay }) };
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

jest.mock("@/lib/memVoicePrefs", () => {
  const ReactLib = require("react");
  return {
    ensureMemVoiceMuteHydrated: (userId: string) =>
      mockEnsureHydrated(userId),
    hasMemIntroBeenSpoken: (userId: string) => mockHasIntroBeenSpoken(userId),
    markMemIntroSpoken: (userId: string) => mockMarkIntroSpoken(userId),
    hasMemSkipHintBeenSeen: (userId: string) =>
      mockHasSkipHintBeenSeen(userId),
    markMemSkipHintSeen: (userId: string) => mockMarkSkipHintSeen(userId),
    setMemVoiceMuted: (userId: string, value: boolean) => {
      mockSetMutedState(value);
      return mockSetMemVoiceMuted(userId, value);
    },
    // Tiny subscription so consuming components actually re-render
    // when the test flips the muted flag. Without this the screen
    // would close over the initial `false` on first render.
    useMemVoiceMuted: () => {
      const [, force] = ReactLib.useState(0);
      ReactLib.useEffect(() => {
        const listener = () => force((n: number) => n + 1);
        mockMutedListeners.add(listener);
        return () => {
          mockMutedListeners.delete(listener);
        };
      }, []);
      return mockMutedState;
    },
    // Caption-strip toggle (Task #293). The talking-Mem tests don't
    // exercise the caption strip itself, so the hook just returns
    // false (default off) and the hydrate call is a resolved
    // no-op. Keeping these stubs stops "is not a function" failures
    // when ai-guide.tsx imports them.
    useMemCaptionsEnabled: () => false,
    ensureMemCaptionsEnabledHydrated: (_userId: string) =>
      Promise.resolve(false),
    setMemCaptionsEnabled: (_userId: string, _value: boolean) =>
      Promise.resolve(),
    // Voice id pref (Task #292). The screen reads this and passes
    // it (via `useEffectiveMemVoiceId`) to `useMemSpeech`; this
    // test never exercises voice selection so it's pinned to
    // `null` (system default).
    useMemVoiceId: () => null,
  };
});

// ai-guide.tsx funnels the saved voice id through
// `useEffectiveMemVoiceId`, which kicks off an
// `Speech.getAvailableVoicesAsync()` fetch on mount. This suite
// doesn't exercise the cross-device fallback — that lives in
// `lib/memVoiceCatalog.test.ts` — so we short-circuit the hook to
// a passthrough so it doesn't trigger an extra async render or
// cause act() warnings while the catalog "hydrates".
jest.mock("@/lib/memVoiceCatalog", () => ({
  useEffectiveMemVoiceId: (saved: string | null) => saved,
}));

jest.mock("@/lib/useMemSpeech", () => {
  const ReactLib = require("react");
  return {
    useMemSpeech: () => {
      const mouthOpen = ReactLib.useRef({ value: 0 }).current;
      return {
        speak: (...args: unknown[]) => mockSpeak(...args),
        stop: (...args: unknown[]) => mockSpeechStop(...args),
        isSpeaking: false,
        mouthOpen,
      };
    },
  };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
    push: jest.fn(),
    back: jest.fn(),
  }),
  // The screen registers a blur cleanup via `useFocusEffect` to stop
  // Mem speaking when the user leaves /ai-guide (Task #294). The real
  // hook depends on a navigation context the bare `render()` here
  // doesn't set up, and there's no blur-equivalent we want to drive
  // from these tests — they exercise the on-screen behavior. The
  // blur-stop behavior itself is covered by the dedicated
  // `useMemSpeech` AppState test, so we stub this as a no-op.
  useFocusEffect: () => {},
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let lastChatThreadProps: Record<string, unknown> | null = null;
jest.mock("@/components/ChatThread", () => {
  const ReactLib = require("react");
  const { View: RNView, TextInput, Pressable, Text } = require("react-native");
  return {
    ChatThread: (props: Record<string, unknown>) => {
      lastChatThreadProps = props;
      return ReactLib.createElement(
        RNView,
        { accessibilityLabel: "MockChatThread" },
        props.input as React.ReactNode,
      );
    },
    FreeTextInput: ({
      onSubmit,
      placeholder,
    }: {
      onSubmit: (v: string) => void;
      placeholder?: string;
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
            onPress: () => onSubmit(val),
          },
          ReactLib.createElement(Text, null, "Send"),
        ),
      );
    },
  };
});

jest.mock("@/components/MemCharacter", () => {
  const ReactLib = require("react");
  const { View: RNView } = require("react-native");
  return {
    MemCharacter: (props: Record<string, unknown>) =>
      ReactLib.createElement(RNView, {
        accessibilityLabel: `MockMemCharacter:${String(props.expression)}`,
      }),
  };
});

jest.mock("@/components/alive/FrostBackground", () => ({
  FrostBackground: () => null,
}));

jest.mock("@/components/ProUpsellCard", () => ({ ProUpsellCard: () => null }));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "user@example.com" } }),
}));

jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ status: { is_pro: true } }),
}));

import AiGuideScreen from "./ai-guide";

beforeEach(() => {
  mockPlay.mockReset();
  mockSendAiGuideMessage.mockReset();
  mockBumpAiGuideCounter.mockReset();
  mockLoadAiGuideCounter.mockReset();
  mockLoadAiGuideThread.mockReset();
  mockSaveAiGuideThread.mockReset();
  mockClearAiGuideThread.mockReset();
  mockRouterReplace.mockReset();
  mockSetMemVoiceMuted.mockReset();
  mockEnsureHydrated.mockReset();
  mockHasIntroBeenSpoken.mockReset();
  mockMarkIntroSpoken.mockReset();
  mockSpeak.mockReset();
  mockSpeechStop.mockReset();
  mockHasSkipHintBeenSeen.mockReset();
  mockMarkSkipHintSeen.mockReset();
  lastChatThreadProps = null;
  mockMutedState = false;

  mockLoadAiGuideThread.mockResolvedValue([]);
  mockLoadAiGuideCounter.mockResolvedValue({ date: "2026-01-01", count: 0 });
  mockSaveAiGuideThread.mockResolvedValue(undefined);
  mockBumpAiGuideCounter.mockResolvedValue({ date: "2026-01-01", count: 1 });
  mockEnsureHydrated.mockResolvedValue(false);
  // Default: intro already spoken so the stage doesn't auto-speak
  // during render and pollute the speak-call assertions.
  mockHasIntroBeenSpoken.mockResolvedValue(true);
  mockMarkIntroSpoken.mockResolvedValue(undefined);
  // Default: skip hint already seen so the hint label doesn't
  // appear in render-output snapshots that aren't testing it.
  mockHasSkipHintBeenSeen.mockResolvedValue(true);
  mockMarkSkipHintSeen.mockResolvedValue(undefined);
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AiGuideScreen — talking-Mem stage (Task #283)", () => {
  test("renders the Mem stage with the tap-to-skip Pressable", async () => {
    const view = render(<AiGuideScreen />);
    await flushAsync();
    expect(view.getByLabelText("Tap Mem to skip the current voice")).toBeTruthy();
    // Stage hosts the Mem character.
    expect(view.getByLabelText(/MockMemCharacter:/)).toBeTruthy();
  });

  test("hides the in-bubble Mem avatar by passing showAvatars=false to ChatThread", async () => {
    render(<AiGuideScreen />);
    await flushAsync();
    expect(lastChatThreadProps).not.toBeNull();
    expect(lastChatThreadProps!.showAvatars).toBe(false);
  });

  test("the header mute toggle is present and flips its accessibility label when pressed", async () => {
    const view = render(<AiGuideScreen />);
    await flushAsync();

    // Default: not muted → label is "Mute Mem's voice".
    const muteBtn = view.getByLabelText("Mute Mem's voice");
    expect(muteBtn).toBeTruthy();

    await act(async () => {
      fireEvent.press(muteBtn);
    });
    await flushAsync();

    // Toggling persists via setMemVoiceMuted (which our mock also
    // updates `mockMutedState` for, so the next render flips the label).
    expect(mockSetMemVoiceMuted).toHaveBeenCalledWith("u1", true);
    expect(view.getByLabelText("Unmute Mem's voice")).toBeTruthy();
  });

  test("tapping the stage interrupts in-flight speech via stop()", async () => {
    const view = render(<AiGuideScreen />);
    await flushAsync();
    await act(async () => {
      fireEvent.press(view.getByLabelText("Tap Mem to skip the current voice"));
    });
    expect(mockSpeechStop).toHaveBeenCalled();
  });

  test("a successful Mem reply calls speak() with the response text", async () => {
    mockSendAiGuideMessage.mockResolvedValueOnce({
      response: "I hear you.",
      mood: "calm",
    });
    const view = render(<AiGuideScreen />);
    await flushAsync();

    fireEvent.changeText(view.getByLabelText("Your answer to Mem"), "hi");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Send your answer"));
    });
    await flushAsync();

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe("I hear you.");
  });

  test("the 'Tap Mem to skip' hint shows once for a never-seen user and is persisted to AsyncStorage", async () => {
    // First-ever talking reply for this user — the hint must show.
    mockHasSkipHintBeenSeen.mockResolvedValue(false);
    mockSendAiGuideMessage.mockResolvedValueOnce({
      response: "I hear you.",
      mood: "calm",
    });

    const view = render(<AiGuideScreen />);
    await flushAsync();

    fireEvent.changeText(view.getByLabelText("Your answer to Mem"), "hi");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Send your answer"));
    });
    await flushAsync();

    // The hint label is rendered.
    expect(view.queryByText("Tap Mem to skip")).not.toBeNull();
    // The persistence write fired with the correct user id.
    expect(mockMarkSkipHintSeen).toHaveBeenCalledWith("u1");
  });

  test("the 'Tap Mem to skip' hint does NOT show on subsequent launches once persisted", async () => {
    // Default beforeEach already sets hasSeen=true, simulating a
    // user who saw the hint on a previous app launch.
    mockSendAiGuideMessage.mockResolvedValueOnce({
      response: "I hear you.",
      mood: "calm",
    });
    const view = render(<AiGuideScreen />);
    await flushAsync();

    fireEvent.changeText(view.getByLabelText("Your answer to Mem"), "hi");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Send your answer"));
    });
    await flushAsync();

    expect(view.queryByText("Tap Mem to skip")).toBeNull();
    expect(mockMarkSkipHintSeen).not.toHaveBeenCalled();
  });

  test("on first launch the intro greeting does not auto-speak without an approved voice", async () => {
    // Default/system robot voice playback is intentionally disabled.
    // First launch can show the intro visually, but it should not
    // auto-speak unless a future approved voice is explicitly wired.
    mockHasIntroBeenSpoken.mockResolvedValue(false);

    jest.useFakeTimers();
    render(<AiGuideScreen />);
    await flushAsync();

    await act(async () => {
      jest.advanceTimersByTime(60);
      await Promise.resolve();
    });
    jest.useRealTimers();

    expect(mockSpeak).not.toHaveBeenCalled();
    expect(mockMarkIntroSpoken).not.toHaveBeenCalled();
  });
});
