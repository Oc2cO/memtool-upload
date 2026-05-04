import { VISEME_INDEX, type VisemeKey } from "@/components/Memora";

/**
 * Lightweight English text → viseme stream heuristic.
 *
 * `expo-speech` does not expose phoneme timing on iOS or Android,
 * but it does fire `onBoundary` per word. That gives us a reliable
 * "this word starts now" anchor; we generate a per-word viseme
 * sequence at a fixed cadence between boundaries.
 *
 * We map each character to one of the 7 viseme codes
 * (see `VISEME_INDEX`) using broad letter-class buckets that match
 * real English mouth shapes well enough to read as lip-sync at
 * normal video distance:
 *
 *   - vowels (a, i, e, y) → AI / E  (open + smile-open)
 *   - vowels (o)          → O       (round)
 *   - vowels (u, w)       → U       (puckered)
 *   - bilabials (m, b, p) → MBP     (lips closed)
 *   - labiodentals (f, v) → FV      (lower lip on teeth)
 *   - everything else     → E or rest
 *
 * Consecutive identical visemes are collapsed and the rest viseme
 * is inserted at word boundaries so the mouth has a beat between
 * words.
 */

export interface VisemeFrame {
  /** Viseme integer code, see `VISEME_INDEX`. */
  code: number;
  /** Viseme name for debugging / tests. */
  key: VisemeKey;
}

function classify(ch: string): VisemeKey {
  const c = ch.toLowerCase();
  if (c === "m" || c === "b" || c === "p") return "MBP";
  if (c === "f" || c === "v") return "FV";
  if (c === "o") return "O";
  if (c === "u" || c === "w") return "U";
  if (c === "a" || c === "i" || c === "y") return "AI";
  if (c === "e") return "E";
  if (c === "h" || c === "r" || c === "l" || c === "n") return "E";
  return "rest";
}

export function wordToVisemes(word: string): VisemeFrame[] {
  const out: VisemeFrame[] = [];
  let last: VisemeKey | null = null;
  for (const ch of word) {
    if (!/[a-z]/i.test(ch)) continue;
    const key = classify(ch);
    if (key === last) continue;
    last = key;
    out.push({ code: VISEME_INDEX[key], key });
  }
  // Words like "the" reduce to a single viseme; pad so the mouth
  // actually moves once during the word's spoken duration.
  if (out.length < 2) {
    out.push({ code: VISEME_INDEX.rest, key: "rest" });
  }
  return out;
}

export function textToVisemeStream(text: string): VisemeFrame[][] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  return words.map(wordToVisemes);
}
