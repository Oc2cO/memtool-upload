import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  clearAiGuideThread,
  loadAiGuideThread,
  saveAiGuideThread,
  type StoredAiGuideMessage,
} from "./aiGuideThread";

const KEY_PREFIX = "mt_ai_guide_thread_v1:";

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

describe("loadAiGuideThread", () => {
  beforeEach(() => {
    mockedStorage.getItem.mockReset();
  });

  it("returns an empty array when there's no userId", async () => {
    expect(await loadAiGuideThread("")).toEqual([]);
    expect(mockedStorage.getItem).not.toHaveBeenCalled();
  });

  it("returns an empty array when storage is empty", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(null);
    const out = await loadAiGuideThread("user-1");
    expect(out).toEqual([]);
    expect(mockedStorage.getItem).toHaveBeenCalledWith(`${KEY_PREFIX}user-1`);
  });

  it("loads a valid thread roundtrip", async () => {
    const thread: StoredAiGuideMessage[] = [
      { id: "intro", role: "mem", text: "Hi", accentMood: "calm" },
      { id: "u1", role: "user", text: "Hi back" },
    ];
    mockedStorage.getItem.mockResolvedValueOnce(JSON.stringify(thread));
    const out = await loadAiGuideThread("user-1");
    expect(out).toEqual(thread);
  });

  it("recovers from corrupt JSON", async () => {
    mockedStorage.getItem.mockResolvedValueOnce("{nope");
    expect(await loadAiGuideThread("user-1")).toEqual([]);
  });

  it("returns empty when the persisted value is not an array", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(JSON.stringify({ id: "x" }));
    expect(await loadAiGuideThread("user-1")).toEqual([]);
  });

  it("filters out malformed entries while keeping valid ones", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify([
        { id: "ok", role: "mem", text: "ok" },
        { id: "no-role", text: "nope" },
        { id: "bad-role", role: "system", text: "nope" },
        { role: "user", text: "no id" },
        { id: "no-text", role: "user" },
        null,
        "string-row",
        { id: "good-user", role: "user", text: "good" },
      ]),
    );
    const out = await loadAiGuideThread("user-1");
    expect(out).toEqual([
      { id: "ok", role: "mem", text: "ok" },
      { id: "good-user", role: "user", text: "good" },
    ]);
  });

  it("preserves accentMood when present and a string", async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify([
        { id: "m1", role: "mem", text: "hi", accentMood: "happy" },
        { id: "m2", role: "mem", text: "again", accentMood: 7 },
      ]),
    );
    const out = await loadAiGuideThread("user-1");
    expect(out).toEqual([
      { id: "m1", role: "mem", text: "hi", accentMood: "happy" },
      { id: "m2", role: "mem", text: "again" },
    ]);
  });

  it("isolates threads per user (different keys)", async () => {
    mockedStorage.getItem
      .mockResolvedValueOnce(
        JSON.stringify([{ id: "a", role: "user", text: "from-a" }]),
      )
      .mockResolvedValueOnce(
        JSON.stringify([{ id: "b", role: "user", text: "from-b" }]),
      );
    const aThread = await loadAiGuideThread("alice");
    const bThread = await loadAiGuideThread("bob");
    expect(aThread[0].text).toBe("from-a");
    expect(bThread[0].text).toBe("from-b");
    expect(mockedStorage.getItem).toHaveBeenNthCalledWith(1, `${KEY_PREFIX}alice`);
    expect(mockedStorage.getItem).toHaveBeenNthCalledWith(2, `${KEY_PREFIX}bob`);
  });
});

describe("saveAiGuideThread", () => {
  beforeEach(() => {
    mockedStorage.setItem.mockReset();
  });

  it("persists the thread under the per-user key", async () => {
    const thread: StoredAiGuideMessage[] = [
      { id: "m1", role: "mem", text: "hi", accentMood: "calm" },
    ];
    await saveAiGuideThread("user-1", thread);
    expect(mockedStorage.setItem).toHaveBeenCalledWith(
      `${KEY_PREFIX}user-1`,
      JSON.stringify(thread),
    );
  });

  it("is a no-op when userId is empty", async () => {
    await saveAiGuideThread("", []);
    expect(mockedStorage.setItem).not.toHaveBeenCalled();
  });

  it("swallows storage failures silently (best-effort)", async () => {
    mockedStorage.setItem.mockRejectedValueOnce(new Error("disk full"));
    await expect(saveAiGuideThread("user-1", [])).resolves.toBeUndefined();
  });
});

describe("clearAiGuideThread", () => {
  beforeEach(() => {
    mockedStorage.removeItem.mockReset();
  });

  it("removes the per-user key", async () => {
    await clearAiGuideThread("user-1");
    expect(mockedStorage.removeItem).toHaveBeenCalledWith(`${KEY_PREFIX}user-1`);
  });

  it("is a no-op when userId is empty", async () => {
    await clearAiGuideThread("");
    expect(mockedStorage.removeItem).not.toHaveBeenCalled();
  });
});
