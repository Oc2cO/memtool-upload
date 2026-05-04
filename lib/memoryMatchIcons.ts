export const MEMORY_MATCH_ICONS = [
  "🍎", "🚀", "🐶", "🌟", "🎵", "🎮", "🍕", "🌈", "🦄", "🎨",
  "🏀", "⚡️", "🌙", "🍦", "🦋", "🎁", "🌺", "🐠", "🎭", "🍓",
  "🎯", "🌍", "🍩", "🦊", "🐯", "🐼", "🍀", "🍭"
];

/**
 * "Similar-looking" subsets used by higher Memory Match levels
 * (see `docs/games/LEVELS_SPEC.md`). Each subset is visually adjacent
 * so the user can't fingerprint a pair from a half-second peek —
 * fruit-vs-fruit instead of rocket-vs-fruit.
 */
export const MEMORY_MATCH_SIMILAR_SETS: string[][] = [
  // Food & sweets
  ["🍎", "🍓", "🍒", "🍑", "🍊", "🍋", "🍐", "🍏", "🍌", "🍇", "🍉", "🥭", "🍍", "🥝", "🥥", "🍈", "🍅", "🥑"],
  // Animals
  ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🦝", "🐺", "🐗"],
  // Faces / expressions
  ["😀", "😃", "😄", "😁", "😆", "😊", "🙂", "😉", "😌", "😍", "😘", "🤩", "😎", "🤓", "🧐", "🤔", "😏", "😴"],
];

export function pickIconSet(count: number, similar: boolean): string[] {
  const pool = similar
    ? MEMORY_MATCH_SIMILAR_SETS[
        Math.floor(Math.random() * MEMORY_MATCH_SIMILAR_SETS.length)
      ]
    : MEMORY_MATCH_ICONS;
  return [...pool].sort(() => 0.5 - Math.random()).slice(0, count);
}
