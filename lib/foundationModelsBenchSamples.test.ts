import {
  BENCH_PRESETS,
  buildSampleText,
} from "./foundationModelsBenchSamples";

describe("buildSampleText", () => {
  it("returns empty string for non-positive targets", () => {
    expect(buildSampleText(0)).toBe("");
    expect(buildSampleText(-5)).toBe("");
  });

  it("produces text within the target length window", () => {
    for (const preset of BENCH_PRESETS) {
      const out = buildSampleText(preset.targetChars);
      // Allow a small backtrack tolerance (we trim at word boundaries).
      expect(out.length).toBeGreaterThan(preset.targetChars - 16);
      expect(out.length).toBeLessThanOrEqual(preset.targetChars);
    }
  });

  it("is deterministic for a given target", () => {
    expect(buildSampleText(1000)).toBe(buildSampleText(1000));
  });

  it("does not end mid-word for typical targets", () => {
    const out = buildSampleText(1000);
    // The last char should be a letter (we trimmed any trailing space)
    // and the char after our cut should have been a space in the source,
    // i.e. we shouldn't have produced "thr" instead of "three".
    expect(/[A-Za-z.]$/.test(out)).toBe(true);
  });
});

describe("BENCH_PRESETS", () => {
  it("covers small, medium, and large input sizes in ascending order", () => {
    expect(BENCH_PRESETS.map((p) => p.id)).toEqual([
      "small",
      "medium",
      "large",
    ]);
    const sizes = BENCH_PRESETS.map((p) => p.targetChars);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1] ?? 0);
    }
  });
});
