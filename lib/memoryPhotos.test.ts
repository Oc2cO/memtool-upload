/**
 * Coverage for the photo upload outbox (Task #372). The drain is
 * the offline-survival contract: an entry that hits a transient
 * failure has to remain queued (with bumped attempts) so the next
 * AppState foreground / 45s heartbeat can retry, while a permanent
 * failure (e.g. the underlying file vanished from the device) has
 * to drop out so we don't loop forever. A fully successful round
 * confirms via the bulk shape MemoriesContext patches into the
 * memory list. These three branches are the only thing standing
 * between "user took a photo" and "photo shows up in Archive
 * tomorrow morning", so we pin each one explicitly.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import * as ImageManipulator from "expo-image-manipulator";

import {
  drainPhotoQueue,
  enqueuePhotoUpload,
  listPendingPhotoIds,
  stripPhotoMetadata,
} from "./memoryPhotos";

jest.mock("./auth", () => {
  const actual = jest.requireActual("./auth");
  return {
    ...actual,
    getToken: jest.fn(() => Promise.resolve("test-token")),
  };
});

jest.mock("./config", () => ({
  resolveReplitApiBase: () => "https://api.test",
}));

const mockedAuth = jest.requireMock("./auth") as { getToken: jest.Mock };

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

const TEST_EMAIL = "u@example.com";
const QUEUE_KEY = `pendingPhotoUploads_${TEST_EMAIL}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response("", { status });
}

const ORIGINAL_FETCH = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  // Tiny in-memory store stand-in so enqueue → readQueue → drain
  // round-trip behaves like the real device.
  let store: Record<string, string> = {};
  mockedStorage.getItem.mockImplementation((k: string) =>
    Promise.resolve(store[k] ?? null),
  );
  mockedStorage.setItem.mockImplementation((k: string, v: string) => {
    store[k] = v;
    return Promise.resolve();
  });
  mockedStorage.removeItem.mockImplementation((k: string) => {
    delete store[k];
    return Promise.resolve();
  });
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockedAuth.getToken.mockReset();
  mockedAuth.getToken.mockResolvedValue("test-token");
});

afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("photo upload outbox", () => {
  it("enqueue → drain → confirm wipes the queue and surfaces the entry", async () => {
    await enqueuePhotoUpload(TEST_EMAIL, {
      clientId: "mem-1",
      localUri: "file:///tmp/a.jpg",
      mimeType: "image/jpeg",
      takenAt: "2026-05-03T10:00:00.000Z",
    });

    fetchMock
      // 1) sign
      .mockResolvedValueOnce(
        jsonResponse({
          uploadURL: "https://signed.example/put",
          objectPath: "/objects/uploads/abc",
        }),
      )
      // 2) materialise local file as blob
      .mockResolvedValueOnce(new Response("BYTES", { status: 200 }))
      // 3) GCS PUT
      .mockResolvedValueOnce(emptyResponse(200))
      // 4) PATCH confirm
      .mockResolvedValueOnce(
        jsonResponse({
          photo: {
            photo_path: "/objects/uploads/abc",
            thumb_path: "/objects/uploads/abc-thumb",
            taken_at: "2026-05-03T10:00:00.000Z",
            updated_at: "2026-05-03T10:00:01.000Z",
          },
        }),
      );

    const out = await drainPhotoQueue(TEST_EMAIL);

    // Task #385: confirmed entries are now grouped per memory in
    // capture order so a multi-pick drain can return several photos
    // for the same clientId in one pass.
    expect(out.confirmed["mem-1"]).toHaveLength(1);
    expect(out.confirmed["mem-1"][0].url).toContain("/objects/uploads/abc");
    expect(out.confirmed["mem-1"][0].thumbUrl).toContain("abc-thumb");
    expect(out.stillPending).toEqual([]);

    // Queue is empty after a clean drain.
    const pending = await listPendingPhotoIds(TEST_EMAIL);
    expect(pending.size).toBe(0);
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it("transient PATCH 500 keeps the entry queued for the next drain", async () => {
    await enqueuePhotoUpload(TEST_EMAIL, {
      clientId: "mem-2",
      localUri: "file:///tmp/b.jpg",
    });

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          uploadURL: "https://signed.example/put",
          objectPath: "/objects/uploads/xyz",
        }),
      )
      .mockResolvedValueOnce(new Response("BYTES", { status: 200 }))
      .mockResolvedValueOnce(emptyResponse(200))
      .mockResolvedValueOnce(emptyResponse(500));

    const out = await drainPhotoQueue(TEST_EMAIL);

    expect(out.confirmed).toEqual({});
    expect(out.stillPending).toEqual(["mem-2"]);

    const pending = await listPendingPhotoIds(TEST_EMAIL);
    expect(pending.has("mem-2")).toBe(true);

    // Attempts bumped so a future surface (e.g. a "give up after N
    // tries" check) has the right counter to read.
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as Array<{ attempts: number }>;
    expect(persisted[0].attempts).toBe(1);
  });

  it("PATCH 415 (unsupported mime) is permanent and drops the entry", async () => {
    await enqueuePhotoUpload(TEST_EMAIL, {
      clientId: "mem-bad",
      localUri: "file:///tmp/bad.gif",
      mimeType: "image/gif",
    });

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          uploadURL: "https://signed.example/put",
          objectPath: "/objects/user-photos/abc",
        }),
      )
      .mockResolvedValueOnce(new Response("BYTES", { status: 200 }))
      .mockResolvedValueOnce(emptyResponse(200))
      // Server's MIME enforcement (memory-photos.ts) replies 415 on
      // confirm. Retrying would never succeed — the same bytes will
      // always fail the same content-type check — so the entry must
      // drop, not stay queued. Without this branch the heartbeat
      // would burn forever and `photoPendingUpload` would stick on.
      .mockResolvedValueOnce(emptyResponse(415));

    const out = await drainPhotoQueue(TEST_EMAIL);

    expect(out.confirmed).toEqual({});
    expect(out.stillPending).toEqual([]);
    const pending = await listPendingPhotoIds(TEST_EMAIL);
    expect(pending.size).toBe(0);
  });

  it("permanent local-file failure drops the entry without retry", async () => {
    await enqueuePhotoUpload(TEST_EMAIL, {
      clientId: "mem-3",
      localUri: "file:///tmp/gone.jpg",
    });

    fetchMock
      // sign succeeds
      .mockResolvedValueOnce(
        jsonResponse({
          uploadURL: "https://signed.example/put",
          objectPath: "/objects/uploads/zzz",
        }),
      )
      // local file read throws — user emptied the camera roll
      .mockRejectedValueOnce(new Error("ENOENT"));

    const out = await drainPhotoQueue(TEST_EMAIL);

    expect(out.confirmed).toEqual({});
    // Permanent failures must NOT remain queued — otherwise we'd
    // burn forever retrying a file that no longer exists.
    expect(out.stillPending).toEqual([]);
    const pending = await listPendingPhotoIds(TEST_EMAIL);
    expect(pending.size).toBe(0);
  });
});

// Task #387: stripPhotoMetadata is the device-side guard against
// leaking GPS EXIF via the public photo URL. It must always route
// the picked URI through expo-image-manipulator with format=JPEG
// (the manipulator does not copy EXIF onto the output) and force
// the canonical "image/jpeg" mime so the signed PUT's Content-Type
// matches what the server's MIME allowlist expects.
describe("stripPhotoMetadata — Task #387", () => {
  test("re-encodes the picked URI as JPEG and returns image/jpeg", async () => {
    const manipulate = ImageManipulator.manipulateAsync as unknown as jest.Mock;
    manipulate.mockResolvedValueOnce({
      uri: "file:///tmp/clean.jpg",
      width: 100,
      height: 100,
    });
    const out = await stripPhotoMetadata("file:///tmp/geotagged.heic");
    expect(manipulate).toHaveBeenCalledWith(
      "file:///tmp/geotagged.heic",
      [],
      expect.objectContaining({ format: ImageManipulator.SaveFormat.JPEG }),
    );
    expect(out).toEqual({
      uri: "file:///tmp/clean.jpg",
      mimeType: "image/jpeg",
    });
  });
});
