/**
 * Single source of truth for every user-facing date string in MemTool.
 * Pre-launch audit Round 1 ("Date format drift") found dates rendered
 * five different ways depending on the screen — including a raw ISO
 * string ("2026-04-28") on the Daily Recap header. Centralising the
 * formatting here keeps existing screens consistent and means new
 * screens have an obvious place to reach for instead of inventing
 * their own `toLocaleDateString` call.
 *
 * Locale is intentionally pinned to American English (`"en-US"`)
 * everywhere — matches the rest of the app and stops the same date
 * from rendering as e.g. "24 Oct 2026" on a UK-locale device. i18n is
 * a post-launch concern; passing `[]` would defer to the device locale
 * and quietly reintroduce drift.
 *
 * All helpers accept either a `Date`, a millisecond timestamp, or a
 * string. YYYY-MM-DD strings are treated as LOCAL calendar days, not
 * UTC midnight, because `new Date("2026-04-28")` is parsed as UTC and
 * would shift to the previous day for any user west of UTC. ISO
 * timestamps with a time component (e.g. `"2026-04-28T15:00:00Z"`)
 * keep the standard `Date(...)` parser since those carry their own
 * timezone information.
 */

const LOCALE = "en-US";

export type DateInput = Date | string | number;

/**
 * Parse the input into a Date. YYYY-MM-DD strings are interpreted as
 * the local calendar day so the displayed date matches the user's
 * timezone (see header comment).
 */
function toDate(input: DateInput): Date {
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(input);
}

/**
 * Short absolute date, e.g. `"Oct 24, 2026"`. The canonical "what day
 * was this" format — used for memory cards, recap headers, and the
 * fallback tail of `formatRelative` once the gap is wider than a
 * couple of weeks.
 */
export function formatDate(input: DateInput): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Long absolute date, e.g. `"October 24, 2026"`. Used by the
 * subscription / paywall screen where renewal dates feel more
 * comfortable spelled out. Same input handling as `formatDate`.
 */
export function formatLongDate(input: DateInput): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(LOCALE, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Month + day only, e.g. `"October 24"`. Use when the year is
 * implied by context (e.g. an in-year date filter chip).
 */
export function formatDayMonth(input: DateInput): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(LOCALE, { month: "long", day: "numeric" });
}

/**
 * Compact day + month, e.g. `"Apr 14"`. Used by the Archive date
 * filter chip when the year matches the user's current year — the
 * year is dropped because it would just repeat what the surrounding
 * UI already implies. Off-year dates fall through to `formatDate`
 * so the year is unambiguous.
 */
export function formatShortDayMonth(input: DateInput): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

/**
 * Soft "ago" string for recent events. Promoted from
 * `app/(app)/insights.tsx` so the Insights "Last refreshed" line and
 * any future "X minutes/hours ago" surface stay identical. Falls
 * back to `formatDate` for anything older than a couple of weeks
 * because at that point a real date is more informative than "21d
 * ago". Returns `"—"` for empty / invalid input — the original
 * caller already relied on that placeholder.
 */
export function formatRelative(input: DateInput | null | undefined): string {
  if (input === "" || input == null) return "—";
  const t = toDate(input).getTime();
  if (!Number.isFinite(t)) return "—";
  const delta = Date.now() - t;
  const min = Math.round(delta / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return formatDate(input);
}

/**
 * Coarser "ago" string used by the locked-memory tease in the
 * Archive. Different bucket boundaries from `formatRelative` on
 * purpose: a locked card is by definition older than the user's
 * library window, so minute-level precision would be misleading
 * ("7m ago — also unlock pro to read it" reads strangely). Returns
 * `"earlier"` for invalid input — matches the original helper's
 * conservative fallback.
 */
export function formatRelativeAge(input: DateInput): string {
  const ts = toDate(input).getTime();
  if (Number.isNaN(ts)) return "earlier";
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/**
 * Compact axis label for a chart cell. `"weekday"` produces `"Mon"`
 * (used by the Progress weekly bar chart); `"monthDay"` produces
 * `"10/24"` without leading zeroes (used by the Wellness 7-day
 * stress chart). Both share the same entry point so a future chart
 * can pick a style without inventing yet another inline formatter.
 */
export function formatChartLabel(
  input: DateInput,
  style: "weekday" | "monthDay" = "monthDay",
): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return "";
  if (style === "weekday") {
    return d.toLocaleDateString(LOCALE, { weekday: "short" });
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
