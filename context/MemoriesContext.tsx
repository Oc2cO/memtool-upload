import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  enqueuePhotoUpload as enqueuePhotoUploadStorage,
} from "@/lib/memoryPhotos";
import { useAuth } from "./AuthContext";
import { useSubscription } from "./SubscriptionContext";
import {
  CaptureBlockedError,
  CaptureLimitReachedError,
  LibraryWindowLockedError,
} from "@/lib/subscription";
import {
  getCaptureLimitState,
  getLibraryWindowState,
  isTimestampToday,
} from "@/lib/captureLimits";
import {
  apiCreateMemory,
  apiDeleteMemory,
  apiListMemoriesWithTimeout,
  apiSearchMemoriesWithTimeout,
  apiUpdateMemory,
  extractAnnotation,
  mergeAnnotations,
  newClientId,
  type Memory,
  type MemoryAnnotationMap,
  type MemoryFacets,
} from "@/lib/memories";
import { useSyncOutbox } from "@/lib/useSyncOutbox";
import {
  ANNOTATE_ID_PREFIX,
  annotateOutboxId,
  summarizeMemoryDrainOutcomes,
  type DrainApi,
  type DrainOutcome,
  type OutboxEntry,
} from "@/lib/syncOutbox";
import {
  apiDeleteAnnotation,
  apiFetchAnnotations,
  apiPutAnnotation,
} from "@/lib/annotations";
import {
  apiDeleteIllustration,
  apiFetchIllustrations,
  apiIllustrateMemory,
  mergeIllustrations,
  type DeleteIllustrationResult,
  type IllustrateResult,
  type IllustrationMap,
} from "@/lib/illustrations";
import {
  apiFetchPhotos,
  drainPhotoQueue,
  listPendingPhotoIds,
  mergePhotos,
  type PhotoMap,
} from "@/lib/memoryPhotos";
import {
  enqueueMemoriesForEmbedding,
  refreshPatternsIfDue,
  runDailyReaper,
  configureEngineMutator,
  type EngineMemoryInput,
  type EngineMutator,
} from "@/lib/aiEngine";
import { backfillMissingFacets } from "@/lib/backfillFacets";
import {
  extractFacets,
  getAvailability as getFmAvailability,
} from "@/modules/foundation-models";

export type { Memory } from "@/lib/memories";

interface MemoriesContextType {
  memories: Memory[];
  todayMemories: Memory[];
  /** True when the most recent `searchMemories` call fell back to the
   *  local in-memory filter because the server fetch failed (network
   *  error, timeout, captive portal). Resets to `false` on the next
   *  successful server search or when the query is cleared. Consumers
   *  can use this to surface an unobtrusive "offline results" banner. */
  lastSearchWasOffline: boolean;
  addMemory: (
    content: string,
    options?: Partial<
      Pick<
        Memory,
        | "kind"
        | "tags"
        | "person"
        | "linkedEventId"
        | "facets"
        | "dailySelfieDate"
      >
    > & {
      /** Daily-selfie replacement (Task #375) — when true, the
       *  Layer-3 cap throw is skipped because the caller has just
       *  deleted the same-day selfie this row is replacing. The
       *  user's net daily-row count is unchanged. Server-side cap
       *  enforcement still applies via the outbox response, so this
       *  flag can't be used to gain extra captures. */
      bypassCaptureLimit?: boolean;
    },
  ) => Promise<{ syncedToCloud: boolean; id: string | null }>;
  addCall: (options: {
    person: string;
    content: string;
    tags?: string[];
    linkedEventId?: string;
  }) => Promise<{ syncedToCloud: boolean; id: string | null }>;
  updateMemory: (id: string, updates: Partial<Memory>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  refreshMemories: () => Promise<void>;
  searchMemories: (query: string) => Promise<Memory[]>;
  isLoading: boolean;
  /** Number of outbox entries that have been failing for ≥24h. The
   *  Archive tab reads this to decide whether to surface the
   *  SyncWarningBanner. */
  stuckSyncCount: number;
  /** Force an outbox drain attempt immediately. Wired to the Retry
   *  button on the SyncWarningBanner and the "Sync all" affordance
   *  on the Archive's pinned offline section.
   *
   *  Returns a per-call summary derived from the drain's outcomes so
   *  the caller can surface a batch-level toast:
   *   - `synced` counts entries that were accepted by the server on
   *     this pass (both `success` and `duplicate` outcomes — both
   *     clear the pending row, see `retryMemorySync`).
   *   - `failed` counts entries that were attempted on this pass but
   *     came back as `failure` (still offline / server still
   *     rejecting). Entries already in backoff that the lock skipped
   *     contribute to neither count.
   *  Annotation outbox entries (the `ann:` keyspace) are excluded
   *  from both counts — they're not memory rows, so counting them
   *  would inflate a user-facing "N memories" toast.
   *  Both being zero means the drain didn't have anything memory-
   *  related to attempt (e.g. the queue was already empty, only
   *  annotations drained, or another pass held the lock) — callers
   *  should treat this as "nothing to report". */
  retrySync: () => Promise<{ synced: number; failed: number }>;
  /** Force an immediate sync attempt for one memory's outbox entry,
   *  bypassing the normal exponential backoff. Wired to the per-row
   *  tap-to-retry on the offline badge in the Archive tab.
   *  Outcomes:
   *   - "synced"   → the entry flushed to the server (success OR
   *                  duplicate-collapse — both clear the pending row).
   *   - "failed"   → the retry attempt was made but failed again
   *                  (still offline / server still rejecting). The
   *                  caller should surface the "still offline" toast.
   *   - "noop"     → there was no queued entry for this id (already
   *                  drained by the heartbeat between render and tap)
   *                  or no signed-in user. The caller should stay
   *                  silent — the badge will already be gone. */
  retryMemorySync: (id: string) => Promise<"synced" | "failed" | "noop">;
  /** AI illustration for a memory. Returns a discriminated result so
   *  the caller can drive the right UI: `"ok"` populates the polaroid
   *  on the row, `"limit"` opens the paywall upsell, `"auth_error"`
   *  bounces to login, `"server_error"` shows a retryable error toast.
   *  On success the illustration URL is also written into the
   *  in-memory list and the AsyncStorage cache so a subsequent
   *  Archive render shows the polaroid without waiting for the next
   *  bulk pull. */
  illustrateMemory: (id: string) => Promise<IllustrateResult>;
  /** Discard a memory's illustration on both server and client (Task
   *  #210). Wired to the Lightbox's "Remove" action. The server
   *  delete is idempotent — a stale tap that races with another
   *  device still resolves to `kind: "ok"`. On a successful clear
   *  we strip `illustrationUrl` / `illustratedAt` from the in-memory
   *  list and the AsyncStorage cache so the row immediately swaps
   *  back to its "Illustrate" affordance without waiting for the
   *  next bulk pull.
   *
   *  We deliberately do NOT decrement `illustrationsUsedToday` here
   *  — the daily quota is a cost counter, not an inventory of
   *  visible images. Refunding it would let a free user loop
   *  generate→delete→generate to bypass the cap; the server agrees
   *  and never refunds either. */
  deleteIllustration: (id: string) => Promise<DeleteIllustrationResult>;
  /** How many AI illustrations the current user has generated today
   *  (per the device-local day). Updated on every successful
   *  generation and refreshed by `loadMemories`. Used by the Archive
   *  card to show "0 of 1 left" and to disable the button when the
   *  free user is out of slots. */
  illustrationsUsedToday: number;
  /** Daily illustration cap for the active tier. `null` means no
   *  cap (Pro). Free users default to 1. */
  illustrationsLimit: number | null;
  /** Attach a freshly-picked user photo to a memory (Task #372).
   *  Persists the local URI in the per-user photo upload queue and
   *  kicks the drain immediately. The memory is marked
   *  `photoPendingUpload` synchronously so the confirmation card +
   *  Archive row show the "Uploading photo…" affordance even if
   *  the device is offline. The drain replays on AppState
   *  foreground / heartbeat until the bytes land. */
  attachPhotoToMemory: (
    clientId: string,
    photo: { localUri: string; takenAt?: string; mimeType?: string },
  ) => Promise<void>;
}

const MemoriesContext = createContext<MemoriesContextType | null>(null);

const memoriesKey = (email: string) => `memories_${email}`;
const annotationsKey = (email: string) => `memoryAnnotations_${email}`;

async function loadAnnotations(email: string): Promise<MemoryAnnotationMap> {
  try {
    const raw = await AsyncStorage.getItem(annotationsKey(email));
    return raw ? (JSON.parse(raw) as MemoryAnnotationMap) : {};
  } catch {
    return {};
  }
}

async function writeAnnotations(email: string, map: MemoryAnnotationMap): Promise<void> {
  try {
    await AsyncStorage.setItem(annotationsKey(email), JSON.stringify(map));
  } catch {
    // ignore
  }
}

async function writeMemoriesCache(email: string, list: Memory[]): Promise<void> {
  try {
    await AsyncStorage.setItem(memoriesKey(email), JSON.stringify(list));
  } catch {
    // ignore
  }
}

async function readMemoriesCache(email: string): Promise<Memory[]> {
  try {
    const raw = await AsyncStorage.getItem(memoriesKey(email));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Memory[];
    return parsed.map((m) => ({ ...m, kind: m.kind || "memory" }));
  } catch {
    return [];
  }
}

function sortByTimestampDesc(list: Memory[]): Memory[] {
  return [...list].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function toEngineInput(m: Memory): EngineMemoryInput {
  return {
    id: m.id,
    content: m.content,
    timestamp: m.timestamp,
    kind: m.kind,
    tags: m.tags,
    person: m.person,
    // Forward the on-device facets (Task #195) so aiEngine's
    // patterns aggregator can prefer the model's structured
    // tags/theme over the legacy keyword path. Legacy rows
    // without facets keep flowing through `tags`.
    facets: m.facets,
    embeddingFailed: m.embeddingFailed,
    embeddingPermanentlyFailed: m.embeddingPermanentlyFailed,
  };
}

// Daily reaper + embed enqueue + patterns refresh, all best-effort and
// off the render path. Replaces the missing nightly cron — fires
// whenever the memory list refreshes.
async function maintainAiEngine(
  email: string,
  isPro: boolean,
  memories: Memory[],
): Promise<void> {
  if (!email || memories.length === 0) return;
  try {
    const failed = memories.filter(
      (m) => m.embeddingFailed === true && m.embeddingPermanentlyFailed !== true,
    );
    if (failed.length > 0) await runDailyReaper(email, failed.map(toEngineInput));
  } catch {
    /* best-effort */
  }
  try {
    enqueueMemoriesForEmbedding(email, memories.map(toEngineInput));
  } catch {
    /* best-effort */
  }
  try {
    await refreshPatternsIfDue(email, isPro, memories.map(toEngineInput));
  } catch {
    /* best-effort */
  }
}

export function MemoriesProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  // Pulled here (not inside addMemory) because hooks can only be
  // called at the top of a component body. addMemory closes over the
  // latest `subscriptionStatus` reference on every render, so when
  // SubscriptionContext refreshes (post-purchase) the cap check sees
  // the new is_pro value without needing any extra wiring. Provider
  // order in app/_layout.tsx puts SubscriptionProvider above
  // MemoriesProvider so this hook is guaranteed to resolve.
  const { status: subscriptionStatus, freeDailyCaptureLimit } = useSubscription();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Illustration quota state — refreshed alongside the memories
  // bulk pull on every `loadMemories`, and bumped optimistically by
  // `illustrateMemory` on a successful generate so the Archive
  // card's "X of Y left" updates instantly without waiting for
  // another round trip. `limit` is `null` for Pro users (unbounded).
  const [illustrationsUsedToday, setIllustrationsUsedToday] = useState(0);
  const [illustrationsLimit, setIllustrationsLimit] = useState<number | null>(1);
  const [lastSearchWasOffline, setLastSearchWasOffline] = useState(false);

  // Engine mutator: lets aiEngine flip per-memory flags from inside its
  // batch pipeline without each Memory consumer needing engine wiring.
  useEffect(() => {
    const mutator: EngineMutator = {
      setPending: (ids) => updateFlags(ids, { pendingEmbedding: true }),
      clearPending: (ids) => updateFlags(ids, { pendingEmbedding: false }),
      setEmbedded: (ids) =>
        updateFlags(ids, {
          pendingEmbedding: false,
          embeddingFailed: false,
        }),
      setFailed: (ids) =>
        updateFlags(ids, {
          pendingEmbedding: false,
          embeddingFailed: true,
        }),
      setPermanentlyFailed: (ids) =>
        updateFlags(ids, {
          pendingEmbedding: false,
          embeddingFailed: true,
          embeddingPermanentlyFailed: true,
        }),
    };
    configureEngineMutator(mutator);
    return () => configureEngineMutator(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFlags = (
    ids: string[],
    patch: Partial<
      Pick<
        Memory,
        "pendingEmbedding" | "embeddingFailed" | "embeddingPermanentlyFailed"
      >
    >,
  ): void => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setMemories((prev) => {
      const next = prev.map((m) =>
        idSet.has(m.id) ? { ...m, ...patch } : m,
      );
      // Best-effort persist; cache write is not awaited (engine is
      // off-render-path and consumers only need the in-memory state).
      if (user?.email) void writeMemoriesCache(user.email, next);
      return next;
    });
  };

  // Outbox: single source of truth for pending mutations. The pure
  // module + hook live in `lib/syncOutbox.ts` and `lib/useSyncOutbox.ts`.
  // We define the DrainApi inline so the outbox calls the exact same
  // `apiCreateMemory` / `apiUpdateMemory` / `apiDeleteMemory` paths
  // the inline mutations used to call directly. Captured in a stable
  // ref-friendly object via useMemo would be nice but the references
  // are top-level imports and don't change between renders.
  // The api-server contract returns `{ ok: boolean; server_id? }`.
  // The DrainApi narrows that to `ok: true`, so any `ok: false` must
  // become a thrown error here — the outbox treats throws as failures
  // and applies backoff.
  const assertOk = (
    res: { ok: boolean; server_id?: string },
  ): { ok: true; server_id?: string } => {
    if (!res.ok) throw new Error("server returned ok=false");
    return { ok: true, server_id: res.server_id };
  };
  const drainApis: DrainApi = useMemo(
    () => ({
      create: async (payload) => {
        // `apiCreateMemory` posts to our api-server proxy, which
        // verifies the same Polsia bearer token, enforces the daily
        // capture cap, then forwards to Polsia. Identity is taken
        // from the verified token — no need to pass an email here.
        // If the user logged out mid-drain the proxy returns 401
        // and the outbox classifier marks it as transient.
        return assertOk(
          await apiCreateMemory({
            client_id: payload.client_id,
            content: payload.content,
            kind: payload.kind,
            tags: payload.tags,
          }),
        );
      },
      update: async (payload) =>
        assertOk(
          await apiUpdateMemory(payload.client_id, {
            content: payload.content,
            kind: payload.kind,
            tags: payload.tags,
          }),
        ),
      delete: async (payload) =>
        assertOk(await apiDeleteMemory(payload.client_id)),
      annotate: async (payload) => {
        // Annotation writes target the local api-server, not Polsia,
        // so they need the userId (= email). We capture it from the
        // ref-via-closure dance above. If the user logs out mid-drain
        // we throw a retryable failure rather than silently no-op.
        const email = user?.email;
        if (!email) {
          throw new Error("annotate: no user");
        }
        if (payload.person == null && payload.linkedEventId == null) {
          await apiDeleteAnnotation(email, payload.client_id);
        } else {
          await apiPutAnnotation(email, payload.client_id, {
            person: payload.person ?? null,
            linkedEventId: payload.linkedEventId ?? null,
          });
        }
        return { ok: true };
      },
    }),
    [user?.email],
  );

  // Outcome handler: patches the in-memory `memories` array so the UI
  // reflects what the outbox just confirmed. Runs after every drain.
  const onOutcomes = useCallback((outcomes: DrainOutcome[]) => {
    if (outcomes.length === 0) return;
    setMemories((prev) => {
      let next = prev;
      let changed = false;
      for (const o of outcomes) {
        // Annotation entries live in their own id namespace and don't
        // map to a memory row's pendingSync / syncFailed flags. Skip
        // them so a successful annotate doesn't accidentally clobber
        // a still-pending memory mutation flag.
        if (o.id.startsWith(ANNOTATE_ID_PREFIX)) continue;
        if (o.kind === "success") {
          // Clear pendingSync/syncFailed and stamp serverId if the
          // create returned one. Update/delete just clear the flags.
          next = next.map((m) => {
            if (m.id !== o.id) return m;
            const patched: Memory = {
              ...m,
              pendingSync: false,
              syncFailed: false,
            };
            if (o.serverId) patched.serverId = o.serverId;
            return patched;
          });
          changed = true;
        } else if (o.kind === "duplicate") {
          // Two-device collision: server already has this client_id.
          // Drop the local pending duplicate; the next refreshMemories
          // pulls the canonical row.
          next = next.filter((m) => m.id !== o.id);
          changed = true;
        } else if (o.kind === "failure") {
          next = next.map((m) =>
            m.id === o.id
              ? { ...m, pendingSync: true, syncFailed: true }
              : m,
          );
          changed = true;
        }
      }
      if (!changed) return prev;
      if (user?.email) void writeMemoriesCache(user.email, next);
      return next;
    });
  }, [user?.email]);

  const {
    outbox,
    enqueue: enqueueOutbox,
    drainNow,
    stuckCount,
  } = useSyncOutbox({
    email: user?.email ?? null,
    apis: drainApis,
    onOutcomes,
  });

  // Re-derive pendingSync/syncFailed flags whenever the outbox changes
  // so the row indicator stays in sync with what's actually queued.
  // We only patch flags that actually differ, so this is a no-op for
  // the steady-state synced list.
  useEffect(() => {
    setMemories((prev) => {
      const outboxIds = new Set(outbox.map((e) => e.id));
      const failedIds = new Set(
        outbox.filter((e) => e.attempts > 0).map((e) => e.id),
      );
      let changed = false;
      const next = prev.map((m) => {
        const desiredPending = outboxIds.has(m.id);
        const desiredFailed = failedIds.has(m.id);
        if (
          (m.pendingSync ?? false) === desiredPending &&
          (m.syncFailed ?? false) === desiredFailed
        ) {
          return m;
        }
        changed = true;
        return { ...m, pendingSync: desiredPending, syncFailed: desiredFailed };
      });
      return changed ? next : prev;
    });
  }, [outbox]);

  // ---- Photo upload queue drain (Task #372) -------------------------------
  // Mirrors the outbox drain shape (AppState foreground + heartbeat
  // + immediate kick) but lives in its own loop so a stuck photo
  // upload can never delay the memory text outbox. On a successful
  // confirm the in-memory list + AsyncStorage cache get patched
  // with `mergePhotos` so the next render shows the thumbnail
  // without waiting for the next bulk pull. Photos that stay
  // queued (transient failure) keep their `photoPendingUpload`
  // affordance.
  const photoDrainLockRef = useRef(false);
  const drainPhotosNow = useCallback(async (): Promise<void> => {
    const email = user?.email;
    if (!email) return;
    if (photoDrainLockRef.current) return;
    photoDrainLockRef.current = true;
    try {
      const { confirmed, stillPending } = await drainPhotoQueue(email);
      const confirmedIds = Object.keys(confirmed);
      if (confirmedIds.length === 0 && stillPending.length === 0) return;
      const stillPendingSet = new Set(stillPending);
      setMemories((prev) => {
        const next = mergePhotos(prev, confirmed).map((m) =>
          stillPendingSet.has(m.id) && !m.photoUrl
            ? { ...m, photoPendingUpload: true }
            : m,
        );
        void writeMemoriesCache(email, next);
        return next;
      });
    } catch (err) {
      if (__DEV__) console.warn("[memories] photo drain failed", err);
    } finally {
      photoDrainLockRef.current = false;
    }
  }, [user?.email]);

  // Heartbeat + AppState foreground triggers. 45s cadence is slower
  // than the outbox heartbeat (text mutations are tiny; photos are
  // megabytes and don't need sub-minute retries).
  useEffect(() => {
    if (!user?.email) return;
    void drainPhotosNow();
    const interval = setInterval(() => {
      void drainPhotosNow();
    }, 45_000);
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") void drainPhotosNow();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [user?.email, drainPhotosNow]);

  const attachPhotoToMemory = useCallback(
    async (
      clientId: string,
      photo: { localUri: string; takenAt?: string; mimeType?: string },
    ): Promise<void> => {
      const email = user?.email;
      if (!email) return;
      await enqueuePhotoUploadStorage(email, {
        clientId,
        localUri: photo.localUri,
        takenAt: photo.takenAt,
        mimeType: photo.mimeType,
      });
      // Optimistic flag so the confirmation card + Archive row
      // show "Uploading photo…" instantly. Drain replaces it.
      setMemories((prev) => {
        const next = prev.map((m) =>
          m.id === clientId ? { ...m, photoPendingUpload: true } : m,
        );
        void writeMemoriesCache(email, next);
        return next;
      });
      // Don't await — the drain runs off-render and the caller
      // (Save flow) already returns control to the confirmation card.
      void drainPhotosNow();
    },
    [user?.email, drainPhotosNow],
  );

  const loadMemories = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      setMemories([]);
      setIsLoading(false);
      return;
    }
    const email = user.email;
    setIsLoading(true);
    // Read both the on-device annotation cache AND the server bulk
    // pull. Server values win when present (they reflect the user's
    // last sync from any device); the local cache is the offline
    // fallback so a no-network cold start still renders edits made
    // before the network dropped. Failure to fetch falls back to the
    // local cache silently — the next online drain reconciles.
    const localAnnotations = await loadAnnotations(email);
    const serverAnnotations = await apiFetchAnnotations(email);
    const annotations: MemoryAnnotationMap = {
      ...localAnnotations,
      ...serverAnnotations,
    };
    // Persist the merged view so a later offline cold start still
    // reflects the server snapshot the user just pulled.
    if (Object.keys(serverAnnotations).length > 0) {
      await writeAnnotations(email, annotations);
    }
    // Illustrations live in their own bulk endpoint (no local cache
    // — the URLs themselves point back to the server, so a pure
    // offline cold start renders no polaroids and that's fine; the
    // memory text and metadata are still in the AsyncStorage cache).
    // Failures degrade silently to an empty map for the same
    // reason as annotations: a network blip should never block the
    // memory list from rendering.
    // User-uploaded photos (Task #372). Same shape + failure mode
    // as illustrations: a network blip degrades to an empty map so
    // the memory list still renders. Merged after illustrations so
    // a row can have both an AI illustration AND a user photo.
    let photoMap: PhotoMap = {};
    try {
      photoMap = await apiFetchPhotos();
    } catch {
      /* ignore — empty map already set */
    }
    // Mark any rows whose photo is still in the local upload queue
    // so the row badge shows "Uploading photo…" until the next
    // drain confirms it.
    const pendingPhotoIds = await listPendingPhotoIds(email);
    let illustrationMap: IllustrationMap = {};
    try {
      const ill = await apiFetchIllustrations();
      illustrationMap = ill.items;
      setIllustrationsUsedToday(ill.usedToday);
      // The server reports the cap for the active tier explicitly;
      // a `null` indicates Pro (unbounded). The bulk read currently
      // always sends the free cap, so we synthesize the Pro case
      // from the subscription status the provider already has.
      if (subscriptionStatus?.is_pro === true) {
        setIllustrationsLimit(null);
      } else {
        setIllustrationsLimit(ill.limit);
      }
    } catch {
      /* ignore — empty map already set */
    }
    try {
      // `apiListMemoriesWithTimeout` wraps `apiListMemories` in a
      // per-call AbortController + setTimeout (Task #179). Without
      // the ceiling, a captive-portal Wi-Fi (TCP handshake completes
      // but no data ever arrives) would leave the home tab on its
      // loading spinner forever instead of falling through to the
      // cached rows below. A fired timeout aborts the in-flight
      // request, which surfaces to `authFetch` as a network failure
      // (`AuthError` with no `status`) — caught below as the offline
      // path, exactly the same way Task #143 handles it for export.
      const fromApi = await apiListMemoriesWithTimeout(email, 1, 20);

      // Preserve locally-created memories that have not yet been confirmed
      // by the server. These exist when the outbox still has a create
      // entry for them — most commonly because the device is offline or
      // the server is briefly unavailable. Without this merge, a full
      // reload would silently discard the user's un-synced data because
      // the server list doesn't include items it never received.
      //
      // Strategy: keep any cached row whose id is NOT in the server
      // response AND is still in the outbox. Outbox is the single
      // source of truth for "this row is owed to the server", so the
      // older `pendingSync` cache flag is a fallback only.
      const fromApiIds = new Set(fromApi.map((m) => m.id));
      const cachedForPending = await readMemoriesCache(email);
      const outboxIds = new Set(outbox.map((e) => e.id));
      const pendingOnly = cachedForPending.filter(
        (m) =>
          !fromApiIds.has(m.id) &&
          (outboxIds.has(m.id) || m.pendingSync === true),
      );

      // Facets are device-local (Task #195) — they have no server
      // column, so a server-fresh `Memory` would arrive without
      // them and the row would visually "lose" its tags/theme/mood
      // on every refresh. We rebuild a `client_id → facets` map
      // from the cached rows and re-attach the values on top of
      // the server snapshot. Cached pendingOnly rows already carry
      // facets directly, so the map is sourced from the full cache,
      // not just pendingOnly.
      const cachedFacetsById = new Map<string, MemoryFacets>();
      for (const m of cachedForPending) {
        if (m.facets) cachedFacetsById.set(m.id, m.facets);
      }

      const allMemories = pendingOnly.length > 0
        ? [...pendingOnly, ...fromApi]
        : fromApi;
      const allMemoriesWithFacets =
        cachedFacetsById.size > 0
          ? allMemories.map((m) =>
              m.facets || !cachedFacetsById.has(m.id)
                ? m
                : { ...m, facets: cachedFacetsById.get(m.id) },
            )
          : allMemories;
      const mergedBase = sortByTimestampDesc(
        mergePhotos(
          mergeIllustrations(
            mergeAnnotations(allMemoriesWithFacets, annotations),
            illustrationMap,
          ),
          photoMap,
        ),
      );
      const merged = pendingPhotoIds.size > 0
        ? mergedBase.map((m) =>
            pendingPhotoIds.has(m.id) && !m.photoUrl
              ? { ...m, photoPendingUpload: true }
              : m,
          )
        : mergedBase;
      setMemories(merged);
      await writeMemoriesCache(email, merged);
      // Fire-and-forget: keep AI engine maintenance off the render path so
      // a slow embed call can never delay the memory list paint.
      void maintainAiEngine(
        email,
        subscriptionStatus?.is_pro === true,
        merged,
      );
      // Successful refresh implies the network is up — opportunistic
      // drain to flush any queued mutations.
      void drainNow();
    } catch (err) {
      console.warn("[memories] API list failed, falling back to cache", err);
      const cached = await readMemoriesCache(email);
      const mergedBase = sortByTimestampDesc(
        mergePhotos(
          mergeIllustrations(mergeAnnotations(cached, annotations), illustrationMap),
          photoMap,
        ),
      );
      const merged = pendingPhotoIds.size > 0
        ? mergedBase.map((m) =>
            pendingPhotoIds.has(m.id) && !m.photoUrl
              ? { ...m, photoPendingUpload: true }
              : m,
          )
        : mergedBase;
      setMemories(merged);
      void maintainAiEngine(
        email,
        subscriptionStatus?.is_pro === true,
        merged,
      );
    } finally {
      setIsLoading(false);
    }
  }, [user, authLoading, outbox, drainNow]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  // One-time backfill of on-device `MemoryFacets` for memories
  // captured before Task #195 shipped (Task #277). Without this
  // pass, existing rows in a user's archive would permanently lack
  // facets because the capture-flow hook only attaches them to
  // NEW memories — tags / themes surfaces would take weeks to
  // populate organically.
  //
  // Lifecycle: fires once per signed-in email per process. We
  // gate on `backfillRunByEmail` (a ref, not state — no re-render
  // needed) so a `loadMemories` re-run from a refresh doesn't
  // restart the walk. The walk itself happens off the render path
  // via setTimeout(0) so the home tab paints first; on devices
  // without on-device model availability the helper short-circuits
  // immediately and the timer is a near no-op. An AbortController
  // tied to email change / unmount makes sure a sign-out mid-loop
  // stops further extractor calls instead of racing with a stale
  // email. We deliberately read `memories` and update flags via
  // the same `setMemories` + `writeMemoriesCache` pattern the
  // engine mutator uses so a concurrent `loadMemories` merge can
  // re-attach the freshly-saved facets the same way it preserves
  // capture-flow facets (see `cachedFacetsById` in `loadMemories`).
  const backfillRunByEmail = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading) return;
    if (!user?.email) return;
    if (isLoading) return;
    const email = user.email;
    if (backfillRunByEmail.current === email) return;
    backfillRunByEmail.current = email;

    const availability = getFmAvailability();
    if (!availability.available) return;

    const controller = new AbortController();
    const handle = setTimeout(() => {
      // Best-effort, off the render path. Errors are swallowed —
      // the helper itself never throws, but a future refactor
      // shouldn't be able to break the home tab via this side
      // effect.
      void backfillMissingFacets(memories, {
        available: true,
        extract: extractFacets,
        signal: controller.signal,
        onResult: (id, facets) => {
          if (controller.signal.aborted) return;
          setMemories((prev) => {
            const idx = prev.findIndex((m) => m.id === id);
            // Row may have been deleted between snapshot and now.
            if (idx === -1) return prev;
            // Don't clobber facets the user / capture flow attached
            // in the meantime — the backfill is strictly a fill-the-
            // gap operation, never an overwrite.
            if (prev[idx]!.facets) return prev;
            const next = prev.slice();
            next[idx] = { ...prev[idx]!, facets };
            void writeMemoriesCache(email, next);
            return next;
          });
        },
      }).catch((err) => {
        // Defensive: helper is no-throw but never let this break the
        // app. Surface in dev so a future regression in
        // `backfillMissingFacets` is visible.
        if (__DEV__) console.warn("[memories] facet backfill failed", err);
      });
    }, 0);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // `memories` intentionally excluded from deps — the backfill
    // snapshots the list at fire time (the helper iterates a
    // captured array), and we don't want every single optimistic
    // insert / mutator patch to retrigger the effect and start
    // another concurrent walk. The ref guard is the canonical
    // "ran for this email" signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.email, isLoading]);

  // Annotation flow:
  //   1. Local AsyncStorage map is the offline-read source so a cold
  //      start without network still renders the user's last person /
  //      event values.
  //   2. We always enqueue an `annotate` outbox entry so the same
  //      change gets mirrored to the api-server. The entry uses an
  //      `ann:` id prefix so it lives in its own keyspace and never
  //      collides with a queued create/update/delete for the same
  //      memory client_id (see syncOutbox.ts ANNOTATE_ID_PREFIX).
  //   3. On the next loadMemories the bulk pull reconciles the local
  //      map against the server snapshot.
  const persistAnnotation = async (
    email: string,
    client_id: string,
    person?: string,
    linkedEventId?: string,
  ): Promise<void> => {
    const ann = extractAnnotation({
      id: client_id,
      userId: email,
      content: "",
      timestamp: "",
      kind: "memory",
      person,
      linkedEventId,
    });
    const map = await loadAnnotations(email);
    if (ann) {
      map[client_id] = ann;
    } else {
      delete map[client_id];
    }
    await writeAnnotations(email, map);
    // Mirror to api-server. If both fields are empty, the drain will
    // call DELETE on the annotation row to keep the server clean.
    // Awaited (not fire-and-forget) so that callers like addMemory
    // which also enqueue afterwards run AFTER this enqueue commits —
    // the outbox lock then chains the next enqueue safely.
    const entry: OutboxEntry = {
      id: annotateOutboxId(client_id),
      action: "annotate",
      payload: {
        client_id,
        person: person ?? null,
        linkedEventId: linkedEventId ?? null,
      },
      attempts: 0,
      first_queued_at: new Date().toISOString(),
    };
    await enqueueOutbox(entry);
  };

  const removeAnnotation = async (email: string, client_id: string): Promise<void> => {
    const map = await loadAnnotations(email);
    if (map[client_id]) {
      delete map[client_id];
      await writeAnnotations(email, map);
    }
    // Server-side delete is queued unconditionally so a stale row from
    // a prior install gets cleaned up even if the local map was empty.
    const entry: OutboxEntry = {
      id: annotateOutboxId(client_id),
      action: "annotate",
      payload: { client_id, person: null, linkedEventId: null },
      attempts: 0,
      first_queued_at: new Date().toISOString(),
    };
    await enqueueOutbox(entry);
  };

  const addMemory = async (
    content: string,
    options: Partial<
      Pick<
        Memory,
        | "kind"
        | "tags"
        | "person"
        | "linkedEventId"
        | "facets"
        | "dailySelfieDate"
      >
    > & { bypassCaptureLimit?: boolean } = {},
  ): Promise<{ syncedToCloud: boolean; id: string | null }> => {
    if (!user) return { syncedToCloud: false, id: null };

    // Layer 3 of the three-layer defense (see replit.md "Free-tier
    // enforcement"). UI gates in capture.tsx + log-call.tsx + the
    // home screen are the first two layers; this throw is the
    // last-mile guard that even multi-tab / stale-state callers must
    // pass:
    //   - a stale screen that rendered before subscription status
    //     loaded can't sneak past the cap
    //   - opening /capture and /log-call simultaneously can't double-
    //     submit past 10
    //   - any future surface that calls addMemory inherits the cap
    //     for free (addCall also routes through here)
    //
    // Conservative default: when subscriptionStatus is still null
    // (initial load, network blip, status fetch in flight), we treat
    // the user as non-Pro and enforce the cap. A loaded Pro user
    // will flip past this branch on the next render. This errs on
    // the side of NOT giving away free Pro by accident.
    //
    // We route through `getCaptureLimitState` (the same helper the UI
    // layers use) so a stale UI cannot disagree with this throw —
    // both paths arrive at `atLimit` from the same math, and both
    // bucket "today" via `isTimestampToday`.
    const todayCount = memories.filter((m) =>
      isTimestampToday(m.timestamp),
    ).length;
    // `freeDailyCaptureLimit` (Task #144) is the live server cap so
    // the Layer 3 throw also tracks on-call's runtime override —
    // otherwise this layer would still fire at the compiled-in 10
    // even after the entitlement endpoint reported a higher cap, and
    // a free user mid-promo would see "save fails" with the cap-
    // reached upsell before they ever reach the real wall.
    const limitState = getCaptureLimitState(
      todayCount,
      subscriptionStatus?.is_pro === true,
      freeDailyCaptureLimit,
    );
    if (limitState.atLimit && !options.bypassCaptureLimit) {
      throw new CaptureLimitReachedError(limitState.limit);
    }

    const email = user.email;
    const client_id = newClientId();
    const newMemory: Memory = {
      id: client_id,
      userId: email,
      content,
      timestamp: new Date().toISOString(),
      kind: options.kind || "memory",
      tags: options.tags,
      person: options.person,
      linkedEventId: options.linkedEventId,
      // Facets are device-local: the server contract has no column
      // for them, so they ride along in the AsyncStorage cache only.
      // The capture flow's `useMemoryFacets` hook supplies them when
      // the on-device model succeeds; otherwise the field is omitted
      // and the row degrades silently.
      facets: options.facets,
      // Task #375 — daily selfie marker. Same device-local
      // persistence model as `facets` (cache-only); the durable
      // server-side marker is the `daily-selfie` tag included in
      // `options.tags` by the capture flow.
      dailySelfieDate: options.dailySelfieDate,
    };

    // Single transactional write: optimistic local insert + outbox
    // entry. The outbox is the only path to the server — we never
    // call apiCreateMemory directly here. Even if the app is killed
    // between writeMemoriesCache and the drain returning, the next
    // foreground/heartbeat/reachability tick will replay the entry.
    const optimistic: Memory = { ...newMemory, pendingSync: true };
    const next = sortByTimestampDesc([optimistic, ...memories]);
    setMemories(next);
    await writeMemoriesCache(email, next);
    await persistAnnotation(email, client_id, options.person, options.linkedEventId);

    try {
      enqueueMemoriesForEmbedding(email, [toEngineInput(newMemory)]);
    } catch {
      // ignore
    }

    const entry: OutboxEntry = {
      id: client_id,
      action: "create",
      payload: {
        client_id,
        content,
        kind: newMemory.kind,
        tags: options.tags,
      },
      attempts: 0,
      first_queued_at: new Date().toISOString(),
    };
    const outcomes = await enqueueOutbox(entry);
    // Server-side rejections surface as a `failure` outcome with a
    // specific `errorClass`. Both branches roll back the optimistic
    // row and rethrow so the caller (capture.tsx / log-call.tsx)
    // can route the user appropriately. The outbox helper drops the
    // entry on either class — they're both non-retryable today.
    //
    //   "cap"     → CaptureLimitReachedError → screens send the user
    //               to /subscription for the upsell.
    //   "blocked" → CaptureBlockedError      → screens show a
    //               cooldown alert (no upsell — the account has been
    //               auto-blocked for the rest of the UTC day after
    //               cap-bypass abuse was detected; the block clears
    //               on its own at midnight UTC).
    //
    // We must keep these two paths distinct: collapsing them would
    // either send a blocked attacker to /subscription (wrong — they
    // can't pay their way out of an abuse block) or surface a cap
    // user with a "we suspect abuse" cooldown copy (wrong — they're
    // just out of free captures).
    const own = outcomes.find((o) => o.id === client_id);
    if (own?.kind === "failure" && own.errorClass === "cap") {
      setMemories(memories);
      await writeMemoriesCache(email, memories);
      throw new CaptureLimitReachedError(limitState.limit);
    }
    if (own?.kind === "failure" && own.errorClass === "blocked") {
      setMemories(memories);
      await writeMemoriesCache(email, memories);
      throw new CaptureBlockedError();
    }
    return { syncedToCloud: own?.kind === "success", id: client_id };
  };

  const addCall = async ({
    person,
    content,
    tags,
    linkedEventId,
  }: {
    person: string;
    content: string;
    tags?: string[];
    linkedEventId?: string;
  }): Promise<{ syncedToCloud: boolean; id: string | null }> => {
    return addMemory(content, { kind: "call", person, tags, linkedEventId });
  };

  const updateMemory = async (id: string, updates: Partial<Memory>) => {
    if (!user) return;
    const email = user.email;
    const before = memories.find((m) => m.id === id);

    // Library-window enforcement: free users may not edit memories
    // older than `FREE_LIBRARY_DAYS`; Pro users may not edit older
    // than `PRO_LIBRARY_DAYS`. Same conservative-default `isPro =
    // false` rule the capture cap uses (see addMemory comment) — a
    // stale render with subscription status not yet loaded errs on
    // the side of locking, then unlocks on the next render once Pro
    // is observed. Throws a discriminated `LibraryWindowLockedError`
    // so screens can `instanceof`-branch and route to /subscription.
    if (before) {
      const window = getLibraryWindowState(
        before.timestamp,
        subscriptionStatus?.is_pro === true,
      );
      if (!window.editable) {
        throw new LibraryWindowLockedError(
          window.lockedReason ?? "Outside your library window",
        );
      }
    }

    // Mark the row as pending until the outbox confirms the change
    // hit the server. The same enqueue-first transaction the create
    // path uses applies here.
    const next = memories.map((m) =>
      m.id === id ? { ...m, ...updates, pendingSync: true } : m,
    );
    setMemories(next);
    await writeMemoriesCache(email, next);

    if (
      updates.person !== undefined ||
      updates.linkedEventId !== undefined
    ) {
      const merged = { ...before, ...updates } as Memory;
      await persistAnnotation(email, id, merged.person, merged.linkedEventId);
    }

    // If only person/linkedEventId changed (annotation-only edit), the
    // memory row itself doesn't need a server update — the annotation
    // outbox entry from persistAnnotation already mirrors it.
    const hasServerChange =
      updates.content !== undefined ||
      updates.kind !== undefined ||
      updates.tags !== undefined;
    if (!hasServerChange) {
      // Clear pendingSync since there's nothing to drain for the row
      // itself (the annotation entry is tracked separately).
      const cleared = next.map((m) =>
        m.id === id ? { ...m, pendingSync: false } : m,
      );
      setMemories(cleared);
      await writeMemoriesCache(email, cleared);
      return;
    }

    const entry: OutboxEntry = {
      id,
      action: "update",
      payload: {
        client_id: id,
        content: updates.content,
        kind: updates.kind,
        tags: updates.tags,
      },
      attempts: 0,
      first_queued_at: new Date().toISOString(),
    };
    await enqueueOutbox(entry);
  };

  const deleteMemory = async (id: string) => {
    if (!user) return;
    const email = user.email;
    // Optimistic delete + outbox entry as a single transaction. If a
    // matching create is still queued (offline burst), the
    // enqueueEntry collapse rule drops both. Otherwise the entry
    // drains a real DELETE on the next online tick.
    const next = memories.filter((m) => m.id !== id);
    setMemories(next);
    await writeMemoriesCache(email, next);
    await removeAnnotation(email, id);

    const entry: OutboxEntry = {
      id,
      action: "delete",
      payload: { client_id: id },
      attempts: 0,
      first_queued_at: new Date().toISOString(),
    };
    await enqueueOutbox(entry);
  };

  const refreshMemories = loadMemories;

  const searchMemories = useCallback(
    async (query: string): Promise<Memory[]> => {
      const q = query.trim();
      if (!user) return [];
      if (!q) {
        setLastSearchWasOffline(false);
        return memories;
      }
      const email = user.email;
      const annotations = await loadAnnotations(email);
      try {
        const fromApi = await apiSearchMemoriesWithTimeout(email, q, 1, 50);
        setLastSearchWasOffline(false);
        return sortByTimestampDesc(mergeAnnotations(fromApi, annotations));
      } catch (err) {
        console.warn("[memories] search failed, falling back to local filter", err);
        setLastSearchWasOffline(true);
        const lower = q.toLowerCase();
        return memories.filter((m) => m.content.toLowerCase().includes(lower));
      }
    },
    [user, memories],
  );

  const todayMemories = memories.filter((m) =>
    isTimestampToday(m.timestamp),
  );

  const retrySync = useCallback(async (): Promise<{
    synced: number;
    failed: number;
  }> => {
    // `summarizeMemoryDrainOutcomes` filters out annotation entries
    // (the `ann:` keyspace) and collapses success+duplicate into
    // "synced" — see its JSDoc for why annotations are excluded
    // from the user-facing "N memories synced" toast tally.
    return summarizeMemoryDrainOutcomes(await drainNow());
  }, [drainNow]);

  const retryMemorySync = useCallback(
    async (id: string): Promise<"synced" | "failed" | "noop"> => {
      if (!user) return "noop";
      // The outbox is the single source of truth for "this row is owed
      // to the server" — if no entry exists for this id there's
      // nothing to retry. This guards against a stale render firing a
      // tap on a row whose entry was already drained by the heartbeat
      // or reachability listener.
      if (!outbox.some((e) => e.id === id)) return "noop";
      const outcomes = await drainNow({ forceIds: new Set([id]) });
      const own = outcomes.find((o) => o.id === id);
      // Both `success` and `duplicate` clear the pending row (the
      // `onOutcomes` handler removes the local copy on duplicate, so
      // the badge disappears either way).
      if (own?.kind === "success" || own?.kind === "duplicate") {
        return "synced";
      }
      if (own?.kind === "failure") return "failed";
      // No outcome means the entry was already drained between the
      // outbox snapshot above and the lock acquiring inside drainNow.
      return "noop";
    },
    [user, outbox, drainNow],
  );

  const deleteIllustration = useCallback(
    async (id: string): Promise<DeleteIllustrationResult> => {
      if (!user) return { kind: "auth_error" };
      const target = memories.find((m) => m.id === id);
      if (!target) {
        return { kind: "server_error", message: "Memory not found" };
      }
      if (!target.illustrationUrl) {
        // Nothing to delete locally — short-circuit so the lightbox
        // can close cleanly without a wasted round trip.
        return { kind: "ok", removed: false };
      }
      const result = await apiDeleteIllustration(target.id);

      if (result.kind === "ok") {
        // Strip illustration fields locally regardless of `removed` —
        // the server might have already lost the record (race with
        // another device, or a re-tap after the first delete) and
        // we still want the local UI to match.
        setMemories((prev) => {
          const next = prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  illustrationUrl: undefined,
                  illustratedAt: undefined,
                }
              : m,
          );
          if (user.email) void writeMemoriesCache(user.email, next);
          return next;
        });
      }

      return result;
    },
    [user, memories],
  );

  const illustrateMemory = useCallback(
    async (id: string): Promise<IllustrateResult> => {
      if (!user) return { kind: "auth_error" };
      const target = memories.find((m) => m.id === id);
      if (!target) {
        return { kind: "server_error", message: "Memory not found" };
      }
      // Don't enqueue this through the outbox — illustration is a
      // user-driven action with a heavy upstream cost (a single
      // gpt-image-1 call). The outbox would silently retry on
      // backoff and burn through the user's quota; we want explicit
      // tap-to-retry instead.
      const result = await apiIllustrateMemory({
        clientId: target.id,
        content: target.content,
        tags: target.tags,
        person: target.person,
      });

      if (result.kind === "ok") {
        // Optimistically attach the URL and bump the local quota
        // counter so the Archive card flips to the polaroid state
        // without waiting for the next bulk pull.
        setMemories((prev) => {
          const next = prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  illustrationUrl: result.url,
                  illustrationThumbUrl: result.thumbUrl ?? m.illustrationThumbUrl,
                  illustratedAt: result.generatedAt,
                }
              : m,
          );
          if (user.email) void writeMemoriesCache(user.email, next);
          return next;
        });
        setIllustrationsUsedToday(result.usedToday);
        if (result.limit === null) {
          setIllustrationsLimit(null);
        } else {
          setIllustrationsLimit(result.limit);
        }
      } else if (result.kind === "limit") {
        // Server is the authority on the cap — sync the local
        // counter so the Archive card immediately reflects "0 left"
        // even if our optimistic state was stale.
        setIllustrationsUsedToday(result.used);
        setIllustrationsLimit(result.limit);
      }

      return result;
    },
    [user, memories],
  );

  return (
    <MemoriesContext.Provider
      value={{
        memories,
        todayMemories,
        lastSearchWasOffline,
        addMemory,
        addCall,
        updateMemory,
        deleteMemory,
        refreshMemories,
        searchMemories,
        isLoading,
        stuckSyncCount: stuckCount,
        retrySync,
        retryMemorySync,
        illustrateMemory,
        deleteIllustration,
        illustrationsUsedToday,
        illustrationsLimit,
        attachPhotoToMemory,
      }}
    >
      {children}
    </MemoriesContext.Provider>
  );
}

export const useMemories = () => {
  const ctx = useContext(MemoriesContext);
  if (!ctx) throw new Error("useMemories must be used within MemoriesProvider");
  return ctx;
};
