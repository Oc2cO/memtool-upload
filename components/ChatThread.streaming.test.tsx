/**
 * Tests for the word-by-word streaming reveal in `ChatThread`
 * (Task #283 step 5 + step 8).
 *
 * Coverage:
 *   - `sliceWords` returns the prefix of the input up to N words,
 *     preserving the spacing between words so a partial reveal
 *     reads naturally.
 *   - When a Mem bubble carries `visibleWordCount`, the rendered
 *     text shows only that many words, but the `accessibilityLabel`
 *     still carries the full text so VoiceOver reads the whole
 *     reply at once (per task brief).
 *   - The `showAvatars={false}` opt-out hides the in-bubble Mem
 *     avatar (used by the AI Guide screen, where Mem lives in a
 *     dedicated stage above the thread).
 */
import React from "react";
import { render } from "@testing-library/react-native";

import { ChatThread, sliceWords, type ChatMessage } from "./ChatThread";

const PALETTE = {
  bg: "#000",
  bgDeep: "#000",
  mem: "#FFD56F",
  hot: "#B47AFF",
  cool: "#6FE5FF",
  pink: "#FF8FB1",
  text: "#FFF",
  textMuted: "#999",
  card: "#111",
  border: "#222",
};

describe("sliceWords", () => {
  test("returns the empty string for count<=0", () => {
    expect(sliceWords("hello world", 0)).toBe("");
    expect(sliceWords("hello world", -1)).toBe("");
  });

  test("returns the full text when count exceeds word count", () => {
    expect(sliceWords("hi there", 99)).toBe("hi there");
  });

  test("slices to N words and preserves spacing between them", () => {
    expect(sliceWords("one two three four", 2)).toBe("one two");
    expect(sliceWords("one two three four", 3)).toBe("one two three");
  });

  test("preserves multi-character whitespace runs", () => {
    expect(sliceWords("hi —  Mem", 2)).toBe("hi —");
  });

  test("treats the empty string defensively", () => {
    expect(sliceWords("", 5)).toBe("");
  });
});

describe("ChatThread bubble streaming + avatar opt-out", () => {
  test("Mem bubble with visibleWordCount renders the partial text but keeps the full text in accessibilityLabel", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "mem",
        text: "Hi — I'm Mem and I'm listening.",
        visibleWordCount: 3,
      },
    ];
    const view = render(
      <ChatThread
        messages={messages}
        showTyping={false}
        palette={PALETTE}
        showAvatars={false}
      />,
    );
    // The visible text only carries the first 3 whitespace-
    // separated words ("Hi", "—", "I'm").
    const node = view.getByLabelText("Mem said: Hi — I'm Mem and I'm listening.");
    // The text inside the bubble is the streamed prefix.
    expect(node.props.children).toBe("Hi — I'm");
  });

  test("Mem bubble without visibleWordCount renders the full text", () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "mem", text: "Whole reply." },
    ];
    const view = render(
      <ChatThread messages={messages} showTyping={false} palette={PALETTE} />,
    );
    const node = view.getByLabelText("Mem said: Whole reply.");
    expect(node.props.children).toBe("Whole reply.");
  });

  test("default showAvatars (omitted prop, as onboarding-chat.tsx uses it) keeps the in-bubble Mem avatar — regression guard for Task #283", () => {
    // The AI Guide screen passes `showAvatars={false}` because the
    // big Mem character lives in the dedicated stage above the
    // thread. Every OTHER ChatThread consumer — most importantly
    // `app/onboarding-chat.tsx` — relies on the default behavior
    // and does NOT pass `showAvatars`. This test pins the default
    // so a future tweak to the prop default can't silently strip
    // the in-bubble avatar from onboarding chat.
    const messages: ChatMessage[] = [
      { id: "m1", role: "mem", text: "hello" },
    ];
    // Render exactly like `app/onboarding-chat.tsx` does: no
    // `showAvatars` prop at all.
    const onboardingLike = render(
      <ChatThread messages={messages} showTyping={false} palette={PALETTE} />,
    );
    // Same messages with `showAvatars={false}` — the AI Guide
    // path. This produces strictly fewer view nodes (the avatar
    // wrapper + its 36×36 spacer are dropped).
    const aiGuideLike = render(
      <ChatThread
        messages={messages}
        showTyping={false}
        palette={PALETTE}
        showAvatars={false}
      />,
    );
    const onboardingLen = JSON.stringify(onboardingLike.toJSON()).length;
    const aiGuideLen = JSON.stringify(aiGuideLike.toJSON()).length;
    // Default render must include MORE nodes than the avatar-
    // suppressed render — i.e. the avatar wrapper is in the
    // default tree. If a future refactor flips the default to
    // `false`, these lengths would equalize and this test fails
    // loudly.
    expect(onboardingLen).toBeGreaterThan(aiGuideLen);
  });

  test("showAvatars=false hides the in-bubble Mem avatar wrapper", () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "mem", text: "hello" },
    ];
    const withAvatars = render(
      <ChatThread
        messages={messages}
        showTyping={false}
        palette={PALETTE}
        showAvatars={true}
      />,
    );
    const withoutAvatars = render(
      <ChatThread
        messages={messages}
        showTyping={false}
        palette={PALETTE}
        showAvatars={false}
      />,
    );
    // The hidden-avatar render produces strictly fewer view nodes
    // than the visible-avatar render (the avatar wrapper + its
    // 36×36 spacer are dropped). Comparing the toJSON tree string
    // length is a robust proxy without coupling to a fragile
    // testID we'd have to add to the component.
    const withLen = JSON.stringify(withAvatars.toJSON()).length;
    const withoutLen = JSON.stringify(withoutAvatars.toJSON()).length;
    expect(withoutLen).toBeLessThan(withLen);
  });
});
