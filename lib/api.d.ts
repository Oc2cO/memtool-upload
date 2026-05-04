export const API_BASE_URL: string | null;
export function setApiBaseUrl(url: string | null): void;
export function getApiBaseUrl(): string | null;
export function isCloudSyncEnabled(): boolean;
export function setSyncProActive(active: boolean): void;
export function isSyncProActiveForTesting(): boolean;
export function queueChange(
  resource: string,
  action: string,
  payload: unknown,
): Promise<void>;
export function syncToCloud(options?: {
  headers?: Record<string, string>;
}): Promise<{
  synced: number;
  remaining?: number;
  errors?: Array<{ id: string; status?: number; error?: string }>;
  skipped: boolean;
  reason?: string;
}>;
export function getPendingSyncCount(): Promise<number>;
export function clearSyncQueue(): Promise<void>;
