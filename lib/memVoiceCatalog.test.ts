/**
 * Unit coverage for the curated voice catalog (Task #292), pinned
 * around the cross-device fallback the brief calls out:
 *
 *   "falls back gracefully if saved voice id isn't installed on
 *    current device"
 *
 * The two pieces that enforce this guarantee are:
 *   - `isInstalledVoice(savedId, catalog)` — pure helper used by
 *     Settings to gate its checkmark on whether the saved id is
 *     actually present in the catalog this device resolved.
 *   - `getCuratedMemVoices()` — always returns at least the
 *     "System default" pseudo-voice (`id: null`), so even devices
 *     with no installed voices still get a usable selector and
 *     `isInstalledVoice` has something to compare against.
 *
 * Together these mean: a "Warm" pick made on iOS won't orphan the
 * Settings selection or strand `useMemSpeech` with an unknown id
 * when the same user later opens MemTool on Android.
 */

import * as Speech from "expo-speech";

import {
  getCuratedMemVoices,
  getRecommendedDefaultVoiceId,
  isInstalledVoice,
  type CuratedMemVoice,
} from "./memVoiceCatalog";

const mockedGetAvailableVoicesAsync =
  Speech.getAvailableVoicesAsync as jest.MockedFunction<
    typeof Speech.getAvailableVoicesAsync
  >;

beforeEach(() => {
  mockedGetAvailableVoicesAsync.mockReset();
});

describe("isInstalledVoice", () => {
  const catalog: CuratedMemVoice[] = [
    {
      id: null,
      label: "System default",
      subtitle: "",
      tier: "system",
      gender: "neutral",
    },
    {
      id: "com.apple.voice.Samantha",
      label: "Warm",
      subtitle: "",
      tier: "enhanced",
      gender: "female",
    },
  ];

  it("treats the system default pseudo-voice as always installed", () => {
    // `null` is a sentinel — selecting "System default" clears the
    // saved id rather than persisting one — so it must always be
    // considered installed regardless of catalog contents.
    expect(isInstalledVoice(null, catalog)).toBe(true);
    expect(isInstalledVoice(null, [])).toBe(true);
  });

  it("returns true when the saved id is present in the catalog", () => {
    expect(isInstalledVoice("com.apple.voice.Samantha", catalog)).toBe(true);
  });

  it("returns false when the saved id is missing on this device", () => {
    // This is the critical cross-device case: the user picked "Warm"
    // on an iPhone, so `mem_voice_id:<userId>` holds Samantha's id
    // — but on this Android device the catalog only has the system
    // default. Settings collapses the missing id to "System default"
    // for display, and `useEffectiveMemVoiceId` collapses it to
    // `null` for the speech path so Mem still talks.
    const androidCatalog: CuratedMemVoice[] = [
      {
        id: null,
        label: "System default",
        subtitle: "",
        tier: "system",
        gender: "neutral",
      },
    ];
    expect(
      isInstalledVoice("com.apple.voice.Samantha", androidCatalog),
    ).toBe(false);
  });
});

describe("getCuratedMemVoices", () => {
  it("returns the System default entry even when no voices are installed", async () => {
    // Devices without TTS installed (or with the enumeration call
    // silently returning empty) still need a working selector — the
    // pseudo-voice keeps the picker section renderable and gives
    // `isInstalledVoice` something to anchor on.
    mockedGetAvailableVoicesAsync.mockResolvedValueOnce([]);
    const list = await getCuratedMemVoices();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toEqual(
      expect.objectContaining({ id: null, label: "System default" }),
    );
  });

  it("returns only the System default entry when the enumeration throws", async () => {
    // `Speech.getAvailableVoicesAsync()` can reject on platforms
    // where TTS is unavailable. The catalog must collapse to a
    // single-entry list rather than propagating the rejection —
    // Settings still renders, just without alternative picks.
    mockedGetAvailableVoicesAsync.mockRejectedValueOnce(
      new Error("no TTS available"),
    );
    const list = await getCuratedMemVoices();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBeNull();
  });

  it("promotes Apple's Premium Ava voice with the recommended flag", async () => {
    // First-launch users should hear Ava (the curated calming
    // default) — but ONLY when the Premium tier is actually installed
    // on the device. A Compact "Ava" must NOT match, because that's
    // the robotic voice the user explicitly wanted us to move away from.
    mockedGetAvailableVoicesAsync.mockResolvedValueOnce([
      {
        identifier: "com.apple.voice.compact.en-US.Ava",
        name: "Ava",
        language: "en-US",
        quality: Speech.VoiceQuality.Default,
      },
      {
        identifier: "com.apple.voice.premium.en-US.Ava",
        name: "Ava",
        language: "en-US",
        quality: Speech.VoiceQuality.Enhanced,
      },
    ]);
    const list = await getCuratedMemVoices();
    const ava = list.find((v) => v.id === "com.apple.voice.premium.en-US.Ava");
    expect(ava).toBeDefined();
    expect(ava?.tier).toBe("premium");
    expect(ava?.gender).toBe("female");
    expect(ava?.recommended).toBe(true);
  });
});

describe("getRecommendedDefaultVoiceId", () => {
  it("prefers a Premium recommended voice (Ava) over any other tier", () => {
    const catalog: CuratedMemVoice[] = [
      { id: null, label: "System default", subtitle: "", tier: "system", gender: "neutral" },
      { id: "ava-premium", label: "Ava — Calm", subtitle: "", tier: "premium", gender: "female", recommended: true },
      { id: "samantha-enh", label: "Samantha — Warm", subtitle: "", tier: "enhanced", gender: "female" },
    ];
    expect(getRecommendedDefaultVoiceId(catalog)).toBe("ava-premium");
  });

  it("falls back to any Premium voice when no recommended one is installed", () => {
    const catalog: CuratedMemVoice[] = [
      { id: null, label: "System default", subtitle: "", tier: "system", gender: "neutral" },
      { id: "zoe-premium", label: "Zoe — Soft", subtitle: "", tier: "premium", gender: "female" },
      { id: "samantha-enh", label: "Samantha — Warm", subtitle: "", tier: "enhanced", gender: "female" },
    ];
    expect(getRecommendedDefaultVoiceId(catalog)).toBe("zoe-premium");
  });

  it("falls back to Enhanced when no Premium voice is installed", () => {
    const catalog: CuratedMemVoice[] = [
      { id: null, label: "System default", subtitle: "", tier: "system", gender: "neutral" },
      { id: "samantha-enh", label: "Samantha — Warm", subtitle: "", tier: "enhanced", gender: "female" },
    ];
    expect(getRecommendedDefaultVoiceId(catalog)).toBe("samantha-enh");
  });

  it("returns null (= system default) when only the System Default pseudo-voice is in the catalog", () => {
    const catalog: CuratedMemVoice[] = [
      { id: null, label: "System default", subtitle: "", tier: "system", gender: "neutral" },
    ];
    expect(getRecommendedDefaultVoiceId(catalog)).toBeNull();
  });
});
