import AsyncStorage from "@react-native-async-storage/async-storage";

export let API_BASE_URL = null;

export function setApiBaseUrl(url) {
  API_BASE_URL = url || null;
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function isCloudSyncEnabled() {
  return typeof API_BASE_URL === "string" && API_BASE_URL.length > 0;
}

// Subscription gate for cloud sync (Pro-only feature). Defense-in-depth
// alongside the UI-level check in settings.tsx — even if a future caller
// is added, syncToCloud will refuse for non-Pro accounts. The flag is
// pushed in by SubscriptionContext whenever status changes (and reset
// to false on logout / status clear), so api.js stays React-free.
let isSyncProActive = false;

export function setSyncProActive(active) {
  isSyncProActive = active === true;
}

export function isSyncProActiveForTesting() {
  return isSyncProActive;
}

const SYNC_QUEUE_KEY = "memtool:syncQueue";

async function readQueue() {
  try {
    const raw = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue) {
  try {
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

export async function queueChange(resource, action, payload) {
  const queue = await readQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    resource,
    action,
    payload,
    queuedAt: new Date().toISOString(),
  });
  await writeQueue(queue);
}

export async function syncToCloud(options = {}) {
  if (!isSyncProActive) {
    return {
      synced: 0,
      skipped: true,
      reason: "Cloud sync is a Pro feature",
    };
  }
  if (!isCloudSyncEnabled()) {
    return { synced: 0, skipped: true, reason: "API_BASE_URL is not set" };
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const queue = await readQueue();
  if (queue.length === 0) {
    return { synced: 0, skipped: false };
  }

  const remaining = [];
  let synced = 0;
  const errors = [];

  for (const item of queue) {
    try {
      const res = await fetch(`${API_BASE_URL}/sync/${item.resource}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: item.action, payload: item.payload }),
      });
      if (res.ok) {
        synced += 1;
      } else {
        remaining.push(item);
        errors.push({ id: item.id, status: res.status });
      }
    } catch (err) {
      remaining.push(item);
      errors.push({ id: item.id, error: String(err) });
    }
  }

  await writeQueue(remaining);

  return { synced, remaining: remaining.length, errors, skipped: false };
}

export async function getPendingSyncCount() {
  const queue = await readQueue();
  return queue.length;
}

export async function clearSyncQueue() {
  await writeQueue([]);
}
