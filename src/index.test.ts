import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('./util/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('./scraper', () => ({
  detectListType: jest.fn(),
  fetchMoviesFromUrl: jest.fn(),
  getSyncModeForListType: jest.fn(),
}));

jest.mock('./api/seerr', () => ({
  createMovieRequest: jest.fn(),
  getMediaIdByTmdbId: jest.fn(),
  deleteMediaFile: jest.fn(),
  deleteMedia: jest.fn(),
}));

jest.mock('./util/mount', () => ({
  mountSentinelExists: jest.fn(),
}));

jest.mock('./scraper/rss', () => ({
  RssScraper: jest.fn(),
}));

jest.mock('./server', () => ({
  startServer: jest.fn(),
}));

describe('main application', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let dataDir: string;
  let setIntervalSpy: jest.SpyInstance;
  let saveStateSpy: jest.SpyInstance;
  let startScheduledMonitoring: () => void;
  let scraperModule: any;
  let seerrModule: any;
  let mountModule: any;
  let stateModule: any;
  let rssModule: any;

  const WATCHLIST_URL = 'https://letterboxd.com/user/watchlist';
  const DELETE_URL = 'https://letterboxd.com/user/films';
  const DIARY_URL = 'https://letterboxd.com/user/films/diary';
  const LIST_URL = 'https://letterboxd.com/user/list/some-list/';

  const createMovie = (
    overrides: Partial<{
      id: number;
      name: string;
      slug: string;
      tmdbId: string | null;
      imdbId: string | null;
      publishedYear: number | null;
    }> = {}
  ) => ({
    id: 1,
    name: 'Movie 1',
    slug: '/film/movie-1/',
    tmdbId: '123',
    imdbId: null,
    publishedYear: null,
    ...overrides,
  });

  const createSavedItem = (
    overrides: Partial<{
      id: number;
      name: string;
      slug: string;
      tmdbId: string | null;
      seerrMediaId: number | null;
      retryCount: number;
      status: 'pending' | 'cleanupPending' | 'acknowledged' | 'skipped';
      lastError: string | null;
    }> = {}
  ) => ({
    id: 1,
    name: 'Movie 1',
    slug: '/film/movie-1/',
    tmdbId: '123',
    seerrMediaId: null,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    retryCount: 0,
    status: 'pending' as const,
    lastError: null,
    ...overrides,
  });

  function makeV2State(url: string, mode: 'request' | 'delete', items: Record<string, any> = {}, rssEtag?: string | null) {
    return {
      version: 2,
      sources: {
        [url]: {
          url,
          mode,
          ...(rssEtag !== undefined ? { rssEtag } : {}),
          items,
        },
      },
    };
  }

  async function flushAsyncWork(iterations = 10): Promise<void> {
    for (let index = 0; index < iterations; index += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  async function waitForState(
    predicate: (state: any) => boolean
  ) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const state = await stateModule.loadState(dataDir);
        if (state && predicate(state)) {
          return state;
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          throw error;
        }
      }

      await flushAsyncWork(1);
    }

    throw new Error(`Timed out waiting for matching state in ${dataDir}`);
  }

  function loadModules(): void {
    scraperModule = require('./scraper');
    seerrModule = require('./api/seerr');
    mountModule = require('./util/mount');
    stateModule = require('./util/state');
    rssModule = require('./scraper/rss');
    saveStateSpy = jest.spyOn(stateModule, 'saveState');
    ({ startScheduledMonitoring } = require('./index'));
  }

  function mockRssScraper(movies: any[], etag: string | null = '"etag-123"') {
    const mockGetMovies = jest.fn().mockResolvedValue({ movies, etag });
    rssModule.RssScraper.mockImplementation(() => ({ getMovies: mockGetMovies }));
    return mockGetMovies;
  }

  function setRequestMode(url = WATCHLIST_URL): void {
    process.env.LETTERBOXD_URL = url;
  }

  function setDeleteMode(url = DELETE_URL): void {
    process.env.LETTERBOXD_URL = url;
  }

  beforeEach(async () => {
    originalEnv = { ...process.env };
    jest.resetModules();
    jest.clearAllMocks();

    dataDir = await mkdtemp(path.join(os.tmpdir(), 'seerrboxd-index-test-'));

    process.env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      LETTERBOXD_URL: WATCHLIST_URL,
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
      DATA_DIR: dataDir,
      CHECK_INTERVAL_MINUTES: '10',
      DRY_RUN: 'false',
    };

    setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(() => 1 as any);
  });

  afterEach(async () => {
    setIntervalSpy.mockRestore();
    process.env = originalEnv;
    await rm(dataDir, { recursive: true, force: true });
  });

  it('runs request mode and persists acknowledged Seerr requests', async () => {
    loadModules();

    scraperModule.detectListType.mockReturnValue('watchlist');
    scraperModule.getSyncModeForListType.mockReturnValue('request');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([createMovie()]);
    seerrModule.createMovieRequest.mockResolvedValue('created');

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[WATCHLIST_URL]?.items['1']?.status === 'acknowledged'
    ));

    expect(scraperModule.fetchMoviesFromUrl).toHaveBeenCalledWith(WATCHLIST_URL);
    expect(seerrModule.createMovieRequest).toHaveBeenCalledWith('123');
    expect(savedState.sources[WATCHLIST_URL]).toEqual(
      expect.objectContaining({
        mode: 'request',
        items: {
          '1': expect.objectContaining({
            status: 'acknowledged',
            tmdbId: '123',
          }),
        },
      })
    );
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 600000);
  });

  it('runs regular list sources in request mode and creates Seerr requests', async () => {
    setRequestMode(LIST_URL);
    loadModules();

    scraperModule.detectListType.mockReturnValue('regular_list');
    scraperModule.getSyncModeForListType.mockReturnValue('request');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 17,
        name: 'Regular List Movie',
        slug: '/film/regular-list-movie/',
        tmdbId: '717',
      }),
    ]);
    seerrModule.createMovieRequest.mockResolvedValue('created');

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[LIST_URL]?.items['17']?.status === 'acknowledged'
    ));

    expect(scraperModule.fetchMoviesFromUrl).toHaveBeenCalledWith(LIST_URL);
    expect(seerrModule.createMovieRequest).toHaveBeenCalledWith('717');
    expect(savedState.sources[LIST_URL]).toEqual(
      expect.objectContaining({
        mode: 'request',
        items: {
          '17': expect.objectContaining({
            status: 'acknowledged',
            tmdbId: '717',
          }),
        },
      })
    );
  });

  it('bootstraps delete mode on first run without deleting historical entries', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    mockRssScraper([
      createMovie({ id: 9, name: 'Watched Movie', slug: '/film/watched-movie/', tmdbId: '999' }),
    ]);

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[DELETE_URL]?.items['9']?.status === 'acknowledged'
    ));

    expect(seerrModule.getMediaIdByTmdbId).not.toHaveBeenCalled();
    expect(seerrModule.deleteMediaFile).not.toHaveBeenCalled();
    expect(seerrModule.deleteMedia).not.toHaveBeenCalled();
    expect(savedState.sources[DELETE_URL]).toEqual(
      expect.objectContaining({
        mode: 'delete',
        items: {
          '9': expect.objectContaining({
            status: 'acknowledged',
            tmdbId: '999',
          }),
        },
      })
    );
  });

  it('leaves pending delete items unchanged when mount safety fails', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    mockRssScraper([
      createMovie({ id: 5, name: 'Pending Delete', slug: '/film/pending-delete/', tmdbId: '555' }),
    ]);
    await stateModule.saveState(dataDir, makeV2State(DELETE_URL, 'delete', {
      '5': createSavedItem({ id: 5, name: 'Pending Delete', slug: '/film/pending-delete/', tmdbId: '555' }),
    }));
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(false);

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      saveStateSpy.mock.calls.length > 0 &&
      state.sources?.[DELETE_URL]?.items['5']?.status === 'pending'
    ));

    expect(mountModule.mountSentinelExists).toHaveBeenCalledWith('/mnt/media/.MOUNT_OK');
    expect(seerrModule.getMediaIdByTmdbId).not.toHaveBeenCalled();
    expect(seerrModule.deleteMediaFile).not.toHaveBeenCalled();
    expect(seerrModule.deleteMedia).not.toHaveBeenCalled();
    expect(savedState.sources[DELETE_URL].items['5']).toEqual(
      expect.objectContaining({
        status: 'pending',
        tmdbId: '555',
        retryCount: 0,
      })
    );
  });

  it('deletes from Radarr via Seerr and removes Seerr record', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    mockRssScraper([
      createMovie({ id: 7, name: 'Delete Me', slug: '/film/delete-me/', tmdbId: '777' }),
    ]);
    await stateModule.saveState(dataDir, makeV2State(DELETE_URL, 'delete', {
      '7': createSavedItem({ id: 7, name: 'Delete Me', slug: '/film/delete-me/', tmdbId: '777' }),
    }));
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(true);
    seerrModule.getMediaIdByTmdbId.mockResolvedValue(42);
    seerrModule.deleteMediaFile.mockResolvedValue('deleted');
    seerrModule.deleteMedia.mockResolvedValue('deleted');

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[DELETE_URL]?.items['7']?.status === 'acknowledged'
    ));

    expect(seerrModule.getMediaIdByTmdbId).toHaveBeenCalledWith('777');
    expect(seerrModule.deleteMediaFile).toHaveBeenCalledWith(42);
    expect(seerrModule.deleteMedia).toHaveBeenCalledWith(42);
    expect(seerrModule.getMediaIdByTmdbId.mock.invocationCallOrder[0]).toBeLessThan(
      seerrModule.deleteMediaFile.mock.invocationCallOrder[0]
    );
    expect(seerrModule.deleteMediaFile.mock.invocationCallOrder[0]).toBeLessThan(
      seerrModule.deleteMedia.mock.invocationCallOrder[0]
    );
    expect(savedState.sources[DELETE_URL].items['7']).toEqual(
      expect.objectContaining({
        status: 'acknowledged',
        tmdbId: '777',
      })
    );
  });

  it('marks as acknowledged when movie is not tracked in Seerr', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    mockRssScraper([
      createMovie({ id: 7, name: 'Not In Seerr', slug: '/film/not-in-seerr/', tmdbId: '777' }),
    ]);
    await stateModule.saveState(dataDir, makeV2State(DELETE_URL, 'delete', {
      '7': createSavedItem({ id: 7, name: 'Not In Seerr', slug: '/film/not-in-seerr/', tmdbId: '777' }),
    }));
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(true);
    seerrModule.getMediaIdByTmdbId.mockResolvedValue(null);

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[DELETE_URL]?.items['7']?.status === 'acknowledged'
    ));

    expect(seerrModule.deleteMediaFile).not.toHaveBeenCalled();
    expect(seerrModule.deleteMedia).not.toHaveBeenCalled();
    expect(savedState.sources[DELETE_URL].items['7']).toEqual(
      expect.objectContaining({ status: 'acknowledged' })
    );
  });

  it('marks items cleanupPending when deleteMediaFile succeeds but deleteMedia fails', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    mockRssScraper([
      createMovie({ id: 7, name: 'Delete Me', slug: '/film/delete-me/', tmdbId: '777' }),
    ]);
    await stateModule.saveState(dataDir, makeV2State(DELETE_URL, 'delete', {
      '7': createSavedItem({ id: 7, name: 'Delete Me', slug: '/film/delete-me/', tmdbId: '777' }),
    }));
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(true);
    seerrModule.getMediaIdByTmdbId.mockResolvedValue(42);
    seerrModule.deleteMediaFile.mockResolvedValue('deleted');
    seerrModule.deleteMedia.mockRejectedValue(new Error('Seerr unavailable'));

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[DELETE_URL]?.items['7']?.status === 'cleanupPending'
    ));

    expect(savedState.sources[DELETE_URL].items['7']).toEqual(
      expect.objectContaining({
        status: 'cleanupPending',
        seerrMediaId: 42,
        lastError: 'Seerr unavailable',
      })
    );
  });

  it('retries cleanupPending items using stored seerrMediaId', async () => {
    setDeleteMode(DIARY_URL);
    loadModules();

    scraperModule.detectListType.mockReturnValue('diary');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    mockRssScraper([]);
    await stateModule.saveState(dataDir, makeV2State(DIARY_URL, 'delete', {
      '8': createSavedItem({
        id: 8,
        name: 'Cleanup Only',
        slug: '/film/cleanup-only/',
        tmdbId: '888',
        seerrMediaId: 99,
        status: 'cleanupPending',
        lastError: 'Temporary Seerr outage',
      }),
    }));
    saveStateSpy.mockClear();
    seerrModule.deleteMedia.mockResolvedValue('deleted');

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[DIARY_URL]?.items['8']?.status === 'acknowledged'
    ));

    expect(seerrModule.deleteMedia).toHaveBeenCalledWith(99);
    expect(seerrModule.deleteMediaFile).not.toHaveBeenCalled();
    expect(savedState.sources[DIARY_URL].items['8']).toEqual(
      expect.objectContaining({
        status: 'acknowledged',
        tmdbId: '888',
      })
    );
  });

  it('caps TMDb-missing retries at three attempts', async () => {
    setRequestMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watchlist');
    scraperModule.getSyncModeForListType.mockReturnValue('request');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 11,
        name: 'Missing TMDb',
        slug: '/film/missing-tmdb/',
        tmdbId: null,
      }),
    ]);
    await stateModule.saveState(dataDir, makeV2State(WATCHLIST_URL, 'request', {
      '11': createSavedItem({
        id: 11,
        name: 'Missing TMDb',
        slug: '/film/missing-tmdb/',
        tmdbId: null,
        retryCount: 2,
      }),
    }));
    saveStateSpy.mockClear();

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[WATCHLIST_URL]?.items['11']?.status === 'skipped' &&
      state.sources?.[WATCHLIST_URL]?.items['11']?.retryCount === 3
    ));

    expect(seerrModule.createMovieRequest).not.toHaveBeenCalled();
    expect(savedState.sources[WATCHLIST_URL].items['11']).toEqual(
      expect.objectContaining({
        status: 'skipped',
        retryCount: 3,
        lastError: 'TMDb ID is missing',
      })
    );
  });

  it('keeps transient Seerr request failures uncapped and retryable', async () => {
    setRequestMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watchlist');
    scraperModule.getSyncModeForListType.mockReturnValue('request');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 13,
        name: 'Transient Request Failure',
        slug: '/film/transient-request-failure/',
        tmdbId: '313',
      }),
    ]);
    await stateModule.saveState(dataDir, makeV2State(WATCHLIST_URL, 'request', {
      '13': createSavedItem({
        id: 13,
        name: 'Transient Request Failure',
        slug: '/film/transient-request-failure/',
        tmdbId: '313',
        retryCount: 2,
      }),
    }));
    saveStateSpy.mockClear();
    seerrModule.createMovieRequest.mockRejectedValue({
      isAxiosError: true,
      message: 'Seerr temporarily unavailable',
    });

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[WATCHLIST_URL]?.items['13']?.lastError === 'Seerr temporarily unavailable'
    ));

    expect(savedState.sources[WATCHLIST_URL].items['13']).toEqual(
      expect.objectContaining({
        status: 'pending',
        retryCount: 2,
        lastError: 'Seerr temporarily unavailable',
      })
    );
  });

  it('does not attempt deleteMedia cleanup when deleteMediaFile throws a transient error', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    mockRssScraper([
      createMovie({ id: 20, name: 'Delete Transient', slug: '/film/delete-transient/', tmdbId: '202' }),
    ]);
    await stateModule.saveState(dataDir, makeV2State(DELETE_URL, 'delete', {
      '20': createSavedItem({ id: 20, name: 'Delete Transient', slug: '/film/delete-transient/', tmdbId: '202' }),
    }));
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(true);
    seerrModule.getMediaIdByTmdbId.mockResolvedValue(88);
    seerrModule.deleteMediaFile.mockRejectedValue({
      isAxiosError: true,
      message: 'Seerr delete failed transiently',
    });

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[DELETE_URL]?.items['20']?.lastError === 'Seerr delete failed transiently'
    ));

    expect(seerrModule.deleteMedia).not.toHaveBeenCalled();
    expect(savedState.sources[DELETE_URL].items['20']).toEqual(
      expect.objectContaining({
        status: 'pending',
        lastError: 'Seerr delete failed transiently',
      })
    );
  });

  it('keeps transient deleteMediaFile failures uncapped and retryable', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    mockRssScraper([
      createMovie({ id: 14, name: 'Transient Delete Failure', slug: '/film/transient-delete-failure/', tmdbId: '414' }),
    ]);
    await stateModule.saveState(dataDir, makeV2State(DELETE_URL, 'delete', {
      '14': createSavedItem({
        id: 14,
        name: 'Transient Delete Failure',
        slug: '/film/transient-delete-failure/',
        tmdbId: '414',
        retryCount: 2,
      }),
    }));
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(true);
    seerrModule.getMediaIdByTmdbId.mockResolvedValue(55);
    seerrModule.deleteMediaFile.mockRejectedValue({
      isAxiosError: true,
      message: 'Seerr temporarily unavailable',
    });

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[DELETE_URL]?.items['14']?.lastError === 'Seerr temporarily unavailable'
    ));

    expect(seerrModule.deleteMedia).not.toHaveBeenCalled();
    expect(savedState.sources[DELETE_URL].items['14']).toEqual(
      expect.objectContaining({
        status: 'pending',
        retryCount: 2,
        lastError: 'Seerr temporarily unavailable',
      })
    );
  });

  it('does not mutate or persist in DRY_RUN request mode', async () => {
    process.env.DRY_RUN = 'true';
    loadModules();

    scraperModule.detectListType.mockReturnValue('watchlist');
    scraperModule.getSyncModeForListType.mockReturnValue('request');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 15,
        name: 'Dry Run Request',
        slug: '/film/dry-run-request/',
        tmdbId: '515',
      }),
    ]);

    startScheduledMonitoring();
    await flushAsyncWork();

    expect(seerrModule.createMovieRequest).not.toHaveBeenCalled();
    expect(seerrModule.deleteMediaFile).not.toHaveBeenCalled();
    expect(saveStateSpy).not.toHaveBeenCalled();
    expect(await stateModule.loadState(dataDir)).toBeNull();
  });

  it('skips processing when RSS feed returns 304', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    const mockGetMovies = jest.fn().mockResolvedValue(null); // 304
    rssModule.RssScraper.mockImplementation(() => ({ getMovies: mockGetMovies }));

    startScheduledMonitoring();
    await flushAsyncWork();

    expect(seerrModule.getMediaIdByTmdbId).not.toHaveBeenCalled();
    expect(saveStateSpy).not.toHaveBeenCalled();
  });

  it('does not mutate or persist in DRY_RUN delete mode', async () => {
    process.env.DRY_RUN = 'true';
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    mockRssScraper([
      createMovie({ id: 16, name: 'Dry Run Delete', slug: '/film/dry-run-delete/', tmdbId: '616' }),
    ]);

    startScheduledMonitoring();
    await flushAsyncWork();

    expect(mountModule.mountSentinelExists).not.toHaveBeenCalled();
    expect(seerrModule.getMediaIdByTmdbId).not.toHaveBeenCalled();
    expect(seerrModule.deleteMediaFile).not.toHaveBeenCalled();
    expect(seerrModule.deleteMedia).not.toHaveBeenCalled();
    // First run in DRY_RUN mode still saves bootstrapped state so subsequent runs work correctly
    expect(saveStateSpy).toHaveBeenCalledTimes(1);
    const savedState = await stateModule.loadState(dataDir);
    expect(savedState?.sources?.[DELETE_URL]?.mode).toBe('delete');
    expect(savedState?.sources?.[DELETE_URL]?.items['16']?.status).toBe('acknowledged');
  });

  it('migrates V1 state on first load using the configured URL', async () => {
    setRequestMode();
    loadModules();

    // Seed a V1-format state file
    await stateModule.saveState(dataDir, {
      version: 2,
      sources: {
        [WATCHLIST_URL]: {
          url: WATCHLIST_URL,
          mode: 'request',
          items: {
            '42': createSavedItem({ id: 42, name: 'V1 Movie', slug: '/film/v1-movie/', tmdbId: '42' }),
          },
        },
      },
    });
    saveStateSpy.mockClear();

    scraperModule.detectListType.mockReturnValue('watchlist');
    scraperModule.getSyncModeForListType.mockReturnValue('request');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({ id: 42, name: 'V1 Movie', slug: '/film/v1-movie/', tmdbId: '42' }),
    ]);
    seerrModule.createMovieRequest.mockResolvedValue('created');

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[WATCHLIST_URL]?.items['42']?.status === 'acknowledged'
    ));

    expect(savedState.version).toBe(2);
    expect(savedState.sources[WATCHLIST_URL].items['42'].status).toBe('acknowledged');
  });

  it('processes two request-mode URLs sequentially and saves both in one file', async () => {
    const urlA = WATCHLIST_URL;
    const urlB = LIST_URL;
    process.env.LETTERBOXD_URL = undefined as any;
    process.env.LETTERBOXD_URLS = `${urlA}, ${urlB}`;
    loadModules();

    scraperModule.detectListType
      .mockReturnValueOnce('watchlist')
      .mockReturnValueOnce('regular_list');
    scraperModule.getSyncModeForListType.mockReturnValue('request');
    scraperModule.fetchMoviesFromUrl
      .mockResolvedValueOnce([createMovie({ id: 1, name: 'Movie A', tmdbId: '111' })])
      .mockResolvedValueOnce([createMovie({ id: 2, name: 'Movie B', tmdbId: '222' })]);
    seerrModule.createMovieRequest.mockResolvedValue('created');

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[urlA]?.items['1']?.status === 'acknowledged' &&
      state.sources?.[urlB]?.items['2']?.status === 'acknowledged'
    ));

    expect(savedState.version).toBe(2);
    expect(Object.keys(savedState.sources)).toHaveLength(2);
    expect(seerrModule.createMovieRequest).toHaveBeenCalledWith('111');
    expect(seerrModule.createMovieRequest).toHaveBeenCalledWith('222');
  });

  it('processes request and delete sources independently in one container', async () => {
    const requestUrl = WATCHLIST_URL;
    const deleteUrl = DIARY_URL;
    process.env.LETTERBOXD_URL = undefined as any;
    process.env.LETTERBOXD_URLS = `${requestUrl}, ${deleteUrl}`;
    loadModules();

    // Seed pre-existing delete-mode state (not first run)
    await stateModule.saveState(dataDir, makeV2State(deleteUrl, 'delete', {
      '9': createSavedItem({ id: 9, name: 'Diary Movie', tmdbId: '999' }),
    }));
    saveStateSpy.mockClear();

    scraperModule.detectListType
      .mockReturnValueOnce('watchlist')
      .mockReturnValueOnce('diary');
    scraperModule.getSyncModeForListType
      .mockReturnValueOnce('request')
      .mockReturnValueOnce('delete');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({ id: 1, name: 'Watchlist Movie', tmdbId: '111' }),
    ]);
    mockRssScraper([
      createMovie({ id: 9, name: 'Diary Movie', tmdbId: '999' }),
    ]);
    seerrModule.createMovieRequest.mockResolvedValue('created');
    mountModule.mountSentinelExists.mockResolvedValue(true);
    seerrModule.getMediaIdByTmdbId.mockResolvedValue(77);
    seerrModule.deleteMediaFile.mockResolvedValue('deleted');
    seerrModule.deleteMedia.mockResolvedValue('deleted');

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.sources?.[requestUrl]?.items['1']?.status === 'acknowledged' &&
      state.sources?.[deleteUrl]?.items['9']?.status === 'acknowledged'
    ));

    expect(seerrModule.createMovieRequest).toHaveBeenCalledWith('111');
    expect(seerrModule.deleteMediaFile).toHaveBeenCalledWith(77);
    expect(savedState.sources[requestUrl].mode).toBe('request');
    expect(savedState.sources[deleteUrl].mode).toBe('delete');
  });

  it('first-run bootstrap for one source does not affect other sources', async () => {
    const requestUrl = WATCHLIST_URL;
    const deleteUrl = DIARY_URL;
    process.env.LETTERBOXD_URL = undefined as any;
    process.env.LETTERBOXD_URLS = `${requestUrl}, ${deleteUrl}`;
    loadModules();

    // Pre-seed only the request source (delete source is first-run)
    await stateModule.saveState(dataDir, makeV2State(requestUrl, 'request', {
      '1': createSavedItem({ id: 1, name: 'Already Requested', tmdbId: '111', status: 'acknowledged' }),
    }));
    saveStateSpy.mockClear();

    scraperModule.detectListType
      .mockReturnValueOnce('watchlist')
      .mockReturnValueOnce('diary');
    scraperModule.getSyncModeForListType
      .mockReturnValueOnce('request')
      .mockReturnValueOnce('delete');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([]);
    mockRssScraper([
      createMovie({ id: 9, name: 'Diary Movie', tmdbId: '999' }),
    ]);

    startScheduledMonitoring();
    // Bootstrap save happens immediately for the diary (delete) source
    const savedState = await waitForState(state => (
      state.sources?.[deleteUrl]?.items['9']?.status === 'acknowledged'
    ));

    // The watchlist source should still have its pre-seeded item
    expect(savedState.sources[requestUrl]?.items['1']?.status).toBe('acknowledged');
    // Delete source bootstrapped correctly
    expect(seerrModule.deleteMediaFile).not.toHaveBeenCalled();
  });
});
