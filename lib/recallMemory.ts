// Client for `GET /api/memories/recall-positive` (Task #336). The
// server picks one memory by sentiment / starred / focus-area
// match; the client uses the fallback copy when the response is
// `{ memory: null }`.

import { getToken, AuthError } from "./auth";
import { resolveReplitApiBase } from "./config";

export interface RecallPositiveMemory {
  content: string;
  timestamp: string | null;
  reason: "sentiment" | "starred" | "focus_area" | "fallback";
}

export interface RecallPositiveResponse {
  memory: RecallPositiveMemory | null;
}

const TIMEOUT_MS = 8_000;

export async function fetchPositiveMemory(): Promise<RecallPositiveResponse> {
  const token = await getToken();
  if (!token) throw new AuthError("Not signed in", 401);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${resolveReplitApiBase()}/api/memories/recall-positive`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      throw new AuthError(
        `recall-positive HTTP ${res.status}`,
        res.status,
      );
    }
    const data = (await res.json()) as RecallPositiveResponse;
    if (!data || typeof data !== "object") return { memory: null };
    return data;
  } finally {
    clearTimeout(timer);
  }
}
