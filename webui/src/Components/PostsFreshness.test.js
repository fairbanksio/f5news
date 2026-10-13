import { getPostsFreshness, createFreshnessReporter } from './MainContent';

describe('posts freshness diagnostics', () => {
  const now = Date.parse('2026-06-06T12:00:00.000Z');
  let warn;
  let info;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    info.mockRestore();
  });

  test.each([undefined, null, '', 'invalid', Infinity, NaN])(
    'reports unknown freshness for an unusable timestamp: %s', fetchedAt => {
      expect(getPostsFreshness([{ fetchedAt }], now)).toMatchObject({
        state: 'unknown', latestFetchedAt: null, invalidTimestampCount: 1,
      });
    }
  );

  test('finds the latest valid timestamp after missing or invalid values', () => {
    expect(getPostsFreshness([
      {}, { fetchedAt: 'invalid' }, { fetchedAt: '2026-06-06T11:50:00.000Z' },
      { fetchedAt: '2026-06-06T11:59:00.000Z' },
    ], now)).toMatchObject({
      state: 'fresh', latestFetchedAt: '2026-06-06T11:59:00.000Z', invalidTimestampCount: 2,
    });
    expect(getPostsFreshness([{}, { fetchedAt: '2026-06-06T11:50:00.000Z' }], now).state).toBe('stale');
  });

  test('keeps the exact grace boundary fresh and marks one millisecond older stale', () => {
    expect(getPostsFreshness([{ fetchedAt: now - 420000 }], now).state).toBe('fresh');
    expect(getPostsFreshness([{ fetchedAt: now - 420001 }], now).state).toBe('stale');
  });

  test('treats empty responses as valid without a freshness warning', () => {
    createFreshnessReporter()('politics', [], now);
    expect(getPostsFreshness([], now).state).toBe('empty');
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  test.each(['stale', 'unknown'])('bounds repeated %s warnings and preserves counts on recovery', state => {
    const report = createFreshnessReporter();
    const posts = state === 'stale' ? [{ fetchedAt: now - 600000 }] : [{}];
    report('politics', posts, now);
    report('politics', posts, now + 1000);
    report('politics', posts, now + 299999);
    expect(warn).toHaveBeenCalledTimes(1);
    report('politics', posts, now + 300000);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][1]).toMatchObject({
      state, event: 'summary', observationCount: 4,
      firstObservedAt: '2026-06-06T12:00:00.000Z',
      lastObservedAt: '2026-06-06T12:05:00.000Z',
      latestFetchedAt: state === 'stale' ? '2026-06-06T11:50:00.000Z' : null,
      invalidTimestampCount: state === 'unknown' ? 1 : 0,
    });
    report('politics', [{ fetchedAt: now + 300001 }], now + 300001);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][1]).toMatchObject({
      event: 'recovery', state: 'fresh', previousState: state, previousObservationCount: 4,
    });
    report('politics', [{ fetchedAt: now + 300002 }], now + 300002);
    expect(info).toHaveBeenCalledTimes(1);
  });

  test('logs cause changes immediately and resets counts when the subreddit changes', () => {
    const report = createFreshnessReporter();
    report('politics', [{}], now);
    report('politics', [{}], now + 1);
    report('politics', [{ fetchedAt: now - 600000 }], now + 2);
    expect(warn.mock.calls[1][1]).toMatchObject({
      state: 'stale', previousState: 'unknown', previousObservationCount: 2,
    });
    report('news', [{ fetchedAt: now - 600000 }], now + 3);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[2][1]).toMatchObject({ subreddit: 'news', observationCount: 1 });
    expect(warn.mock.calls[2][1]).not.toHaveProperty('previousState');
  });

  test('records empty results after a warning without claiming freshness recovered', () => {
    const report = createFreshnessReporter();
    report('politics', [{}], now);
    report('politics', [], now + 1);
    expect(info.mock.calls[0][1]).toMatchObject({ event: 'transition', state: 'empty', previousState: 'unknown' });
  });
});
