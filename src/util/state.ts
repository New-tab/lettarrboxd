import path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { LetterboxdMovie, SyncMode } from '../scraper';

export const SYNC_STATE_VERSION = 1;
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

export interface SyncState {
  version: number;
  mode: SyncMode;
  rssEtag?: string | null;
  items: Record<string, SyncStateItem>;
}

export function createEmptyState(mode: SyncMode): SyncState {
  return {
    version: SYNC_STATE_VERSION,
    mode,
    items: {},
  };
}

export function getStateFilePath(dataDir: string): string {
  return path.join(dataDir, SYNC_STATE_FILENAME);
}

export async function loadState(dataDir: string): Promise<SyncState | null> {
  try {
    const raw = await readFile(getStateFilePath(dataDir), 'utf8');
    return JSON.parse(raw) as SyncState;
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
