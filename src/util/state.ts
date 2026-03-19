import path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { LetterboxdMovie, SyncMode } from '../scraper';

export const SYNC_STATE_VERSION = 2;
export const SYNC_STATE_FILENAME = 'sync-state.json';
export const LOGIC_RETRY_LIMIT = 3;

export type SyncStateItemStatus =
  | 'pending'
  | 'cleanupPending'
  | 'acknowledged'
  | 'skipped';

export interface SyncStateItem {
  id: number;
  name: string;
  slug: string;
  tmdbId?: string | null;
  seerrMediaId?: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  retryCount: number;
  status: SyncStateItemStatus;
  lastError: string | null;
}

export interface SourceState {
  url: string;
  mode: SyncMode;
  rssEtag?: string | null;
  items: Record<string, SyncStateItem>;
}

export interface SyncStateV1 {
  version: number;
  mode: SyncMode;
  rssEtag?: string | null;
  items: Record<string, SyncStateItem>;
}

export interface SyncStateV2 {
  version: 2;
  sources: Record<string, SourceState>;
}

export type SyncState = SyncStateV2;

export function createEmptyState(): SyncStateV2 {
  return {
    version: 2,
    sources: {},
  };
}

export function migrateV1toV2(v1: SyncStateV1, url: string): SyncStateV2 {
  return {
    version: 2,
    sources: {
      [url]: {
        url,
        mode: v1.mode,
        rssEtag: v1.rssEtag ?? null,
        items: v1.items,
      },
    },
  };
}

export function getOrCreateSourceState(state: SyncStateV2, url: string, mode: SyncMode): SourceState {
  const existing = state.sources[url];
  if (existing && existing.mode === mode) {
    return existing;
  }
  return { url, mode, items: {} };
}

export function getStateFilePath(dataDir: string): string {
  return path.join(dataDir, SYNC_STATE_FILENAME);
}

export async function loadState(dataDir: string, migrateUrl?: string): Promise<SyncState | null> {
  try {
    const raw = await readFile(getStateFilePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed.version === 2) {
      return parsed as SyncStateV2;
    }

    // V1 migration: wrap single-source state into V2 structure
    if (migrateUrl) {
      return migrateV1toV2(parsed as SyncStateV1, migrateUrl);
    }

    return null;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function saveState(dataDir: string, state: SyncState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    getStateFilePath(dataDir),
    JSON.stringify(state, null, 2),
    'utf8'
  );
}

export function getStateKey(id: number): string {
  return String(id);
}

export function createStateItem(movie: LetterboxdMovie, timestamp: string): SyncStateItem {
  return {
    id: movie.id,
    name: movie.name,
    slug: movie.slug,
    tmdbId: movie.tmdbId ?? null,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    retryCount: 0,
    status: 'pending',
    lastError: null,
  };
}

export function markAcknowledged(item: SyncStateItem): SyncStateItem {
  return {
    ...item,
    status: 'acknowledged',
    lastError: null,
  };
}

export function markCleanupPending(
  item: SyncStateItem,
  errorMessage: string,
  seerrMediaId?: number
): SyncStateItem {
  return {
    ...item,
    status: 'cleanupPending',
    lastError: errorMessage,
    seerrMediaId: seerrMediaId ?? item.seerrMediaId ?? null,
  };
}

export function markSkipped(
  item: SyncStateItem,
  errorMessage: string
): SyncStateItem {
  return {
    ...item,
    status: 'skipped',
    lastError: errorMessage,
  };
}

export function markRetryableItemFailure(
  item: SyncStateItem,
  errorMessage: string
): SyncStateItem {
  return {
    ...item,
    status: 'pending',
    retryCount: item.retryCount + 1,
    lastError: errorMessage,
  };
}

export function markTransientItemFailure(
  item: SyncStateItem,
  errorMessage: string
): SyncStateItem {
  return {
    ...item,
    status: item.status,
    lastError: errorMessage,
  };
}

export function shouldSkipAfterRetry(item: SyncStateItem): boolean {
  return item.retryCount >= LOGIC_RETRY_LIMIT;
}
