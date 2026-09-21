'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pickNewest, pickPopular, parseChannelsConfig } = require('./youtube-feed-lib');

test('pickNewest returns N most recently published videos, newest first', () => {
  const videos = [
    { id: 'a', publishedAt: '2026-09-01T00:00:00Z' },
    { id: 'b', publishedAt: '2026-09-10T00:00:00Z' },
    { id: 'c', publishedAt: '2026-09-05T00:00:00Z' },
  ];
  const result = pickNewest(videos, 2);
  assert.deepEqual(result.map((v) => v.id), ['b', 'c']);
});

test('pickPopular sorts by views desc and excludes videos older than sinceMs', () => {
  const now = new Date('2026-09-21T00:00:00Z').getTime();
  const videos = [
    { id: 'old-hit', publishedAt: '2026-06-01T00:00:00Z', views: 1000000 },
    { id: 'new-a', publishedAt: '2026-09-15T00:00:00Z', views: 500 },
    { id: 'new-b', publishedAt: '2026-09-18T00:00:00Z', views: 5000 },
  ];
  const result = pickPopular(videos, { sinceMs: 30 * 24 * 60 * 60 * 1000, limit: 8 }, now);
  assert.deepEqual(result.map((v) => v.id), ['new-b', 'new-a']);
});

test('pickPopular respects the limit', () => {
  const now = new Date('2026-09-21T00:00:00Z').getTime();
  const videos = Array.from({ length: 10 }, (_, i) => ({
    id: 'v' + i,
    publishedAt: '2026-09-20T00:00:00Z',
    views: i,
  }));
  const result = pickPopular(videos, { sinceMs: 30 * 24 * 60 * 60 * 1000, limit: 3 }, now);
  assert.deepEqual(result.map((v) => v.id), ['v9', 'v8', 'v7']);
});

test('parseChannelsConfig parses "id:Name" pairs separated by commas', () => {
  const result = parseChannelsConfig('UCabc:Канал Раз, UCxyz:Канал Два');
  assert.deepEqual(result, [
    { id: 'UCabc', name: 'Канал Раз' },
    { id: 'UCxyz', name: 'Канал Два' },
  ]);
});

test('parseChannelsConfig throws on a malformed entry', () => {
  assert.throws(() => parseChannelsConfig('no-colon-here'), /Некорректная запись/);
});

test('parseChannelsConfig returns an empty array for empty/undefined input', () => {
  assert.deepEqual(parseChannelsConfig(''), []);
  assert.deepEqual(parseChannelsConfig(undefined), []);
});
