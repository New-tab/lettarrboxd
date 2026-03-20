import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  ACTIVITY_LOG_MAX_LINES,
  ActivityEvent,
  appendEvent,
  loadEvents,
} from './activity-log';

describe('activity-log', () => {
  let dataDir: string;

  const makeEvent = (overrides: Partial<ActivityEvent> = {}): ActivityEvent => ({
    timestamp: '2026-01-01T00:00:00.000Z',
    sourceUrl: 'https://letterboxd.com/user/watchlist',
    mode: 'request',
    action: 'requested',
    itemName: 'Test Movie',
    tmdbId: '123',
    ...overrides,
  });

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'seerrboxd-activity-log-test-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('appends an event and loads it back', async () => {
    const event = makeEvent();
    await appendEvent(dataDir, event);
    const events = await loadEvents(dataDir);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it('returns events in reverse-chronological order', async () => {
    for (let i = 0; i < 3; i++) {
      await appendEvent(dataDir, makeEvent({ message: `Event ${i}` }));
    }
    const events = await loadEvents(dataDir);
    expect(events[0].message).toBe('Event 2');
    expect(events[1].message).toBe('Event 1');
    expect(events[2].message).toBe('Event 0');
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await appendEvent(dataDir, makeEvent({ action: 'sync_started', message: `Event ${i}` }));
    }
    const events = await loadEvents(dataDir, 2);
    expect(events).toHaveLength(2);
    expect(events[0].message).toBe('Event 4');
    expect(events[1].message).toBe('Event 3');
  });

  it('truncates to ACTIVITY_LOG_MAX_LINES when cap is exceeded', async () => {
    const total = ACTIVITY_LOG_MAX_LINES + 5;
    for (let i = 0; i < total; i++) {
      await appendEvent(dataDir, makeEvent({ action: 'sync_completed', message: `Event ${i}` }));
    }
    const events = await loadEvents(dataDir, total);
    expect(events).toHaveLength(ACTIVITY_LOG_MAX_LINES);
    // Most recent event is first (reverse-chrono)
    expect(events[0].message).toBe(`Event ${total - 1}`);
    // Oldest retained event: the 6th written (index 5), since first 5 were truncated
    expect(events[ACTIVITY_LOG_MAX_LINES - 1].message).toBe('Event 5');
  });

  it('returns empty array when log file does not exist', async () => {
    const events = await loadEvents(dataDir);
    expect(events).toEqual([]);
  });

  it('handles global events without sourceUrl or mode', async () => {
    const event: ActivityEvent = {
      timestamp: '2026-01-01T00:00:00.000Z',
      action: 'sync_started',
      message: 'Sync started',
    };
    await appendEvent(dataDir, event);
    const events = await loadEvents(dataDir);
    expect(events[0]).toEqual(event);
    expect(events[0].sourceUrl).toBeUndefined();
  });
});
