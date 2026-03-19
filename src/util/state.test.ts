import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  createEmptyState,
  createStateItem,
  getOrCreateSourceState,
  getStateFilePath,
  getStateKey,
  LOGIC_RETRY_LIMIT,
  markAcknowledged,
  markCleanupPending,
  markRetryableItemFailure,
  markSkipped,
  markTransientItemFailure,
  migrateV1toV2,
  loadState,
  saveState,
  shouldSkipAfterRetry,
  SyncStateV1,
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

  it('creates empty V2 state with no sources', () => {
    expect(createEmptyState()).toEqual({
      version: 2,
      sources: {},
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

  describe('migrateV1toV2', () => {
    it('wraps a V1 state into a single-source V2 structure', () => {
      const v1: SyncStateV1 = {
        version: 1,
        mode: 'request',
        items: {
          '1': {
            id: 1,
            name: 'Movie 1',
            slug: '/film/movie-1/',
            tmdbId: '123',
            seerrMediaId: null,
            firstSeenAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: '2026-01-01T00:00:00.000Z',
            retryCount: 0,
            status: 'acknowledged',
            lastError: null,
          },
        },
      };

      const url = 'https://letterboxd.com/user/watchlist';
      const v2 = migrateV1toV2(v1, url);

      expect(v2).toEqual({
        version: 2,
        sources: {
          [url]: {
            url,
            mode: 'request',
            rssEtag: null,
            items: v1.items,
          },
        },
      });
    });

    it('preserves rssEtag during migration', () => {
      const v1: SyncStateV1 = {
        version: 1,
        mode: 'delete',
        rssEtag: '"etag-abc"',
        items: {},
      };

      const url = 'https://letterboxd.com/user/films/diary/';
      const v2 = migrateV1toV2(v1, url);

      expect(v2.sources[url].rssEtag).toBe('"etag-abc"');
    });
  });

  describe('loadState', () => {
    let dataDir: string;

    beforeEach(async () => {
      dataDir = await mkdtemp(path.join(os.tmpdir(), 'seerrboxd-state-test-'));
    });

    afterEach(async () => {
      await rm(dataDir, { recursive: true, force: true });
    });

    it('returns null when state file does not exist', async () => {
      expect(await loadState(dataDir)).toBeNull();
    });

    it('loads V2 state as-is', async () => {
      const state = {
        version: 2,
        sources: {
          'https://letterboxd.com/user/watchlist': {
            url: 'https://letterboxd.com/user/watchlist',
            mode: 'request',
            items: {},
          },
        },
      };
      await writeFile(path.join(dataDir, 'sync-state.json'), JSON.stringify(state), 'utf8');

      const loaded = await loadState(dataDir);
      expect(loaded).toEqual(state);
    });

    it('auto-migrates V1 state when migrateUrl is provided', async () => {
      const v1 = { version: 1, mode: 'delete', rssEtag: '"etag-1"', items: {} };
      await writeFile(path.join(dataDir, 'sync-state.json'), JSON.stringify(v1), 'utf8');

      const url = 'https://letterboxd.com/user/films/diary/';
      const loaded = await loadState(dataDir, url);

      expect(loaded).toEqual({
        version: 2,
        sources: {
          [url]: { url, mode: 'delete', rssEtag: '"etag-1"', items: {} },
        },
      });
    });

    it('returns null for V1 state when no migrateUrl is provided', async () => {
      const v1 = { version: 1, mode: 'request', items: {} };
      await writeFile(path.join(dataDir, 'sync-state.json'), JSON.stringify(v1), 'utf8');

      expect(await loadState(dataDir)).toBeNull();
    });
  });

  describe('getOrCreateSourceState', () => {
    it('returns existing source state when mode matches', () => {
      const existing = {
        url: 'https://letterboxd.com/user/watchlist',
        mode: 'request' as const,
        items: { '1': createStateItem(movie, '2026-01-01T00:00:00.000Z') },
      };
      const state = { version: 2 as const, sources: { 'https://letterboxd.com/user/watchlist': existing } };

      const result = getOrCreateSourceState(state, 'https://letterboxd.com/user/watchlist', 'request');
      expect(result).toBe(existing);
    });

    it('creates new source state when URL is not in sources', () => {
      const state = createEmptyState();
      const url = 'https://letterboxd.com/user/watchlist';

      const result = getOrCreateSourceState(state, url, 'request');
      expect(result).toEqual({ url, mode: 'request', items: {} });
    });

    it('creates new source state when mode does not match existing', () => {
      const existing = {
        url: 'https://letterboxd.com/user/watchlist',
        mode: 'delete' as const,
        items: {},
      };
      const state = { version: 2 as const, sources: { 'https://letterboxd.com/user/watchlist': existing } };

      const result = getOrCreateSourceState(state, 'https://letterboxd.com/user/watchlist', 'request');
      expect(result).toEqual({ url: 'https://letterboxd.com/user/watchlist', mode: 'request', items: {} });
    });
  });

  describe('saveState / loadState round-trip', () => {
    let dataDir: string;

    beforeEach(async () => {
      dataDir = await mkdtemp(path.join(os.tmpdir(), 'seerrboxd-state-test-'));
    });

    afterEach(async () => {
      await rm(dataDir, { recursive: true, force: true });
    });

    it('persists and reloads V2 state correctly', async () => {
      const state = createEmptyState();
      await saveState(dataDir, state);

      const loaded = await loadState(dataDir);
      expect(loaded).toEqual(state);
    });
  });
});
