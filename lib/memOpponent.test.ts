import {
  chooseMemoryMatchPick,
  game24ConcedeProbability,
  game24ShouldConcede,
  game24ThinkingDelayMs,
  makeSeedableRng,
  MEM_VOICE_LINES,
  memoryMatchRecallProbability,
  pickMemLine,
  scheduleMemSubmission,
  type MemEvent,
} from "./memOpponent";
import { LEVELS_PER_GAME } from "./gameLevels";

describe("makeSeedableRng", () => {
  it("is deterministic for the same seed", () => {
    const a = makeSeedableRng(42);
    const b = makeSeedableRng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs across seeds", () => {
    const a = makeSeedableRng(1);
    const b = makeSeedableRng(2);
    expect(a.next()).not.toBe(b.next());
  });
});

describe("memoryMatchRecallProbability", () => {
  it("is forgetful at level 1 and near-perfect at level 30", () => {
    expect(memoryMatchRecallProbability(1)).toBeCloseTo(0.25, 3);
    expect(memoryMatchRecallProbability(LEVELS_PER_GAME)).toBeCloseTo(0.95, 3);
  });

  it("difficulty offsets recall independently of level (Task #330)", () => {
    // Hard on an early level should out-recall Normal; Easy on a late
    // level should under-recall Normal — the whole point of the
    // player-selectable toggle.
    expect(memoryMatchRecallProbability(1, "hard")).toBeGreaterThan(
      memoryMatchRecallProbability(1, "normal"),
    );
    expect(memoryMatchRecallProbability(1, "easy")).toBeLessThan(
      memoryMatchRecallProbability(1, "normal"),
    );
    expect(memoryMatchRecallProbability(LEVELS_PER_GAME, "easy")).toBeLessThan(
      memoryMatchRecallProbability(LEVELS_PER_GAME, "normal"),
    );
  });

  it("clamps difficulty-adjusted recall into a sensible range", () => {
    for (let lvl = 1; lvl <= LEVELS_PER_GAME; lvl++) {
      for (const d of ["easy", "normal", "hard"] as const) {
        const p = memoryMatchRecallProbability(lvl, d);
        expect(p).toBeGreaterThanOrEqual(0.05);
        expect(p).toBeLessThanOrEqual(0.99);
      }
    }
  });

  it("is monotonically non-decreasing across levels", () => {
    let prev = -Infinity;
    for (let lvl = 1; lvl <= LEVELS_PER_GAME; lvl++) {
      const p = memoryMatchRecallProbability(lvl);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("clamps out-of-range levels", () => {
    expect(memoryMatchRecallProbability(0)).toBe(memoryMatchRecallProbability(1));
    expect(memoryMatchRecallProbability(999)).toBe(
      memoryMatchRecallProbability(LEVELS_PER_GAME),
    );
  });
});

describe("chooseMemoryMatchPick", () => {
  it("flips a remembered known pair when one exists at high recall", () => {
    // At level 30 recall ~0.95 — both revealed entries will be in the
    // remembered set with very high probability.
    const revealed = new Map<number, string>([
      [0, "🍎"],
      [3, "🍎"],
    ]);
    const matched = new Set<number>();
    const rng = makeSeedableRng(7);
    const pick = chooseMemoryMatchPick({
      revealed,
      matched,
      totalCards: 8,
      rng,
      level: 30,
    });
    expect(new Set([pick.first, pick.second])).toEqual(new Set([0, 3]));
  });

  it("returns two distinct unmatched indices", () => {
    const revealed = new Map<number, string>();
    const matched = new Set<number>([0, 1]);
    const rng = makeSeedableRng(123);
    const pick = chooseMemoryMatchPick({
      revealed,
      matched,
      totalCards: 6,
      rng,
      level: 5,
    });
    expect(pick.first).not.toBe(pick.second);
    expect(matched.has(pick.first)).toBe(false);
    expect(matched.has(pick.second)).toBe(false);
    expect(pick.first).toBeGreaterThanOrEqual(0);
    expect(pick.first).toBeLessThan(6);
    expect(pick.second).toBeGreaterThanOrEqual(0);
    expect(pick.second).toBeLessThan(6);
  });

  it("is deterministic given the same seed and state", () => {
    const make = () =>
      chooseMemoryMatchPick({
        revealed: new Map(),
        matched: new Set(),
        totalCards: 12,
        rng: makeSeedableRng(99),
        level: 4,
      });
    expect(make()).toEqual(make());
  });
});

describe("game24ThinkingDelayMs", () => {
  it("is faster on later levels (median lower at L30 than L1)", () => {
    const samples = (level: number) => {
      const xs: number[] = [];
      for (let i = 0; i < 200; i++) {
        xs.push(game24ThinkingDelayMs(level, makeSeedableRng(1000 + i)));
      }
      xs.sort((a, b) => a - b);
      return xs[Math.floor(xs.length / 2)];
    };
    expect(samples(30)).toBeLessThan(samples(1));
  });

  it("never falls below the 1500ms floor", () => {
    for (let i = 0; i < 50; i++) {
      const ms = game24ThinkingDelayMs(30, makeSeedableRng(2000 + i));
      expect(ms).toBeGreaterThanOrEqual(1500);
    }
  });

  it("is deterministic for the same seed", () => {
    expect(game24ThinkingDelayMs(10, makeSeedableRng(5))).toBe(
      game24ThinkingDelayMs(10, makeSeedableRng(5)),
    );
  });

  it("difficulty scales the delay independently of level (Task #330)", () => {
    // Same seed → identical jitter, so any delta comes from the
    // difficulty multiplier alone. Easy makes Mem slower (longer
    // delay); Hard makes Mem faster (shorter delay).
    const seed = 4242;
    const easy = game24ThinkingDelayMs(15, makeSeedableRng(seed), "easy");
    const normal = game24ThinkingDelayMs(15, makeSeedableRng(seed), "normal");
    const hard = game24ThinkingDelayMs(15, makeSeedableRng(seed), "hard");
    expect(easy).toBeGreaterThan(normal);
    expect(hard).toBeLessThan(normal);
  });
});

describe("game24 concede", () => {
  it("probability decays from early to late levels", () => {
    expect(game24ConcedeProbability(1)).toBeGreaterThan(
      game24ConcedeProbability(LEVELS_PER_GAME),
    );
    expect(game24ConcedeProbability(LEVELS_PER_GAME)).toBeGreaterThanOrEqual(
      0.05,
    );
  });

  it("game24ShouldConcede is deterministic given a seed", () => {
    expect(game24ShouldConcede(5, makeSeedableRng(11))).toBe(
      game24ShouldConcede(5, makeSeedableRng(11)),
    );
  });
});

describe("scheduleMemSubmission", () => {
  it("invokes onSubmit after the calibrated delay", () => {
    const onSubmit = jest.fn();
    let scheduled: { cb: () => void; ms: number } | null = null;
    const setTimeoutFn = (cb: () => void, ms: number) => {
      scheduled = { cb, ms };
      return 1;
    };
    const clearTimeoutFn = jest.fn();
    const { delayMs } = scheduleMemSubmission({
      level: 5,
      rng: makeSeedableRng(123),
      onSubmit,
      setTimeoutFn,
      clearTimeoutFn,
    });
    expect(delayMs).toBeGreaterThan(0);
    expect(scheduled).not.toBeNull();
    expect(scheduled!.ms).toBe(delayMs);
    scheduled!.cb();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("regression: cancel suppresses an already-fired timeout so exiting a versus match does not record a phantom loss", () => {
    // Models: user starts versus → presses Back before Mem's timeout
    // resolves → setTimeout fires its queued callback → onSubmit MUST
    // NOT run. Without the cancel latch, leaving the screen would
    // record a spurious versus loss against the user's stats.
    const onSubmit = jest.fn();
    let firedCb: (() => void) | null = null;
    const setTimeoutFn = (cb: () => void) => {
      firedCb = cb;
      return 42;
    };
    const clearTimeoutFn = jest.fn();
    const { cancel } = scheduleMemSubmission({
      level: 8,
      rng: makeSeedableRng(7),
      onSubmit,
      setTimeoutFn,
      clearTimeoutFn,
    });
    cancel();
    expect(clearTimeoutFn).toHaveBeenCalledWith(42);
    // Even if the host scheduler had already queued the callback
    // before clearTimeout took effect, the latch must still suppress
    // the submission.
    firedCb!();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("pickMemLine", () => {
  it("returns a line from the catalog for every event", () => {
    const events: MemEvent[] = [
      "your-turn",
      "user-match",
      "user-mismatch",
      "mem-match",
      "mem-mismatch",
      "mem-thinking",
      "mem-wins",
      "user-wins",
      "draw",
    ];
    for (const event of events) {
      const line = pickMemLine(event, makeSeedableRng(event.length + 1));
      expect(MEM_VOICE_LINES[event]).toContain(line);
    }
  });

  it("avoids the previous line when alternatives exist", () => {
    const event: MemEvent = "your-turn";
    const pool = MEM_VOICE_LINES[event];
    const last = pool[0];
    for (let seed = 1; seed < 30; seed++) {
      const next = pickMemLine(event, makeSeedableRng(seed), last);
      expect(next).not.toBe(last);
    }
  });
});
