// Set NODE_ENV to test
process.env.NODE_ENV = 'test';

// Set required environment variables for tests
process.env.LETTERBOXD_URL = 'https://letterboxd.com/user/watchlist';
process.env.SEERR_API_URL = 'http://localhost:5055';
process.env.SEERR_API_KEY = 'seerr-test-key';
process.env.RADARR_API_URL = 'http://localhost:7878';
process.env.RADARR_API_KEY = 'test-key';
process.env.RADARR_QUALITY_PROFILE = 'HD-1080p';
process.env.DATA_DIR = '/tmp/seerrboxd-test';
process.env.MEDIA_MOUNT_SENTINEL = '/mnt/media/.MOUNT_OK';
process.env.LOG_LEVEL = 'error'; // Suppress logs during tests

// Mock process.exit to prevent tests from exiting
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit called with ${code}`);
});

// Clean up after all tests
afterAll(() => {
  mockExit.mockRestore();
});
