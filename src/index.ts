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
import {
  deleteMovieById,
  findMovieByTmdbId,
} from './api/radarr';
import {
  createMovieRequest,
  deleteMovieRequestByTmdbId,
} from './api/seerr';
import { mountSentinelExists } from './util/mount';
import {
  createEmptyState,
  createStateItem,
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
  SyncState,
  SyncStateItem,
} from './util/state';

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
  state: SyncState,
  movies: LetterboxdMovie[],
  mode: SyncMode,
  timestamp: string
) {
  const currentMovieKeys = new Set<string>();

  for (const movie of movies) {
    currentMovieKeys.add(getStateKey(movie.id));
  }

  const nextItems: SyncState['items'] = {};
  for (const [key, item] of Object.entries(state.items)) {
    if (item.status === 'cleanupPending') {
      nextItems[key] = { ...item };
      continue;
    }

    if (item.status === 'acknowledged' || item.status === 'skipped') {
      nextItems[key] = { ...item };
      continue;
    }

    if (currentMovieKeys.has(key)) {
      nextItems[key] = { ...item };
    } else if (item.retryCount > 0) {
      logger.warn(
        `Pending item ${item.name} (retryCount: ${item.retryCount}) disappeared from the source HTML and will not be retried.`
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

async function runRequestMode(
  state: SyncState,
  currentMovieMap: Map<string, LetterboxdMovie>
): Promise<SyncState> {
  const nextState: SyncState = {
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
    } catch (error) {
      const errorMessage = formatError(error);
      if (isServiceError(error)) {
        nextState.items[key] = markTransientItemFailure(item, errorMessage);
        logger.error(
          `Service failure while requesting ${movie.name} in Seerr. Item will remain retryable. ${errorMessage}`
        );
        continue;
      }

      throw error;
    }
  }

  return nextState;
}

async function runCleanupPendingItems(state: SyncState): Promise<SyncState> {
  const nextState: SyncState = {
    ...state,
    items: { ...state.items },
  };

  for (const [key, item] of Object.entries(nextState.items)) {
    if (item.status !== 'cleanupPending') {
      continue;
    }

    if (!item.tmdbId) {
      nextState.items[key] = markSkipped(item, 'cleanupPending item is missing TMDb ID');
      logger.error(
        `cleanupPending item ${item.name} is missing a TMDb ID. Marking as skipped for manual review.`
      );
      continue;
    }

    try {
      const result = await deleteMovieRequestByTmdbId(item.tmdbId);
      nextState.items[key] = markAcknowledged(item);

      if (result === 'notFound') {
        logger.info(
          `No matching Seerr request found for cleanupPending item ${item.name}. Marking as acknowledged.`
        );
      } else {
        logger.info(`Successfully completed Seerr cleanup for ${item.name}.`);
      }
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
  state: SyncState,
  currentMovieMap: Map<string, LetterboxdMovie>
): Promise<SyncState> {
  let nextState = await runCleanupPendingItems(state);
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
      continue;
    }

    try {
      const radarrMovie = await findMovieByTmdbId(movie.tmdbId);
      if (!radarrMovie) {
        nextState.items[key] = applyBoundedRetryFailure(
          item,
          `No Radarr movie found for TMDb ${movie.tmdbId}`,
          'Per-item failure (Radarr match missing)'
        );
        continue;
      }

      await deleteMovieById(radarrMovie.id);
      logger.info(
        `Successfully deleted ${movie.name} from Radarr first. Proceeding to Seerr cleanup.`
      );

      try {
        const cleanupResult = await deleteMovieRequestByTmdbId(movie.tmdbId);
        nextState.items[key] = markAcknowledged(item);

        if (cleanupResult === 'notFound') {
          logger.info(
            `No matching Seerr request found for ${movie.name} after Radarr delete. Marking as acknowledged.`
          );
        } else {
          logger.info(`Successfully deleted matching Seerr request for ${movie.name}.`);
        }
      } catch (error) {
        nextState.items[key] = markCleanupPending(item, formatError(error));
        logger.error(
          `Radarr delete succeeded for ${movie.name}, but Seerr cleanup failed. Marking item cleanupPending. ${formatError(error)}`
        );
      }
    } catch (error) {
      const errorMessage = formatError(error);
      if (isServiceError(error)) {
        nextState.items[key] = markTransientItemFailure(item, errorMessage);
        logger.error(
          `Service failure while deleting ${movie.name} from Radarr/Seerr. Item remains retryable. ${errorMessage}`
        );
        continue;
      }

      throw error;
    }
  }

  return nextState;
}

function logDryRun(
  mode: SyncMode,
  state: SyncState,
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

async function run() {
  const mode = getModeForUrl(env.LETTERBOXD_URL);
  const movies = await fetchMoviesFromUrl(env.LETTERBOXD_URL);
  const currentMovieMap = buildCurrentMovieMap(movies);
  const timestamp = new Date().toISOString();
  const loadedState = await loadState(env.DATA_DIR);
  const isFirstRun = !loadedState || loadedState.mode !== mode;

  if (loadedState && loadedState.mode !== mode) {
    logger.warn(
      `State mode ${loadedState.mode} does not match current mode ${mode}. Resetting state for this data directory.`
    );
  }

  let state = loadedState && loadedState.mode === mode
    ? loadedState
    : createEmptyState(mode);

  state = upsertStateWithCurrentMovies(state, movies, mode, timestamp);

  if (mode === 'delete' && isFirstRun) {
    const bootstrappedState: SyncState = {
      ...state,
      items: Object.entries(state.items).reduce<SyncState['items']>((items, [key, item]) => {
        items[key] = markAcknowledged(item);
        return items;
      }, {}),
    };

    if (env.DRY_RUN) {
      logDryRun(mode, bootstrappedState, currentMovieMap, true);
      return;
    }

    logger.info(
      `Delete mode first run detected. Bootstrapping ${movies.length} items without deleting historical entries.`
    );
    await saveState(env.DATA_DIR, bootstrappedState);
    return;
  }

  if (env.DRY_RUN) {
    logDryRun(mode, state, currentMovieMap, isFirstRun);
    return;
  }

  const nextState = mode === 'request'
    ? await runRequestMode(state, currentMovieMap)
    : await runDeleteMode(state, currentMovieMap);

  await saveState(env.DATA_DIR, nextState);
}

function startScheduledMonitoring(): void {
  const intervalMs = env.CHECK_INTERVAL_MINUTES * 60 * 1000;

  logger.info(`Starting scheduled monitoring. Will check every ${env.CHECK_INTERVAL_MINUTES} minutes.`);

  // Run immediately on startup
  run().catch(error => {
    logger.error(error);
  });

  // Then run on interval
  setInterval(async () => {
    try {
      await run();
    } catch (error) {
      logger.error(error);
    }
  }, intervalMs);
}

export async function main() {
  startScheduledMonitoring();
}

export { startScheduledMonitoring };

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error(error);
  });
}
