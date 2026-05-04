// Pure mapper from chat answers → { traits, focus_areas }.
// No imports — testable in plain Node via tsx.
//
// Contract:
//   - traits  ← chip selections only, validated against `allowedTraits`.
//   - focus_areas ← free-text only (trim/cap/dedupe).
//   - Free text is passed through unscanned. The mapper never inspects
//     it for trait keywords or anything else: it does not infer traits
//     from prose, and it does not filter prose against the trait enum.
//     Any backend-side normalization (e.g. dropping a focus_area that
//     equals a trait keyword) is the server's responsibility.

export const FOCUS_AREA_CHAR_MAX = 40;
export const FOCUS_AREA_MAX = 5;
export const TRAITS_MAX = 8;

export interface ProfileShape<T extends string> {
  traits: T[];
  focus_areas: string[];
}

export function buildProfileFromAnswersCore<T extends string>(
  allowedTraits: ReadonlySet<T>,
  selectedTraits: readonly unknown[],
  freeTextAnswers: readonly unknown[],
): ProfileShape<T> {
  const seenT = new Set<T>();
  const traits: T[] = [];
  for (const candidate of selectedTraits) {
    if (typeof candidate !== "string") continue;
    if (!allowedTraits.has(candidate as T)) continue;
    const t = candidate as T;
    if (seenT.has(t)) continue;
    seenT.add(t);
    traits.push(t);
    if (traits.length >= TRAITS_MAX) break;
  }

  const seenF = new Set<string>();
  const focus_areas: string[] = [];
  for (const raw of freeTextAnswers) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const capped =
      trimmed.length > FOCUS_AREA_CHAR_MAX
        ? trimmed.slice(0, FOCUS_AREA_CHAR_MAX)
        : trimmed;
    const lower = capped.toLowerCase();
    if (seenF.has(lower)) continue;
    seenF.add(lower);
    focus_areas.push(capped);
    if (focus_areas.length >= FOCUS_AREA_MAX) break;
  }

  return { traits, focus_areas };
}
