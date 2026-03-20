require('dotenv').config();


import Axios from 'axios';
import env from './util/env';
import logger from './util/logger';
import {
  detectListType,
  fetchMoviesFromUrl,
  getSyncModeForListType,
  LetterboxdMovie,
  SyncMode,
} from './scraper';
import { RssScraper } from './scraper/rss';
import {
  createMovieRequest,
  deleteMedia,
  deleteMediaFile,
  getMediaIdByTmdbId,
} from './api/seerr';
import { mountSentinelExists } from './util/mount';
import {
  createEmptyState,
  createStateItem,
  getOrCreateSourceState,
  getStateKey,
  loadState,
  LOGIC_RETRY_LIMIT,
  markAcknowledged,
  markCleanupPending,
  markRetryableItemFailure,
  markSkipped,
  markTransientItemFailure,
  saveState,
  shouldSkipAfterRetry,
  SourceState,
  SyncState,
  SyncStateItem,
} from './util/state';
import { appendEvent, ActivityEvent } from './util/activity-log';
import { startServer } from './server';

function getModeForUrl(url: string): SyncMode {
  const listType = detectListType(url);

  if (!listType) {
    throw new Error(`Unsupported URL format: ${url}`);
  }

  return getSyncModeForListType(listType);
}

function formatError(error: unknown): string {
  if (Axios.isAxiosError(error)) {
    const rawMessage =
      typeof error.response?.data === 'string'
        ? error.response.data
        : error.response?.data?.message;

    if (Array.isArray(rawMessage) && rawMessage.length > 0) {
      return rawMessage.join(', ');
    }

    if (typeof rawMessage === 'string' && rawMessage.length > 0) {
      return rawMessage;
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isServiceError(error: unknown): boolean {
  return Axios.isAxiosError(error);
}

function logBoundedRetryFailure(
  context: string,
  item: SyncStateItem,
  updatedItem: SyncStateItem
): void {
  if (updatedItem.status === 'skipped') {
    logger.error(
      `${context} for ${item.name}; capped at ${updatedItem.retryCount}/${LOGIC_RETRY_LIMIT} attempts. Manual review needed.`
    );
    return;
  }

  logger.warn(
    `${context} for ${item.name}; retry ${updatedItem.retryCount}/${LOGIC_RETRY_LIMIT}.`
  );
}

function applyBoundedRetryFailure(
  item: SyncStateItem,
  errorMessage: string,
  context: string
): SyncStateItem {
  const retryableItem = markRetryableItemFailure(item, errorMessage);
  const updatedItem = shouldSkipAfterRetry(retryableItem)
    ? markSkipped(retryableItem, errorMessage)
    : retryableItem;

  logBoundedRetryFailure(context, item, updatedItem);
  return updatedItem;
}

function upsertStateWithCurrentMovies(
  state: SourceState,
  movies: LetterboxdMovie[],
  mode: SyncMode,
  timestamp: string,
  diaryRedelete = false
): SourceState {
  const currentMovieKeys = new Set<string>();

  for (const movie of movies) {
    currentMovieKeys.add(getStateKey(movie.id));
  }

  const nextItems: SourceState['items'] = {};
  for (const [key, item] of Object.entries(state.items)) {
    if (item.status === 'cleanupPending') {
      nextItems[key] = { ...item };
      continue;
    }

    if (item.status === 'acknowledged' || item.status === 'skipped') {
      if (mode === 'delete') {
        if (!currentMovieKeys.has(key)) {
          // Item absent from feed — record that it genuinely left at least once
          nextItems[key] = { ...item, hasLeftFeed: true };
        } else if (diaryRedelete && item.hasLeftFeed) {
          // Back in feed after a confirmed absence — user re-logged it, re-delete
          nextItems[key] = { ...item, status: 'pending', retryCount: 0, lastError: null };
        } else {
          // Continuously in top-50 or hasn't left since last acknowledgment — keep tombstone
          nextItems[key] = { ...item };
        }
      } else if (currentMovieKeys.has(key)) {
        // Request-mode: only retain while still in feed
        nextItems[key] = { ...item };
      }
      continue;
    }

    if (currentMovieKeys.has(key)) {
      nextItems[key] = { ...item };
    } else if (item.retryCount > 0) {
      logger.warn(
        `Pending item ${item.name} (retryCount: ${item.retryCount}) disappeared from the source feed and will not be retried.`
      );
    }
  }

  for (const movie of movies) {
    const key = getStateKey(movie.id);
    const existingItem = nextItems[key];

    if (!existingItem) {
      nextItems[key] = createStateItem(movie, timestamp);
      continue;
    }

    nextItems[key] = {
      ...existingItem,
      name: movie.name,
      slug: movie.slug,
      tmdbId: movie.tmdbId ?? null,
      lastSeenAt: timestamp,
    };
  }

  return {
    ...state,
    mode,
    items: nextItems,
  };
}

function buildCurrentMovieMap(movies: LetterboxdMovie[]): Map<string, LetterboxdMovie> {
  return new Map(movies.map(movie => [getStateKey(movie.id), movie]));
}

// Emit an activity event; errors are caught and logged so sync is never blocked.
async function logEvent(event: ActivityEvent): Promise<void> {
  await appendEvent(env.DATA_DIR, event).catch(err => {
    logger.error(`Failed to write activity event: ${err}`);
  });
}

async function runRequestMode(
  state: SourceState,
  currentMovieMap: Map<string, LetterboxdMovie>,
  timestamp: string
): Promise<SourceState> {
  const nextState: SourceState = {
    ...state,
    items: { ...state.items },
  };

  for (const [key, item] of Object.entries(nextState.items)) {
    if (item.status !== 'pending' || !currentMovieMap.has(key)) {
      continue;
    }

    const movie = currentMovieMap.get(key)!;
    if (!movie.tmdbId) {
      nextState.items[key] = applyBoundedRetryFailure(
        item,
        'TMDb ID is missing',
        'Per-item failure (TMDb missing)'
      );
      const updated = nextState.items[key];
      await logEvent({
        timestamp,
        sourceUrl: state.url,
        mode: state.mode,
        action: updated.status === 'skipped' ? 'skipped' : 'error',
        itemName: item.name,
        itemId: String(item.id),
        message: 'TMDb ID is missing',
      });
      continue;
    }

    try {
      const result = await createMovieRequest(movie.tmdbId);
      nextState.items[key] = markAcknowledged(item);

      if (result === 'alreadyExists') {
        logger.info(`Seerr request already exists for ${movie.name}. Marking as acknowledged.`);
      } else {
        logger.info(`Successfully created Seerr request for ${movie.name} (TMDb: ${movie.tmdbId}).`);
      }

      await logEvent({
        timestamp,
        sourceUrl: state.url,
        mode: state.mode,
        action: 'requested',
        itemName: movie.name,
        itemId: String(movie.id),
        tmdbId: movie.tmdbId,
      });
    } catch (error) {
      const errorMessage = formatError(error);
      if (isServiceError(error)) {
        nextState.items[key] = markTransientItemFailure(item, errorMessage);
        logger.error(
          `Service failure while requesting ${movie.name} in Seerr. Item will remain retryable. ${errorMessage}`
        );
        await logEvent({
          timestamp,
          sourceUrl: state.url,
          mode: state.mode,
          action: 'error',
          itemName: movie.name,
          itemId: String(movie.id),
          tmdbId: movie.tmdbId ?? undefined,
          message: errorMessage,
        });
        continue;
      }

      throw error;
    }
  }

  return nextState;
}

async function runCleanupPendingItems(state: SourceState, timestamp: string): Promise<SourceState> {
  const nextState: SourceState = {
    ...state,
    items: { ...state.items },
  };

  for (const [key, item] of Object.entries(nextState.items)) {
    if (item.status !== 'cleanupPending') {
      continue;
    }

    if (!item.seerrMediaId) {
      nextState.items[key] = markSkipped(item, 'cleanupPending item is missing Seerr media ID');
      logger.error(
        `cleanupPending item ${item.name} is missing a Seerr media ID. Marking as skipped for manual review.`
      );
      await logEvent({
        timestamp,
        sourceUrl: state.url,
        mode: state.mode,
        action: 'skipped',
        itemName: item.name,
        itemId: String(item.id),
        message: 'cleanupPending item is missing Seerr media ID',
      });
      continue;
    }

    try {
      const result = await deleteMedia(item.seerrMediaId);
      nextState.items[key] = markAcknowledged(item);

      if (result === 'notFound') {
        logger.info(
          `Seerr media record for cleanupPending item ${item.name} was already gone. Marking as acknowledged.`
        );
      } else {
        logger.info(`Successfully completed Seerr cleanup for ${item.name}.`);
      }

      await logEvent({
        timestamp,
        sourceUrl: state.url,
        mode: state.mode,
        action: 'cleanup',
        itemName: item.name,
        itemId: String(item.id),
        tmdbId: item.tmdbId ?? undefined,
      });
    } catch (error) {
      nextState.items[key] = markTransientItemFailure(item, formatError(error));
      logger.error(
        `Service failure while retrying Seerr cleanup for ${item.name}. Item remains cleanupPending. ${formatError(error)}`
      );
    }
  }

  return nextState;
}

async function runDeleteMode(
  state: SourceState,
  currentMovieMap: Map<string, LetterboxdMovie>,
  timestamp: string
): Promise<SourceState> {
  let nextState = await runCleanupPendingItems(state, timestamp);
  const pendingDeleteKeys = Object.entries(nextState.items)
    .filter(([key, item]) => item.status === 'pending' && currentMovieMap.has(key))
    .map(([key]) => key);

  if (pendingDeleteKeys.length === 0) {
    return nextState;
  }

  const sentinelExists = await mountSentinelExists(env.MEDIA_MOUNT_SENTINEL);
  if (!sentinelExists) {
    logger.error(
      `Mount safety failed: ${env.MEDIA_MOUNT_SENTINEL} does not exist. Skipping Radarr deletes and leaving items pending.`
    );
    return nextState;
  }

  for (const key of pendingDeleteKeys) {
    const item = nextState.items[key];
    const movie = currentMovieMap.get(key);

    if (!item || !movie) {
      continue;
    }

    if (!movie.tmdbId) {
      nextState.items[key] = applyBoundedRetryFailure(
        item,
        'TMDb ID is missing',
        'Per-item failure (TMDb missing)'
      );
      const updated = nextState.items[key];
      await logEvent({
        timestamp,
        sourceUrl: state.url,
        mode: state.mode,
        action: updated.status === 'skipped' ? 'skipped' : 'error',
        itemName: item.name,
        itemId: String(item.id),
        message: 'TMDb ID is missing',
      });
      continue;
    }

    try {
      const mediaId = await getMediaIdByTmdbId(movie.tmdbId);
      if (!mediaId) {
        logger.info(
          `${movie.name} (TMDb: ${movie.tmdbId}) is not tracked in Seerr. Marking as acknowledged.`
        );
        nextState.items[key] = markAcknowledged(item);
        await logEvent({
          timestamp,
          sourceUrl: state.url,
          mode: state.mode,
          action: 'deleted',
          itemName: movie.name,
          itemId: String(movie.id),
          tmdbId: movie.tmdbId,
          message: 'Not tracked in Seerr',
        });
        continue;
      }

      await deleteMediaFile(mediaId);
      logger.info(`Successfully deleted ${movie.name} from Radarr via Seerr.`);

      try {
        const cleanupResult = await deleteMedia(mediaId);
        nextState.items[key] = markAcknowledged(item);

        if (cleanupResult === 'notFound') {
          logger.info(
            `Seerr media record for ${movie.name} was already gone. Marking as acknowledged.`
          );
        } else {
          logger.info(`Successfully removed ${movie.name} from Seerr.`);
        }

        await logEvent({
          timestamp,
          sourceUrl: state.url,
          mode: state.mode,
          action: 'deleted',
          itemName: movie.name,
          itemId: String(movie.id),
          tmdbId: movie.tmdbId,
        });
      } catch (error) {
        nextState.items[key] = markCleanupPending(item, formatError(error), mediaId);
        logger.error(
          `Radarr delete succeeded for ${movie.name}, but Seerr record cleanup failed. Marking item cleanupPending. ${formatError(error)}`
        );
        await logEvent({
          timestamp,
          sourceUrl: state.url,
          mode: state.mode,
          action: 'error',
          itemName: movie.name,
          itemId: String(movie.id),
          tmdbId: movie.tmdbId,
          message: formatError(error),
        });
      }
    } catch (error) {
      const errorMessage = formatError(error);
      if (isServiceError(error)) {
        nextState.items[key] = markTransientItemFailure(item, errorMessage);
        logger.error(
          `Service failure while deleting ${movie.name} from Radarr/Seerr. Item remains retryable. ${errorMessage}`
        );
        await logEvent({
          timestamp,
          sourceUrl: state.url,
          mode: state.mode,
          action: 'error',
          itemName: movie.name,
          itemId: String(movie.id),
          tmdbId: movie.tmdbId ?? undefined,
          message: errorMessage,
        });
        continue;
      }

      throw error;
    }
  }

  return nextState;
}

function logDryRun(
  mode: SyncMode,
  state: SourceState,
  currentMovieMap: Map<string, LetterboxdMovie>,
  isFirstRun: boolean
): void {
  logger.info(`[DRY RUN] Running ${mode} mode${isFirstRun ? ' (first run)' : ''}.`);

  if (mode === 'request') {
    for (const [key, item] of Object.entries(state.items)) {
      if (item.status !== 'pending' || !currentMovieMap.has(key)) {
        continue;
      }

      const movie = currentMovieMap.get(key)!;
      if (!movie.tmdbId) {
        logger.info(`[DRY RUN] Would retry TMDb resolution for ${movie.name}.`);
      } else {
        logger.info(`[DRY RUN] Would create Seerr request for ${movie.name} (TMDb: ${movie.tmdbId}).`);
      }
    }

    return;
  }

  for (const item of Object.values(state.items)) {
    if (item.status === 'cleanupPending') {
      logger.info(`[DRY RUN] Would retry Seerr cleanup for ${item.name} (TMDb: ${item.tmdbId}).`);
    }
  }

  for (const [key, item] of Object.entries(state.items)) {
    if (item.status !== 'pending' || !currentMovieMap.has(key)) {
      continue;
    }

    const movie = currentMovieMap.get(key)!;
    if (!movie.tmdbId) {
      logger.info(`[DRY RUN] Would retry TMDb resolution for ${movie.name}.`);
    } else {
      logger.info(`[DRY RUN] Would delete ${movie.name} from Radarr, then clean up Seerr request.`);
    }
  }
}

function checkCrossSourceOverlap(
  globalState: SyncState,
  currentUrl: string,
  currentMovieMap: Map<string, LetterboxdMovie>
): void {
  for (const [url, sourceState] of Object.entries(globalState.sources)) {
    if (url === currentUrl) continue;

    for (const [key, item] of Object.entries(sourceState.items)) {
      if (item.status === 'pending' && currentMovieMap.has(key)) {
        const movie = currentMovieMap.get(key)!;
        logger.warn(
          `Cross-source overlap detected: ${movie.name} is pending in ${url} and also present in ${currentUrl}. Both sources will process it independently.`
        );
      }
    }
  }
}

export async function runAllSources(): Promise<void> {
  const timestamp = new Date().toISOString();
  let globalState = (await loadState(env.DATA_DIR, env.letterboxdUrls[0])) ?? createEmptyState();
  let shouldSave = false;

  await logEvent({ timestamp, action: 'sync_started', message: 'Sync started' });

  try {
    for (const url of env.letterboxdUrls) {
      const mode = getModeForUrl(url);
      const existingSource = globalState.sources[url];
      const isFirstRun = !existingSource || existingSource.mode !== mode;

      if (existingSource && existingSource.mode !== mode) {
        logger.warn(
          `Mode mismatch for ${url}: stored state has mode ${existingSource.mode} but URL resolves to ${mode}. Resetting source state.`
        );
      }

      let sourceState = getOrCreateSourceState(globalState, url, mode);

      let movies: LetterboxdMovie[];
      let newRssEtag: string | null | undefined;

      try {
        if (mode === 'delete') {
          const rssScraper = new RssScraper(url);
          const result = await rssScraper.getMovies(sourceState.rssEtag);
          if (result === null) {
            logger.debug(`RSS feed for ${url} unchanged (304). Skipping source.`);
            continue;
          }
          movies = result.movies;
          newRssEtag = result.etag;
        } else {
          movies = await fetchMoviesFromUrl(url);
        }
      } catch (fetchError) {
        const errorMessage = formatError(fetchError);
        logger.error(`Failed to fetch source ${url}: ${errorMessage}. Skipping this source.`);
        await logEvent({
          timestamp,
          sourceUrl: url,
          mode,
          action: 'error',
          message: `Failed to fetch source: ${errorMessage}`,
        });
        continue;
      }

      const currentMovieMap = buildCurrentMovieMap(movies);

      sourceState = upsertStateWithCurrentMovies(sourceState, movies, mode, timestamp, env.DIARY_REDELETE);

      if (newRssEtag !== undefined) {
        sourceState = { ...sourceState, rssEtag: newRssEtag };
      }

      if (mode === 'delete' && isFirstRun) {
        const bootstrappedItems = Object.entries(sourceState.items).reduce<SourceState['items']>(
          (items, [key, item]) => {
            items[key] = markAcknowledged(item);
            return items;
          },
          {}
        );

        sourceState = { ...sourceState, items: bootstrappedItems };
        logger.info(
          `Delete mode first run for ${url}. Bootstrapping ${movies.length} items without deleting historical entries.`
        );

        await logEvent({
          timestamp,
          sourceUrl: url,
          mode,
          action: 'bootstrapped',
          message: `Bootstrapped ${movies.length} items`,
        });

        globalState = {
          ...globalState,
          sources: { ...globalState.sources, [url]: sourceState },
        };
        await saveState(env.DATA_DIR, globalState);

        if (env.DRY_RUN) {
          logDryRun(mode, sourceState, currentMovieMap, true);
        }

        continue;
      }

      if (env.DRY_RUN) {
        logDryRun(mode, sourceState, currentMovieMap, isFirstRun);
        continue;
      }

      checkCrossSourceOverlap(globalState, url, currentMovieMap);

      const nextSourceState = mode === 'request'
        ? await runRequestMode(sourceState, currentMovieMap, timestamp)
        : await runDeleteMode(sourceState, currentMovieMap, timestamp);

      globalState = {
        ...globalState,
        sources: { ...globalState.sources, [url]: nextSourceState },
      };
      shouldSave = true;
    }

    if (shouldSave) {
      await saveState(env.DATA_DIR, globalState);
    }
  } finally {
    await logEvent({ timestamp: new Date().toISOString(), action: 'sync_completed', message: 'Sync completed' });
  }
}

function startScheduledMonitoring(): void {
  const intervalMs = env.CHECK_INTERVAL_MINUTES * 60 * 1000;

  logger.info(`Starting scheduled monitoring. Will check every ${env.CHECK_INTERVAL_MINUTES} minutes.`);

  // Run immediately on startup
  runAllSources().catch(error => {
    logger.error(error);
  });

  // Then run on interval
  setInterval(async () => {
    try {
      await runAllSources();
    } catch (error) {
      logger.error(error);
    }
  }, intervalMs);
}

export async function main() {
  startScheduledMonitoring();
  startServer(env.PORT, runAllSources);
}

export { startScheduledMonitoring };

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error(error);
  });
}
