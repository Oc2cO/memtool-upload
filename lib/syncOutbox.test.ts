import {
  ANNOTATE_ID_PREFIX,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  SURFACE_WARNING_AFTER_MS,
  annotateOutboxId,
  backoffMsForAttempts,
  classifyError,
  drainOutbox,
  enqueueEntry,
  isDuplicateError,
  isEntryDue,
  markFailure,
  removeEntry,
  shouldSurfaceWarning,
  summarizeMemoryDrainOutcomes,
  type DrainApi,
  type DrainOutcome,
  type OutboxEntry,
} from "./syncOutbox";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: "mem-1",
    action: "create",
    payload: {
      client_id: "mem-1",
      content: "hello",
      kind: "memory",
    },
    attempts: 0,
    first_queued_at: new Date("2026-04-30T12:00:00Z").toISOString(),
    ...overrides,
  };
}

describe("backoffMsForAttempts — exponential with hard 5min cap", () => {
  test("0 attempts → 0 (entry is due immediately)", () => {
    expect(backoffMsForAttempts(0)).toBe(0);
  });

  test("attempt 1 → BASE_BACKOFF_MS", () => {
    expect(backoffMsForAttempts(1)).toBe(BASE_BACKOFF_MS);
  });

  test("attempt 2 → 2x base", () => {
    expect(backoffMsForAttempts(2)).toBe(2 * BASE_BACKOFF_MS);
  });

  test("attempt 7 → would be 320s but caps at MAX_BACKOFF_MS (5min)", () => {
    // 5s * 2^6 = 320s = 320_000ms; cap = 300_000ms
    expect(backoffMsForAttempts(7)).toBe(MAX_BACKOFF_MS);
  });

  test("attempt 50 → still capped at MAX_BACKOFF_MS", () => {
    expect(backoffMsForAttempts(50)).toBe(MAX_BACKOFF_MS);
  });
});

describe("isEntryDue — gates the next retry attempt", () => {
  test("brand-new entry with no attempts is always due", () => {
    expect(isEntryDue(makeEntry({ attempts: 0 }))).toBe(true);
  });

  test("just-failed entry is not due until backoff elapses", () => {
    const now = Date.now();
    const entry = makeEntry({
      attempts: 1,
      last_attempt_at: new Date(now - 1000).toISOString(),
    });
    expect(isEntryDue(entry, now)).toBe(false);
  });

  test("failed entry past its backoff window is due again", () => {
    const now = Date.now();
    const entry = makeEntry({
      attempts: 1,
      last_attempt_at: new Date(now - (BASE_BACKOFF_MS + 1000)).toISOString(),
    });
    expect(isEntryDue(entry, now)).toBe(true);
  });

  test("entry with corrupt last_attempt_at is treated as due", () => {
    const entry = makeEntry({
      attempts: 3,
      last_attempt_at: "not-a-date",
    });
    expect(isEntryDue(entry)).toBe(true);
  });
});

describe("shouldSurfaceWarning — 24h banner threshold", () => {
  test("brand-new entry with no failures does NOT surface", () => {
    const entry = makeEntry({ attempts: 0 });
    const now = new Date(entry.first_queued_at).getTime() + 48 * HOUR;
    expect(shouldSurfaceWarning(entry, now)).toBe(false);
  });

  test("failed entry under 24h does NOT surface", () => {
    const entry = makeEntry({ attempts: 4 });
    const now = new Date(entry.first_queued_at).getTime() + 23 * HOUR;
    expect(shouldSurfaceWarning(entry, now)).toBe(false);
  });

  test("failed entry exactly at 24h surfaces", () => {
    const entry = makeEntry({ attempts: 4 });
    const now = new Date(entry.first_queued_at).getTime() + SURFACE_WARNING_AFTER_MS;
    expect(shouldSurfaceWarning(entry, now)).toBe(true);
  });

  test("failed entry well past 24h surfaces", () => {
    const entry = makeEntry({ attempts: 4 });
    const now = new Date(entry.first_queued_at).getTime() + 72 * HOUR;
    expect(shouldSurfaceWarning(entry, now)).toBe(true);
  });
});

describe("enqueueEntry — collapse rules keep the queue minimal", () => {
  test("first enqueue → entry added with attempts=0", () => {
    const out = enqueueEntry([], {
      id: "mem-1",
      action: "create",
      payload: { client_id: "mem-1", content: "hi", kind: "memory" },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "mem-1",
      action: "create",
      // attempts and first_queued_at injected by enqueueEntry
    });
    expect(out[0].first_queued_at).toBeTruthy();
  });

  test("update on top of pending create → keeps create, merges payload", () => {
    const initial: OutboxEntry[] = [
      makeEntry({
        action: "create",
        payload: { client_id: "mem-1", content: "v1", kind: "memory" },
      }),
    ];
    const out = enqueueEntry(initial, {
      id: "mem-1",
      action: "update",
      payload: { client_id: "mem-1", content: "v2" },
    });
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe("create");
    expect((out[0].payload as { content: string }).content).toBe("v2");
    expect((out[0].payload as { kind: string }).kind).toBe("memory");
  });

  test("delete on top of pending create → drops the entry entirely", () => {
    const initial: OutboxEntry[] = [
      makeEntry({
        action: "create",
        payload: { client_id: "mem-1", content: "v1", kind: "memory" },
      }),
    ];
    const out = enqueueEntry(initial, {
      id: "mem-1",
      action: "delete",
      payload: { client_id: "mem-1" },
    });
    expect(out).toHaveLength(0);
  });

  test("update on top of pending update → newer wins, attempts reset", () => {
    const initial: OutboxEntry[] = [
      makeEntry({
        action: "update",
        payload: { client_id: "mem-1", content: "v1" },
        attempts: 3,
      }),
    ];
    const out = enqueueEntry(initial, {
      id: "mem-1",
      action: "update",
      payload: { client_id: "mem-1", content: "v2" },
    });
    expect(out).toHaveLength(1);
    expect(out[0].attempts).toBe(0);
    expect((out[0].payload as { content: string }).content).toBe("v2");
  });

  test("multiple ids coexist independently", () => {
    let list: OutboxEntry[] = [];
    list = enqueueEntry(list, {
      id: "a",
      action: "create",
      payload: { client_id: "a", content: "A", kind: "memory" },
    });
    list = enqueueEntry(list, {
      id: "b",
      action: "create",
      payload: { client_id: "b", content: "B", kind: "memory" },
    });
    expect(list.map((e) => e.id).sort()).toEqual(["a", "b"]);
  });
});

describe("removeEntry & markFailure", () => {
  test("removeEntry drops only the matching id", () => {
    const list = [
      makeEntry({ id: "a" }),
      makeEntry({ id: "b" }),
    ];
    expect(removeEntry(list, "a").map((e) => e.id)).toEqual(["b"]);
  });

  test("markFailure increments attempts and stamps timestamps", () => {
    const list = [makeEntry({ id: "a", attempts: 2 })];
    const now = new Date("2026-05-01T00:00:00Z");
    const next = markFailure(list, "a", "network", now);
    expect(next[0].attempts).toBe(3);
    expect(next[0].last_attempt_at).toBe(now.toISOString());
    expect(next[0].last_error_at).toBe(now.toISOString());
    expect(next[0].last_error).toBe("network");
  });

  test("markFailure on missing id is a no-op", () => {
    const list = [makeEntry({ id: "a" })];
    const next = markFailure(list, "ghost", "network");
    expect(next).toEqual(list);
  });
});

describe("isDuplicateError & classifyError", () => {
  test("HTTP 409 → duplicate", () => {
    expect(isDuplicateError({ status: 409 })).toBe(true);
  });

  test("body.code DUPLICATE_CLIENT_ID → duplicate", () => {
    expect(
      isDuplicateError({ status: 400, body: { code: "DUPLICATE_CLIENT_ID" } }),
    ).toBe(true);
  });

  test("body.error 'already exists' → duplicate", () => {
    expect(
      isDuplicateError({
        status: 400,
        body: { error: "Memory already exists for this client_id" },
      }),
    ).toBe(true);
  });

  test("plain message 'already exists' → duplicate", () => {
    expect(
      isDuplicateError(new Error("Resource already exists on server")),
    ).toBe(true);
  });

  test("normal 500 is not duplicate", () => {
    expect(isDuplicateError({ status: 500 })).toBe(false);
  });

  test("classifyError maps shapes to short strings", () => {
    expect(classifyError({ status: 500 })).toBe("http_500");
    expect(classifyError({ status: 409 })).toBe("duplicate");
    expect(classifyError(new Error("offline"))).toBe("network");
    expect(classifyError(null)).toBe("unknown");
  });
});

describe("drainOutbox — full retry behavior", () => {
  function makeApis(overrides: Partial<DrainApi> = {}): DrainApi {
    return {
      create: jest.fn().mockResolvedValue({ ok: true, server_id: "srv-1" }),
      update: jest.fn().mockResolvedValue({ ok: true }),
      delete: jest.fn().mockResolvedValue({ ok: true }),
      annotate: jest.fn().mockResolvedValue({ ok: true }),
      ...overrides,
    };
  }

  test("happy-path create drains, returns serverId, removes entry", async () => {
    const apis = makeApis();
    const list = [makeEntry({ id: "a" })];
    const result = await drainOutbox({ list, apis });
    expect(apis.create).toHaveBeenCalledTimes(1);
    expect(result.list).toEqual([]);
    expect(result.outcomes).toEqual([
      { kind: "success", id: "a", serverId: "srv-1" },
    ]);
  });

  test("drain failure increments attempts and keeps entry for retry", async () => {
    const apis = makeApis({
      create: jest.fn().mockRejectedValue(
        Object.assign(new Error("Couldn't reach the server"), {
          status: undefined,
        }),
      ),
    });
    const list = [makeEntry({ id: "a", attempts: 0 })];
    const result = await drainOutbox({ list, apis });
    expect(result.list).toHaveLength(1);
    expect(result.list[0].attempts).toBe(1);
    expect(result.list[0].last_error).toBe("network");
    expect(result.outcomes).toEqual([
      { kind: "failure", id: "a", errorClass: "network" },
    ]);
  });

  test("backoff prevents premature retry: not-yet-due entry is skipped", async () => {
    const apis = makeApis();
    const now = new Date("2026-04-30T12:00:30Z");
    const list = [
      makeEntry({
        id: "a",
        attempts: 1,
        last_attempt_at: new Date(now.getTime() - 1000).toISOString(),
      }),
    ];
    const result = await drainOutbox({ list, apis, now });
    expect(apis.create).not.toHaveBeenCalled();
    expect(result.list).toEqual(list);
    expect(result.outcomes).toEqual([]);
  });

  test("entry past its backoff window IS retried", async () => {
    const apis = makeApis();
    const now = new Date("2026-04-30T12:00:30Z");
    const list = [
      makeEntry({
        id: "a",
        attempts: 1,
        last_attempt_at: new Date(
          now.getTime() - (BASE_BACKOFF_MS + 1000),
        ).toISOString(),
      }),
    ];
    const result = await drainOutbox({ list, apis, now });
    expect(apis.create).toHaveBeenCalledTimes(1);
    expect(result.list).toEqual([]);
    expect(result.outcomes[0].kind).toBe("success");
  });

  test("forceIds bypasses backoff for the listed entry only", async () => {
    // Two entries both well within their backoff window. Without
    // forceIds neither would retry. Adding "a" to forceIds should
    // attempt "a" while leaving "b" untouched — this is exactly the
    // contract the per-row tap-to-retry on the offline badge needs.
    const apis = makeApis();
    const now = new Date("2026-04-30T12:00:30Z");
    const list: OutboxEntry[] = [
      makeEntry({
        id: "a",
        attempts: 1,
        last_attempt_at: new Date(now.getTime() - 1000).toISOString(),
      }),
      makeEntry({
        id: "b",
        attempts: 1,
        last_attempt_at: new Date(now.getTime() - 1000).toISOString(),
        payload: { client_id: "b", content: "hello b", kind: "memory" },
      }),
    ];
    const result = await drainOutbox({
      list,
      apis,
      now,
      forceIds: new Set(["a"]),
    });
    expect(apis.create).toHaveBeenCalledTimes(1);
    expect(result.outcomes).toEqual([
      { kind: "success", id: "a", serverId: "srv-1" },
    ]);
    // "b" stays in the outbox, untouched by attempts++.
    expect(result.list).toHaveLength(1);
    expect(result.list[0].id).toBe("b");
    expect(result.list[0].attempts).toBe(1);
  });

  test("forceIds with a non-existent id is a safe no-op", async () => {
    // Race window: the user taps a row whose entry was already drained
    // by the heartbeat between render and tap. The drain should not
    // throw and should not invent a new outcome.
    const apis = makeApis();
    const list: OutboxEntry[] = [];
    const result = await drainOutbox({
      list,
      apis,
      forceIds: new Set(["ghost"]),
    });
    expect(apis.create).not.toHaveBeenCalled();
    expect(result.list).toEqual([]);
    expect(result.outcomes).toEqual([]);
  });

  test("409 duplicate is collapsed to success — local entry dropped", async () => {
    const dupErr: Error & { status?: number } = Object.assign(
      new Error("Already exists"),
      { status: 409 },
    );
    const apis = makeApis({
      create: jest.fn().mockRejectedValue(dupErr),
    });
    const list = [makeEntry({ id: "a" })];
    const result = await drainOutbox({ list, apis });
    expect(result.list).toEqual([]);
    expect(result.outcomes).toEqual([{ kind: "duplicate", id: "a" }]);
  });

  test("update + delete entries each route to the right api", async () => {
    const apis = makeApis();
    const list: OutboxEntry[] = [
      makeEntry({
        id: "a",
        action: "update",
        payload: { client_id: "a", content: "v2" },
      }),
      makeEntry({
        id: "b",
        action: "delete",
        payload: { client_id: "b" },
      }),
    ];
    const result = await drainOutbox({ list, apis });
    expect(apis.update).toHaveBeenCalledTimes(1);
    expect(apis.delete).toHaveBeenCalledTimes(1);
    expect(apis.create).not.toHaveBeenCalled();
    expect(result.list).toEqual([]);
    expect(result.outcomes.map((o) => o.kind).sort()).toEqual([
      "success",
      "success",
    ]);
  });

  test("mixed success + failure: each entry's outcome is independent", async () => {
    const apis = makeApis({
      create: jest
        .fn()
        .mockResolvedValueOnce({ ok: true, server_id: "srv-1" })
        .mockRejectedValueOnce(new Error("network down")),
    });
    const list: OutboxEntry[] = [
      makeEntry({ id: "a" }),
      makeEntry({ id: "b" }),
    ];
    const result = await drainOutbox({ list, apis });
    expect(result.list).toHaveLength(1);
    expect(result.list[0].id).toBe("b");
    expect(result.list[0].attempts).toBe(1);
    expect(result.outcomes).toEqual([
      { kind: "success", id: "a", serverId: "srv-1" },
      { kind: "failure", id: "b", errorClass: "network" },
    ]);
  });
});

describe("end-to-end: enqueue → drain → success → empty", () => {
  test("the canonical add → drain → ack → cleared flow", async () => {
    let list: OutboxEntry[] = [];

    list = enqueueEntry(list, {
      id: "mem-1",
      action: "create",
      payload: { client_id: "mem-1", content: "first thought", kind: "memory" },
    });
    expect(list).toHaveLength(1);

    const apis: DrainApi = {
      create: jest.fn().mockResolvedValue({ ok: true, server_id: "srv-1" }),
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn(),
    };

    const drained = await drainOutbox({ list, apis });
    expect(drained.list).toHaveLength(0);
    expect(drained.outcomes).toEqual([
      { kind: "success", id: "mem-1", serverId: "srv-1" },
    ]);
  });

  test("enqueue → fail → wait past backoff → re-drain → success", async () => {
    let list: OutboxEntry[] = [
      makeEntry({ id: "mem-1", attempts: 0 }),
    ];

    const failingApis: DrainApi = {
      create: jest.fn().mockRejectedValue(new Error("offline")),
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn(),
    };

    const t0 = new Date("2026-04-30T12:00:00Z");
    const first = await drainOutbox({ list, apis: failingApis, now: t0 });
    expect(first.list).toHaveLength(1);
    expect(first.list[0].attempts).toBe(1);

    const successApis: DrainApi = {
      create: jest.fn().mockResolvedValue({ ok: true }),
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn(),
    };

    // Advance well past backoff
    const t1 = new Date(t0.getTime() + BASE_BACKOFF_MS * 2);
    const second = await drainOutbox({
      list: first.list,
      apis: successApis,
      now: t1,
    });
    expect(second.list).toHaveLength(0);
    expect(second.outcomes[0].kind).toBe("success");
  });
});

describe("non-retryable failures — cap drops the entry", () => {
  test("classifyError treats CaptureLimitReachedError-shaped throws as 'cap'", () => {
    const err1 = Object.assign(new Error("limit"), {
      name: "CaptureLimitReachedError",
    });
    const err2 = Object.assign(new Error("payment required"), { status: 402 });
    expect(classifyError(err1)).toBe("cap");
    expect(classifyError(err2)).toBe("cap");
  });

  test("drainOutbox drops a 'cap' failure instead of marking it for retry", async () => {
    const apis: DrainApi = {
      create: jest.fn().mockRejectedValue(
        Object.assign(new Error("daily cap"), {
          name: "CaptureLimitReachedError",
        }),
      ),
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn(),
    };
    const list: OutboxEntry[] = [makeEntry({ id: "mem-cap" })];
    const result = await drainOutbox({ list, apis });
    // Entry is removed (non-retryable) AND a failure outcome with
    // errorClass: "cap" is emitted so the caller can roll back the
    // optimistic UI write.
    expect(result.list).toHaveLength(0);
    expect(result.outcomes).toEqual([
      { kind: "failure", id: "mem-cap", errorClass: "cap" },
    ]);
  });

  // Task #121: server-side auto-block (HTTP 429 + CAPTURE_BLOCKED_ABUSE)
  // is reported by apiCreateMemory as CaptureBlockedError. The outbox
  // must classify this as the distinct "blocked" class (NOT collapsed
  // into "cap") so MemoriesContext can throw CaptureBlockedError and
  // surface the cooldown alert instead of routing the user to the
  // /subscription upsell.
  test("classifyError treats CaptureBlockedError as 'blocked' (distinct from 'cap')", () => {
    const err = Object.assign(new Error("auto-blocked"), {
      name: "CaptureBlockedError",
    });
    expect(classifyError(err)).toBe("blocked");
  });

  test("drainOutbox drops a 'blocked' failure and reports errorClass: 'blocked'", async () => {
    const apis: DrainApi = {
      create: jest.fn().mockRejectedValue(
        Object.assign(new Error("auto-blocked"), {
          name: "CaptureBlockedError",
        }),
      ),
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn(),
    };
    const list: OutboxEntry[] = [makeEntry({ id: "mem-blocked" })];
    const result = await drainOutbox({ list, apis });
    // Same drain treatment as "cap" (non-retryable, dropped) but the
    // outcome's errorClass MUST stay "blocked" so the caller can
    // distinguish auto-block from a regular cap-reached.
    expect(result.list).toHaveLength(0);
    expect(result.outcomes).toEqual([
      { kind: "failure", id: "mem-blocked", errorClass: "blocked" },
    ]);
  });
});

describe("annotate entries — separate id namespace + dispatch", () => {
  test("annotateOutboxId prepends ann: so it never collides with a memory id", () => {
    expect(annotateOutboxId("mem-1")).toBe("ann:mem-1");
    expect(annotateOutboxId("mem-1").startsWith(ANNOTATE_ID_PREFIX)).toBe(true);
  });

  test("queueing an annotate entry does not collapse with a queued create for the same memory", () => {
    let list: OutboxEntry[] = [];
    list = enqueueEntry(list, {
      id: "mem-1",
      action: "create",
      payload: { client_id: "mem-1", content: "hi", kind: "memory" },
      // attempts and first_queued_at injected by enqueueEntry
      first_queued_at: new Date().toISOString(),
    });
    list = enqueueEntry(list, {
      id: annotateOutboxId("mem-1"),
      action: "annotate",
      payload: { client_id: "mem-1", person: "Bob", linkedEventId: null },
      // attempts and first_queued_at injected by enqueueEntry
      first_queued_at: new Date().toISOString(),
    });
    expect(list).toHaveLength(2);
    expect(list[0].action).toBe("create");
    expect(list[1].action).toBe("annotate");
  });

  test("two annotate entries for the same memory collapse to the latest payload", () => {
    let list: OutboxEntry[] = [];
    list = enqueueEntry(list, {
      id: annotateOutboxId("mem-1"),
      action: "annotate",
      payload: { client_id: "mem-1", person: "Alice", linkedEventId: null },
      // attempts and first_queued_at injected by enqueueEntry
      first_queued_at: new Date().toISOString(),
    });
    list = enqueueEntry(list, {
      id: annotateOutboxId("mem-1"),
      action: "annotate",
      payload: { client_id: "mem-1", person: "Bob", linkedEventId: "evt-9" },
      // attempts and first_queued_at injected by enqueueEntry
      first_queued_at: new Date().toISOString(),
    });
    expect(list).toHaveLength(1);
    expect(list[0].payload).toEqual({
      client_id: "mem-1",
      person: "Bob",
      linkedEventId: "evt-9",
    });
  });

  test("drain dispatches annotate entries to apis.annotate, not create/update/delete", async () => {
    const apis: DrainApi = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn().mockResolvedValue({ ok: true }),
    };
    const list: OutboxEntry[] = [
      {
        id: annotateOutboxId("mem-1"),
        action: "annotate",
        payload: {
          client_id: "mem-1",
          person: "Alice",
          linkedEventId: "evt-1",
        },
        attempts: 0,
        first_queued_at: new Date().toISOString(),
      },
    ];
    const result = await drainOutbox({ list, apis });
    expect(apis.annotate).toHaveBeenCalledTimes(1);
    expect(apis.annotate).toHaveBeenCalledWith({
      client_id: "mem-1",
      person: "Alice",
      linkedEventId: "evt-1",
    });
    expect(apis.create).not.toHaveBeenCalled();
    expect(apis.update).not.toHaveBeenCalled();
    expect(apis.delete).not.toHaveBeenCalled();
    expect(result.list).toHaveLength(0);
    expect(result.outcomes[0]).toEqual({
      kind: "success",
      id: "ann:mem-1",
      serverId: undefined,
    });
  });
});

describe("summarizeMemoryDrainOutcomes — toast tally for 'Sync all'", () => {
  test("counts success and duplicate as synced; failure as failed", () => {
    const outcomes: DrainOutcome[] = [
      { kind: "success", id: "mem-1" },
      { kind: "duplicate", id: "mem-2" },
      { kind: "failure", id: "mem-3", errorClass: "network" },
    ];
    expect(summarizeMemoryDrainOutcomes(outcomes)).toEqual({
      synced: 2,
      failed: 1,
    });
  });

  test("excludes annotation entries so a memory + annotation drain doesn't double-count", () => {
    // A single offline edit can produce both a memory mutation AND
    // an annotation entry for the same row. The user-facing toast
    // is about memories only — counting the annotation outcome
    // would inflate the number ("2 synced" when the user only sees
    // 1 memory drain).
    const outcomes: DrainOutcome[] = [
      { kind: "success", id: "mem-1" },
      { kind: "success", id: annotateOutboxId("mem-1") },
    ];
    expect(summarizeMemoryDrainOutcomes(outcomes)).toEqual({
      synced: 1,
      failed: 0,
    });
  });

  test("annotation-only drain reports zero of both (caller stays silent)", () => {
    const outcomes: DrainOutcome[] = [
      { kind: "success", id: annotateOutboxId("mem-1") },
      { kind: "failure", id: annotateOutboxId("mem-2"), errorClass: "network" },
    ];
    expect(summarizeMemoryDrainOutcomes(outcomes)).toEqual({
      synced: 0,
      failed: 0,
    });
  });

  test("empty outcomes list produces zero counts", () => {
    expect(summarizeMemoryDrainOutcomes([])).toEqual({
      synced: 0,
      failed: 0,
    });
  });

  test("mixed memory failures with annotation successes only counts memory side", () => {
    const outcomes: DrainOutcome[] = [
      { kind: "failure", id: "mem-1", errorClass: "network" },
      { kind: "failure", id: "mem-2", errorClass: "network" },
      { kind: "success", id: annotateOutboxId("mem-3") },
    ];
    expect(summarizeMemoryDrainOutcomes(outcomes)).toEqual({
      synced: 0,
      failed: 2,
    });
  });
});
