// Deterministic sample texts for the FoundationModels latency spike.
//
// We need inputs of roughly fixed character lengths (200 / 1000 / 4000)
// so the dev who runs the spike on real hardware can chart latency
// against input size without the result being polluted by random text
// generation. Keeping the corpus here (and not inline in the screen)
// makes it easy to reuse from a unit test and to swap the seed text
// without touching UI code.

const SEED_PARAGRAPHS = [
  "Walked along the river with Mira after work. The air was sharp and "
  + "the lights from the bridge were doubling on the water. We didn't "
  + "talk much. She mentioned she'd been struggling with sleep again. I "
  + "noticed I felt calmer than I have in weeks — something about the cold.",
  "Tried the new bakery on Powell before the standup. The croissant was "
  + "underbaked but the espresso was the best I've had this month. Sat by "
  + "the window and watched the fog burn off the hills. Started sketching "
  + "an idea for the onboarding flow on a napkin and ended up filling the "
  + "back too.",
  "Long call with Dad. He's started physical therapy for the shoulder and "
  + "is grumbling about the exercises. Mom is doing okay. We talked about "
  + "the trip to Lake Tahoe in August and whether the cabin is actually big "
  + "enough for everyone. I promised I'd send dates by Friday.",
  "Quiet evening. Made the lentil soup recipe Sara sent over and it turned "
  + "out almost as good as hers. Read a chapter of the new Le Guin "
  + "collection and fell asleep on the couch with the lamp on. Woke at "
  + "three, brushed my teeth, slept again until the alarm.",
];

/**
 * Build a sample text of approximately `targetChars` characters by
 * concatenating the seed paragraphs and trimming to the target length.
 * The output is deterministic for a given target so successive runs
 * compare against the same input.
 */
export function buildSampleText(targetChars: number): string {
  if (targetChars <= 0) return "";
  let buffer = "";
  let i = 0;
  while (buffer.length < targetChars) {
    if (buffer.length > 0) buffer += " ";
    buffer += SEED_PARAGRAPHS[i % SEED_PARAGRAPHS.length];
    i += 1;
  }
  // Trim to a clean character boundary (avoid splitting a word in half
  // when we can help it — backtrack to the previous space).
  if (buffer.length > targetChars) {
    let cut = targetChars;
    while (cut > 0 && buffer.charAt(cut) !== " " && cut > targetChars - 12) {
      cut -= 1;
    }
    buffer = buffer.slice(0, cut > 0 ? cut : targetChars).trimEnd();
  }
  return buffer;
}

export type BenchPresetId = "small" | "medium" | "large";

export type BenchPreset = {
  id: BenchPresetId;
  label: string;
  targetChars: number;
};

export const BENCH_PRESETS: readonly BenchPreset[] = [
  { id: "small", label: "200 chars", targetChars: 200 },
  { id: "medium", label: "1k chars", targetChars: 1000 },
  { id: "large", label: "4k chars", targetChars: 4000 },
] as const;
