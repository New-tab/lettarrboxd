describe('env', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses request-mode configuration with Seerr and state settings', () => {
    process.env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
      CHECK_INTERVAL_MINUTES: '15',
      DATA_DIR: '/tmp/data',
      MEDIA_MOUNT_SENTINEL: '/mnt/media/.MOUNT_OK',
      DRY_RUN: 'false',
    };

    const env = require('./env').default;

    expect(env.SEERR_API_URL).toBe('http://localhost:5055');
    expect(env.SEERR_API_KEY).toBe('seerr-key');
    expect(env.DATA_DIR).toBe('/tmp/data');
    expect(env.MEDIA_MOUNT_SENTINEL).toBe('/mnt/media/.MOUNT_OK');
    expect(env.CHECK_INTERVAL_MINUTES).toBe(15);
  });

  it('requires Radarr credentials for watched sources', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URL: 'https://letterboxd.com/user/films',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
    };

    expect(() => {
      jest.isolateModules(() => {
        require('./env');
      });
    }).toThrow('process.exit called');

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('allows request-mode sources without Radarr credentials', () => {
    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
    };

    const env = require('./env').default;
    expect(env.RADARR_API_URL).toBeUndefined();
    expect(env.RADARR_API_KEY).toBeUndefined();
    expect(env.DATA_DIR).toBe('/data');
    expect(env.MEDIA_MOUNT_SENTINEL).toBe('/mnt/media/.MOUNT_OK');
  });

  it('still requires take amount and strategy together', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
      LETTERBOXD_TAKE_AMOUNT: '5',
    };

    expect(() => {
      jest.isolateModules(() => {
        require('./env');
      });
    }).toThrow('process.exit called');

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });
});
