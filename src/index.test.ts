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

jest.mock('./api/radarr', () => ({
  findMovieByTmdbId: jest.fn(),
  deleteMovieById: jest.fn(),
}));

jest.mock('./api/seerr', () => ({
  createMovieRequest: jest.fn(),
  deleteMovieRequestByTmdbId: jest.fn(),
}));

jest.mock('./util/mount', () => ({
  mountSentinelExists: jest.fn(),
}));

describe('main application', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let dataDir: string;
  let setIntervalSpy: jest.SpyInstance;
  let saveStateSpy: jest.SpyInstance;
  let startScheduledMonitoring: () => void;
  let scraperModule: any;
  let radarrModule: any;
  let seerrModule: any;
  let mountModule: any;
  let stateModule: any;

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
      retryCount: number;
      status: 'pending' | 'cleanupPending' | 'acknowledged' | 'skipped';
      lastError: string | null;
    }> = {}
  ) => ({
    id: 1,
    name: 'Movie 1',
    slug: '/film/movie-1/',
    tmdbId: '123',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    retryCount: 0,
    status: 'pending' as const,
    lastError: null,
    ...overrides,
  });

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
    radarrModule = require('./api/radarr');
    seerrModule = require('./api/seerr');
    mountModule = require('./util/mount');
    stateModule = require('./util/state');
    saveStateSpy = jest.spyOn(stateModule, 'saveState');
    ({ startScheduledMonitoring } = require('./index'));
  }

  function setRequestMode(): void {
    process.env.LETTERBOXD_URL = 'https://letterboxd.com/user/watchlist';
  }

  function setDeleteMode(url = 'https://letterboxd.com/user/films'): void {
    process.env.LETTERBOXD_URL = url;
  }

  beforeEach(async () => {
    originalEnv = { ...process.env };
    jest.resetModules();
    jest.clearAllMocks();

    dataDir = await mkdtemp(path.join(os.tmpdir(), 'lettarrboxd-index-test-'));

    process.env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
      RADARR_API_URL: 'http://localhost:7878',
      RADARR_API_KEY: 'radarr-key',
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
      state.mode === 'request' &&
      state.items['1']?.status === 'acknowledged'
    ));

    expect(scraperModule.fetchMoviesFromUrl).toHaveBeenCalledWith(
      'https://letterboxd.com/user/watchlist'
    );
    expect(seerrModule.createMovieRequest).toHaveBeenCalledWith('123');
    expect(savedState).toEqual(
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
    process.env.LETTERBOXD_URL = 'https://letterboxd.com/user/list/some-list/';
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
      state.mode === 'request' &&
      state.items['17']?.status === 'acknowledged'
    ));

    expect(scraperModule.fetchMoviesFromUrl).toHaveBeenCalledWith(
      'https://letterboxd.com/user/list/some-list/'
    );
    expect(seerrModule.createMovieRequest).toHaveBeenCalledWith('717');
    expect(savedState).toEqual(
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
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 9,
        name: 'Watched Movie',
        slug: '/film/watched-movie/',
        tmdbId: '999',
      }),
    ]);

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.mode === 'delete' &&
      state.items['9']?.status === 'acknowledged'
    ));

    expect(radarrModule.findMovieByTmdbId).not.toHaveBeenCalled();
    expect(radarrModule.deleteMovieById).not.toHaveBeenCalled();
    expect(seerrModule.deleteMovieRequestByTmdbId).not.toHaveBeenCalled();
    expect(savedState).toEqual(
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
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 5,
        name: 'Pending Delete',
        slug: '/film/pending-delete/',
        tmdbId: '555',
      }),
    ]);
    await stateModule.saveState(dataDir, {
      version: 1,
      mode: 'delete',
      items: {
        '5': createSavedItem({
          id: 5,
          name: 'Pending Delete',
          slug: '/film/pending-delete/',
          tmdbId: '555',
        }),
      },
    });
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(false);

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      saveStateSpy.mock.calls.length > 0 &&
      state.items['5']?.status === 'pending'
    ));

    expect(mountModule.mountSentinelExists).toHaveBeenCalledWith('/mnt/media/.MOUNT_OK');
    expect(radarrModule.findMovieByTmdbId).not.toHaveBeenCalled();
    expect(radarrModule.deleteMovieById).not.toHaveBeenCalled();
    expect(seerrModule.deleteMovieRequestByTmdbId).not.toHaveBeenCalled();
    expect(savedState.items['5']).toEqual(
      expect.objectContaining({
        status: 'pending',
        tmdbId: '555',
        retryCount: 0,
      })
    );
  });

  it('deletes from Radarr before Seerr cleanup', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 7,
        name: 'Delete Me',
        slug: '/film/delete-me/',
        tmdbId: '777',
      }),
    ]);
    await stateModule.saveState(dataDir, {
      version: 1,
      mode: 'delete',
      items: {
        '7': createSavedItem({
          id: 7,
          name: 'Delete Me',
          slug: '/film/delete-me/',
          tmdbId: '777',
        }),
      },
    });
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(true);
    radarrModule.findMovieByTmdbId.mockResolvedValue({
      id: 77,
      title: 'Delete Me',
      tmdbId: 777,
    });
    radarrModule.deleteMovieById.mockResolvedValue('deleted');
    seerrModule.deleteMovieRequestByTmdbId.mockResolvedValue('deleted');

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.items['7']?.status === 'acknowledged'
    ));

    expect(radarrModule.findMovieByTmdbId).toHaveBeenCalledWith('777');
    expect(radarrModule.deleteMovieById).toHaveBeenCalledWith(77);
    expect(seerrModule.deleteMovieRequestByTmdbId).toHaveBeenCalledWith('777');
    expect(radarrModule.findMovieByTmdbId.mock.invocationCallOrder[0]).toBeLessThan(
      radarrModule.deleteMovieById.mock.invocationCallOrder[0]
    );
    expect(radarrModule.deleteMovieById.mock.invocationCallOrder[0]).toBeLessThan(
      seerrModule.deleteMovieRequestByTmdbId.mock.invocationCallOrder[0]
    );
    expect(savedState.items['7']).toEqual(
      expect.objectContaining({
        status: 'acknowledged',
        tmdbId: '777',
      })
    );
  });

  it('marks items cleanupPending when Radarr succeeds and Seerr cleanup fails', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 7,
        name: 'Delete Me',
        slug: '/film/delete-me/',
        tmdbId: '777',
      }),
    ]);
    await stateModule.saveState(dataDir, {
      version: 1,
      mode: 'delete',
      items: {
        '7': createSavedItem({
          id: 7,
          name: 'Delete Me',
          slug: '/film/delete-me/',
          tmdbId: '777',
        }),
      },
    });
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(true);
    radarrModule.findMovieByTmdbId.mockResolvedValue({
      id: 77,
      title: 'Delete Me',
      tmdbId: 777,
    });
    radarrModule.deleteMovieById.mockResolvedValue('deleted');
    seerrModule.deleteMovieRequestByTmdbId.mockRejectedValue(
      new Error('Seerr unavailable')
    );

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.items['7']?.status === 'cleanupPending'
    ));

    expect(savedState.items['7']).toEqual(
      expect.objectContaining({
        status: 'cleanupPending',
        lastError: 'Seerr unavailable',
      })
    );
  });

  it('retries cleanupPending items from state even when absent from the current source', async () => {
    setDeleteMode('https://letterboxd.com/user/films/diary');
    loadModules();

    scraperModule.detectListType.mockReturnValue('diary');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([]);
    await stateModule.saveState(dataDir, {
      version: 1,
      mode: 'delete',
      items: {
        '8': createSavedItem({
          id: 8,
          name: 'Cleanup Only',
          slug: '/film/cleanup-only/',
          tmdbId: '888',
          status: 'cleanupPending',
          lastError: 'Temporary Seerr outage',
        }),
      },
    });
    saveStateSpy.mockClear();
    seerrModule.deleteMovieRequestByTmdbId.mockResolvedValue('deleted');

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.items['8']?.status === 'acknowledged'
    ));

    expect(seerrModule.deleteMovieRequestByTmdbId).toHaveBeenCalledWith('888');
    expect(radarrModule.deleteMovieById).not.toHaveBeenCalled();
    expect(savedState.items['8']).toEqual(
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
    await stateModule.saveState(dataDir, {
      version: 1,
      mode: 'request',
      items: {
        '11': createSavedItem({
          id: 11,
          name: 'Missing TMDb',
          slug: '/film/missing-tmdb/',
          tmdbId: null,
          retryCount: 2,
        }),
      },
    });
    saveStateSpy.mockClear();

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.items['11']?.status === 'skipped' &&
      state.items['11']?.retryCount === 3
    ));

    expect(seerrModule.createMovieRequest).not.toHaveBeenCalled();
    expect(savedState.items['11']).toEqual(
      expect.objectContaining({
        status: 'skipped',
        retryCount: 3,
        lastError: 'TMDb ID is missing',
      })
    );
  });

  it('caps Radarr-miss retries at three attempts', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 12,
        name: 'Radarr Miss',
        slug: '/film/radarr-miss/',
        tmdbId: '404',
      }),
    ]);
    await stateModule.saveState(dataDir, {
      version: 1,
      mode: 'delete',
      items: {
        '12': createSavedItem({
          id: 12,
          name: 'Radarr Miss',
          slug: '/film/radarr-miss/',
          tmdbId: '404',
          retryCount: 2,
        }),
      },
    });
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(true);
    radarrModule.findMovieByTmdbId.mockResolvedValue(null);

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.items['12']?.status === 'skipped' &&
      state.items['12']?.retryCount === 3
    ));

    expect(radarrModule.deleteMovieById).not.toHaveBeenCalled();
    expect(savedState.items['12']).toEqual(
      expect.objectContaining({
        status: 'skipped',
        retryCount: 3,
        lastError: 'No Radarr movie found for TMDb 404',
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
    await stateModule.saveState(dataDir, {
      version: 1,
      mode: 'request',
      items: {
        '13': createSavedItem({
          id: 13,
          name: 'Transient Request Failure',
          slug: '/film/transient-request-failure/',
          tmdbId: '313',
          retryCount: 2,
        }),
      },
    });
    saveStateSpy.mockClear();
    seerrModule.createMovieRequest.mockRejectedValue({
      isAxiosError: true,
      message: 'Seerr temporarily unavailable',
    });

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.items['13']?.lastError === 'Seerr temporarily unavailable'
    ));

    expect(savedState.items['13']).toEqual(
      expect.objectContaining({
        status: 'pending',
        retryCount: 2,
        lastError: 'Seerr temporarily unavailable',
      })
    );
  });

  it('keeps transient Radarr failures uncapped and retryable', async () => {
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 14,
        name: 'Transient Delete Failure',
        slug: '/film/transient-delete-failure/',
        tmdbId: '414',
      }),
    ]);
    await stateModule.saveState(dataDir, {
      version: 1,
      mode: 'delete',
      items: {
        '14': createSavedItem({
          id: 14,
          name: 'Transient Delete Failure',
          slug: '/film/transient-delete-failure/',
          tmdbId: '414',
          retryCount: 2,
        }),
      },
    });
    saveStateSpy.mockClear();
    mountModule.mountSentinelExists.mockResolvedValue(true);
    radarrModule.findMovieByTmdbId.mockRejectedValue({
      isAxiosError: true,
      message: 'Radarr temporarily unavailable',
    });

    startScheduledMonitoring();
    const savedState = await waitForState(state => (
      state.items['14']?.lastError === 'Radarr temporarily unavailable'
    ));

    expect(radarrModule.deleteMovieById).not.toHaveBeenCalled();
    expect(seerrModule.deleteMovieRequestByTmdbId).not.toHaveBeenCalled();
    expect(savedState.items['14']).toEqual(
      expect.objectContaining({
        status: 'pending',
        retryCount: 2,
        lastError: 'Radarr temporarily unavailable',
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
    expect(radarrModule.deleteMovieById).not.toHaveBeenCalled();
    expect(saveStateSpy).not.toHaveBeenCalled();
    expect(await stateModule.loadState(dataDir)).toBeNull();
  });

  it('does not mutate or persist in DRY_RUN delete mode', async () => {
    process.env.DRY_RUN = 'true';
    setDeleteMode();
    loadModules();

    scraperModule.detectListType.mockReturnValue('watched_movies');
    scraperModule.getSyncModeForListType.mockReturnValue('delete');
    scraperModule.fetchMoviesFromUrl.mockResolvedValue([
      createMovie({
        id: 16,
        name: 'Dry Run Delete',
        slug: '/film/dry-run-delete/',
        tmdbId: '616',
      }),
    ]);

    startScheduledMonitoring();
    await flushAsyncWork();

    expect(mountModule.mountSentinelExists).not.toHaveBeenCalled();
    expect(radarrModule.findMovieByTmdbId).not.toHaveBeenCalled();
    expect(radarrModule.deleteMovieById).not.toHaveBeenCalled();
    expect(seerrModule.deleteMovieRequestByTmdbId).not.toHaveBeenCalled();
    expect(saveStateSpy).not.toHaveBeenCalled();
    expect(await stateModule.loadState(dataDir)).toBeNull();
  });
});
