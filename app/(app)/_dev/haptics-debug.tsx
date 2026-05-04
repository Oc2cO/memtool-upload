// Dev-only bench for the local `expo-core-haptics` Swift bridge.
// Lives under `app/(app)/_dev/` so expo-router does NOT register it as
// a route in any build profile (the `_` prefix marks the folder as
// non-routable). It is therefore unreachable via `router.push` or the
// `memtool://haptics-debug` deep link. To exercise it during
// development, import this module from a temporary scratch route or a
// dev-only navigator.
// Companion checklist: `docs/HAPTICS_REAL_DEVICE_CHECKLIST.md`.

import * as Clipboard from "expo-clipboard";
import { Stack, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import * as coreHaptics from "@/modules/expo-core-haptics";
import { playPattern, type PlayHandle } from "@/lib/haptics/ahapPlayer";
import { HAPTIC_NAMES, HAPTIC_PATTERNS } from "@/lib/haptics/patterns";
import type { HapticName } from "@/lib/haptics/types";

// Beat between signatures during "Play all 6". Long enough that each
// signature feels distinct from the previous (slowest is ~220ms).
const ALL_SIGNATURE_GAP_MS = 900;

// Conservative upper bound for how long a single signature can keep
// running before we stop counting it as "in-flight" for cancel
// bookkeeping. The longest pattern (day-recap-ready) runs ~280ms.
const MAX_SIGNATURE_RUNTIME_MS = 600;

type LogEntry = {
  id: number;
  at: string;
  message: string;
};

type RowResult = "pass" | "fail" | null;

// ─── Smoke-test checklist data ───────────────────────────────────────────────

type ChecklistRow = {
  id: string;
  label: string;
  hint: string;
};

const SECTION_A: ChecklistRow[] = [
  {
    id: "A1",
    label: "capture",
    hint: "Two taps in quick succession; second firmer than first. Feels like a confident 'got it', not two equal thumps.",
  },
  {
    id: "A2",
    label: "link-formed",
    hint: "Two close taps that fade into a soft continuous tail. Tail is smooth on Core Haptics; JS fallback stutters. Easiest A/B to feel.",
  },
  {
    id: "A3",
    label: "streak-extended",
    hint: "Clear rising 1–2–3 crescendo (light → medium → heavy). Third tap is the strongest. JS drops the smooth ramp.",
  },
  {
    id: "A4",
    label: "day-recap-ready",
    hint: "Short shimmer underneath a three-tap chime climbing in intensity. Shimmer is felt, not just heard. JS drops it.",
  },
  {
    id: "A5",
    label: "error",
    hint: "Two firm thumps with a pause. Distinct from iOS default notificationAsync(Warning). JS version is close — check weight and pause.",
  },
  {
    id: "A6",
    label: "undo",
    hint: "Soft tap that gently retreats — single tap then a quiet taper. Feels like a withdrawal. JS loses the smooth taper.",
  },
  {
    id: "A7",
    label: "Play all 6 back-to-back",
    hint: "Six signatures fire in order with ~900ms gap. Tester can name each without looking at the log. Repeat with JS fallback on — signatures feel flatter.",
  },
];

const SECTION_B: ChecklistRow[] = [
  {
    id: "B1",
    label: "day-recap-ready → Cancel (within ~150ms)",
    hint: "Remaining three taps + shimmer do not fire. Phone goes silent immediately.",
  },
  {
    id: "B2",
    label: "Play all 6 → Cancel while 2–3 playing",
    hint: "Signatures 4–6 never fire. Log shows ✕ cancel line with queued ≥ 3.",
  },
  {
    id: "B3",
    label: "link-formed → swipe to background immediately",
    hint: "Continuous tail stops as app loses foreground. Foregrounding does not resume the cancelled pattern.",
  },
];

const SECTION_C: ChecklistRow[] = [
  {
    id: "C1",
    label: "streak-extended → background → 5s → foreground → tap again",
    hint: "Second tap fires the rich version, not silence or JS fallback. Log shows two ▶ streak-extended lines.",
  },
  {
    id: "C2",
    label: "capture → Siri → dismiss → tap capture again",
    hint: "Post-Siri tap still plays the rich capture. Availability stays green (brief flip to engine_start_failed is ok).",
  },
  {
    id: "C3",
    label: "day-recap-ready → lock phone → 5s → unlock → tap error",
    hint: "error tap after unlock plays its rich version. No stuck buzzing or completely-silent failure.",
  },
  {
    id: "C4",
    label: "(Optional) Real incoming call mid-play → decline → link-formed",
    hint: "Interrupting call cancels in-flight pattern. Post-call tap plays the rich version.",
  },
];

const ALL_ROWS: ChecklistRow[] = [...SECTION_A, ...SECTION_B, ...SECTION_C];

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function HapticsDebugScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [availability, setAvailability] = useState(() =>
    coreHaptics.getAvailability(),
  );

  const [forceFallback, setForceFallback] = useState(false);

  const [log, setLog] = useState<LogEntry[]>([]);
  const nextLogIdRef = useRef(1);

  // Smoke-test checklist state
  const [rowState, setRowState] = useState<Record<string, RowResult>>(() =>
    Object.fromEntries(ALL_ROWS.map((r) => [r.id, null])),
  );
  const [testerName, setTesterName] = useState("");
  const [notes, setNotes] = useState("");
  const [resultLine, setResultLine] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  const handlesRef = useRef<Set<PlayHandle>>(new Set());

  const appendLog = useCallback((message: string) => {
    const id = nextLogIdRef.current++;
    const at = new Date().toISOString().slice(11, 23);
    setLog((prev) => [{ id, at, message }, ...prev].slice(0, 60));
  }, []);

  useEffect(() => {
    setAvailability(coreHaptics.getAvailability());
    const interval = setInterval(() => {
      setAvailability(coreHaptics.getAvailability());
    }, 750);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timers = pendingTimersRef.current;
    const handles = handlesRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const h of handles) h.cancel();
      handles.clear();
    };
  }, []);

  const trackHandle = useCallback((handle: PlayHandle) => {
    handlesRef.current.add(handle);
    setTimeout(() => {
      handlesRef.current.delete(handle);
    }, MAX_SIGNATURE_RUNTIME_MS);
  }, []);

  const playOne = useCallback(
    (name: HapticName) => {
      const handle = playPattern(HAPTIC_PATTERNS[name], { forceFallback });
      trackHandle(handle);
      appendLog(`▶ ${name} [${formatPath(handle.path)}]`);
    },
    [appendLog, forceFallback, trackHandle],
  );

  const playAll = useCallback(() => {
    appendLog(
      `▶▶ Play all 6 back-to-back [${formatPath(forceFallback ? "js" : "core")}]`,
    );
    HAPTIC_NAMES.forEach((name, i) => {
      const t = setTimeout(() => {
        pendingTimersRef.current.delete(t);
        const handle = playPattern(HAPTIC_PATTERNS[name], { forceFallback });
        trackHandle(handle);
        appendLog(
          `  ${i + 1}/${HAPTIC_NAMES.length} ${name} [${formatPath(handle.path)}]`,
        );
      }, i * ALL_SIGNATURE_GAP_MS);
      pendingTimersRef.current.add(t);
    });
  }, [appendLog, forceFallback, trackHandle]);

  const cancelAll = useCallback(() => {
    const queued = pendingTimersRef.current.size;
    const inFlight = handlesRef.current.size;
    for (const t of pendingTimersRef.current) clearTimeout(t);
    pendingTimersRef.current.clear();
    for (const h of handlesRef.current) h.cancel();
    handlesRef.current.clear();
    appendLog(`✕ cancel (queued ${queued}, in-flight ${inFlight})`);
  }, [appendLog]);

  const setRow = useCallback((id: string, result: RowResult) => {
    setRowState((prev) => ({ ...prev, [id]: result }));
    setResultLine(null);
  }, []);

  const incompleteCount = ALL_ROWS.filter(
    (r) => rowState[r.id] === null,
  ).length;

  const generateResultLine = useCallback(async () => {
    const constants = Platform.constants as Record<string, unknown>;
    const deviceModel =
      typeof constants.Model === "string" && constants.Model.length > 0
        ? constants.Model
        : "unknown device";
    const iosVersion =
      typeof constants.systemVersion === "string" &&
      constants.systemVersion.length > 0
        ? constants.systemVersion
        : typeof Platform.Version === "string" ||
            typeof Platform.Version === "number"
          ? String(Platform.Version)
          : "unknown";

    const date = new Date().toISOString().slice(0, 10);
    const tester =
      testerName.trim().length > 0 ? testerName.trim() : "unknown tester";

    const sectionScore = (rows: ChecklistRow[]) => {
      const total = rows.length;
      const passed = rows.filter((r) => rowState[r.id] === "pass").length;
      const failed = rows.filter((r) => rowState[r.id] === "fail").length;
      const incomplete = rows.filter((r) => rowState[r.id] === null).length;
      const failIds = rows
        .filter((r) => rowState[r.id] === "fail")
        .map((r) => r.id);
      return { passed, failed, incomplete, total, failIds };
    };

    const a = sectionScore(SECTION_A);
    const b = sectionScore(SECTION_B);
    const c = sectionScore(SECTION_C);

    const anyFail = a.failed > 0 || b.failed > 0 || c.failed > 0;
    const anyIncomplete =
      a.incomplete > 0 || b.incomplete > 0 || c.incomplete > 0;
    const overallVerdict = anyFail ? "FAIL" : anyIncomplete ? "INCOMPLETE" : "PASS";

    const failSummary = [
      ...(a.failIds.length > 0 ? a.failIds : []),
      ...(b.failIds.length > 0 ? b.failIds : []),
      ...(c.failIds.length > 0 ? c.failIds : []),
    ];

    const failNote =
      failSummary.length > 0 ? ` [failing: ${failSummary.join(", ")}]` : "";

    const notesText = notes.trim().length > 0 ? notes.trim() : "none";

    const line =
      `${anyFail ? "🔴 " : anyIncomplete ? "⚠️ " : ""}**Haptics smoke test (Task #227):** ${overallVerdict}${failNote} — ` +
      `${deviceModel}, iOS ${iosVersion}, ${date}, ${tester}. ` +
      `A: ${a.passed}/${a.total} · B: ${b.passed}/${b.total} · C: ${c.passed}/${c.total}. ` +
      `Notes: ${notesText}.`;

    setResultLine(line);
    await Clipboard.setStringAsync(line);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [rowState, testerName, notes]);

  const copyResult = useCallback(async () => {
    if (!resultLine) return;
    await Clipboard.setStringAsync(resultLine);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [resultLine]);

  if (!__DEV__) {
    return (
      <>
        <Stack.Screen
          options={{
            title: "Haptics debug",
            headerShown: true,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.foreground,
          }}
        />
        <View
          style={[styles.devOnlyBlock, { backgroundColor: colors.background }]}
        >
          <Text style={[styles.devOnlyTitle, { color: colors.foreground }]}>
            Dev-only screen
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            This bench is gated to development builds. There is nothing
            here in a production / TestFlight build.
          </Text>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <Text style={[styles.backLinkText, { color: colors.mutedForeground }]}>
              ← Back
            </Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Haptics debug",
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
        }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.container,
          { paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.h1, { color: colors.foreground }]}>
          Core Haptics bench
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Real-device QA for the `expo-core-haptics` Swift bridge. Run
          on a physical iPhone — the simulator has no haptic hardware
          and will report `hardware_not_supported`.
        </Text>

        <AvailabilityCard availability={availability} colors={colors} />

        <View
          style={[
            styles.fallbackToggleCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          testID="haptics-debug-force-fallback-card"
        >
          <View style={styles.fallbackToggleRow}>
            <View style={styles.fallbackToggleLabelCol}>
              <Text
                style={[styles.fallbackToggleLabel, { color: colors.foreground }]}
              >
                Force JS fallback
              </Text>
              <Text
                style={[
                  styles.fallbackToggleHint,
                  { color: colors.mutedForeground },
                ]}
              >
                {forceFallback
                  ? "ON — every play below uses the `expo-haptics` JS approximation, even on a Core Haptics–capable device. Toggle off to A/B against the rich version."
                  : "OFF — plays use Core Haptics when the engine is up. Toggle on to feel the JS fallback for the same signature on this device."}
              </Text>
            </View>
            <Switch
              value={forceFallback}
              onValueChange={(next) => {
                setForceFallback(next);
                appendLog(`⚙ force JS fallback: ${next ? "ON" : "OFF"}`);
              }}
              testID="haptics-debug-force-fallback-switch"
            />
          </View>
        </View>

        <Text style={[styles.label, { color: colors.foreground }]}>
          Single signatures
        </Text>
        <View style={styles.grid}>
          {HAPTIC_NAMES.map((name) => (
            <Pressable
              key={name}
              onPress={() => playOne(name)}
              style={[
                styles.signatureCta,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
              testID={`haptics-debug-play-${name}`}
            >
              <Text style={[styles.signatureLabel, { color: colors.foreground }]}>
                {name}
              </Text>
              <Text
                style={[styles.signatureHint, { color: colors.mutedForeground }]}
                numberOfLines={2}
              >
                {describePattern(name)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={playAll}
            style={[styles.cta, { backgroundColor: colors.primaryAction }]}
            testID="haptics-debug-play-all"
          >
            <Text style={[styles.ctaText, { color: colors.foreground }]}>
              Play all 6 back-to-back
            </Text>
          </Pressable>
          <Pressable
            onPress={cancelAll}
            style={[
              styles.secondaryCta,
              { borderColor: colors.destructive },
            ]}
            testID="haptics-debug-cancel"
          >
            <Text
              style={[styles.secondaryCtaText, { color: colors.destructive }]}
            >
              Cancel
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.label, { color: colors.foreground }]}>
          Background / foreground check
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Tap "Play all 6", swipe up to background the app mid-run,
          wait 5 seconds, foreground again, then tap any single
          signature. The bridge should restart the CHHapticEngine on
          its own — the new tap should still play the rich version,
          not the JS fallback. The availability badge above should
          stay green (or flip back to green within ~1s after returning
          to the foreground).
        </Text>

        {/* ── Smoke-test checklist ─────────────────────────────────────── */}

        <Text style={[styles.h2, { color: colors.foreground }]}>
          Smoke test checklist
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Mark each row Pass or Fail after running it. When all rows
          are marked, tap "Generate result line" to copy a ready-made
          summary for the TestFlight release notes or launch PR.
        </Text>

        <Text style={[styles.label, { color: colors.foreground }]}>
          Section A — rich vs JS fallback
        </Text>
        {SECTION_A.map((row) => (
          <ChecklistRowItem
            key={row.id}
            row={row}
            result={rowState[row.id] ?? null}
            onSet={setRow}
            colors={colors}
          />
        ))}

        <Text style={[styles.label, { color: colors.foreground }]}>
          Section B — cancel mid-play
        </Text>
        {SECTION_B.map((row) => (
          <ChecklistRowItem
            key={row.id}
            row={row}
            result={rowState[row.id] ?? null}
            onSet={setRow}
            colors={colors}
          />
        ))}

        <Text style={[styles.label, { color: colors.foreground }]}>
          Section C — backgrounding / engine restart
        </Text>
        {SECTION_C.map((row) => (
          <ChecklistRowItem
            key={row.id}
            row={row}
            result={rowState[row.id] ?? null}
            onSet={setRow}
            colors={colors}
          />
        ))}

        {/* ── Result generation ─────────────────────────────────────────── */}

        <Text style={[styles.label, { color: colors.foreground }]}>
          Result line
        </Text>

        <View
          style={[
            styles.resultInputCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
            Tester name
          </Text>
          <TextInput
            value={testerName}
            onChangeText={(t) => {
              setTesterName(t);
              setResultLine(null);
            }}
            placeholder="Your name"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.textInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            autoCapitalize="words"
            autoCorrect={false}
          />
          <Text
            style={[
              styles.inputLabel,
              { color: colors.mutedForeground, marginTop: 10 },
            ]}
          >
            Notes (anything unusual)
          </Text>
          <TextInput
            value={notes}
            onChangeText={(t) => {
              setNotes(t);
              setResultLine(null);
            }}
            placeholder="none"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.textInput,
              styles.textInputMultiline,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            multiline
            autoCapitalize="sentences"
          />
        </View>

        {incompleteCount > 0 ? (
          <Text
            style={[styles.incompleteHint, { color: colors.mutedForeground }]}
          >
            {incompleteCount} row{incompleteCount !== 1 ? "s" : ""} not yet
            marked — result line will be tagged INCOMPLETE.
          </Text>
        ) : null}

        <Pressable
          onPress={generateResultLine}
          style={[styles.cta, { backgroundColor: colors.primaryAction }]}
          testID="haptics-debug-generate-result"
        >
          <Text style={[styles.ctaText, { color: colors.foreground }]}>
            Generate &amp; copy result line
          </Text>
        </Pressable>

        {resultLine !== null ? (
          <View
            style={[
              styles.resultCard,
              {
                backgroundColor: colors.card,
                borderColor: resultLine.startsWith("🔴")
                  ? colors.destructive
                  : resultLine.startsWith("⚠️")
                    ? colors.mutedForeground
                    : colors.accent,
              },
            ]}
            testID="haptics-debug-result-card"
          >
            <Text
              style={[styles.resultText, { color: colors.foreground }]}
              selectable
            >
              {resultLine}
            </Text>
            <Pressable
              onPress={copyResult}
              style={[
                styles.copyButton,
                {
                  backgroundColor: copied ? colors.accent : colors.primaryAction,
                },
              ]}
              testID="haptics-debug-copy-result"
            >
              <Text style={[styles.copyButtonText, { color: colors.foreground }]}>
                {copied ? "Copied ✓" : "Re-copy"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* ── Log ──────────────────────────────────────────────────────── */}

        <Text style={[styles.label, { color: colors.foreground }]}>Log</Text>
        <View
          style={[
            styles.logCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {log.length === 0 ? (
            <Text style={[styles.logEmpty, { color: colors.mutedForeground }]}>
              No plays yet — tap a signature above.
            </Text>
          ) : (
            log.map((entry) => (
              <Text
                key={entry.id}
                style={[styles.logLine, { color: colors.foreground }]}
              >
                <Text style={{ color: colors.mutedForeground }}>
                  {entry.at}{"  "}
                </Text>
                {entry.message}
              </Text>
            ))
          )}
        </View>

        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={[styles.backLinkText, { color: colors.mutedForeground }]}>
            ← Back
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

// ─── ChecklistRowItem ─────────────────────────────────────────────────────────

function ChecklistRowItem({
  row,
  result,
  onSet,
  colors,
}: {
  row: ChecklistRow;
  result: RowResult;
  onSet: (id: string, result: RowResult) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const isPass = result === "pass";
  const isFail = result === "fail";

  return (
    <View
      style={[
        styles.checklistRow,
        {
          backgroundColor: colors.card,
          borderColor: isFail
            ? colors.destructive
            : isPass
              ? colors.accent
              : colors.border,
        },
      ]}
    >
      <View style={styles.checklistRowHeader}>
        <Text
          style={[styles.checklistRowId, { color: colors.mutedForeground }]}
        >
          {row.id}
        </Text>
        <Text
          style={[styles.checklistRowLabel, { color: colors.foreground }]}
        >
          {row.label}
        </Text>
      </View>
      <Text
        style={[styles.checklistRowHint, { color: colors.mutedForeground }]}
      >
        {row.hint}
      </Text>
      <View style={styles.checklistRowButtons}>
        <Pressable
          onPress={() => onSet(row.id, isPass ? null : "pass")}
          style={[
            styles.checklistBtn,
            {
              backgroundColor: isPass ? colors.accent : colors.background,
              borderColor: colors.accent,
            },
          ]}
        >
          <Text
            style={[
              styles.checklistBtnText,
              { color: isPass ? colors.foreground : colors.accent },
            ]}
          >
            ✓ Pass
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onSet(row.id, isFail ? null : "fail")}
          style={[
            styles.checklistBtn,
            {
              backgroundColor: isFail ? colors.destructive : colors.background,
              borderColor: colors.destructive,
            },
          ]}
        >
          <Text
            style={[
              styles.checklistBtnText,
              { color: isFail ? colors.foreground : colors.destructive },
            ]}
          >
            ✗ Fail
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── AvailabilityCard ─────────────────────────────────────────────────────────

function AvailabilityCard({
  availability,
  colors,
}: {
  availability: coreHaptics.CoreHapticsAvailability;
  colors: ReturnType<typeof useColors>;
}) {
  const tint = availability.available ? colors.accent : colors.destructive;
  return (
    <View
      style={[
        styles.statusCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      testID="haptics-debug-availability"
    >
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: tint }]} />
        <Text style={[styles.statusLabel, { color: colors.foreground }]}>
          {availability.available
            ? "Core Haptics engine ready"
            : "Core Haptics unavailable"}
        </Text>
      </View>
      <Text style={[styles.codeLine, { color: colors.mutedForeground }]}>
        reason: {availability.reason ?? "null"}
      </Text>
      {!availability.available ? (
        <Text style={[styles.statusReason, { color: colors.mutedForeground }]}>
          {describeReason(availability.reason)} The screen will keep
          working — every play falls back to the `expo-haptics` JS
          approximation — but you won't be testing the Swift bridge.
        </Text>
      ) : null}
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function describeReason(
  reason: coreHaptics.CoreHapticsAvailability["reason"],
): string {
  switch (reason) {
    case "non_ios_platform":
      return "Not iOS — Core Haptics is iPhone-only.";
    case "module_not_linked":
      return "The native module isn't in this binary. You're on Expo Go or an older dev client built before the module landed — rebuild the dev client.";
    case "hardware_not_supported":
      return "This device has no Taptic Engine (likely the iOS simulator).";
    case "engine_start_failed":
      return "CHHapticEngine refused to start. Often a transient audio-session conflict — try foregrounding the app and tapping again.";
    case "invalid_pattern":
      return "The last pattern handed to native was rejected as malformed.";
    case "unknown":
    case null:
    default:
      return "Reason unknown.";
  }
}

function describePattern(name: HapticName): string {
  const meta = HAPTIC_PATTERNS[name].Metadata;
  const desc = meta?.Description;
  if (typeof desc === "string") return desc;
  return "";
}

function formatPath(path: "core" | "js"): string {
  return path === "core" ? "core" : "JS";
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
  },
  h1: {
    fontSize: 24,
    fontWeight: "700",
  },
  h2: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 6,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  statusReason: {
    fontSize: 13,
    lineHeight: 18,
  },
  fallbackToggleCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  fallbackToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  fallbackToggleLabelCol: {
    flex: 1,
    gap: 4,
  },
  fallbackToggleLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  fallbackToggleHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  signatureCta: {
    flexBasis: "47%",
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
    minHeight: 92,
  },
  signatureLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  signatureHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  cta: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryCta: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryCtaText: {
    fontSize: 15,
    fontWeight: "600",
  },
  // Checklist rows
  checklistRow: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  checklistRowHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  checklistRowId: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "monospace",
    minWidth: 28,
    paddingTop: 1,
  },
  checklistRowLabel: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  checklistRowHint: {
    fontSize: 12,
    lineHeight: 17,
    paddingLeft: 36,
  },
  checklistRowButtons: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 36,
    marginTop: 2,
  },
  checklistBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
  },
  checklistBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  // Result inputs
  resultInputCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  textInputMultiline: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  // Result card
  resultCard: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  resultText: {
    fontSize: 13,
    lineHeight: 20,
  },
  copyButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
  },
  copyButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  incompleteHint: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
  },
  // Log
  logCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    minHeight: 80,
  },
  logLine: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  logEmpty: {
    fontSize: 13,
    fontStyle: "italic",
  },
  codeLine: {
    fontFamily: "monospace",
    fontSize: 12,
  },
  devOnlyBlock: {
    flex: 1,
    padding: 24,
    gap: 12,
    justifyContent: "center",
  },
  devOnlyTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  backLink: {
    alignSelf: "flex-start",
    paddingVertical: 8,
  },
  backLinkText: {
    fontSize: 14,
  },
});
