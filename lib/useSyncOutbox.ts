import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

import {
  drainOutbox,
  enqueueEntry,
  readOutbox,
  shouldSurfaceWarning,
  writeOutbox,
  type DrainApi,
  type DrainOutcome,
  type OutboxEntry,
} from "./syncOutbox";

/**
 * The default heartbeat cadence between automatic drain attempts while
 * the app is in the foreground. 30 seconds is short enough that a
 * brief network blip recovers within the user's attention window, but
 * long enough that we don't burn battery polling on a stable Wi-Fi
 * session.
 */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export interface UseSyncOutboxArgs {
  email: string | null;
  apis: DrainApi;
  /** Fired for every per-entry outcome a drain produced. The host wires
   *  this to the in-memory `memories` array so a successful create
   *  patches `serverId`, a duplicate drops the local pending row, etc. */
  onOutcomes: (outcomes: DrainOutcome[]) => void;
  /** Optional override for tests so a tight `jest.useFakeTimers()` loop
   *  doesn't have to wait the real 30s. */
  heartbeatMs?: number;
  /** When true, skip the AppState + heartbeat wiring. Tests use this so
   *  they can drive `enqueue`/`drainNow` deterministically. */
  disableAuto?: boolean;
}

export interface UseSyncOutboxResult {
  outbox: OutboxEntry[];
  /** True while a drain attempt is in flight. Keeps the row indicator
   *  from oscillating mid-drain. */
  isDraining: boolean;
  /** Convenience: number of entries that have crossed the 24h banner
   *  threshold. The Archive surface banner reads this directly. */
  stuckCount: number;
  /** Append (or collapse) a new entry. Persists to AsyncStorage and
   *  triggers an immediate drain attempt. Returns the drain outcomes
   *  so the caller can tell whether the just-enqueued entry was
   *  flushed to the server in this same tick. */
  enqueue: (entry: OutboxEntry | OutboxEntry[]) => Promise<DrainOutcome[]>;
  /** Force a drain right now. Returns the outcome stream so callers
   *  that want a specific signal (e.g. retry-banner tap) can react.
   *  Pass `forceIds` to bypass the normal exponential backoff for
   *  specific entries — used by per-row tap-to-retry on the offline
   *  badge so the user gets immediate feedback instead of waiting up
   *  to 5 minutes for backoff to expire. */
  drainNow: (opts?: { forceIds?: ReadonlySet<string> }) => Promise<DrainOutcome[]>;
  /** Replace the outbox wholesale. Used by `loadMemories` to hydrate
   *  from AsyncStorage on cold start. */
  replace: (next: OutboxEntry[]) => Promise<void>;
}

/**
 * Wire the pure `syncOutbox` module into the React tree. Owns:
 *   - the in-memory copy of the outbox so consumers can render the
 *     per-row sync indicator without a second AsyncStorage read,
 *   - the AppState listener that drains on foreground,
 *   - the heartbeat interval that drains every HEARTBEAT_INTERVAL_MS
 *     while the app is open,
 *   - the per-outcome fan-out so `MemoriesContext` can patch its in-
 *     memory `memories` array (e.g. clear pendingSync on success, drop
 *     a duplicate-id local row on 409).
 *
 * Reachability: a NetInfo subscription kicks an immediate drain when
 * the device transitions from offline → online so a queued capture
 * lands the moment the network is back.
 */
export function useSyncOutbox(args: UseSyncOutboxArgs): UseSyncOutboxResult {
  const { email, apis, onOutcomes, heartbeatMs, disableAuto } = args;

  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [isDraining, setIsDraining] = useState(false);

  // Keep refs that the AppState/interval callbacks can read without
  // re-binding every render. Without these, a stale closure would
  // drain against an old `outbox` snapshot.
  const outboxRef = useRef<OutboxEntry[]>(outbox);
  const apisRef = useRef<DrainApi>(apis);
  const onOutcomesRef = useRef(onOutcomes);
  const emailRef = useRef<string | null>(email);

  outboxRef.current = outbox;
  apisRef.current = apis;
  onOutcomesRef.current = onOutcomes;
  emailRef.current = email;

  // Serialize every outbox mutation (enqueue) and drain attempt so
  // they can't interleave. The race we're killing:
  //   - enqueue A starts a drain on snapshot [A]
  //   - while drain awaits the network, enqueue B mutates outboxRef
  //     to [A, B]
  //   - drain finishes with result.list = [] (A succeeded) and
  //     blindly commits, clobbering B and silently dropping the
  //     mutation.
  // A FIFO promise chain guarantees enqueue(B) cannot start until the
  // current drain has committed, so every drain operates on a
  // snapshot that matches the state it commits back.
  const lockRef = useRef<Promise<unknown>>(Promise.resolve());
  const runExclusive = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T> => {
      const next = lockRef.current.then(fn, fn);
      // Swallow rejections in the chain so one thrown enqueue doesn't
      // poison every subsequent operation. The original promise still
      // rejects to its caller via `next`.
      lockRef.current = next.catch(() => undefined);
      return next;
    },
    [],
  );

  // Hydrate from AsyncStorage when the email changes (login/logout).
  useEffect(() => {
    let cancelled = false;
    if (!email) {
      setOutbox([]);
      return;
    }
    void (async () => {
      const stored = await readOutbox(email);
      if (!cancelled) {
        setOutbox(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  // Shared drain implementation. ALWAYS called under `runExclusive` so
  // outboxRef.current is exactly the list passed to drainOutbox — no
  // concurrent enqueue can mutate it between snapshot and commit.
  const performDrain = useCallback(async (
    forceIds?: ReadonlySet<string>,
  ): Promise<DrainOutcome[]> => {
    if (!emailRef.current) return [];
    setIsDraining(true);
    try {
      const result = await drainOutbox({
        list: outboxRef.current,
        apis: apisRef.current,
        forceIds,
      });
      // Safe to commit `result.list` directly: the lock guarantees
      // outboxRef.current didn't change while we were awaiting the
      // network.
      if (result.list !== outboxRef.current) {
        setOutbox(result.list);
        outboxRef.current = result.list;
        if (emailRef.current) {
          await writeOutbox(emailRef.current, result.list);
        }
      }
      if (result.outcomes.length > 0) {
        onOutcomesRef.current(result.outcomes);
      }
      return result.outcomes;
    } finally {
      setIsDraining(false);
    }
  }, []);

  const drainNow = useCallback(
    (opts?: { forceIds?: ReadonlySet<string> }): Promise<DrainOutcome[]> =>
      runExclusive(() => performDrain(opts?.forceIds)),
    [performDrain, runExclusive],
  );

  const enqueue = useCallback(
    (entry: OutboxEntry | OutboxEntry[]): Promise<DrainOutcome[]> =>
      runExclusive(async () => {
        if (!emailRef.current) return [];
        const incoming = Array.isArray(entry) ? entry : [entry];
        // Run each incoming mutation through the pure `enqueueEntry`
        // collapse rules so create+update merges, create+delete
        // drops, etc. Without this, a "queued create" + "later edit"
        // would become a bare update on a row the server has never
        // seen and would fail forever.
        let merged = outboxRef.current;
        for (const e of incoming) {
          merged = enqueueEntry(merged, {
            id: e.id,
            action: e.action,
            payload: e.payload,
            first_queued_at: e.first_queued_at,
          });
        }
        setOutbox(merged);
        outboxRef.current = merged;
        await writeOutbox(emailRef.current, merged);
        // Drain inline (still under the same lock) so the caller
        // observes the just-enqueued entry's outcome — addMemory
        // needs syncedToCloud, addCall needs the same signal.
        return await performDrain();
      }),
    [performDrain, runExclusive],
  );

  const replace = useCallback(async (next: OutboxEntry[]): Promise<void> => {
    setOutbox(next);
    outboxRef.current = next;
    if (emailRef.current) {
      await writeOutbox(emailRef.current, next);
    }
  }, []);

  // AppState foreground drain.
  useEffect(() => {
    if (disableAuto) return;
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        void drainNow();
      }
    });
    return () => sub.remove();
  }, [disableAuto, drainNow]);

  // Heartbeat drain.
  useEffect(() => {
    if (disableAuto) return;
    const ms = heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    const handle = setInterval(() => {
      void drainNow();
    }, ms);
    return () => clearInterval(handle);
  }, [disableAuto, drainNow, heartbeatMs]);

  // Reachability drain. Trigger on every offline → online transition
  // so a queued capture lands as soon as the device sees the network
  // again, instead of waiting up to HEARTBEAT_INTERVAL_MS.
  useEffect(() => {
    if (disableAuto) return;
    let lastOnline = true;
    const unsub = NetInfo.addEventListener((state: NetInfoState) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;
      if (online && !lastOnline) {
        void drainNow();
      }
      lastOnline = online;
    });
    return () => unsub();
  }, [disableAuto, drainNow]);

  const stuckCount = outbox.reduce(
    (acc, e) => (shouldSurfaceWarning(e) ? acc + 1 : acc),
    0,
  );

  return { outbox, isDraining, stuckCount, enqueue, drainNow, replace };
}
