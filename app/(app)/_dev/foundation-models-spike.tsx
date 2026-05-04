// Developer-only spike screen for the on-device FoundationModels
// prototype. Lives under `app/(app)/_dev/` so expo-router does NOT
// register it as a route in any build (the `_` prefix marks the folder
// as non-routable). It is therefore unreachable via `router.push` or
// the `memtool://foundation-models-spike` deep link. To exercise it
// during development, import this module from a temporary scratch
// route or a dev-only navigator.
//
// Two cards drive the same status machine (`useOnDeviceTask`):
//   1. Summary  — paste a memory, hit Summarize, see a 3-sentence
//                 paraphrase + latency / token count.
//   2. Facets   — paste a memory, hit Extract facets, see the
//                 `@Generable` `MemoryFacets` struct rendered as
//                 tag chips + theme + mood with the same metrics.
//
// Both cards confirm the fallback messaging on devices that aren't
// iOS-26 / not Apple Intelligence eligible: an Unavailable banner
// with a machine-readable reason replaces the result card.
//
// Task #196 — streaming: the summary card now shows text token-by-token
// while the model generates via `partialSummary`. A blinking cursor
// (▌) is appended while `status === "running"`. Tapping Reset
// mid-generation cancels the underlying Swift Task immediately.
//
// Latency-bench mode (Task #197): the summary card also drives the
// measurements that feed the "Measured latency" table in
// `docs/FOUNDATION_MODELS_SPIKE.md`. Each successful summary run is
// appended to a runs log labeled cold (first run per process launch)
// or warm (any run after that), with input character count, latency,
// and approximate tok/s. Three preset buttons fill the input with
// deterministic 200 / 1000 / 4000-char samples so the dev can chart
// latency vs. input size without typing them out.

import { Stack, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import {
  isFirstRunInProcess,
  type FMMemoryFacets,
} from "@/modules/foundation-models";
import {
  BENCH_PRESETS,
  buildSampleText,
} from "@/lib/foundationModelsBenchSamples";
import {
  describeUnavailableReason,
  useOnDeviceSummary,
} from "@/lib/useOnDeviceSummary";
import { useMemoryFacets } from "@/lib/useMemoryFacets";

const SAMPLE_ENTRY =
  "Walked along the river with Mira after work. The air was sharp and the "
  + "lights from the bridge were doubling on the water. We didn't talk much. "
  + "She mentioned she'd been struggling with sleep again. I noticed I felt "
  + "calmer than I have in weeks — something about the cold.";

type RunRow = {
  id: string;
  startedAt: number;
  cold: boolean;
  inputChars: number;
  latencyMs: number;
  approxTokens: number;
  tokensPerSecond: number;
};

export default function FoundationModelsSpikeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [text, setText] = useState(SAMPLE_ENTRY);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const summary = useOnDeviceSummary();
  const facets = useMemoryFacets();

  const isSummaryRunning = summary.status === "running";
  const isFacetsRunning = facets.status === "running";
  // Either card running disables input editing + preset taps so the
  // user can't change the bench input mid-flight.
  const isAnyRunning = isSummaryRunning || isFacetsRunning;
  const canSummarize =
    summary.availability.available && !isSummaryRunning && text.trim().length > 0;
  const canExtractFacets =
    facets.availability.available && !isFacetsRunning && text.trim().length > 0;

  const handleRun = useCallback(async () => {
    // Snapshot cold-vs-warm BEFORE calling run, since the
    // native call flips the module-level "cold consumed" flag on
    // success.
    const cold = isFirstRunInProcess();
    const inputChars = text.length;
    const result = await summary.run(text);
    if (result === null) return;
    const { latencyMs, approxTokens } = result;
    const tokensPerSecond =
      latencyMs > 0 ? Math.round((approxTokens / latencyMs) * 1000) : 0;
    setRuns((prev) =>
      [
        {
          id: `${Date.now()}-${prev.length}`,
          startedAt: Date.now(),
          cold,
          inputChars,
          latencyMs,
          approxTokens,
          tokensPerSecond,
        },
        ...prev,
      ].slice(0, 10),
    );
  }, [summary, text]);

  // Gate the entire bench behind __DEV__ so a stray deep link or
  // a curious production user sees a blank "not available" screen
  // rather than the development tooling. The route itself stays in
  // the Stack so TypeScript typed-routes doesn't complain, but no
  // production user will ever see the actual bench UI.
  if (!__DEV__) {
    return (
      <>
        <Stack.Screen
          options={{
            title: "FoundationModels spike",
            headerShown: true,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.foreground,
          }}
        />
        <View
          style={{
            flex: 1,
            backgroundColor: colors.background,
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>
            Dev-only screen
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.mutedForeground, textAlign: "center" }}>
            This bench is gated to development builds. There is nothing here in a production or TestFlight build.
          </Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 14, color: colors.mutedForeground }}>← Back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "FoundationModels spike",
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
          On-device FoundationModels spike
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Apple FoundationModels (iOS 26+) — runs on the device, no
          network call. Devs only.
        </Text>

        <AvailabilityCard
          available={summary.availability.available}
          reason={summary.availability.reason}
          colors={colors}
        />

        <ColdStateBanner
          colors={colors}
          available={summary.availability.available}
          runsCount={runs.length}
        />

        <Text style={[styles.label, { color: colors.foreground }]}>
          Memory
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          editable={!isAnyRunning}
          placeholder="Paste or type a memory..."
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.textarea,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
            },
          ]}
          testID="fm-spike-input"
        />

        <Text style={[styles.label, { color: colors.foreground }]}>
          Input-size presets
        </Text>
        <View style={styles.presetRow}>
          {BENCH_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              disabled={isAnyRunning}
              onPress={() => setText(buildSampleText(preset.targetChars))}
              style={[
                styles.presetButton,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: isAnyRunning ? 0.5 : 1,
                },
              ]}
              testID={`fm-spike-preset-${preset.id}`}
            >
              <Text style={[styles.presetText, { color: colors.foreground }]}>
                {preset.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* --- Summarize card --- */}
        <View style={styles.actionsRow}>
          <Pressable
            disabled={!canSummarize}
            onPress={() => {
              void handleRun();
            }}
            style={[
              styles.cta,
              {
                backgroundColor: canSummarize
                  ? colors.primaryAction
                  : colors.muted,
                opacity: canSummarize ? 1 : 0.6,
              },
            ]}
            testID="fm-spike-run"
          >
            {isSummaryRunning ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <Text style={[styles.ctaText, { color: colors.foreground }]}>
                Summarize on-device
              </Text>
            )}
          </Pressable>
          <Pressable
            onPress={summary.reset}
            style={[
              styles.secondaryCta,
              { borderColor: colors.border },
            ]}
            testID="fm-spike-reset"
          >
            <Text style={[styles.secondaryCtaText, { color: colors.foreground }]}>
              Reset
            </Text>
          </Pressable>
        </View>

        {/* Streaming partial summary — shown while the model is generating */}
        {isSummaryRunning && summary.partialSummary !== null ? (
          <StreamingResultCard
            colors={colors}
            partialText={summary.partialSummary}
          />
        ) : null}

        {summary.status === "done" && summary.summary !== null ? (
          <ResultCard
            colors={colors}
            summary={summary.summary}
            latencyMs={summary.latencyMs ?? 0}
            approxTokens={summary.approxTokens ?? 0}
            inputCharCount={text.length}
          />
        ) : null}

        {summary.status === "error" ? (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.destructive,
              },
            ]}
          >
            <Text style={[styles.label, { color: colors.destructive }]}>
              Summary error
            </Text>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {summary.error ?? "Unknown error"}
            </Text>
          </View>
        ) : null}

        {summary.status === "unavailable" && summary.reason !== null ? (
          <View
            style={[
              styles.fallbackCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.label, { color: colors.foreground }]}>
              Why summary couldn't run
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {describeUnavailableReason(summary.reason)}
            </Text>
            <Text style={[styles.codeLine, { color: colors.mutedForeground }]}>
              reason: {summary.reason}
            </Text>
          </View>
        ) : null}

        {runs.length > 0 ? (
          <RunsLog runs={runs} colors={colors} />
        ) : null}

        {/* --- Facets card (Task #195) --- */}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.actionsRow}>
          <Pressable
            disabled={!canExtractFacets}
            onPress={() => {
              void facets.run(text);
            }}
            style={[
              styles.cta,
              {
                backgroundColor: canExtractFacets
                  ? colors.primaryAction
                  : colors.muted,
                opacity: canExtractFacets ? 1 : 0.6,
              },
            ]}
            testID="fm-spike-facets-run"
          >
            {isFacetsRunning ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <Text style={[styles.ctaText, { color: colors.foreground }]}>
                Extract facets
              </Text>
            )}
          </Pressable>
          <Pressable
            onPress={facets.reset}
            style={[
              styles.secondaryCta,
              { borderColor: colors.border },
            ]}
            testID="fm-spike-facets-reset"
          >
            <Text style={[styles.secondaryCtaText, { color: colors.foreground }]}>
              Reset
            </Text>
          </Pressable>
        </View>

        {facets.status === "done" && facets.facets !== null ? (
          <FacetsCard
            colors={colors}
            facets={facets.facets}
            latencyMs={facets.latencyMs ?? 0}
            approxTokens={facets.approxTokens ?? 0}
            inputCharCount={text.length}
          />
        ) : null}

        {facets.status === "error" ? (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.destructive,
              },
            ]}
          >
            <Text style={[styles.label, { color: colors.destructive }]}>
              Facets error
            </Text>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {facets.error ?? "Unknown error"}
            </Text>
          </View>
        ) : null}

        {facets.status === "unavailable" && facets.reason !== null ? (
          <View
            style={[
              styles.fallbackCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.label, { color: colors.foreground }]}>
              Why facets couldn't run
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {describeUnavailableReason(facets.reason)}
            </Text>
            <Text style={[styles.codeLine, { color: colors.mutedForeground }]}>
              reason: {facets.reason}
            </Text>
          </View>
        ) : null}

        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={[styles.backLinkText, { color: colors.mutedForeground }]}>
            ← Back
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// StreamingResultCard — shown while the model is generating, before `done`.
// Displays accumulated partial text with a blinking block cursor (▌).
// ---------------------------------------------------------------------------

function StreamingResultCard({
  colors,
  partialText,
}: {
  colors: ReturnType<typeof useColors>;
  partialText: string;
}) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 530,
          easing: Easing.step0,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 530,
          easing: Easing.step0,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <View
      style={[
        styles.resultCard,
        { backgroundColor: colors.card, borderColor: colors.accent },
      ]}
      testID="fm-spike-streaming-result"
    >
      <Text style={[styles.label, { color: colors.accent }]}>
        Generating…
      </Text>
      <Text style={[styles.body, { color: colors.foreground }]}>
        {partialText}
        <Animated.Text style={{ opacity, color: colors.accent }}>▌</Animated.Text>
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (unchanged from Task #195 baseline)
// ---------------------------------------------------------------------------

function AvailabilityCard({
  available,
  reason,
  colors,
}: {
  available: boolean;
  reason: ReturnType<typeof useOnDeviceSummary>["availability"]["reason"];
  colors: ReturnType<typeof useColors>;
}) {
  const tint = available ? colors.accent : colors.destructive;
  return (
    <View
      style={[
        styles.statusCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: tint }]} />
        <Text style={[styles.statusLabel, { color: colors.foreground }]}>
          {available ? "FoundationModels available" : "Unavailable"}
        </Text>
      </View>
      {!available ? (
        <Text style={[styles.statusReason, { color: colors.mutedForeground }]}>
          {describeUnavailableReason(reason)}
        </Text>
      ) : null}
    </View>
  );
}

function ColdStateBanner({
  colors,
  available,
  runsCount,
}: {
  colors: ReturnType<typeof useColors>;
  available: boolean;
  runsCount: number;
}) {
  if (!available) return null;
  // We re-evaluate on each render so the banner flips after the first
  // run completes — `isFirstRunInProcess` reads the module-level flag.
  const cold = isFirstRunInProcess();
  return (
    <View
      style={[
        styles.coldBanner,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      testID="fm-spike-cold-banner"
    >
      <Text style={[styles.coldBannerLabel, { color: colors.mutedForeground }]}>
        Next run will be
      </Text>
      <Text style={[styles.coldBannerValue, { color: colors.foreground }]}>
        {cold ? "COLD (first call this launch)" : "WARM"}
      </Text>
      {cold ? (
        <Text style={[styles.coldBannerHelp, { color: colors.mutedForeground }]}>
          Cold-start can only be re-measured by force-quitting the app
          and relaunching the dev client. Subsequent runs will be warm.
        </Text>
      ) : (
        <Text style={[styles.coldBannerHelp, { color: colors.mutedForeground }]}>
          {runsCount} run(s) logged so far. Switch input-size presets
          and tap Summarize to chart latency vs. character count.
        </Text>
      )}
    </View>
  );
}

function RunsLog({
  runs,
  colors,
}: {
  runs: RunRow[];
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.runsCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      testID="fm-spike-runs-log"
    >
      <Text style={[styles.label, { color: colors.foreground }]}>
        Runs log (latest first, max 10)
      </Text>
      <View style={[styles.runsHeader, { borderColor: colors.border }]}>
        <Text style={[styles.runsHeaderCell, { color: colors.mutedForeground, flex: 0.7 }]}>
          state
        </Text>
        <Text style={[styles.runsHeaderCell, { color: colors.mutedForeground, flex: 0.7 }]}>
          chars
        </Text>
        <Text style={[styles.runsHeaderCell, { color: colors.mutedForeground, flex: 1 }]}>
          latency
        </Text>
        <Text style={[styles.runsHeaderCell, { color: colors.mutedForeground, flex: 0.6 }]}>
          ≈tok
        </Text>
        <Text style={[styles.runsHeaderCell, { color: colors.mutedForeground, flex: 0.6 }]}>
          tok/s
        </Text>
      </View>
      {runs.map((row) => (
        <View
          key={row.id}
          style={[styles.runsRow, { borderColor: colors.border }]}
          testID={`fm-spike-runs-row-${row.cold ? "cold" : "warm"}`}
        >
          <Text style={[styles.runsCell, { color: colors.foreground, flex: 0.7 }]}>
            {row.cold ? "cold" : "warm"}
          </Text>
          <Text style={[styles.runsCell, { color: colors.foreground, flex: 0.7 }]}>
            {row.inputChars}
          </Text>
          <Text style={[styles.runsCell, { color: colors.foreground, flex: 1 }]}>
            {row.latencyMs} ms
          </Text>
          <Text style={[styles.runsCell, { color: colors.foreground, flex: 0.6 }]}>
            {row.approxTokens}
          </Text>
          <Text style={[styles.runsCell, { color: colors.foreground, flex: 0.6 }]}>
            {row.tokensPerSecond}
          </Text>
        </View>
      ))}
      <Text style={[styles.runsHelp, { color: colors.mutedForeground }]}>
        Copy these into docs/FOUNDATION_MODELS_SPIKE.md → "Measured
        latency". Force-quit the app to re-measure cold start.
      </Text>
    </View>
  );
}

function ResultCard({
  colors,
  summary,
  latencyMs,
  approxTokens,
  inputCharCount,
}: {
  colors: ReturnType<typeof useColors>;
  summary: string;
  latencyMs: number;
  approxTokens: number;
  inputCharCount: number;
}) {
  const tokensPerSecond =
    latencyMs > 0 ? Math.round((approxTokens / latencyMs) * 1000) : 0;
  return (
    <View
      style={[
        styles.resultCard,
        { backgroundColor: colors.card, borderColor: colors.accent },
      ]}
      testID="fm-spike-result"
    >
      <Text style={[styles.label, { color: colors.accent }]}>Summary</Text>
      <Text style={[styles.body, { color: colors.foreground }]}>{summary}</Text>
      <View style={styles.metricsRow}>
        <Metric label="Latency" value={`${latencyMs} ms`} colors={colors} />
        <Metric label="≈ tokens" value={String(approxTokens)} colors={colors} />
        <Metric label="tok/s" value={String(tokensPerSecond)} colors={colors} />
        <Metric label="input chars" value={String(inputCharCount)} colors={colors} />
      </View>
    </View>
  );
}

function FacetsCard({
  colors,
  facets,
  latencyMs,
  approxTokens,
  inputCharCount,
}: {
  colors: ReturnType<typeof useColors>;
  facets: FMMemoryFacets;
  latencyMs: number;
  approxTokens: number;
  inputCharCount: number;
}) {
  const tokensPerSecond =
    latencyMs > 0 ? Math.round((approxTokens / latencyMs) * 1000) : 0;
  return (
    <View
      style={[
        styles.resultCard,
        { backgroundColor: colors.card, borderColor: colors.accent },
      ]}
      testID="fm-spike-facets-result"
    >
      <Text style={[styles.label, { color: colors.accent }]}>Facets</Text>

      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        Tags
      </Text>
      {facets.tags.length === 0 ? (
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          (none)
        </Text>
      ) : (
        <View style={styles.tagRow}>
          {facets.tags.map((tag) => (
            <View
              key={tag}
              style={[styles.tagChip, { borderColor: colors.border, backgroundColor: colors.muted }]}
            >
              <Text style={[styles.tagChipText, { color: colors.foreground }]}>
                {tag}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        Theme
      </Text>
      <Text style={[styles.body, { color: colors.foreground }]}>
        {facets.theme || "(none)"}
      </Text>

      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        Mood
      </Text>
      <Text style={[styles.body, { color: colors.foreground }]}>
        {facets.mood || "(none)"}
      </Text>

      <View style={styles.metricsRow}>
        <Metric label="Latency" value={`${latencyMs} ms`} colors={colors} />
        <Metric label="≈ tokens" value={String(approxTokens)} colors={colors} />
        <Metric label="tok/s" value={String(tokensPerSecond)} colors={colors} />
        <Metric label="input chars" value={String(inputCharCount)} colors={colors} />
      </View>
    </View>
  );
}

function Metric({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
  },
  h1: {
    fontSize: 24,
    fontWeight: "700",
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
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 4,
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
  coldBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  coldBannerLabel: {
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  coldBannerValue: {
    fontSize: 16,
    fontWeight: "700",
  },
  coldBannerHelp: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  textarea: {
    minHeight: 160,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  presetButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  presetText: {
    fontSize: 14,
    fontWeight: "500",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
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
    fontWeight: "500",
  },
  resultCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 8,
  },
  metric: {
    minWidth: 70,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  metricLabel: {
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 2,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  divider: {
    height: 1,
    marginVertical: 4,
    opacity: 0.6,
  },
  fallbackCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  runsCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  runsHeader: {
    flexDirection: "row",
    paddingBottom: 6,
    borderBottomWidth: 1,
  },
  runsHeaderCell: {
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  runsRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  runsCell: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  runsHelp: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
    fontStyle: "italic",
  },
  codeLine: {
    fontFamily: "monospace",
    fontSize: 12,
    marginTop: 4,
  },
  backLink: {
    alignSelf: "flex-start",
    paddingVertical: 8,
  },
  backLinkText: {
    fontSize: 14,
  },
});
