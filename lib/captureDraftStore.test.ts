import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DRAFT_MAX_AGE_MS,
  __test__,
  clearDraft,
  loadDraft,
  saveDraft,
} from "./captureDraftStore";

const { keyFor } = __test__;

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

describe("captureDraftStore", () => {
  beforeEach(() => {
    mockedStorage.getItem.mockReset();
    mockedStorage.setItem.mockReset();
    mockedStorage.removeItem.mockReset();
  });

  describe("loadDraft", () => {
    it("returns null when userId is missing", async () => {
      expect(await loadDraft("capture", null)).toBeNull();
      expect(await loadDraft("capture", undefined)).toBeNull();
      expect(await loadDraft("capture", "")).toBeNull();
      expect(mockedStorage.getItem).not.toHaveBeenCalled();
    });

    it("returns null when nothing is stored", async () => {
      mockedStorage.getItem.mockResolvedValueOnce(null);
      expect(await loadDraft("capture", "u1")).toBeNull();
      expect(mockedStorage.getItem).toHaveBeenCalledWith(
        keyFor("capture", "u1"),
      );
    });

    it("recovers from corrupt JSON", async () => {
      mockedStorage.getItem.mockResolvedValueOnce("{not json");
      expect(await loadDraft("capture", "u1")).toBeNull();
    });

    it("returns null when blob has no meaningful content", async () => {
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({ content: "", person: "", tags: [], updatedAt: Date.now() }),
      );
      expect(await loadDraft("capture", "u1")).toBeNull();
    });

    it("drops drafts older than the age cap", async () => {
      const now = 10_000_000_000;
      const stale = now - DRAFT_MAX_AGE_MS - 1;
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({ content: "old note", person: "", tags: [], updatedAt: stale }),
      );
      expect(await loadDraft("capture", "u1", now)).toBeNull();
    });

    it("loads a recent draft roundtrip", async () => {
      const now = 10_000_000_000;
      const draft = {
        content: "hello",
        person: "",
        title: "",
        tone: "",
        tags: ["work"],
        updatedAt: now - 1000,
      };
      mockedStorage.getItem.mockResolvedValueOnce(JSON.stringify(draft));
      expect(await loadDraft("capture", "u1", now)).toEqual(draft);
    });

    it("loads a voice-capture draft with title and tone", async () => {
      const now = 10_000_000_000;
      const stored = {
        content: "had coffee with alex",
        person: "",
        title: "Coffee with Alex",
        tone: "happy",
        tags: ["social"],
        updatedAt: now - 1000,
      };
      mockedStorage.getItem.mockResolvedValueOnce(JSON.stringify(stored));
      expect(await loadDraft("voice-capture", "u1", now)).toEqual(stored);
    });

    it("defaults missing title/tone fields to empty strings", async () => {
      const now = 10_000_000_000;
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({ content: "hi", person: "", tags: [], updatedAt: now }),
      );
      const out = await loadDraft("capture", "u1", now);
      expect(out).toEqual({
        content: "hi",
        person: "",
        title: "",
        tone: "",
        tags: [],
        updatedAt: now,
      });
    });

    it("treats a tone-only blob as no draft", async () => {
      const now = 10_000_000_000;
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({
          content: "",
          person: "",
          title: "",
          tone: "neutral",
          tags: [],
          updatedAt: now,
        }),
      );
      expect(await loadDraft("voice-capture", "u1", now)).toBeNull();
    });

    it("filters out non-string tag entries", async () => {
      const now = 10_000_000_000;
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({
          content: "hi",
          person: "",
          tags: ["work", 7, null, "idea"],
          updatedAt: now,
        }),
      );
      const out = await loadDraft("capture", "u1", now);
      expect(out?.tags).toEqual(["work", "idea"]);
    });

    it("uses a different key per screen", async () => {
      mockedStorage.getItem.mockResolvedValue(null);
      await loadDraft("capture", "u1");
      await loadDraft("log-call", "u1");
      expect(mockedStorage.getItem).toHaveBeenNthCalledWith(1, keyFor("capture", "u1"));
      expect(mockedStorage.getItem).toHaveBeenNthCalledWith(2, keyFor("log-call", "u1"));
      expect(keyFor("capture", "u1")).not.toEqual(keyFor("log-call", "u1"));
    });

    it("uses a different key per user (account isolation)", async () => {
      const now = 10_000_000_000;
      mockedStorage.getItem
        .mockResolvedValueOnce(
          JSON.stringify({ content: "alice note", person: "", tags: [], updatedAt: now }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({ content: "bob note", person: "", tags: [], updatedAt: now }),
        );
      const a = await loadDraft("capture", "alice", now);
      const b = await loadDraft("capture", "bob", now);
      expect(a?.content).toBe("alice note");
      expect(b?.content).toBe("bob note");
      expect(keyFor("capture", "alice")).not.toEqual(keyFor("capture", "bob"));
    });
  });

  describe("saveDraft", () => {
    it("is a no-op when userId is missing", async () => {
      await saveDraft("capture", "", { content: "hi", person: "", tags: [] });
      expect(mockedStorage.setItem).not.toHaveBeenCalled();
    });

    it("persists a non-empty draft with an updatedAt stamp", async () => {
      const now = 1_700_000_000_000;
      await saveDraft(
        "capture",
        "u1",
        { content: "hello", person: "", tags: ["work"] },
        now,
      );
      expect(mockedStorage.setItem).toHaveBeenCalledWith(
        keyFor("capture", "u1"),
        JSON.stringify({
          content: "hello",
          person: "",
          title: "",
          tone: "",
          tags: ["work"],
          updatedAt: now,
        }),
      );
    });

    it("persists voice-capture title and tone fields", async () => {
      const now = 1_700_000_000_000;
      await saveDraft(
        "voice-capture",
        "u1",
        {
          content: "had coffee with alex",
          person: "",
          title: "Coffee with Alex",
          tone: "happy",
          tags: ["social"],
        },
        now,
      );
      expect(mockedStorage.setItem).toHaveBeenCalledWith(
        keyFor("voice-capture", "u1"),
        JSON.stringify({
          content: "had coffee with alex",
          person: "",
          title: "Coffee with Alex",
          tone: "happy",
          tags: ["social"],
          updatedAt: now,
        }),
      );
    });

    it("clears when only tone is set (no body / title / tags)", async () => {
      await saveDraft("voice-capture", "u1", {
        content: "",
        person: "",
        title: "",
        tone: "neutral",
        tags: [],
      });
      expect(mockedStorage.setItem).not.toHaveBeenCalled();
      expect(mockedStorage.removeItem).toHaveBeenCalledWith(
        keyFor("voice-capture", "u1"),
      );
    });

    it("treats a title-only voice draft as worth persisting", async () => {
      const now = 1_700_000_000_000;
      await saveDraft(
        "voice-capture",
        "u1",
        { content: "", person: "", title: "Headline", tone: "", tags: [] },
        now,
      );
      expect(mockedStorage.setItem).toHaveBeenCalled();
    });

    it("clears (removes) when every field is empty", async () => {
      await saveDraft("capture", "u1", { content: "  ", person: "", tags: [] });
      expect(mockedStorage.setItem).not.toHaveBeenCalled();
      expect(mockedStorage.removeItem).toHaveBeenCalledWith(keyFor("capture", "u1"));
    });

    it("swallows storage failures (best-effort)", async () => {
      mockedStorage.setItem.mockRejectedValueOnce(new Error("disk full"));
      await expect(
        saveDraft("capture", "u1", { content: "hi", person: "", tags: [] }),
      ).resolves.toBeUndefined();
    });
  });

  describe("clearDraft", () => {
    it("removes the per-user, per-screen key", async () => {
      await clearDraft("log-call", "u1");
      expect(mockedStorage.removeItem).toHaveBeenCalledWith(keyFor("log-call", "u1"));
    });

    it("is a no-op when userId is missing", async () => {
      await clearDraft("capture", null);
      expect(mockedStorage.removeItem).not.toHaveBeenCalled();
    });
  });
});
