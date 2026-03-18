import {
  createEmptyState,
  createStateItem,
  getStateFilePath,
  getStateKey,
  LOGIC_RETRY_LIMIT,
  markAcknowledged,
  markCleanupPending,
  markRetryableItemFailure,
  markSkipped,
  markTransientItemFailure,
  shouldSkipAfterRetry,
} from './state';

describe('state utilities', () => {
  const movie = {
    id: 1,
    name: 'Movie 1',
    slug: '/film/movie-1/',
    tmdbId: '123',
    imdbId: null,
    publishedYear: null,
  };

  it('creates empty state objects', () => {
    expect(createEmptyState('request')).toEqual({
      version: 1,
      mode: 'request',
      items: {},
    });
  });

  it('creates state items from movies', () => {
    const item = createStateItem(movie, '2026-01-01T00:00:00.000Z');

    expect(item).toEqual({
      id: 1,
      name: 'Movie 1',
      slug: '/film/movie-1/',
      tmdbId: '123',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
      status: 'pending',
      lastError: null,
    });
  });

  it('increments retryable failures and skips at the retry cap', () => {
    let item = createStateItem(movie, '2026-01-01T00:00:00.000Z');

    item = markRetryableItemFailure(item, 'missing tmdb');
    item = markRetryableItemFailure(item, 'missing tmdb');
    item = markRetryableItemFailure(item, 'missing tmdb');

    expect(item.retryCount).toBe(LOGIC_RETRY_LIMIT);
    expect(shouldSkipAfterRetry(item)).toBe(true);
  });

  it('marks item status transitions', () => {
    const item = createStateItem(movie, '2026-01-01T00:00:00.000Z');
    const statuses = new Set([
      item.status,
      markAcknowledged(item).status,
      markCleanupPending(item, 'cleanup failed').status,
      markSkipped(item, 'manual review').status,
    ]);

    expect(statuses).toEqual(
      new Set(['pending', 'acknowledged', 'cleanupPending', 'skipped'])
    );
    expect(markTransientItemFailure(item, 'service error').lastError).toBe('service error');
  });

  it('builds state keys and isolated file paths per data directory', () => {
    expect(getStateKey(123)).toBe('123');
    expect(getStateFilePath('/tmp/data')).toBe('/tmp/data/sync-state.json');
    expect(getStateFilePath('/tmp/instance-a')).toBe('/tmp/instance-a/sync-state.json');
    expect(getStateFilePath('/tmp/instance-b')).toBe('/tmp/instance-b/sync-state.json');
    expect(getStateFilePath('/tmp/instance-a')).not.toBe(getStateFilePath('/tmp/instance-b'));
  });
});
