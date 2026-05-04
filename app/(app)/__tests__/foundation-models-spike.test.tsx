/**
 * Screen-level coverage for the FoundationModels latency-bench
 * additions in Task #197 — the cold/warm banner, the input-size
 * presets, and the runs-log accumulation. The Swift bridge cannot run
 * in jest, so we mock the native module surface and drive the screen
 * through the same `useOnDeviceSummary` hook the production code uses.
 *
 * Task #196: mock now uses the streaming API (`summarizeStream` +
 * `addListener`) rather than the one-shot `summarize` Promise.
 * `fireStreamDone` drives the mock to simulate a completed stream,
 * which is how the screen's `handleRun` callback gets a result.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import {
  __resetNativeModuleForTests,
  __setNativeModuleForTests,
} from "../../../modules/foundation-models";
import FoundationModelsSpikeScreen from "../_dev/foundation-models-spike";

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    text: "#000",
    foreground: "#000",
    mutedForeground: "#666",
    card: "#fafafa",
    border: "#ccc",
    primaryAction: "#007aff",
    muted: "#eee",
    accent: "#0a0",
    destructive: "#a00",
  }),
}));

// ---------------------------------------------------------------------------
// Streaming mock helpers (mirrors the pattern in useOnDeviceSummary.test.ts)
// ---------------------------------------------------------------------------

type EventHandler = (e: Record<string, unknown>) => void;

function makeStreamingMock(opts?: {
  getAvailability?: () => { available: boolean; reason: string | null };
}) {
  const listeners: Record<string, EventHandler[]> = {};

  const addListener = jest.fn(
    (eventName: string, handler: EventHandler) => {
      if (!listeners[eventName]) listeners[eventName] = [];
      listeners[eventName].push(handler);
      return {
        remove: () => {
          listeners[eventName] = (listeners[eventName] ?? []).filter(
            (h) => h !== handler,
          );
        },
      };
    },
  );

  const summarizeStream = jest.fn((_text: string) => {
    // Intentionally does nothing — tests fire events explicitly.
  });

  const cancelSummarizeStream = jest.fn();

  const fire = (eventName: string, payload: Record<string, unknown>) => {
    for (const h of listeners[eventName] ?? []) h(payload);
  };

  const fireChunk = (chunk: string) => fire("onSummarizeChunk", { chunk });
  const fireDone = (latencyMs: number, approxTokens: number) =>
    fire("onSummarizeDone", { latencyMs, approxTokens });

  const mock = {
    getAvailability:
      opts?.getAvailability ?? (() => ({ available: true, reason: null })),
    summarize: jest.fn(),
    summarizeStream,
    cancelSummarizeStream,
    extractFacets: jest.fn().mockResolvedValue({
      status: "unavailable",
      reason: "module_not_linked",
    }),
    addListener,
  };

  return { mock, summarizeStream, fireChunk, fireDone };
}

let currentMock: ReturnType<typeof makeStreamingMock>;

beforeEach(() => {
  currentMock = makeStreamingMock();
  __setNativeModuleForTests(currentMock.mock);
});

afterEach(() => {
  __resetNativeModuleForTests();
});

describe("FoundationModelsSpikeScreen — latency bench", () => {
  it("renders the cold-state banner and flips to WARM after the first run", async () => {
    const { getByTestId, queryByTestId } = render(
      <FoundationModelsSpikeScreen />,
    );

    const banner = getByTestId("fm-spike-cold-banner");
    expect(banner).toBeTruthy();

    // Start a run and complete it via streaming events
    act(() => {
      fireEvent.press(getByTestId("fm-spike-run"));
    });

    await act(async () => {
      currentMock.fireChunk("Summary of the memory.");
      currentMock.fireDone(1200, 32);
    });

    await waitFor(() => {
      expect(queryByTestId("fm-spike-runs-log")).not.toBeNull();
    });

    // The first row should be labeled cold
    expect(queryByTestId("fm-spike-runs-row-cold")).not.toBeNull();
    expect(queryByTestId("fm-spike-runs-row-warm")).toBeNull();
  });

  it("labels subsequent runs as warm once cold-start is consumed", async () => {
    const { getByTestId, getAllByTestId, queryByTestId } = render(
      <FoundationModelsSpikeScreen />,
    );

    // First run — cold
    act(() => {
      fireEvent.press(getByTestId("fm-spike-run"));
    });
    await act(async () => {
      currentMock.fireChunk("First summary.");
      currentMock.fireDone(1200, 30);
    });
    await waitFor(() => {
      expect(queryByTestId("fm-spike-runs-row-cold")).not.toBeNull();
    });

    // Second run — warm
    act(() => {
      fireEvent.press(getByTestId("fm-spike-run"));
    });
    await act(async () => {
      currentMock.fireChunk("Second summary.");
      currentMock.fireDone(800, 28);
    });
    await waitFor(() => {
      expect(getAllByTestId("fm-spike-runs-row-warm").length).toBeGreaterThan(0);
    });

    // Still exactly one cold row
    expect(getAllByTestId("fm-spike-runs-row-cold").length).toBe(1);
  });

  it("input-size presets fill the textarea so the next run measures that size", async () => {
    const { getByTestId, queryByTestId } = render(
      <FoundationModelsSpikeScreen />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("fm-spike-preset-large"));
    });

    act(() => {
      fireEvent.press(getByTestId("fm-spike-run"));
    });

    await act(async () => {
      currentMock.fireChunk("Large input summary.");
      currentMock.fireDone(4200, 32);
    });

    await waitFor(() => {
      expect(queryByTestId("fm-spike-runs-log")).not.toBeNull();
    });

    // The mock receives the textarea content; large preset is ~4000 chars.
    const lastCallArg = currentMock.summarizeStream.mock.calls.at(-1)?.[0] as string;
    expect(lastCallArg.length).toBeGreaterThan(3500);
    expect(lastCallArg.length).toBeLessThanOrEqual(4000);
  });
});
