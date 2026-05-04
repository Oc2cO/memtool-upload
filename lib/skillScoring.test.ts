/**
 * Scoring + round-shape tests (Task #337).
 *
 * Pinning the determinism of `build*Round(seed)` is critical: it's
 * what makes friend challenges fair. If a seed produces a different
 * sequence on the sender's phone vs the recipient's, the comparison
 * shown at end-of-round is meaningless. These tests also lock in
 * the score curves that the bundle paywall copy ("perfect echo: 100
 * pts") implicitly promises.
 */

import {
  buildEchoCountRound,
  buildMemSaysRound,
  buildPatternPathRound,
  buildSignalSortRound,
  deriveSkillSeed,
  makeRng,
  scoreEchoCount,
  scoreMemSays,
  scorePatternPath,
  scoreSignalSort,
} from "./skillScoring";

describe("makeRng", () => {
  it("is deterministic for the same seed", () => {
    const a = makeRng(1234);
    const b = makeRng(1234);
    for (let i = 0; i < 32; i++) expect(a.next()).toBe(b.next());
  });
  it("yields different streams for different seeds", () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next());
  });
});

describe("deriveSkillSeed", () => {
  it("differs across skills for the same base seed", () => {
    const a = deriveSkillSeed("mem_says", 42);
    const b = deriveSkillSeed("signal_sort", 42);
    const c = deriveSkillSeed("echo_count", 42);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });
});

describe("buildMemSaysRound + scoreMemSays", () => {
  it("is deterministic for a fixed seed", () => {
    const a = buildMemSaysRound(99);
    const b = buildMemSaysRound(99);
    expect(a.sequence).toEqual(b.sequence);
  });
  it("rewards a perfect fast echo with the speed bonus", () => {
    const round = buildMemSaysRound(7);
    const score = scoreMemSays({
      round,
      echoed: [...round.sequence],
      elapsedSec: round.parTimeSec - 1,
    });
    expect(score).toBe(round.sequence.length * 100 + 25);
  });
  it("scores partial echoes at the longest correct prefix", () => {
    const round = buildMemSaysRound(7);
    const wrong = [...round.sequence];
    wrong[1] = wrong[1] === "red" ? "blue" : "red";
    expect(
      scoreMemSays({ round, echoed: wrong, elapsedSec: 100 }),
    ).toBe(100); // only the first colour was correct
  });
});

describe("buildSignalSortRound + scoreSignalSort", () => {
  it("scores all-correct as length × 50", () => {
    const round = buildSignalSortRound(13);
    const answers = round.signals.map((s) => s.correctBin);
    expect(scoreSignalSort({ round, answers })).toBe(round.signals.length * 50);
  });
  it("subtracts 10 per wrong answer and floors at 0", () => {
    const round = buildSignalSortRound(13);
    const flipped: ("left" | "right")[] = round.signals.map((s) =>
      s.correctBin === "left" ? "right" : "left",
    );
    expect(scoreSignalSort({ round, answers: flipped })).toBe(0);
  });
});

describe("buildPatternPathRound + scorePatternPath", () => {
  it("yields a path of distinct cells", () => {
    const round = buildPatternPathRound(21);
    const seen = new Set(round.path.map((c) => `${c.row},${c.col}`));
    expect(seen.size).toBe(round.path.length);
  });
  it("perfect retrace earns the bonus", () => {
    const round = buildPatternPathRound(21);
    const score = scorePatternPath({ round, trace: [...round.path] });
    expect(score).toBe(round.path.length * 75 + 50);
  });
});

describe("buildEchoCountRound + scoreEchoCount", () => {
  it("100 for an exact guess", () => {
    const round = buildEchoCountRound(5);
    expect(scoreEchoCount({ round, guess: round.count })).toBe(100);
  });
  it("loses 25 per off-by-one", () => {
    const round = buildEchoCountRound(5);
    expect(scoreEchoCount({ round, guess: round.count + 1 })).toBe(75);
    expect(scoreEchoCount({ round, guess: round.count + 4 })).toBe(0);
  });
  it("rejects non-finite guesses gracefully", () => {
    const round = buildEchoCountRound(5);
    expect(scoreEchoCount({ round, guess: Number.NaN })).toBe(0);
  });
});
