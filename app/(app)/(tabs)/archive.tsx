import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, RefreshControl, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";

import { BreatheCard } from "@/components/alive/BreatheCard";
import { FrostBackground } from "@/components/alive/FrostBackground";
import { LiftPress } from "@/components/alive/LiftPress";
import { SettleOnMount } from "@/components/alive/SettleOnMount";
import { LockedMemoryCard } from "@/components/LockedMemoryCard";
import { MemoryFacetChips } from "@/components/MemoryFacetChips";
import { MemorySyncStatus } from "@/components/MemorySyncStatus";
import { SyncWarningBanner } from "@/components/SyncWarningBanner";
import { Toast } from "@/components/Toast";
import { IllustrationLoader } from "@/components/IllustrationLoader";
import { IllustrationPolaroid } from "@/components/IllustrationPolaroid";
import { Image } from "expo-image";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useMemories, Memory } from "@/context/MemoriesContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { EmptyState } from "@/components/EmptyState";
import {
  getIllustrationQuotaState,
  getLibraryWindowState,
  ILLUSTRATION_OUT_TOAST,
} from "@/lib/captureLimits";
import { SEARCH_QUERY_MAX_LENGTH } from "@/lib/inputLimits";
import {
  type ArchiveRow,
  applyArchiveClientFilters,
  buildArchiveRows,
  getMemorySyncStatus,
  isPendingOrFailed,
} from "@/lib/archiveRows";
import { formatDate, formatShortDayMonth } from "@/lib/dates";

// Per-row stagger (ms) for the SettleOnMount wave on archive
// rows. Modulo'd by 8 at the call site so a long list doesn't
// queue a multi-second tail. Sized roughly to one Mercury
// half-settle (175ms / ~3) so consecutive rows feel like a
// continuous wave instead of discrete steps.
const ROW_STAGGER_MS = 60;

// Friendly label for a YYYY-MM-DD date filter, shared by the header
// chip and the empty-state copy so the two surfaces describing the
// same filter can never drift. Same-year dates drop the year via
// `formatShortDayMonth` ("Apr 14") since the year is implied by
// context; off-year dates use the canonical `formatDate` ("Apr 14,
// 2025") so a stale deep-link from a previous year is unambiguous.
// Both cases delegate to lib/dates.ts so this surface stays in lockstep
// with the rest of the app. Falls back to the raw string if parsing
// fails — better to surface the unfriendly label than to swallow the
// filter silently.
const formatDateFilterLabel = (dateFilter: string): string => {
  const parts = dateFilter.split("-").map((s) => Number.parseInt(s, 10));
  if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n))) {
    return dateFilter;
  }
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return dateFilter;
  const sameYear = y === new Date().getFullYear();
  return sameYear ? formatShortDayMonth(dt) : formatDate(dt);
};

export default function ArchiveScreen() {
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filteredMemories, setFilteredMemories] = useState<Memory[]>([]);
  // Inbound deep-link filters from the Recap → 30-day chip taps.
  // `tag` prefills the search input (server-side FTS already covers
  // tag content). `person` is a strict equality filter applied
  // client-side because the bulk /memories endpoint has no person
  // filter and `person` is a local-only annotation anyway.
  // `date` is a YYYY-MM-DD local-day filter applied client-side
  // (the heatmap row in the 30-day recap deep-links into this) —
  // the bulk endpoint has no date filter either, and matching
  // local-day boundaries here keeps it consistent with how the
  // heatmap counts captures into days.
  const params = useLocalSearchParams<{
    tag?: string;
    person?: string;
    date?: string;
  }>();
  const router = useRouter();
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    memories,
    lastSearchWasOffline,
    deleteMemory,
    refreshMemories,
    searchMemories,
    stuckSyncCount,
    retrySync,
    retryMemorySync,
    illustrateMemory,
    deleteIllustration,
    illustrationsUsedToday,
    illustrationsLimit,
  } = useMemories();
  // Tracks the memory id currently being illustrated so the row can
  // swap its "Illustrate" button for the painting loader and so a
  // double-tap can't trigger two parallel generates against the
  // user's quota. Reset on success/failure regardless.
  const [illustratingId, setIllustratingId] = useState<string | null>(null);
  // Per-row retry state. We track the id currently mid-retry so a
  // double-tap on the same row can't queue two concurrent `drainNow`
  // calls for the same entry (harmless but wasteful). Other rows can
  // still be retried in parallel. The retry-failure toast is
  // local-only and auto-dismisses after 2.5s; we don't persist it
  // because the badge itself is the durable signal that the row is
  // still pending.
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // Single toast state shared by the per-row "still offline" retry
  // toast and the "Sync all" batch summary toast. They're driven by
  // independent user actions but render into the same absolutely-
  // positioned overlay, so collapsing them onto one piece of state
  // avoids two cards stacking on top of each other if the user taps
  // a per-row retry and then "Sync all" inside the auto-dismiss
  // window. The most recent action wins, which matches the user's
  // mental model — they just acted, they want feedback on that.
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    icon: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
  }>({ visible: false, message: "", icon: "cloud-offline-outline" });
  // Tracks an in-flight "Sync all" drain so a second tap can't queue
  // a concurrent pass. The outbox already serializes via its own lock,
  // so this is purely a UI guard — disabling the button removes the
  // visual ambiguity of a tap that appears to do nothing because the
  // first drain is still mid-flight.
  const [syncingAll, setSyncingAll] = useState(false);
  // Local-only dismissal of the 24h "couldn't sync" banner. We
  // intentionally don't persist this to AsyncStorage — silent failure
  // is the bug we're guarding against, so if the entry still exists
  // tomorrow the banner returns. The dismiss is for "yes, I see it,
  // get it off my screen for now".
  const [dismissedStuck, setDismissedStuck] = useState(false);
  // Reset the dismiss the moment the count drops to zero so a future
  // stuck entry surfaces again.
  useEffect(() => {
    if (stuckSyncCount === 0 && dismissedStuck) {
      setDismissedStuck(false);
    }
  }, [stuckSyncCount, dismissedStuck]);
  // Local dismissal of the offline-search banner. Resets automatically
  // when the search succeeds (lastSearchWasOffline → false) so if the
  // user retries their query and the server responds the banner won't
  // reappear. Also resets when search is cleared, which already hides
  // the banner via the `search.trim()` condition — the reset just
  // ensures a new offline result on a fresh query surfaces correctly.
  const [dismissedOfflineBanner, setDismissedOfflineBanner] = useState(false);
  useEffect(() => {
    if (!lastSearchWasOffline) {
      setDismissedOfflineBanner(false);
    }
  }, [lastSearchWasOffline]);
  // Library window read uses the same subscription source the
  // editor and capture cap do — see `MemoriesContext.updateMemory`
  // for the matching enforcement when a user tries to write to a
  // locked card.
  const { status: subscriptionStatus } = useSubscription();
  const isPro = subscriptionStatus?.is_pro === true;

  // Apply incoming Recap deep-link params exactly once per nav. We
  // immediately call setParams({}) to clear the URL so a screen
  // remount or pull-to-refresh doesn't re-apply a filter the user
  // has since cleared.
  useEffect(() => {
    const tagParam = typeof params.tag === "string" ? params.tag : null;
    const personParam =
      typeof params.person === "string" ? params.person : null;
    const dateParam =
      typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
        ? params.date
        : null;
    if (!tagParam && !personParam && !dateParam) return;
    // Deep-link precedence: any inbound recap chip means "show me
    // this slice cleanly" — leftover filters from a previous nav
    // would silently hide captures the user expects to see. So:
    //   • a `date` link clears search + person and sets date
    //   • a `tag` or `person` link clears any active dateFilter
    //     before applying its own filter
    // The two non-date filters remain composable with each other
    // when both arrive in the same nav (existing behavior).
    if (dateParam) {
      setSearch("");
      setPersonFilter(null);
      setDateFilter(dateParam);
    } else {
      setDateFilter(null);
      if (tagParam) setSearch(tagParam);
      if (personParam) setPersonFilter(personParam);
    }
    router.setParams({
      tag: undefined,
      person: undefined,
      date: undefined,
    });
  }, [params.tag, params.person, params.date, router]);

  useEffect(() => {
    const q = search.trim();
    // The local-only person + date filters compose on top of either
    // the in-memory list or the server-side search results. The same
    // YYYY-MM-DD local-day boundary the heatmap aggregator uses is
    // applied here so a capture made at 11pm and one at 1am the next
    // morning sit on different cells. See `applyArchiveClientFilters`.
    const filterOpts = { personFilter, dateFilter };
    if (!q) {
      setFilteredMemories(applyArchiveClientFilters(memories, filterOpts));
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const results = await searchMemories(q);
      if (!cancelled)
        setFilteredMemories(applyArchiveClientFilters(results, filterOpts));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [memories, search, searchMemories, personFilter, dateFilter]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshMemories();
    setRefreshing(false);
  };

  // Auto-dismiss the toast. We keep this short (2.5s) because the
  // badge itself stays visible to communicate the durable state —
  // the toast is just an immediate acknowledgement that the tap
  // registered. Same timing for both per-row and "Sync all" so the
  // batch summary doesn't linger longer than the per-row signal the
  // user is already used to.
  // We include `toast.message` in the deps so that replacing one
  // toast with a new one (e.g. a per-row retry-failure toast that's
  // still on screen when the user taps "Sync all") resets the
  // auto-dismiss timer — otherwise the newer toast would inherit
  // the residual countdown from the older one and disappear early.
  useEffect(() => {
    if (!toast.visible) return;
    const handle = setTimeout(
      () => setToast((t) => ({ ...t, visible: false })),
      2500,
    );
    return () => clearTimeout(handle);
  }, [toast.visible, toast.message]);

  const handleRetryMemory = async (id: string) => {
    // Same-row dedupe only. A user retrying row A and then row B in
    // quick succession should be allowed — they're independent
    // entries in the outbox and the drain serializes anyway.
    if (retryingId === id) return;
    setRetryingId(id);
    try {
      const outcome = await retryMemorySync(id);
      // "noop" stays silent — the entry was already drained between
      // render and tap (the badge is about to disappear on the next
      // heartbeat tick anyway), so a toast would just be noise.
      // "failed" surfaces the offline toast so the user knows the
      // tap registered but didn't move the row. "synced" gets a
      // brief positive confirmation: the badge transitioning is easy
      // to miss on a long list, and an explicit "Saved to your
      // library" closes the loop the user opened by tapping retry.
      if (outcome === "failed") {
        setToast({
          visible: true,
          message: "Still offline — try again later",
          icon: "cloud-offline-outline",
          iconColor: colors.mutedForeground,
        });
      } else if (outcome === "synced") {
        setToast({
          visible: true,
          message: "Saved to your library",
          icon: "checkmark-circle",
          iconColor: colors.primary,
        });
      }
    } finally {
      setRetryingId(null);
    }
  };

  // True when the free user has burned their daily slot. Pro users
  // (limit == null) never hit this branch — they pass through with
  // an unbounded button. We compute this in the screen rather than
  // in the context so a stale render after a successful illustrate
  // (which bumps `usedToday` synchronously) immediately disables
  // the button on every other row, not just the row that just
  // generated.
  //
  // All math + wording for the per-row meter goes through
  // `getIllustrationQuotaState` so the home hint, this footer, and
  // the Capture confirmation card stay locked together.
  const illustrationQuota = getIllustrationQuotaState(
    illustrationsUsedToday,
    illustrationsLimit,
    isPro,
  );
  const illustrateLimitReached = illustrationQuota.atLimit;

  const handleIllustrate = async (item: Memory) => {
    if (illustratingId) return;
    if (illustrateLimitReached) {
      router.push("/subscription");
      return;
    }
    setIllustratingId(item.id);
    try {
      const result = await illustrateMemory(item.id);
      if (result.kind === "ok") {
        setToast({
          visible: true,
          message: "Memory illustrated",
          icon: "sparkles",
          iconColor: colors.primary,
        });
      } else if (result.kind === "limit") {
        setToast({
          visible: true,
          message: ILLUSTRATION_OUT_TOAST,
          icon: "lock-closed",
          iconColor: colors.mutedForeground,
        });
        // Bump the user toward the paywall on a short delay so the
        // toast is visible before the route transition.
        setTimeout(() => {
          router.push("/subscription");
        }, 400);
      } else if (result.kind === "auth_error") {
        setToast({
          visible: true,
          message: "Please sign in again",
          icon: "alert-circle",
          iconColor: colors.destructive,
        });
      } else {
        setToast({
          visible: true,
          message: "Couldn't illustrate — try again",
          icon: "alert-circle",
          iconColor: colors.destructive,
        });
      }
    } finally {
      setIllustratingId(null);
    }
  };

  // Regenerate flow (Task #210). Reuses `illustrateMemory` so the
  // server's quota gate still fires — a free user out of slots gets
  // bumped to the paywall just like a fresh generate. We pre-check
  // the local quota so a known-out user sees the upsell without
  // wasting a round trip and without the row briefly flashing the
  // painting loader.
  const handleRegenerate = async (item: Memory) => {
    if (illustratingId) return;
    if (illustrateLimitReached) {
      router.push("/subscription");
      return;
    }
    setIllustratingId(item.id);
    try {
      const result = await illustrateMemory(item.id);
      if (result.kind === "ok") {
        setToast({
          visible: true,
          message: "Illustration regenerated",
          icon: "sparkles",
          iconColor: colors.primary,
        });
      } else if (result.kind === "limit") {
        setToast({
          visible: true,
          message: ILLUSTRATION_OUT_TOAST,
          icon: "lock-closed",
          iconColor: colors.mutedForeground,
        });
        setTimeout(() => router.push("/subscription"), 400);
      } else if (result.kind === "auth_error") {
        setToast({
          visible: true,
          message: "Please sign in again",
          icon: "alert-circle",
          iconColor: colors.destructive,
        });
      } else {
        setToast({
          visible: true,
          message: "Couldn't regenerate — try again",
          icon: "alert-circle",
          iconColor: colors.destructive,
        });
      }
    } finally {
      setIllustratingId(null);
    }
  };

  // Remove flow (Task #210). The lightbox already showed a
  // confirmation dialog before this fires, so we go straight to the
  // mutation. Errors surface as a toast; the local strip happens
  // inside `deleteIllustration` only on `kind: "ok"` so a network
  // failure leaves the polaroid visible for retry.
  const handleRemoveIllustration = async (item: Memory) => {
    const result = await deleteIllustration(item.id);
    if (result.kind === "ok") {
      setToast({
        visible: true,
        message: "Illustration removed",
        icon: "trash-outline",
        iconColor: colors.mutedForeground,
      });
    } else if (result.kind === "auth_error") {
      setToast({
        visible: true,
        message: "Please sign in again",
        icon: "alert-circle",
        iconColor: colors.destructive,
      });
    } else {
      setToast({
        visible: true,
        message: "Couldn't remove — try again",
        icon: "alert-circle",
        iconColor: colors.destructive,
      });
    }
  };

  const renderMemoryRow = (item: Memory, index: number) => {
    const window = getLibraryWindowState(item.timestamp, isPro);
    // Out-of-window memories render as a tease (blurred snippet,
    // "Unlock 31-Day Memory Library" CTA). Tap routes to
    // /subscription. The matching write-side enforcement lives in
    // `MemoriesContext.updateMemory` — both layers must use the same
    // helper so a stale render can't allow an edit the API would
    // refuse anyway.
    if (!window.editable) {
      return (
        <BreatheCard index={index}>
          <LockedMemoryCard
            timestamp={item.timestamp}
            snippet={item.content}
            lockedReason={window.lockedReason ?? "Outside your library window"}
          />
        </BreatheCard>
      );
    }

    const date = new Date(item.timestamp);
    const timeString = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dateString = formatDate(date);

    // Map the row's outbox-derived flags to the indicator's three
    // states. Failed wins over pending so a row that has already been
    // tried and is now waiting on backoff renders the warning glyph.
    // See `getMemorySyncStatus` for the precedence rule.
    const syncStatus = getMemorySyncStatus(item);

    return (
      <BreatheCard index={index}>
        {/* SettleOnMount adds a per-row Mercury settle on entry,
            staggered by row index so the list arrives as a wave
            rather than a synchronized jolt. Cap at 8 to keep the
            tail short on long lists. LiftPress under it gives the
            press lift; accessibilityRole="none" so screen readers
            don't announce a duplicate "button". Inner Pressables
            (delete, photo viewer, retry badge) keep responder
            ownership via RN's gesture system. */}
        <SettleOnMount delay={(index % 8) * ROW_STAGGER_MS}>
          <LiftPress
            accessibilityRole="none"
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.cardHeader}>
            <View style={styles.timeRow}>
              <MemorySyncStatus
                status={syncStatus}
                onRetry={
                  // Tap-to-retry is wired only on the "failed"
                  // ("Saved offline") badge. The "pending" state is a
                  // genuinely in-flight drain — the outbox lock would
                  // serialize a retry behind it anyway, and a spinning
                  // indicator that also acts as a button is confusing.
                  syncStatus === "failed"
                    ? () => {
                        void handleRetryMemory(item.id);
                      }
                    : undefined
                }
              />
              <Text style={[styles.time, { color: colors.mutedForeground }]}>{dateString} at {timeString}</Text>
            </View>
            <Pressable onPress={() => deleteMemory(item.id)} style={({ pressed }) => [pressed && { opacity: 0.5 }]}>
              <Ionicons name="trash-outline" size={18} color={colors.destructive} />
            </Pressable>
          </View>
          <Text style={[styles.content, { color: colors.foreground }]}>{item.content}</Text>
          {/* User-attached photo thumbnail (Task #372). Renders the
              server-generated 256x256 thumb when available, falling
              back to the full photo when sharp couldn't decode the
              upload. While the photo is in the local upload queue
              we show a small "Uploading photo…" affordance so the
              user knows the picture they attached is in flight. */}
          {item.photos && item.photos.length > 0 ? (
            // Multi-photo album (Task #385). Render up to 3 thumbs
            // inline with a "+N" badge if the memory holds more
            // than fits on one row. The whole row taps through to
            // the full-screen viewer added in Task #387.
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel="View photos full screen"
              onPress={() =>
                router.push({
                  pathname: "/photo/[clientId]" as never,
                  params: { clientId: item.id },
                })
              }
              style={({ pressed }) => [
                styles.photoThumbRow,
                pressed && { opacity: 0.85 },
              ]}
            >
              {item.photos.slice(0, 3).map((p, idx) => (
                <Image
                  key={p.photoId ?? `${p.url}-${idx}`}
                  source={{ uri: p.thumbUrl ?? p.url }}
                  style={styles.photoThumb}
                  contentFit="cover"
                  transition={150}
                />
              ))}
              {item.photos.length > 3 ? (
                <View
                  style={[
                    styles.photoThumb,
                    styles.photoThumbMoreBadge,
                    { backgroundColor: colors.muted, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.photoThumbMoreText, { color: colors.foreground }]}
                  >
                    +{item.photos.length - 3}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : item.photoUrl ? (
            // Legacy single-photo path: a memory hydrated from an
            // older cache that hadn't been re-merged through the
            // bulk endpoint yet. Renders the same way the Task
            // #372 build did, including the Task #387 viewer
            // pressable, so a transitional cold-start is
            // visually unchanged.
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel="View photo full screen"
              onPress={() =>
                router.push({
                  pathname: "/photo/[clientId]" as never,
                  params: { clientId: item.id },
                })
              }
              style={({ pressed }) => [
                styles.photoThumbWrap,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Image
                source={{ uri: item.photoThumbUrl ?? item.photoUrl }}
                style={styles.photoThumb}
                contentFit="cover"
                transition={150}
              />
            </Pressable>
          ) : item.photoPendingUpload ? (
            <View style={styles.photoPendingRow}>
              <Ionicons
                name="cloud-upload-outline"
                size={14}
                color={colors.mutedForeground}
              />
              <Text style={[styles.photoPendingText, { color: colors.mutedForeground }]}>
                Uploading photo…
              </Text>
            </View>
          ) : null}
          {/* On-device facet chips (Task #195 / #275). Reads only from
              `memory.facets.tags` — rows captured before the
              FoundationModels bridge shipped, rows on non-Apple-
              Intelligence devices, and rows where the model call
              failed all simply omit the field and the component
              renders null. No new server contract. */}
          <MemoryFacetChips facets={item.facets} />
          {/* Illustration footer. Three states, mutually exclusive:
              1. illustrationUrl present → show polaroid (taps open the lightbox)
              2. currently illustrating this row → show the painting loader
              3. otherwise → show the Illustrate button (or upsell tease) */}
          {item.illustrationUrl ? (
            <View style={styles.illustrationRow}>
              <IllustrationPolaroid
                imageUrl={item.illustrationUrl}
                thumbUrl={item.illustrationThumbUrl}
                caption={item.content}
                size={160}
                onRegenerate={() => {
                  void handleRegenerate(item);
                }}
                onRemove={() => {
                  void handleRemoveIllustration(item);
                }}
                actionsBusy={illustratingId === item.id}
              />
            </View>
          ) : illustratingId === item.id ? (
            <View style={styles.illustrationRow}>
              <IllustrationLoader size={72} />
            </View>
          ) : (
            <View style={styles.illustrateRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  illustrateLimitReached
                    ? "Upgrade to illustrate more memories"
                    : "Illustrate this memory"
                }
                onPress={() => {
                  void handleIllustrate(item);
                }}
                disabled={illustratingId !== null}
                style={({ pressed }) => [
                  styles.illustrateBtn,
                  {
                    borderColor: colors.border,
                    backgroundColor: illustrateLimitReached
                      ? "transparent"
                      : colors.card,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={illustrateLimitReached ? "lock-closed" : "sparkles-outline"}
                  size={14}
                  color={
                    illustrateLimitReached ? colors.mutedForeground : colors.primary
                  }
                />
                <Text
                  style={[
                    styles.illustrateBtnText,
                    {
                      color: illustrateLimitReached
                        ? colors.mutedForeground
                        : colors.primary,
                    },
                  ]}
                >
                  {illustrateLimitReached ? "Upgrade for more" : "Illustrate"}
                </Text>
              </Pressable>
              {illustrationQuota.visible ? (
                <Text style={[styles.illustrateMeter, { color: colors.mutedForeground }]}>
                  {illustrationQuota.label}
                </Text>
              ) : null}
            </View>
          )}
          </LiftPress>
        </SettleOnMount>
      </BreatheCard>
    );
  };

  // Build a discriminated row list so the pinned "Pending sync" group
  // can render above the timestamp-sorted main list inside a single
  // FlatList. We keep this in one list (rather than reaching for
  // SectionList) so the existing scroll handler, sticky header
  // measurement, refresh control, and empty-state plumbing stay
  // unchanged. The pinned section renders only when there's at least
  // one row that still owes the server — no header, no empty slot.
  // See `buildArchiveRows` for the splitting/keying rules.
  const rows = buildArchiveRows(filteredMemories);

  const handleSyncAll = async () => {
    if (syncingAll) return;
    // Snapshot the pre-drain pending count so the "partial" toast
    // can frame the result as "X of Y synced" using the user's
    // visible expectation rather than only the entries the drain
    // happened to attempt this pass. The drain may skip entries that
    // are still in backoff — those count as "still pending" from the
    // user's POV even though `retrySync` won't return an outcome
    // for them.
    // Count of memories visibly pending or failed in the current
    // filtered view. Mirrors the same predicate `splitPinnedMemories`
    // uses to populate the pinned "Pending sync" group, so the
    // "X of Y synced" toast frames the result against exactly what
    // the user could see when they tapped Sync all.
    const pendingBefore = filteredMemories.filter(isPendingOrFailed).length;
    setSyncingAll(true);
    try {
      const { synced, failed } = await retrySync();
      // True no-op: there was nothing visibly pending to begin with
      // AND the drain produced no outcomes (e.g. the user tapped
      // right after a heartbeat already drained the queue, or
      // another pass held the lock). A toast in this case would be
      // more confusing than silence — the section is empty.
      if (pendingBefore === 0 && synced === 0 && failed === 0) return;
      // "Still pending" from the user's POV is anything that didn't
      // confirmably sync this pass. We take the max of (pre-drain
      // count minus synced) and `failed` so a partial drain that
      // happened to attempt fewer entries than were visible (because
      // some were still in backoff) doesn't under-report. If the
      // drain produced zero outcomes at all but rows were visible,
      // those rows are still pending — that path falls through to
      // the all-failed branch below.
      const stillPending = Math.max(pendingBefore - synced, failed);
      if (failed === 0 && stillPending === 0) {
        setToast({
          visible: true,
          message:
            synced === 1 ? "Memory synced" : `All ${synced} memories synced`,
          icon: "checkmark-circle",
          iconColor: colors.primary,
        });
      } else if (synced === 0) {
        // Includes both the explicit-failure case and the "drain
        // skipped everything because of backoff" case. Either way,
        // the user's expectation is "I tapped Sync all and nothing
        // moved" — they should hear that, not get silence.
        setToast({
          visible: true,
          message:
            stillPending === 1
              ? "Still offline — 1 memory pending"
              : `Still offline — ${stillPending} memories pending`,
          icon: "cloud-offline-outline",
          iconColor: colors.mutedForeground,
        });
      } else {
        const total = synced + stillPending;
        setToast({
          visible: true,
          message: `${synced} of ${total} synced — ${stillPending} still pending`,
          icon: "cloud-offline-outline",
          iconColor: colors.mutedForeground,
        });
      }
    } finally {
      setSyncingAll(false);
    }
  };

  const renderItem = ({ item }: { item: ArchiveRow }) => {
    if (item.kind === "pinned-header") {
      // Show the "Sync all" affordance only when there's more than one
      // pending row — a single row already has its own per-badge tap-
      // to-retry, so a section-level button would be redundant noise.
      const showSyncAll = item.count > 1;
      return (
        <View style={styles.pinnedHeader}>
          <Ionicons
            name="cloud-offline-outline"
            size={14}
            color={colors.mutedForeground}
          />
          <Text
            style={[styles.pinnedHeaderText, { color: colors.mutedForeground }]}
          >
            Pending sync · {item.count}
          </Text>
          {showSyncAll && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sync all ${item.count} pending memories`}
              accessibilityState={{ disabled: syncingAll }}
              disabled={syncingAll}
              onPress={() => {
                void handleSyncAll();
              }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.syncAllButton,
                {
                  borderColor: colors.primary,
                  opacity: syncingAll ? 0.5 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[styles.syncAllText, { color: colors.primary }]}
              >
                {syncingAll ? "Syncing…" : "Sync all"}
              </Text>
            </Pressable>
          )}
        </View>
      );
    }
    if (item.kind === "day-header") {
      const details = [
        `${item.day.memoryCount} ${item.day.memoryCount === 1 ? "memory" : "memories"}`,
        item.day.callCount > 0
          ? `${item.day.callCount} ${item.day.callCount === 1 ? "call" : "calls"}`
          : null,
        item.day.hasPhoto ? "photos" : null,
        item.day.hasSelfie ? "selfie" : null,
        item.day.pendingSyncCount > 0
          ? `${item.day.pendingSyncCount} pending`
          : null,
      ].filter((part): part is string => part !== null);
      return (
        <View style={styles.dayHeader}>
          <Text style={[styles.dayHeaderDate, { color: colors.foreground }]}>
            {item.day.displayDate}
          </Text>
          <Text
            style={[styles.dayHeaderMeta, { color: colors.mutedForeground }]}
          >
            {details.join(" · ")}
          </Text>
        </View>
      );
    }
    return renderMemoryRow(item.memory, item.index);
  };

  // Drives the frosted-glass intensity on the sticky Archive header.
  // Updated off the JS thread by `useAnimatedScrollHandler` so the
  // BlurView ramp stays smooth even while the FlatList is fast-scrolling.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  // Measured at runtime via onLayout so the FlatList contentContainer
  // can reserve exactly enough top padding to clear the absolutely-
  // positioned header. Recomputed when filter chips appear/disappear
  // (the header grows/shrinks) so the first row is never initially
  // obscured. Starts at 0 — the very first frame may render the first
  // row under the header for one tick, which is acceptable and avoids
  // having to hard-code a guess that would drift from the real height.
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setHeaderHeight((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  };

  // Tailor the empty-state copy + action so a deep-linked filter
  // (e.g. tapping a quiet day in the heatmap) doesn't dump the user
  // on the generic "Try a different search term" message. Date wins
  // over person because the deep-link logic above clears person when
  // a date arrives, so they're effectively mutually exclusive — but
  // we still cover the person case so the two filters stay
  // consistent. Search is folded into the description as a secondary
  // hint when both a filter and a query are active.
  const buildEmptyStateProps = () => {
    // When both filters are active (a user can stack them by tapping
    // a person chip after deep-linking from the heatmap), the empty
    // state must still surface a way back to a populated library.
    // We render a single "Clear filters" action that drops both,
    // keeping the EmptyState single-action contract while ensuring
    // the person filter case is never stuck without an exit.
    if (dateFilter && personFilter) {
      const label = formatDateFilterLabel(dateFilter);
      return {
        icon: "funnel-outline" as const,
        title: `No memories from ${personFilter} on ${label}`,
        description: "Clear the person filter to see this person's other memories, or tap the date chip to widen the day.",
        // Single-action contract → "Clear person filter" wins (Task
        // #311). The audit found that the previous "Clear filters"
        // label dropped both, but lost the explicit "person filter"
        // surface. Clearing person only still gives the user a
        // working exit: if no memories match the date alone they
        // fall through to the date-only empty state which has its
        // own "Clear date filter" button.
        action: {
          label: "Clear person filter",
          onPress: () => setPersonFilter(null),
          accessibilityLabel: `Clear person filter ${personFilter}`,
        },
      };
    }
    if (dateFilter) {
      const label = formatDateFilterLabel(dateFilter);
      const trimmed = search.trim();
      return {
        icon: "calendar-outline" as const,
        title: `No memories on ${label}`,
        description: trimmed
          ? `Nothing matches "${trimmed}" on this day. Clear the date filter to search everything.`
          : "Clear the date filter to see your other memories.",
        action: {
          label: "Clear date filter",
          onPress: () => setDateFilter(null),
          accessibilityLabel: `Clear date filter ${dateFilter}`,
        },
      };
    }
    if (personFilter) {
      const trimmed = search.trim();
      return {
        icon: "person-outline" as const,
        title: `No memories from ${personFilter}`,
        description: trimmed
          ? `Nothing matches "${trimmed}" for this person. Clear the person filter to search everything.`
          : "Clear the person filter to see your other memories.",
        action: {
          label: "Clear person filter",
          onPress: () => setPersonFilter(null),
          accessibilityLabel: `Clear person filter ${personFilter}`,
        },
      };
    }
    return {
      icon: "archive-outline" as const,
      title: "No memories found",
      description: search
        ? "Try a different search term"
        : "Capture your first memory to see it here",
    };
  };

  return (
    <SettleOnMount style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[styles.header, { paddingTop: insets.top + 16 }]}
        onLayout={onHeaderLayout}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <FrostBackground scrollY={scrollY} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Archive</Text>
        <View style={[styles.searchContainer, { backgroundColor: colors.input, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.mutedForeground} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search memories..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            maxLength={SEARCH_QUERY_MAX_LENGTH}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} style={styles.clearIcon}>
              <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        {personFilter !== null && (
          <Pressable
            onPress={() => setPersonFilter(null)}
            style={[
              styles.personFilterChip,
              {
                backgroundColor: colors.accent + "22",
                borderColor: colors.accent,
              },
            ]}
            accessibilityLabel={`Clear person filter ${personFilter}`}
          >
            <Ionicons name="person" size={14} color={colors.accent} />
            <Text
              style={[styles.personFilterText, { color: colors.accent }]}
              numberOfLines={1}
            >
              {personFilter}
            </Text>
            <Ionicons name="close" size={14} color={colors.accent} />
          </Pressable>
        )}
        {dateFilter !== null && (
          <Pressable
            onPress={() => setDateFilter(null)}
            style={[
              styles.personFilterChip,
              {
                backgroundColor: colors.primary + "22",
                borderColor: colors.primary,
              },
            ]}
            accessibilityLabel={`Clear date filter ${dateFilter}`}
          >
            <Ionicons name="calendar" size={14} color={colors.primary} />
            <Text
              style={[styles.personFilterText, { color: colors.primary }]}
              numberOfLines={1}
            >
              {formatDateFilterLabel(dateFilter)}
            </Text>
            <Ionicons name="close" size={14} color={colors.primary} />
          </Pressable>
        )}
      </View>

      <Animated.FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerHeight, paddingBottom: insets.bottom + 100 },
        ]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <>
            {stuckSyncCount > 0 && !dismissedStuck ? (
              <SyncWarningBanner
                count={stuckSyncCount}
                onRetry={() => {
                  void retrySync();
                }}
                onDismiss={() => setDismissedStuck(true)}
              />
            ) : null}
            {lastSearchWasOffline && search.trim() !== "" && !dismissedOfflineBanner ? (
              <View
                style={[
                  styles.offlineBanner,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
                accessibilityLiveRegion="polite"
                testID="offline-search-banner"
              >
                <Ionicons
                  name="cloud-offline-outline"
                  size={15}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[styles.offlineBannerText, { color: colors.mutedForeground }]}
                >
                  Showing offline matches — couldn't reach the server
                </Text>
                <Pressable
                  onPress={() => setDismissedOfflineBanner(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss offline search notice"
                  style={({ pressed }) => [pressed && { opacity: 0.5 }]}
                >
                  <Ionicons name="close" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <EmptyState {...buildEmptyStateProps()} />
        }
      />
      <Toast
        visible={toast.visible}
        message={toast.message}
        icon={toast.icon}
        iconColor={toast.iconColor}
      />
    </SettleOnMount>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    // Overlay the FlatList so memory cards scroll *behind* the
    // frosted glass instead of below it (Task #97). The list reserves
    // matching top padding via the measured `headerHeight` so the
    // first row isn't initially obscured. Note the solid background
    // layer that used to sit under the frost is intentionally gone —
    // with the header overlaid, anything opaque behind the BlurView
    // would defeat the whole point of the ramp.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.base,
    // Clip the absolute-fill BlurView so the frost never bleeds past
    // the header bounds on Android (where overflow defaults to
    // "visible").
    overflow: "hidden",
  },
  title: {
    ...text.screenTitle,
    marginBottom: spacing.base,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...text.body,
    height: "100%",
  },
  clearIcon: {
    padding: 4,
  },
  personFilterChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    // 10: deliberate one-off, between spacing.sm (8) and spacing.md (12).
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    maxWidth: "100%",
  },
  personFilterText: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    flexGrow: 1,
  },
  pinnedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    marginBottom: spacing.sm,
    paddingHorizontal: 4,
  },
  pinnedHeaderText: {
    ...text.captionStrong,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  dayHeader: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: 4,
  },
  dayHeaderDate: {
    ...text.bodySemibold,
  },
  dayHeaderMeta: {
    ...text.caption,
    marginTop: 2,
  },
  syncAllButton: {
    marginLeft: "auto",
    // 10: deliberate one-off, between spacing.sm (8) and spacing.md (12).
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  syncAllText: {
    ...text.captionStrong,
    letterSpacing: 0.3,
  },
  card: {
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  time: {
    ...text.caption,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  content: {
    ...text.body,
    lineHeight: 24,
  },
  illustrationRow: {
    marginTop: spacing.md,
    alignItems: "flex-start",
  },
  photoThumbWrap: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },
  photoThumbRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  photoThumb: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
  },
  photoThumbMoreBadge: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  photoThumbMoreText: {
    ...text.bodySemibold,
  },
  photoPendingRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  photoPendingText: {
    ...text.caption,
  },
  illustrateRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 10, // 10: deliberate one-off between spacing.sm (8) and spacing.md (12)
    flexWrap: "wrap",
  },
  illustrateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7, // 7: deliberate one-off for pill geometry
    borderRadius: 999, // fully-rounded pill geometry
    borderWidth: 1,
  },
  illustrateBtnText: {
    ...text.captionStrong,
    fontSize: 13, // 13: between captionStrong (12) and helper (14)
    letterSpacing: 0.2,
  },
  illustrateMeter: {
    ...text.caption,
    fontSize: 11, // 11: between tiny (10) and caption (12)
    letterSpacing: 0.2,
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.base,
  },
  offlineBannerText: {
    ...text.caption,
    flex: 1,
  },
});
