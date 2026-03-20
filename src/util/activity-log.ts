import path from 'path';
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';

export const ACTIVITY_LOG_FILENAME = 'activity-log.jsonl';
export const ACTIVITY_LOG_MAX_LINES = 500;
export const ACTIVITY_LOG_DEFAULT_LIMIT = 50;

export type ActivityAction =
  | 'requested'
  | 'deleted'
  | 'cleanup'
  | 'bootstrapped'
  | 'skipped'
  | 'error'
  | 'sync_started'
  | 'sync_completed';

export interface ActivityEvent {
  timestamp: string;
  sourceUrl?: string;
  mode?: string;
  action: ActivityAction;
  itemName?: string;
  itemId?: string;
  tmdbId?: string;
  message?: string;
}

function getLogPath(dataDir: string): string {
  return path.join(dataDir, ACTIVITY_LOG_FILENAME);
}

// Module-level chain ensures serialized writes (runAllSources is single-threaded,
// but the server's /requeue endpoint could race — this prevents corruption).
let writeChain: Promise<void> = Promise.resolve();

async function doWrite(dataDir: string, event: ActivityEvent): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const logPath = getLogPath(dataDir);

  let existing = '';
  try {
    existing = await readFile(logPath, 'utf8');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const lines = existing.length > 0 ? existing.split('\n').filter(l => l.length > 0) : [];
  lines.push(JSON.stringify(event));

  if (lines.length > ACTIVITY_LOG_MAX_LINES) {
    // Ring-buffer: keep the most recent MAX_LINES entries
    const trimmed = lines.slice(lines.length - ACTIVITY_LOG_MAX_LINES);
    await writeFile(logPath, trimmed.join('\n') + '\n', 'utf8');
  } else {
    await appendFile(logPath, JSON.stringify(event) + '\n', 'utf8');
  }
}

export async function appendEvent(dataDir: string, event: ActivityEvent): Promise<void> {
  // Always continue the chain even if a prior write failed
  writeChain = writeChain
    .catch(() => {})
    .then(() => doWrite(dataDir, event));
  return writeChain;
}

export async function loadEvents(
  dataDir: string,
  limit: number = ACTIVITY_LOG_DEFAULT_LIMIT
): Promise<ActivityEvent[]> {
  try {
    const raw = await readFile(getLogPath(dataDir), 'utf8');
    const lines = raw.split('\n').filter(l => l.length > 0);
    const events = lines.map(l => JSON.parse(l) as ActivityEvent);
    // Return last `limit` events in reverse-chronological order
    return events.slice(-Math.min(limit, events.length)).reverse();
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}
