import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

import { LevelResultOverlay } from "./LevelResultOverlay";

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000",
    foreground: "#fff",
    mutedForeground: "#888",
    primary: "#a78bfa",
    primaryForeground: "#fff",
    secondary: "#222",
    accent: "#fbbf24",
    destructive: "#ef4444",
    card: "#111",
    border: "#333",
    muted: "#1a1a1a",
  }),
}));

jest.mock("@/components/GradientButton", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    GradientButton: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <Pressable onPress={onPress} accessibilityRole="button">
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});

describe("<LevelResultOverlay />", () => {
  const baseProps = {
    visible: true,
    level: 4,
    onReplay: jest.fn(),
    onExit: jest.fn(),
    onNextLevel: jest.fn(),
    hasNextLevel: true,
  };

  it("returns null when not visible", () => {
    const { toJSON } = render(
      <LevelResultOverlay {...baseProps} visible={false} state="win" stars={3} />,
    );
    expect(toJSON()).toBeNull();
  });

  it("renders the win state with stars + Next Level + Replay", () => {
    const onNext = jest.fn();
    const onReplay = jest.fn();
    const { getByText } = render(
      <LevelResultOverlay
        {...baseProps}
        state="win"
        stars={2}
        onNextLevel={onNext}
        onReplay={onReplay}
      />,
    );
    expect(getByText("Level 4 Cleared")).toBeTruthy();
    fireEvent.press(getByText("Next Level"));
    expect(onNext).toHaveBeenCalled();
    fireEvent.press(getByText("Replay"));
    expect(onReplay).toHaveBeenCalled();
  });

  it("renders the timeout state with Replay (no Next Level)", () => {
    const { getByText, queryByText } = render(
      <LevelResultOverlay {...baseProps} state="timeout" stars={null} />,
    );
    expect(getByText("Out of Time")).toBeTruthy();
    expect(queryByText("Next Level")).toBeNull();
    fireEvent.press(getByText("Replay"));
    expect(baseProps.onReplay).toHaveBeenCalled();
  });

  it("relabels Next Level as 'Unlock Pro' when nextLevelProLocked", () => {
    // Pro-gate bypass guard: at the free→Pro boundary the CTA must
    // visually read "Unlock Pro" so the user understands tapping it
    // routes to /subscription rather than starting the next level.
    const onNext = jest.fn();
    const { getByText, queryByText } = render(
      <LevelResultOverlay
        {...baseProps}
        state="win"
        stars={3}
        onNextLevel={onNext}
        nextLevelProLocked
      />,
    );
    expect(getByText("Unlock Pro")).toBeTruthy();
    expect(queryByText("Next Level")).toBeNull();
    fireEvent.press(getByText("Unlock Pro"));
    expect(onNext).toHaveBeenCalled();
  });

  it("renders the fail state with consistent copy + Replay", () => {
    const { getByText, queryByText } = render(
      <LevelResultOverlay {...baseProps} state="fail" stars={null} />,
    );
    expect(getByText("Level Failed")).toBeTruthy();
    expect(queryByText("Next Level")).toBeNull();
    expect(getByText("Replay")).toBeTruthy();
  });

  describe("versus states (Task #321)", () => {
    it("renders versus-win with Rematch (no stars, no Next Level)", () => {
      const onReplay = jest.fn();
      const { getByText, queryByText } = render(
        <LevelResultOverlay
          {...baseProps}
          state="versus-win"
          stars={null}
          hasNextLevel={false}
          onReplay={onReplay}
        />,
      );
      expect(getByText("You Beat Mem")).toBeTruthy();
      expect(queryByText("Next Level")).toBeNull();
      fireEvent.press(getByText("Rematch"));
      expect(onReplay).toHaveBeenCalled();
    });

    it("renders versus-loss with Rematch", () => {
      const { getByText, queryByText } = render(
        <LevelResultOverlay
          {...baseProps}
          state="versus-loss"
          stars={null}
          hasNextLevel={false}
        />,
      );
      expect(getByText("Mem Beat You")).toBeTruthy();
      expect(queryByText("Next Level")).toBeNull();
      expect(getByText("Rematch")).toBeTruthy();
    });

    it("renders versus-draw with Rematch", () => {
      const { getByText, queryByText } = render(
        <LevelResultOverlay
          {...baseProps}
          state="versus-draw"
          stars={null}
          hasNextLevel={false}
        />,
      );
      expect(getByText("It's a Draw")).toBeTruthy();
      expect(queryByText("Next Level")).toBeNull();
      expect(getByText("Rematch")).toBeTruthy();
    });
  });
});
