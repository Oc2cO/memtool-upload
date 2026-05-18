import {
  extractFromTranscript,
  getVoiceCaptureProviders,
  isFoundationModelsAvailable,
  isStreamingTranscriptionAvailable,
  isSpeechToTextAvailable,
  resetVoiceCaptureProviders,
  setSpeechToTextProvider,
  setSpeechToTextStreamProvider,
  setStructuredExtractor,
  startStreamingTranscription,
  transcribeRecording,
} from "./voiceCapture";
import type { StructuredMemoryDraft } from "./voiceMemoryPipeline";

beforeEach(() => {
  resetVoiceCaptureProviders();
});

describe("provider registry defaults", () => {
  it("has no providers registered at boot", () => {
    expect(isSpeechToTextAvailable()).toBe(false);
    expect(isFoundationModelsAvailable()).toBe(false);
    expect(isStreamingTranscriptionAvailable()).toBe(false);
    const reg = getVoiceCaptureProviders();
    expect(reg.stt).toBeNull();
    expect(reg.stream).toBeNull();
    expect(reg.extractor).toBeNull();
  });
});

describe("transcribeRecording", () => {
  it("rejects with a user-readable message when no provider is registered", async () => {
    await expect(transcribeRecording("file://recording.m4a")).rejects.toThrow(
      "Voice transcription is not available in this installed build. Install a build that includes voice transcription.",
    );
  });

  it("delegates to the registered provider", async () => {
    const provider = jest.fn(async (_uri: string) => "hello world");
    setSpeechToTextProvider(provider);
    const out = await transcribeRecording("file://x.m4a");
    expect(out).toBe("hello world");
    expect(provider).toHaveBeenCalledWith("file://x.m4a");
  });

  it("coerces a non-string return into an empty string", async () => {
    // A misbehaving native bridge could return undefined / null —
    // the screen would then crash on `.length`. Coerce here so the
    // facade is the failure boundary, not the UI.
    setSpeechToTextProvider(async () => undefined as unknown as string);
    const out = await transcribeRecording("file://x.m4a");
    expect(out).toBe("");
  });
});

describe("extractFromTranscript", () => {
  it("falls through to the heuristic when no extractor is registered", async () => {
    const draft = await extractFromTranscript(
      "I called Sarah today and felt grateful",
    );
    expect(draft.isEmpty).toBe(false);
    expect(draft.people).toContain("Sarah");
    expect(draft.tone).toBe("happy");
  });

  it("uses the registered extractor when present", async () => {
    const native: StructuredMemoryDraft = {
      title: "Native title",
      body: "Native body",
      tags: ["work"],
      people: ["Alice"],
      tone: "calm",
      isEmpty: false,
    };
    setStructuredExtractor(async () => native);
    const draft = await extractFromTranscript("anything");
    expect(draft).toEqual(native);
  });

  it("falls back to the heuristic if the native extractor throws", async () => {
    setStructuredExtractor(async () => {
      throw new Error("native model crashed");
    });
    const draft = await extractFromTranscript(
      "I felt happy at the gym today",
    );
    expect(draft.isEmpty).toBe(false);
    expect(draft.tone).toBe("happy");
    expect(draft.tags).toContain("health");
  });

  it("falls back to the heuristic if the native extractor returns a malformed shape", async () => {
    setStructuredExtractor(
      async () => ({ title: 42 } as unknown as StructuredMemoryDraft),
    );
    const draft = await extractFromTranscript("I went for a run");
    expect(draft.isEmpty).toBe(false);
    expect(draft.body.toLowerCase()).toContain("run");
    expect(draft.tags).toContain("health");
  });
});

describe("provider availability flags", () => {
  it("flips when providers register", () => {
    expect(isSpeechToTextAvailable()).toBe(false);
    setSpeechToTextProvider(async () => "");
    expect(isSpeechToTextAvailable()).toBe(true);

    expect(isStreamingTranscriptionAvailable()).toBe(false);
    setSpeechToTextStreamProvider(async () => ({ stop: async () => null }));
    expect(isStreamingTranscriptionAvailable()).toBe(true);

    expect(isFoundationModelsAvailable()).toBe(false);
    setStructuredExtractor(async () => ({
      title: "",
      body: "",
      tags: [],
      people: [],
      tone: "neutral",
      isEmpty: true,
    }));
    expect(isFoundationModelsAvailable()).toBe(true);
  });
});

describe("startStreamingTranscription", () => {
  it("returns null when no stream provider is registered", async () => {
    const session = await startStreamingTranscription({ onPartial: jest.fn() });
    expect(session).toBeNull();
  });

  it("delegates to the registered provider", async () => {
    const mockSession = { stop: jest.fn(async () => "streamed text") };
    const provider = jest.fn(async () => mockSession);
    setSpeechToTextStreamProvider(provider);

    const onPartial = jest.fn();
    const session = await startStreamingTranscription({ onPartial });

    expect(provider).toHaveBeenCalledWith({ onPartial });
    expect(session).toBe(mockSession);
  });

  it("returns null (instead of throwing) when the provider throws", async () => {
    setSpeechToTextStreamProvider(async () => {
      throw new Error("mic permission denied");
    });
    const session = await startStreamingTranscription({ onPartial: jest.fn() });
    expect(session).toBeNull();
  });

  it("resetVoiceCaptureProviders clears the stream slot", () => {
    setSpeechToTextStreamProvider(async () => ({ stop: async () => null }));
    expect(isStreamingTranscriptionAvailable()).toBe(true);
    resetVoiceCaptureProviders();
    expect(isStreamingTranscriptionAvailable()).toBe(false);
    expect(getVoiceCaptureProviders().stream).toBeNull();
  });
});
