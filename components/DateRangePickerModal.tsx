import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useHaptic } from "@/lib/haptics";
import { useColors } from "@/hooks/useColors";
import { formatDate } from "@/lib/dates";

/**
 * Lightweight in-app calendar for picking a contiguous date range on
 * the Recap screen. Built from primitives (no native datepicker
 * module) so it works across iOS / Android / web without a custom EAS
 * build, and so the styling matches the rest of MemTool.
 *
 * Selection behaviour:
 *   - First tap sets the start of the range.
 *   - Second tap sets the end. If the second tap lands BEFORE the
 *     existing start, the two are swapped — the user almost certainly
 *     meant to redraw the range rather than create an empty/inverted
 *     one.
 *   - A third tap restarts the selection at the tapped date so users
 *     can recover from a misclick without hunting for a "reset"
 *     button.
 *
 * Constraints:
 *   - End date is clamped to today. Memories live in the past, so a
 *     future end would just produce an empty tail in the heatmap and
 *     confuse the "Past N days" framing.
 *   - Range length is capped at MAX_RANGE_DAYS to keep the recap
 *     aggregator and renderer (heatmap, sparkline) within budgets we
 *     already tested for the 365-day preset.
 *
 * Emits `YYYY-MM-DD` strings via `onConfirm`. The same string format
 * `aggregateRangeRecap`'s `windowStart` / `windowEnd` use, so the
 * caller can persist them as-is.
 */

export const MAX_RANGE_DAYS = 365;

interface DateRangePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (range: { startDate: string; endDate: string }) => void;
  /** Initial range to seed the picker with (re-edit). */
  initialRange?: { startDate: string; endDate: string } | null;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseLocalDateString(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function diffDaysInclusive(startISO: string, endISO: string): number {
  const a = parseLocalDateString(startISO);
  const b = parseLocalDateString(endISO);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Quick presets shown as chips above the calendar. Each one returns
 * an inclusive `[start, end]` pair in `YYYY-MM-DD` form so the picker
 * can drop them straight into `draftStart` / `draftEnd`.
 *
 * Calendar-aligned where it matches user intent ("Last month" = the
 * full prior calendar month, not a rolling 30-day window). "Last 3
 * months" stays as a rolling 90-day window because most users reach
 * for it as a "recent activity" slice rather than a strict calendar
 * boundary.
 */
interface DatePreset {
  key: string;
  label: string;
  compute: (today: Date) => { startISO: string; endISO: string };
}

const PRESETS: DatePreset[] = [
  {
    key: "last-7-days",
    label: "Last 7 days",
    compute: (today) => {
      const start = new Date(today);
      start.setDate(today.getDate() - 6); // inclusive 7-day window
      return {
        startISO: toLocalDateString(start),
        endISO: toLocalDateString(today),
      };
    },
  },
  {
    key: "last-30-days",
    label: "Last 30 days",
    compute: (today) => {
      const start = new Date(today);
      start.setDate(today.getDate() - 29); // inclusive 30-day window
      return {
        startISO: toLocalDateString(start),
        endISO: toLocalDateString(today),
      };
    },
  },
  {
    key: "this-month",
    label: "This month",
    compute: (today) => ({
      startISO: toLocalDateString(startOfMonth(today)),
      endISO: toLocalDateString(today),
    }),
  },
  {
    key: "last-month",
    label: "Last month",
    compute: (today) => {
      const start = addMonths(startOfMonth(today), -1);
      // Day 0 of the current month == last day of the previous month.
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        startISO: toLocalDateString(start),
        endISO: toLocalDateString(end),
      };
    },
  },
  {
    key: "last-3-months",
    label: "Last 3 months",
    compute: (today) => {
      const start = new Date(today);
      start.setDate(today.getDate() - 89); // inclusive 90-day window
      return {
        startISO: toLocalDateString(start),
        endISO: toLocalDateString(today),
      };
    },
  },
  {
    key: "ytd",
    label: "Year to date",
    compute: (today) => ({
      startISO: toLocalDateString(new Date(today.getFullYear(), 0, 1)),
      endISO: toLocalDateString(today),
    }),
  },
  {
    key: "last-year",
    label: "Last year",
    compute: (today) => {
      const start = new Date(today.getFullYear() - 1, 0, 1);
      const end = new Date(today.getFullYear() - 1, 11, 31);
      return {
        startISO: toLocalDateString(start),
        endISO: toLocalDateString(end),
      };
    },
  },
];

/**
 * Trim the start forward if the inclusive range would exceed
 * MAX_RANGE_DAYS. Keeps the chip behaviour predictable: tapping
 * "Last year" in a leap year still produces a confirmable range
 * instead of immediately tripping the cap warning.
 */
function clampToMaxRange(startISO: string, endISO: string): {
  startISO: string;
  endISO: string;
} {
  if (diffDaysInclusive(startISO, endISO) <= MAX_RANGE_DAYS) {
    return { startISO, endISO };
  }
  const end = parseLocalDateString(endISO);
  if (!end) return { startISO, endISO };
  const newStart = new Date(end);
  newStart.setDate(end.getDate() - (MAX_RANGE_DAYS - 1));
  return { startISO: toLocalDateString(newStart), endISO };
}

export function DateRangePickerModal({
  visible,
  onClose,
  onConfirm,
  initialRange,
}: DateRangePickerModalProps) {
  const colors = useColors();
  // Apply is a save-style confirmation — shares the `capture`
  // signature with memory save. Day-tap below stays raw selection.
  const captureHaptic = useHaptic("capture");
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const todayISO = useMemo(() => toLocalDateString(today), [today]);

  // Visible month — defaults to the start month of an existing range
  // or the current month on a fresh open. Recreated whenever the
  // modal becomes visible so reopening doesn't keep stale state.
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const seed = initialRange?.startDate
      ? parseLocalDateString(initialRange.startDate)
      : null;
    return startOfMonth(seed ?? today);
  });
  const [draftStart, setDraftStart] = useState<string | null>(
    initialRange?.startDate ?? null,
  );
  const [draftEnd, setDraftEnd] = useState<string | null>(
    initialRange?.endDate ?? null,
  );

  // When the modal toggles open we reseed the local state from
  // `initialRange` so the picker reflects the latest persisted value
  // every time the user opens it (and not just the first mount).
  React.useEffect(() => {
    if (!visible) return;
    const seed = initialRange?.startDate
      ? parseLocalDateString(initialRange.startDate)
      : null;
    setVisibleMonth(startOfMonth(seed ?? today));
    setDraftStart(initialRange?.startDate ?? null);
    setDraftEnd(initialRange?.endDate ?? null);
  }, [visible, initialRange?.startDate, initialRange?.endDate, today]);

  const handleTapPreset = (preset: DatePreset) => {
    Haptics.selectionAsync().catch(() => {});
    const raw = preset.compute(today);
    const { startISO, endISO } = clampToMaxRange(raw.startISO, raw.endISO);
    setDraftStart(startISO);
    setDraftEnd(endISO);
    // Jump the calendar to the start month so the user can see the
    // selection — and refine from there if they want to.
    const startDate = parseLocalDateString(startISO);
    if (startDate) setVisibleMonth(startOfMonth(startDate));
  };

  const handleTapDay = (iso: string) => {
    Haptics.selectionAsync().catch(() => {});
    if (!draftStart || (draftStart && draftEnd)) {
      // Fresh selection — either no start yet or the user already
      // had a complete range and is restarting.
      setDraftStart(iso);
      setDraftEnd(null);
      return;
    }
    // We have a start but no end yet.
    if (iso < draftStart) {
      // User picked an earlier date than the start. Most natural
      // reading is "they meant to extend backwards", so the new
      // tap becomes the start and the old start becomes the end.
      setDraftEnd(draftStart);
      setDraftStart(iso);
      return;
    }
    setDraftEnd(iso);
  };

  const rangeLength =
    draftStart && draftEnd ? diffDaysInclusive(draftStart, draftEnd) : 0;
  const tooLong = rangeLength > MAX_RANGE_DAYS;
  const canConfirm =
    draftStart !== null && draftEnd !== null && rangeLength > 0 && !tooLong;

  const handleConfirm = () => {
    if (!canConfirm || !draftStart || !draftEnd) return;
    captureHaptic.play();
    onConfirm({ startDate: draftStart, endDate: draftEnd });
  };

  const monthLabel = visibleMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Disable the next-month chevron once we're already showing the
  // current month — there's nothing useful past it.
  const atCurrentMonth =
    visibleMonth.getFullYear() === today.getFullYear() &&
    visibleMonth.getMonth() === today.getMonth();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.headerRow}>
            <Ionicons name="calendar" size={18} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              Pick a date range
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={styles.headerClose}
              accessibilityLabel="Close date range picker"
            >
              <Ionicons name="close" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
            {draftStart && draftEnd
              ? `${formatDate(draftStart)} → ${formatDate(draftEnd)} · ${rangeLength} ${rangeLength === 1 ? "day" : "days"}`
              : draftStart
                ? `Start: ${formatDate(draftStart)} · tap an end date`
                : "Tap a start date, then an end date"}
          </Text>
          {tooLong && (
            <Text
              style={[
                styles.warningText,
                { color: colors.destructive ?? colors.primary },
              ]}
            >
              Range capped at {MAX_RANGE_DAYS} days.
            </Text>
          )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetRow}
            accessibilityLabel="Quick date range presets"
          >
            {PRESETS.map((preset) => {
              const raw = preset.compute(today);
              const { startISO, endISO } = clampToMaxRange(
                raw.startISO,
                raw.endISO,
              );
              const isActive =
                draftStart === startISO && draftEnd === endISO;
              return (
                <Pressable
                  key={preset.key}
                  onPress={() => handleTapPreset(preset)}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: isActive
                        ? colors.primary
                        : "transparent",
                      borderColor: isActive ? colors.primary : colors.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={preset.label}
                  accessibilityState={{ selected: isActive }}
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      {
                        color: isActive
                          ? colors.primaryForeground
                          : colors.foreground,
                      },
                    ]}
                  >
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.monthNavRow}>
            <Pressable
              onPress={() => setVisibleMonth((d) => addMonths(d, -1))}
              hitSlop={8}
              style={styles.monthNavButton}
              accessibilityLabel="Previous month"
            >
              <Ionicons
                name="chevron-back"
                size={20}
                color={colors.foreground}
              />
            </Pressable>
            <Text style={[styles.monthLabel, { color: colors.foreground }]}>
              {monthLabel}
            </Text>
            <Pressable
              onPress={() =>
                !atCurrentMonth && setVisibleMonth((d) => addMonths(d, 1))
              }
              hitSlop={8}
              disabled={atCurrentMonth}
              style={[
                styles.monthNavButton,
                atCurrentMonth && { opacity: 0.3 },
              ]}
              accessibilityLabel="Next month"
              accessibilityState={{ disabled: atCurrentMonth }}
            >
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.foreground}
              />
            </Pressable>
          </View>

          <View style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((w, i) => (
              <View key={`${w}-${i}`} style={styles.weekdayCell}>
                <Text
                  style={[
                    styles.weekdayText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {w}
                </Text>
              </View>
            ))}
          </View>

          <CalendarGrid
            visibleMonth={visibleMonth}
            todayISO={todayISO}
            startISO={draftStart}
            endISO={draftEnd}
            onTapDay={handleTapDay}
          />

          <View style={styles.footerRow}>
            <Pressable
              onPress={onClose}
              style={[
                styles.footerButton,
                styles.footerButtonGhost,
                { borderColor: colors.border },
              ]}
              accessibilityLabel="Cancel"
            >
              <Text
                style={[styles.footerButtonText, { color: colors.foreground }]}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={!canConfirm}
              style={[
                styles.footerButton,
                {
                  backgroundColor: canConfirm
                    ? colors.primary
                    : colors.muted,
                  opacity: canConfirm ? 1 : 0.6,
                },
              ]}
              accessibilityLabel="Apply date range"
              accessibilityState={{ disabled: !canConfirm }}
            >
              <Text
                style={[
                  styles.footerButtonText,
                  { color: colors.primaryForeground },
                ]}
              >
                Apply
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface CalendarGridProps {
  visibleMonth: Date;
  todayISO: string;
  startISO: string | null;
  endISO: string | null;
  onTapDay: (iso: string) => void;
}

function CalendarGrid({
  visibleMonth,
  todayISO,
  startISO,
  endISO,
  onTapDay,
}: CalendarGridProps) {
  const colors = useColors();

  // Build a 6-row × 7-col grid filled with day numbers and pad the
  // leading empties with nulls. 6 rows is enough for any month
  // (longest case: 31-day month starting on a Saturday spans 6
  // rows). This keeps the grid height stable so the modal doesn't
  // jump as the user navigates between months.
  const cells = useMemo(() => {
    const total = daysInMonth(visibleMonth);
    const firstWeekday = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth(),
      1,
    ).getDay();
    const out: Array<{ iso: string; day: number } | null> = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let day = 1; day <= total; day++) {
      const d = new Date(
        visibleMonth.getFullYear(),
        visibleMonth.getMonth(),
        day,
      );
      out.push({ iso: toLocalDateString(d), day });
    }
    while (out.length % 7 !== 0) out.push(null);
    while (out.length < 42) out.push(null);
    return out;
  }, [visibleMonth]);

  const rows: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  return (
    <View style={styles.grid}>
      {rows.map((row, rIdx) => (
        <View key={rIdx} style={styles.gridRow}>
          {row.map((cell, cIdx) => {
            if (!cell) {
              return <View key={cIdx} style={styles.dayCell} />;
            }
            const disabled = cell.iso > todayISO;
            const isStart = startISO !== null && cell.iso === startISO;
            const isEnd = endISO !== null && cell.iso === endISO;
            const inRange =
              startISO !== null &&
              endISO !== null &&
              cell.iso > startISO &&
              cell.iso < endISO;
            const isToday = cell.iso === todayISO;
            const isEdge = isStart || isEnd;
            const bg = isEdge
              ? colors.primary
              : inRange
                ? colors.primary + "33"
                : "transparent";
            const fg = isEdge
              ? colors.primaryForeground
              : disabled
                ? colors.mutedForeground
                : colors.foreground;
            return (
              <Pressable
                key={cIdx}
                onPress={() => !disabled && onTapDay(cell.iso)}
                disabled={disabled}
                style={[
                  styles.dayCell,
                  {
                    backgroundColor: bg,
                    opacity: disabled ? 0.35 : 1,
                  },
                  isToday &&
                    !isEdge && {
                      borderColor: colors.primary,
                      borderWidth: 1,
                    },
                ]}
                accessibilityRole="button"
                accessibilityLabel={cell.iso}
                accessibilityState={{
                  selected: isEdge,
                  disabled,
                }}
              >
                <Text
                  style={[
                    styles.dayText,
                    {
                      color: fg,
                      fontWeight: isEdge ? "700" : "500",
                    },
                  ]}
                >
                  {cell.day}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const CELL_SIZE = 38;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  headerClose: { padding: 4 },
  helperText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  warningText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    marginTop: -6,
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 2,
    paddingRight: 4,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  presetChipText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  monthNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  monthNavButton: { padding: 6 },
  monthLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  weekdayRow: {
    flexDirection: "row",
  },
  weekdayCell: {
    width: CELL_SIZE,
    alignItems: "center",
    paddingVertical: 4,
  },
  weekdayText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    letterSpacing: 1,
  },
  grid: {
    gap: 4,
  },
  gridRow: {
    flexDirection: "row",
  },
  dayCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    margin: 1,
  },
  dayText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  footerRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  footerButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  footerButtonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  footerButtonText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
});
