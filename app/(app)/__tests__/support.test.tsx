/**
 * Screen-level coverage for the Support page (`app/(app)/support.tsx`,
 * Task #314 + Task #315). Apple's App Store submission requires a
 * working Support URL — this test locks in that the page renders all
 * six FAQ rows (questions AND answers), both LEGAL links resolve to
 * the public Privacy/Terms URLs, and the contact row opens the
 * `mailto:` URL via `Linking.openURL`. Without this, a refactor that
 * removes a FAQ row, re-points a legal URL, or changes the support
 * email could silently land in production and break App Review.
 *
 * We use the real `@/lib/legal` module so URL resolution is exercised
 * end-to-end. `expo-web-browser` and `react-native`'s `Linking` are
 * mocked at the platform boundary so we can assert the exact URLs.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
    push: jest.fn(),
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000",
    foreground: "#fff",
    card: "#111",
    border: "#222",
    primary: "#0af",
    accent: "#0ff",
    mutedForeground: "#888",
  }),
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(),
}));

const mockOpenBrowserAsync = jest.fn((_url: string) =>
  Promise.resolve({ type: "opened" }),
);
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (url: string) => mockOpenBrowserAsync(url),
}));

import { Linking } from "react-native";
const mockLinkingOpenURL = jest
  .spyOn(Linking, "openURL")
  .mockImplementation(() => Promise.resolve());

// Force the legal helpers to take their public-URL fallback branches
// (no API base configured, no env overrides). This pins the screen to
// the App Store-facing URLs. Originals are saved here and restored
// in afterAll so we don't leak into other test files in the worker.
const ENV_KEYS = [
  "EXPO_PUBLIC_PRIVACY_POLICY_URL",
  "EXPO_PUBLIC_TERMS_URL",
  "EXPO_PUBLIC_SUPPORT_EMAIL",
  "EXPO_PUBLIC_SUPPORT_URL",
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
  delete process.env[key];
}

import SupportScreen from "../support";

const FAQS: Array<{ question: string; answer: string }> = [
  {
    question: "How do I capture a thought?",
    answer: "Use voice or text input on the Home screen.",
  },
  {
    question: "Where is my AI recap?",
    answer:
      "In the AI chat screen — appears daily once you've logged 5 captures.",
  },
  {
    question: "How do I go Pro?",
    answer: "Settings → Subscription.",
  },
  {
    question: "Can I use voice recording?",
    answer: "Yes — voice capture is a Pro feature.",
  },
  {
    question: "Is my data private?",
    answer:
      "Yes — memories are stored locally unless you choose to share them.",
  },
  {
    question: "How do I restore my purchases?",
    answer: "Settings → Restore Purchases.",
  },
];

describe("SupportScreen (Task #315)", () => {
  afterAll(() => {
    for (const key of ENV_KEYS) {
      const original = ORIGINAL_ENV[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  beforeEach(() => {
    mockBack.mockReset();
    mockReplace.mockReset();
    mockCanGoBack.mockReset().mockReturnValue(true);
    mockOpenBrowserAsync.mockClear();
    mockLinkingOpenURL.mockClear();
  });

  it("renders title, intro, and all six FAQ questions and answers", () => {
    const { getByText } = render(<SupportScreen />);

    expect(getByText("MemTool Support")).toBeTruthy();
    expect(getByText("We're here to help.")).toBeTruthy();

    for (const { question, answer } of FAQS) {
      expect(getByText(question)).toBeTruthy();
      expect(getByText(answer)).toBeTruthy();
    }
  });

  it("renders the legal rows and the contact row", () => {
    const { getByLabelText } = render(<SupportScreen />);
    expect(getByLabelText("Open Privacy Policy")).toBeTruthy();
    expect(getByLabelText("Open Terms of Service")).toBeTruthy();
    expect(
      getByLabelText("Email MemTool support at support@oc2co.com"),
    ).toBeTruthy();
  });

  it("Privacy row opens https://www.oc2co.com/privacy", async () => {
    const { getByLabelText } = render(<SupportScreen />);
    fireEvent.press(getByLabelText("Open Privacy Policy"));
    await Promise.resolve();
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
      "https://www.oc2co.com/privacy",
    );
  });

  it("Terms row opens https://www.oc2co.com/terms", async () => {
    const { getByLabelText } = render(<SupportScreen />);
    fireEvent.press(getByLabelText("Open Terms of Service"));
    await Promise.resolve();
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
      "https://www.oc2co.com/terms",
    );
  });

  it("Email Support row calls Linking.openURL with the support mailto", async () => {
    const { getByLabelText } = render(<SupportScreen />);
    fireEvent.press(
      getByLabelText("Email MemTool support at support@oc2co.com"),
    );
    await Promise.resolve();
    expect(mockLinkingOpenURL).toHaveBeenCalledWith(
      "mailto:support@oc2co.com",
    );
  });

  it("Back button calls router.back when history is available", () => {
    mockCanGoBack.mockReturnValue(true);
    const { getByLabelText } = render(<SupportScreen />);
    fireEvent.press(getByLabelText("Back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("Back button falls back to router.replace('/') when no history", () => {
    mockCanGoBack.mockReturnValue(false);
    const { getByLabelText } = render(<SupportScreen />);
    fireEvent.press(getByLabelText("Back"));
    expect(mockReplace).toHaveBeenCalledWith("/");
    expect(mockBack).not.toHaveBeenCalled();
  });
});
