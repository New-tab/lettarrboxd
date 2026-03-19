import express from 'express';
import { loadState } from './util/state';
import env from './util/env';
import logger from './util/logger';

export function createApp(runAllSources: () => Promise<void>): express.Express {
  const app = express();
  let isSyncing = false;

  app.get('/status', async (_req, res) => {
    try {
      const state = await loadState(env.DATA_DIR);
      if (!state) {
        res.json({ sources: {}, syncing: isSyncing });
        return;
      }

      const sources = Object.fromEntries(
        Object.entries(state.sources).map(([url, source]) => {
          const itemCounts: Record<string, number> = {};
          for (const item of Object.values(source.items)) {
            itemCounts[item.status] = (itemCounts[item.status] ?? 0) + 1;
          }
          return [url, {
            mode: source.mode,
            rssEtag: source.rssEtag ?? null,
            itemCounts,
            totalItems: Object.keys(source.items).length,
          }];
        })
      );

      res.json({ sources, syncing: isSyncing });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/sync', (_req, res) => {
    if (isSyncing) {
      res.status(409).json({ error: 'Sync already in progress' });
      return;
    }

    isSyncing = true;
    res.status(202).json({ message: 'Sync started' });

    runAllSources().catch(error => {
      logger.error(`Manual sync failed: ${error}`);
    }).finally(() => {
      isSyncing = false;
    });
  });

  return app;
}

export function startServer(port: number, runAllSources: () => Promise<void>): void {
  const app = createApp(runAllSources);
  app.listen(port, () => {
    logger.info(`Status server listening on port ${port}`);
  });
}
