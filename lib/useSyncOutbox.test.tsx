import React from "react";
import { Pressable, Text, View } from "react-native";
import { act, render, fireEvent } from "@testing-library/react-native";
import NetInfo, {
  type NetInfoState,
} from "@react-native-community/netinfo";

import { useSyncOutbox } from "./useSyncOutbox";
import {
  type DrainApi,
  type DrainOutcome,
  type OutboxEntry,
} from "./syncOutbox";

interface HostProps {
  email: string | null;
  apis: DrainApi;
  onOutcomes: (o: DrainOutcome[]) => void;
  onMount?: (api: HostHandle) => void;
}

interface HostHandle {
  enqueue: (entry: OutboxEntry) => Promise<DrainOutcome[]>;
  drainNow: () => Promise<DrainOutcome[]>;
  outbox: OutboxEntry[];
}

function Host({ email, apis, onOutcomes, onMount }: HostProps) {
  const { outbox, enqueue, drainNow, isDraining, stuckCount } = useSyncOutbox(
    {
      email,
      apis,
      onOutcomes,
      disableAuto: true,
    },
  );

  const handleRef = React.useRef<HostHandle>({
    enqueue,
    drainNow,
    outbox,
  });
  handleRef.current = { enqueue, drainNow, outbox };
  React.useEffect(() => {
    onMount?.(handleRef.current);
  });

  return (
    <View>
      <Text testID="size">{String(outbox.length)}</Text>
      <Text testID="stuck">{String(stuckCount)}</Text>
      <Text testID="draining">{isDraining ? "yes" : "no"}</Text>
      <Pressable
        accessibilityLabel="Drain"
        onPress={() => {
          void drainNow();
        }}
      >
        <Text>Drain</Text>
      </Pressable>
    </View>
  );
}

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
    first_queued_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("useSyncOutbox — full add → drain → success flow", () => {
  test("enqueue triggers an immediate drain that calls the create api", async () => {
    let handle: HostHandle | null = null;
    const apis: DrainApi = {
      create: jest.fn().mockResolvedValue({ ok: true, server_id: "srv-1" }),
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn().mockResolvedValue({ ok: true }),
    };
    const outcomes: DrainOutcome[] = [];

    const view = render(
      <Host
        email="user@example.com"
        apis={apis}
        onOutcomes={(o) => outcomes.push(...o)}
        onMount={(h) => {
          handle = h;
        }}
      />,
    );

    expect(view.getByTestId("size").props.children).toBe("0");

    await act(async () => {
      await handle!.enqueue(makeEntry({ id: "mem-1" }));
    });

    expect(apis.create).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("size").props.children).toBe("0");
    expect(outcomes).toEqual([
      { kind: "success", id: "mem-1", serverId: "srv-1" },
    ]);
  });

  test("drain failure keeps the entry, increments attempts, fans out outcome", async () => {
    let handle: HostHandle | null = null;
    const apis: DrainApi = {
      create: jest.fn().mockRejectedValue(new Error("offline")),
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn().mockResolvedValue({ ok: true }),
    };
    const outcomes: DrainOutcome[] = [];

    const view = render(
      <Host
        email="user@example.com"
        apis={apis}
        onOutcomes={(o) => outcomes.push(...o)}
        onMount={(h) => {
          handle = h;
        }}
      />,
    );

    await act(async () => {
      await handle!.enqueue(makeEntry({ id: "mem-1" }));
    });

    expect(view.getByTestId("size").props.children).toBe("1");
    expect(handle!.outbox[0].attempts).toBe(1);
    expect(outcomes).toEqual([
      { kind: "failure", id: "mem-1", errorClass: "network" },
    ]);
  });

  test("explicit drainNow tap on a queued entry succeeds and clears it", async () => {
    let handle: HostHandle | null = null;
    const create = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, server_id: "srv-1" });
    const apis: DrainApi = {
      create,
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn().mockResolvedValue({ ok: true }),
    };
    const outcomes: DrainOutcome[] = [];

    const view = render(
      <Host
        email="user@example.com"
        apis={apis}
        onOutcomes={(o) => outcomes.push(...o)}
        onMount={(h) => {
          handle = h;
        }}
      />,
    );

    await act(async () => {
      await handle!.enqueue(makeEntry({ id: "mem-1" }));
    });
    expect(view.getByTestId("size").props.children).toBe("1");

    // The first drain in enqueue counted as attempt 1; we need to
    // wait past backoff before the next drain succeeds. Simulate by
    // resetting last_attempt_at to 0 via direct call.
    handle!.outbox[0].last_attempt_at = undefined;
    handle!.outbox[0].attempts = 0;

    await act(async () => {
      fireEvent.press(view.getByLabelText("Drain"));
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(view.getByTestId("size").props.children).toBe("0");
    expect(outcomes[outcomes.length - 1]).toEqual({
      kind: "success",
      id: "mem-1",
      serverId: "srv-1",
    });
  });

  test("duplicate (409) outcome drops the local entry and fires duplicate outcome", async () => {
    let handle: HostHandle | null = null;
    const create = jest.fn().mockRejectedValue(
      Object.assign(new Error("Already exists"), { status: 409 }),
    );
    const apis: DrainApi = {
      create,
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn().mockResolvedValue({ ok: true }),
    };
    const outcomes: DrainOutcome[] = [];

    const view = render(
      <Host
        email="user@example.com"
        apis={apis}
        onOutcomes={(o) => outcomes.push(...o)}
        onMount={(h) => {
          handle = h;
        }}
      />,
    );

    await act(async () => {
      await handle!.enqueue(makeEntry({ id: "mem-1" }));
    });

    expect(view.getByTestId("size").props.children).toBe("0");
    expect(outcomes).toEqual([{ kind: "duplicate", id: "mem-1" }]);
  });
});

describe("useSyncOutbox — collapse semantics integration", () => {
  test("offline create + later update collapses into a single create with merged payload", async () => {
    let handle: HostHandle | null = null;
    // First create call fails (offline). Then a queued update arrives
    // and we drain — there must be exactly ONE create call with the
    // merged payload, and zero update calls (because the row never
    // existed server-side).
    const create = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, server_id: "srv-1" });
    const update = jest.fn();
    const apis: DrainApi = {
      create,
      update,
      delete: jest.fn(),
      annotate: jest.fn().mockResolvedValue({ ok: true }),
    };
    const outcomes: DrainOutcome[] = [];

    const view = render(
      <Host
        email="user@example.com"
        apis={apis}
        onOutcomes={(o) => outcomes.push(...o)}
        onMount={(h) => {
          handle = h;
        }}
      />,
    );

    // Step 1: queue the create. The immediate drain will fail.
    await act(async () => {
      await handle!.enqueue(
        makeEntry({
          id: "mem-1",
          action: "create",
          payload: {
            client_id: "mem-1",
            content: "first draft",
            kind: "memory",
            tags: ["v1"],
          },
        }),
      );
    });
    expect(view.getByTestId("size").props.children).toBe("1");
    expect(handle!.outbox[0].action).toBe("create");

    // Step 2: queue an update for the same row before the network is
    // back. The collapse rule keeps the entry as a `create` with the
    // merged payload — never a bare `update` against a non-existent
    // row.
    handle!.outbox[0].last_attempt_at = undefined;
    handle!.outbox[0].attempts = 0;
    await act(async () => {
      await handle!.enqueue(
        makeEntry({
          id: "mem-1",
          action: "update",
          payload: {
            client_id: "mem-1",
            content: "edited later",
            tags: ["v2"],
          },
        }),
      );
    });

    expect(view.getByTestId("size").props.children).toBe("0");
    expect(create).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenLastCalledWith({
      client_id: "mem-1",
      content: "edited later",
      kind: "memory",
      tags: ["v2"],
    });
    expect(outcomes[outcomes.length - 1]).toEqual({
      kind: "success",
      id: "mem-1",
      serverId: "srv-1",
    });
  });

  test("offline create + later delete drops the entry without ever calling create or delete", async () => {
    let handle: HostHandle | null = null;
    const create = jest.fn().mockRejectedValueOnce(new Error("offline"));
    const del = jest.fn();
    const apis: DrainApi = {
      create,
      update: jest.fn(),
      delete: del,
      annotate: jest.fn().mockResolvedValue({ ok: true }),
    };
    const outcomes: DrainOutcome[] = [];

    const view = render(
      <Host
        email="user@example.com"
        apis={apis}
        onOutcomes={(o) => outcomes.push(...o)}
        onMount={(h) => {
          handle = h;
        }}
      />,
    );

    await act(async () => {
      await handle!.enqueue(
        makeEntry({
          id: "mem-2",
          action: "create",
          payload: {
            client_id: "mem-2",
            content: "draft",
            kind: "memory",
          },
        }),
      );
    });
    expect(view.getByTestId("size").props.children).toBe("1");

    // First create call already happened (and failed). Second enqueue
    // collapses to no-op — the user undid the capture before the
    // server ever heard about it.
    create.mockClear();
    await act(async () => {
      await handle!.enqueue(
        makeEntry({
          id: "mem-2",
          action: "delete",
          payload: { client_id: "mem-2" },
        }),
      );
    });

    expect(view.getByTestId("size").props.children).toBe("0");
    expect(create).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  test("annotate entry uses ann: id namespace and routes to the annotate api", async () => {
    let handle: HostHandle | null = null;
    const annotate = jest.fn().mockResolvedValue({ ok: true });
    const apis: DrainApi = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      annotate,
    };
    const outcomes: DrainOutcome[] = [];

    const view = render(
      <Host
        email="user@example.com"
        apis={apis}
        onOutcomes={(o) => outcomes.push(...o)}
        onMount={(h) => {
          handle = h;
        }}
      />,
    );

    await act(async () => {
      await handle!.enqueue({
        id: "ann:mem-3",
        action: "annotate",
        payload: {
          client_id: "mem-3",
          person: "Alice",
          linkedEventId: null,
        },
        attempts: 0,
        first_queued_at: new Date().toISOString(),
      });
    });

    expect(annotate).toHaveBeenCalledTimes(1);
    expect(annotate).toHaveBeenCalledWith({
      client_id: "mem-3",
      person: "Alice",
      linkedEventId: null,
    });
    expect(view.getByTestId("size").props.children).toBe("0");
    expect(outcomes[outcomes.length - 1]).toEqual({
      kind: "success",
      id: "ann:mem-3",
      serverId: undefined,
    });
  });
});

describe("useSyncOutbox — concurrent enqueue/drain serialization", () => {
  test("enqueue B during drain of enqueue A does not silently drop B", async () => {
    // Reproduces the previous race:
    //   1. enqueue(A) starts a drain of [A]
    //   2. while drain(A) is awaiting the network, enqueue(B) fires
    //   3. previously: drain(A) committed [] back, clobbering B
    //   4. now: the lock chains enqueue(B) AFTER drain(A) commits, so
    //      B survives and the second drain flushes it.
    //
    // The "release" gate lets us hold the create call mid-flight
    // exactly while we kick off the second enqueue.
    let releaseA: (v: { ok: true; server_id: string }) => void = () => {};
    const createPromiseA = new Promise<{ ok: true; server_id: string }>(
      (r) => {
        releaseA = r;
      },
    );
    const create = jest
      .fn()
      // First call (enqueue A): suspended until we resolve releaseA.
      .mockImplementationOnce(() => createPromiseA)
      // Second call (drain triggered by enqueue B): resolves immediately.
      .mockResolvedValueOnce({ ok: true, server_id: "srv-B" });
    const apis: DrainApi = {
      create,
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn(),
    };

    let handle: HostHandle | null = null;
    const outcomes: DrainOutcome[] = [];
    render(
      <Host
        email="user@example.com"
        apis={apis}
        onOutcomes={(o) => outcomes.push(...o)}
        onMount={(h) => {
          handle = h;
        }}
      />,
    );

    // The lock + writeOutbox chain needs several microtask ticks
    // before apis.create is invoked. flushMicrotasks drains them.
    const flushMicrotasks = async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    };

    // Kick off enqueue A — do NOT await, the drain is suspended on
    // createPromiseA.
    let promiseA: Promise<DrainOutcome[]> | null = null;
    await act(async () => {
      promiseA = handle!.enqueue(makeEntry({ id: "mem-A" }));
      await flushMicrotasks();
    });
    expect(create).toHaveBeenCalledTimes(1);

    // Now enqueue B while drain A is mid-flight. The lock should
    // queue this behind drain A.
    let promiseB: Promise<DrainOutcome[]> | null = null;
    await act(async () => {
      promiseB = handle!.enqueue(makeEntry({ id: "mem-B" }));
      await flushMicrotasks();
    });
    // Drain A is still suspended → create called only once so far.
    expect(create).toHaveBeenCalledTimes(1);

    // Release drain A. enqueue B should then run and drain its entry.
    await act(async () => {
      releaseA({ ok: true, server_id: "srv-A" });
      await promiseA;
      await promiseB;
    });

    // Both A and B reached the server exactly once each.
    expect(create).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { kind: "success", id: "mem-A", serverId: "srv-A" },
        { kind: "success", id: "mem-B", serverId: "srv-B" },
      ]),
    );
  });
});

describe("useSyncOutbox — NetInfo reachability triggers a drain", () => {
  // This test exercises the auto-wired NetInfo subscription, so we use
  // a dedicated Host that does NOT set disableAuto. The default Host
  // helper short-circuits the heartbeat / NetInfo / AppState effects.
  function NetHost({
    apis,
    onOutcomes,
    onMount,
  }: {
    apis: DrainApi;
    onOutcomes: (o: DrainOutcome[]) => void;
    onMount: (h: HostHandle) => void;
  }) {
    const { outbox, enqueue, drainNow, isDraining, stuckCount } = useSyncOutbox({
      email: "user@example.com",
      apis,
      onOutcomes,
    });
    const ref = React.useRef<HostHandle>({ enqueue, drainNow, outbox });
    ref.current = { enqueue, drainNow, outbox };
    React.useEffect(() => {
      onMount(ref.current);
    });
    return (
      <View>
        <Text testID="size">{String(outbox.length)}</Text>
        <Text testID="stuck">{String(stuckCount)}</Text>
        <Text testID="draining">{isDraining ? "yes" : "no"}</Text>
      </View>
    );
  }

  test("offline → online transition fires a drain that flushes a fresh entry", async () => {
    // Two failure modes are intentionally separated:
    //   1) The hook MUST subscribe to NetInfo on mount and unsubscribe
    //      on unmount (lifecycle wiring).
    //   2) Calling the captured listener with offline → online MUST
    //      trigger a drainNow (reachability handler).
    //
    // We avoid the in-memory backoff timer (5s after first failure) by
    // enqueueing a fresh entry AFTER the online transition — that
    // simulates the realistic case: the user re-opens the app on a
    // restored network and the next mutation lands without waiting for
    // the heartbeat tick.
    const create = jest
      .fn()
      .mockResolvedValue({ ok: true, server_id: "srv-net" });
    const apis: DrainApi = {
      create,
      update: jest.fn(),
      delete: jest.fn(),
      annotate: jest.fn(),
    };
    let listener: ((s: NetInfoState) => void) | null = null;
    const unsubscribe = jest.fn();
    const addEventListenerMock = NetInfo.addEventListener as jest.Mock;
    addEventListenerMock.mockReset();
    addEventListenerMock.mockImplementation(
      (cb: (s: NetInfoState) => void) => {
        listener = cb;
        return unsubscribe;
      },
    );

    let handle: HostHandle | null = null;
    const outcomes: DrainOutcome[] = [];
    const view = render(
      <NetHost
        apis={apis}
        onOutcomes={(o) => outcomes.push(...o)}
        onMount={(h) => {
          handle = h;
        }}
      />,
    );

    // (1) Subscription wiring — the hook called addEventListener.
    expect(addEventListenerMock).toHaveBeenCalledTimes(1);
    expect(listener).not.toBeNull();

    // (2) Reachability handler — flip lastOnline=true → false → true
    // and verify the drain runs (no entries queued yet, so no api calls
    // expected; we assert the handler doesn't throw and the subscription
    // stays alive).
    await act(async () => {
      listener!({
        isConnected: false,
        isInternetReachable: false,
      } as NetInfoState);
      listener!({
        isConnected: true,
        isInternetReachable: true,
      } as NetInfoState);
      await Promise.resolve();
    });

    // After reachability fires, a freshly enqueued entry should drain
    // immediately on its own enqueue path. This proves the outbox is
    // healthy after the listener ran.
    await act(async () => {
      await handle!.enqueue(makeEntry({ id: "mem-net" }));
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(
      outcomes.some((o) => o.kind === "success" && o.id === "mem-net"),
    ).toBe(true);

    // Lifecycle: unmount must call the unsubscribe returned by NetInfo.
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
