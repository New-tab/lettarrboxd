import { mkdtemp, rm } from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('./util/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('server', () => {
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let serverInstance: http.Server | null = null;

  async function httpRequest(
    port: number,
    method: string,
    urlPath: string
  ): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: 'localhost', port, method, path: urlPath }, res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  function startTestApp(runAllSources: () => Promise<void> = jest.fn().mockResolvedValue(undefined)): Promise<number> {
    jest.resetModules();

    process.env = {
      NODE_ENV: 'test',
      LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
      SEERR_API_URL: 'http://localhost:5055',
      SEERR_API_KEY: 'seerr-key',
      DATA_DIR: dataDir,
      DRY_RUN: 'false',
    };

    const { createApp } = require('./server');
    const app = createApp(runAllSources);

    return new Promise(resolve => {
      serverInstance = app.listen(0, () => {
        const addr = (serverInstance as http.Server).address() as any;
        resolve(addr.port);
      });
    });
  }

  beforeEach(async () => {
    originalEnv = { ...process.env };
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'seerrboxd-server-test-'));
  });

  afterEach(async () => {
    if (serverInstance) {
      serverInstance.close();
      serverInstance = null;
    }
    process.env = originalEnv;
    await rm(dataDir, { recursive: true, force: true });
  });

  it('GET /status returns empty sources when no state file exists', async () => {
    const port = await startTestApp();
    const { status, body } = await httpRequest(port, 'GET', '/status');

    expect(status).toBe(200);
    expect(body.sources).toEqual({});
    expect(body.syncing).toBe(false);
  });

  it('GET /status returns source summaries from state file', async () => {
    const url = 'https://letterboxd.com/user/watchlist';

    const stateModule = require('./util/state');
    await stateModule.saveState(dataDir, {
      version: 2,
      sources: {
        [url]: {
          url,
          mode: 'request',
          rssEtag: null,
          items: {
            '1': { id: 1, name: 'Movie 1', slug: '/film/m1/', tmdbId: '111', firstSeenAt: '', lastSeenAt: '', retryCount: 0, status: 'acknowledged', lastError: null },
            '2': { id: 2, name: 'Movie 2', slug: '/film/m2/', tmdbId: '222', firstSeenAt: '', lastSeenAt: '', retryCount: 0, status: 'pending', lastError: null },
          },
        },
      },
    });

    const port = await startTestApp();
    const { status, body } = await httpRequest(port, 'GET', '/status');

    expect(status).toBe(200);
    expect(body.sources[url]).toEqual(
      expect.objectContaining({
        mode: 'request',
        rssEtag: null,
        totalItems: 2,
        itemCounts: { acknowledged: 1, pending: 1 },
      })
    );
  });

  it('POST /sync returns 202 and triggers runAllSources', async () => {
    const runAllSources = jest.fn().mockResolvedValue(undefined);
    const port = await startTestApp(runAllSources);

    const { status, body } = await httpRequest(port, 'POST', '/sync');

    expect(status).toBe(202);
    expect(body.message).toBe('Sync started');
    // Allow the async call to be scheduled
    await new Promise(resolve => setImmediate(resolve));
    expect(runAllSources).toHaveBeenCalledTimes(1);
  });

  it('POST /sync returns 409 when sync is already in progress', async () => {
    let resolveSync!: () => void;
    const runAllSources = jest.fn().mockImplementation(
      () => new Promise<void>(resolve => { resolveSync = resolve; })
    );
    const port = await startTestApp(runAllSources);

    // First /sync call — starts a long-running sync
    await httpRequest(port, 'POST', '/sync');
    await new Promise(resolve => setImmediate(resolve));

    // Second /sync call while first is still running
    const { status, body } = await httpRequest(port, 'POST', '/sync');
    expect(status).toBe(409);
    expect(body.error).toContain('already in progress');

    // Release the hanging sync so afterEach can clean up cleanly
    resolveSync();
    await new Promise(resolve => setImmediate(resolve));
  });
});
