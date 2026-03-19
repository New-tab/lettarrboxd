describe('env', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses LETTERBOXD_URL (singular) into a single-element letterboxdUrls array', () => {
    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
    };

    const env = require('./env').default;
    expect(env.letterboxdUrls).toEqual(['https://letterboxd.com/user/watchlist']);
    expect(env.LETTERBOXD_URL).toBe('https://letterboxd.com/user/watchlist');
  });

  it('parses LETTERBOXD_URLS (plural, comma-separated) into a multi-element array', () => {
    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URLS: 'https://letterboxd.com/user/watchlist, https://letterboxd.com/user/films/diary/',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
    };

    const env = require('./env').default;
    expect(env.letterboxdUrls).toEqual([
      'https://letterboxd.com/user/watchlist',
      'https://letterboxd.com/user/films/diary/',
    ]);
  });

  it('trims whitespace from each URL in LETTERBOXD_URLS', () => {
    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URLS: '  https://letterboxd.com/user/watchlist  ,  https://letterboxd.com/user/films/diary/  ',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
    };

    const env = require('./env').default;
    expect(env.letterboxdUrls).toEqual([
      'https://letterboxd.com/user/watchlist',
      'https://letterboxd.com/user/films/diary/',
    ]);
  });

  it('fails when both LETTERBOXD_URL and LETTERBOXD_URLS are set', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
      LETTERBOXD_URLS: 'https://letterboxd.com/user/films/diary/',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
    };

    expect(() => {
      jest.isolateModules(() => { require('./env'); });
    }).toThrow('process.exit called');

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('fails when neither LETTERBOXD_URL nor LETTERBOXD_URLS is set', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

    process.env = {
      NODE_ENV: 'test',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
    };

    expect(() => {
      jest.isolateModules(() => { require('./env'); });
    }).toThrow('process.exit called');

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
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

  it('applies defaults for optional fields when not set', () => {
    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
    };

    const env = require('./env').default;
    expect(env.DATA_DIR).toBe('/data');
    expect(env.MEDIA_MOUNT_SENTINEL).toBe('/mnt/media/.MOUNT_OK');
    expect(env.PORT).toBe(3000);
  });

  it('parses PORT from env', () => {
    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
      PORT: '8080',
    };

    const env = require('./env').default;
    expect(env.PORT).toBe(8080);
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
