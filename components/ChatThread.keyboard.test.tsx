/**
 * Reduce-Motion + keyboard-lift coverage for `ChatThread` and the
 * three animated children it composes (Task #189). Pinned contracts:
 *
 *   1. ChatThread surface (composer wrapper) — keyboard-driven
 *      `translateY` + `shadowOpacity 0.04` ramp when Reduce Motion
 *      is OFF; worklet returns `{}` so transform is undefined and
 *      only the static `shadowOpacity 0.06` remains when ON.
 *      Mid-session OS toggles are honored.
 *
 *   2. Bubble entrance — fade + slide + tiny scale spring (3 calls
 *      to `withSpring` for ty/tx/scale) when Reduce Motion is OFF;
 *      ONLY a `withTiming` opacity fade (no `withSpring`) when ON.
 *
 *   3. CircularSendButton — fade-in `withTiming` + scale-in
 *      `withSpring` when Reduce Motion is OFF and the button
 *      becomes visible; both are bypassed (direct `value =`) when
 *      Reduce Motion is ON, so neither animator helper is called.
 *
 *   4. Chip press-in — `withTiming(0.97)` scale tween when Reduce
 *      Motion is OFF; the press-in handler returns immediately
 *      when ON, so `withTiming` is never called.
 *
 * The Reanimated jest mock returns plain objects for shared values
 * and treats `withSpring`/`withTiming` as identity helpers. We wrap
 * the latter two in spies so we can assert on call counts; without
 * that visibility a regression that drops a Reduce Motion guard
 * would still produce identical final styles in tests.
 */

const mockWithSpring = jest.fn();
const mockWithTiming = jest.fn();

jest.mock("react-native-reanimated", () => {
  const realMock = jest.requireActual("react-native-reanimated/mock");
  return {
    __esModule: true,
    ...realMock,
    withSpring: (...args: unknown[]) => {
      mockWithSpring(...args);
      return (
        realMock.withSpring as (...a: unknown[]) => unknown
      )(...args);
    },
    withTiming: (...args: unknown[]) => {
      mockWithTiming(...args);
      return (
        realMock.withTiming as (...a: unknown[]) => unknown
      )(...args);
    },
  };
});

import React from "react";
import { AccessibilityInfo, View } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import {
  ChatThread,
  ChipsInput,
  FreeTextInput,
  type ChatMessage,
} from "@/components/ChatThread";

const PALETTE = {
  bg: "#0a0612",
  bgDeep: "#050309",
  mem: "#FFD56F",
  hot: "#B47AFF",
  cool: "#6FE5FF",
  pink: "#FF8FB1",
  text: "#F4EEFF",
  textMuted: "#9B91B5",
  card: "rgba(180, 122, 255, 0.10)",
  border: "rgba(180, 122, 255, 0.25)",
};

jest.mock("@/components/MemCharacter", () => ({
  MemCharacter: () => null,
}));

jest.mock("@/components/alive/FrostBackground", () => ({
  FrostBackground: () => null,
}));

const messages: ChatMessage[] = [{ id: "m1", role: "mem", text: "Hi" }];

function makeInput() {
  return (
    <FreeTextInput skippable={false} onSubmit={jest.fn()} palette={PALETTE} />
  );
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flattenStyle(s) }),
      {},
    );
  }
  if (typeof style === "object") return style as Record<string, unknown>;
  return {};
}

/**
 * Find the Animated.View that wraps the composer (the one that
 * carries the keyboard-lift `surfaceAnim`). It's pinned by the
 * combination of `shadowColor: "#000"` (from `styles.inputAreaShadow`)
 * and is the only such wrapper in the rendered thread.
 */
function findSurfaceWrapperStyle(
  root: ReturnType<typeof render>,
): Record<string, unknown> {
  const candidates = root.UNSAFE_root.findAll((node) => {
    if (node.type !== View && typeof node.type !== "function") return false;
    const merged = flattenStyle(node.props.style);
    return merged.shadowColor === "#000" && "shadowOpacity" in merged;
  });
  expect(candidates.length).toBeGreaterThan(0);
  return flattenStyle(candidates[0]!.props.style);
}

/** Flush the AccessibilityInfo.isReduceMotionEnabled microtask. */
async function flushReduceMotionResolution(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ChatThread — surface lift + Reduce Motion", () => {
  beforeEach(() => {
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("with Reduce Motion OFF, the surface wrapper carries the keyboard-driven translateY + shadowOpacity tween", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);

    const view = render(
      <ChatThread
        messages={messages}
        showTyping={false}
        input={makeInput()}
        palette={PALETTE}
      />,
    );

    await waitFor(() =>
      expect(view.getByLabelText("Your answer to Mem")).toBeTruthy(),
    );

    const merged = findSurfaceWrapperStyle(view);
    expect(merged).toHaveProperty("transform");
    const tx = (merged.transform as Array<Record<string, unknown>>).find(
      (t) => "translateY" in t,
    );
    expect(typeof tx?.translateY).toBe("number");
    // shadowOpacity formula at progress=0: 0.04 + 0*0.14 = 0.04.
    expect(merged.shadowOpacity).toBeCloseTo(0.04, 5);
  });

  test("with Reduce Motion ON, the surface animator returns {} — no transform; static shadow only", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);

    const view = render(
      <ChatThread
        messages={messages}
        showTyping={false}
        input={makeInput()}
        palette={PALETTE}
      />,
    );

    await waitFor(() => {
      const merged = findSurfaceWrapperStyle(view);
      expect(merged.transform).toBeUndefined();
      expect(merged.shadowOpacity).toBe(0.06);
    });
  });

  test("re-renders when the OS fires reduceMotionChanged so a mid-session toggle disables the lift", async () => {
    let listener: ((v: boolean) => void) | null = null;
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation(((_: string, l: (v: boolean) => void) => {
        listener = l;
        return { remove: jest.fn() } as { remove: () => void };
      }) as unknown as typeof AccessibilityInfo.addEventListener);

    const view = render(
      <ChatThread
        messages={messages}
        showTyping={false}
        input={makeInput()}
        palette={PALETTE}
      />,
    );

    await waitFor(() => {
      const merged = findSurfaceWrapperStyle(view);
      expect(merged).toHaveProperty("transform");
    });

    expect(listener).not.toBeNull();
    await act(async () => {
      listener?.(true);
    });

    const merged = findSurfaceWrapperStyle(view);
    expect(merged.transform).toBeUndefined();
    expect(merged.shadowOpacity).toBe(0.06);
  });
});

describe("Bubble — entrance Reduce Motion contract", () => {
  beforeEach(() => {
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("with Reduce Motion OFF, a freshly-mounted Bubble runs the spring entrance (3 withSpring calls for ty/tx/scale)", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);

    // Mount with no messages, settle the reduce-motion state, reset
    // the spies, THEN add a message so the Bubble's mount-effect
    // runs cleanly under our spy window.
    const view = render(
      <ChatThread
        messages={[]}
        showTyping={false}
        input={undefined}
        palette={PALETTE}
      />,
    );
    await flushReduceMotionResolution();
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();

    view.rerender(
      <ChatThread
        messages={messages}
        showTyping={false}
        input={undefined}
        palette={PALETTE}
      />,
    );
    await flushReduceMotionResolution();

    // Bubble mount-effect (reduceMotion=false branch):
    //   - opacity = withTiming(1)
    //   - ty = withSpring(0)
    //   - tx = withSpring(0)
    //   - scale = withSpring(1)
    expect(mockWithSpring).toHaveBeenCalledTimes(3);
    expect(mockWithTiming).toHaveBeenCalledWith(
      1,
      expect.any(Object),
    );
  });

  test("with Reduce Motion ON, a freshly-mounted Bubble does NOT call withSpring (only an opacity withTiming fade)", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);

    const view = render(
      <ChatThread
        messages={[]}
        showTyping={false}
        input={undefined}
        palette={PALETTE}
      />,
    );
    await flushReduceMotionResolution();
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();

    view.rerender(
      <ChatThread
        messages={messages}
        showTyping={false}
        input={undefined}
        palette={PALETTE}
      />,
    );
    await flushReduceMotionResolution();

    expect(mockWithSpring).not.toHaveBeenCalled();
    // Reduce-motion branch still runs `withTiming(1, { duration: 220 })`
    // for opacity so the bubble fades in (no slide/scale).
    expect(mockWithTiming).toHaveBeenCalledTimes(1);
    expect(mockWithTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: 220 }),
    );
  });
});

describe("CircularSendButton — visibility Reduce Motion contract", () => {
  beforeEach(() => {
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("with Reduce Motion OFF, typing flips the button to visible and runs withTiming(opacity)+withSpring(scale)", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);

    const view = render(
      <FreeTextInput
        skippable={false}
        onSubmit={jest.fn()}
        palette={PALETTE}
      />,
    );
    await flushReduceMotionResolution();
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();

    fireEvent.changeText(view.getByLabelText("Your answer to Mem"), "hi");
    await flushReduceMotionResolution();

    // visible→true branch under reduceMotion=false:
    //   opacity = withTiming(1, ...) → 1 call
    //   scale  = withSpring(1, ...) → 1 call
    expect(mockWithTiming).toHaveBeenCalledWith(
      1,
      expect.any(Object),
    );
    expect(mockWithSpring).toHaveBeenCalledWith(
      1,
      expect.any(Object),
    );
  });

  test("with Reduce Motion ON, typing flips the button to visible WITHOUT calling withSpring or withTiming (direct value =)", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);

    const view = render(
      <FreeTextInput
        skippable={false}
        onSubmit={jest.fn()}
        palette={PALETTE}
      />,
    );
    await flushReduceMotionResolution();
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();

    fireEvent.changeText(view.getByLabelText("Your answer to Mem"), "hi");
    await flushReduceMotionResolution();

    // Reduce-motion branch sets opacity & scale directly — no helpers.
    expect(mockWithSpring).not.toHaveBeenCalled();
    expect(mockWithTiming).not.toHaveBeenCalled();
  });
});

describe("Chip — press-in Reduce Motion contract", () => {
  beforeEach(() => {
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("with Reduce Motion OFF, pressing in a chip runs withTiming(0.97) for the scale press tween", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);

    const view = render(
      <ChipsInput
        options={["Kind", "Curious"]}
        min={1}
        max={2}
        skippable={false}
        onSubmit={jest.fn()}
        palette={PALETTE}
      />,
    );
    await flushReduceMotionResolution();
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();

    fireEvent(view.getByLabelText("Trait Kind"), "pressIn");

    expect(mockWithTiming).toHaveBeenCalledWith(
      0.97,
      expect.any(Object),
    );
  });

  test("with Reduce Motion ON, pressing in a chip is a no-op — neither withTiming nor withSpring fire", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);

    const view = render(
      <ChipsInput
        options={["Kind", "Curious"]}
        min={1}
        max={2}
        skippable={false}
        onSubmit={jest.fn()}
        palette={PALETTE}
      />,
    );
    await flushReduceMotionResolution();
    mockWithSpring.mockClear();
    mockWithTiming.mockClear();

    fireEvent(view.getByLabelText("Trait Kind"), "pressIn");

    expect(mockWithSpring).not.toHaveBeenCalled();
    expect(mockWithTiming).not.toHaveBeenCalled();
  });
});
