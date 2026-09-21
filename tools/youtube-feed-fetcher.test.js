'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchFeed } = require('./youtube-feed-fetcher');

function fakeFetch(responses) {
  return async (url) => {
    for (const [matcher, body] of responses) {
      if (url.includes(matcher)) {
        return { ok: true, status: 200, json: async () => body };
      }
    }
    throw new Error('Нет заглушки для URL: ' + url);
  };
}

test('fetchFeed assembles newest and popular videos from one channel', async () => {
  const channel = { id: 'UCabc', name: 'Тестовый канал' };
  const fetchImpl = fakeFetch([
    ['/channels?', { items: [{ contentDetails: { relatedPlaylists: { uploads: 'PLxyz' } } }] }],
    ['/playlistItems?', {
      items: [
        { snippet: { resourceId: { videoId: 'vid1' } } },
        { snippet: { resourceId: { videoId: 'vid2' } } },
      ],
    }],
    ['/videos?', {
      items: [
        {
          id: 'vid1',
          snippet: {
            title: 'Видео 1',
            publishedAt: '2026-09-20T00:00:00Z',
            thumbnails: { medium: { url: 'https://x/1.jpg' } },
          },
          statistics: { viewCount: '100' },
        },
        {
          id: 'vid2',
          snippet: {
            title: 'Видео 2',
            publishedAt: '2026-09-10T00:00:00Z',
            thumbnails: { medium: { url: 'https://x/2.jpg' } },
          },
          statistics: { viewCount: '9000' },
        },
      ],
    }],
  ]);

  const feed = await fetchFeed([channel], {
    fetchImpl,
    apiKey: 'test-key',
    now: () => new Date('2026-09-21T00:00:00Z'),
  });

  assert.equal(feed.newest.length, 2);
  assert.equal(feed.newest[0].id, 'vid1');
  assert.equal(feed.popular[0].id, 'vid2');
  assert.equal(feed.popular[0].views, 9000);
  assert.equal(feed.popular[0].channel, 'Тестовый канал');
});

test('fetchFeed marks videos from the official channel and leaves others unmarked', async () => {
  const official = { id: 'UCofficial', name: 'ANOMA' };
  const other = { id: 'UCother', name: 'Другой канал' };
  const fetchImpl = fakeFetch([
    ['/channels?', { items: [{ contentDetails: { relatedPlaylists: { uploads: 'PLxyz' } } }] }],
    ['/playlistItems?', { items: [{ snippet: { resourceId: { videoId: 'vid1' } } }] }],
    ['/videos?', {
      items: [
        {
          id: 'vid1',
          snippet: {
            title: 'Видео',
            publishedAt: '2026-09-20T00:00:00Z',
            thumbnails: { medium: { url: 'https://x/1.jpg' } },
          },
          statistics: { viewCount: '100' },
        },
      ],
    }],
  ]);

  const feed = await fetchFeed([official, other], {
    fetchImpl,
    apiKey: 'test-key',
    officialChannelId: 'UCofficial',
    now: () => new Date('2026-09-21T00:00:00Z'),
  });

  assert.equal(feed.newest.length, 2);
  const officialVideo = feed.newest.find((v) => v.channel === 'ANOMA');
  const otherVideo = feed.newest.find((v) => v.channel === 'Другой канал');
  assert.equal(officialVideo.official, true);
  assert.equal(otherVideo.official, false);
});

test('fetchFeed leaves official false for every video when officialChannelId is not set', async () => {
  const channel = { id: 'UCabc', name: 'Тестовый канал' };
  const fetchImpl = fakeFetch([
    ['/channels?', { items: [{ contentDetails: { relatedPlaylists: { uploads: 'PLxyz' } } }] }],
    ['/playlistItems?', { items: [{ snippet: { resourceId: { videoId: 'vid1' } } }] }],
    ['/videos?', {
      items: [{
        id: 'vid1',
        snippet: { title: 'Видео', publishedAt: '2026-09-20T00:00:00Z', thumbnails: { medium: { url: 'https://x/1.jpg' } } },
        statistics: { viewCount: '100' },
      }],
    }],
  ]);

  const feed = await fetchFeed([channel], { fetchImpl, apiKey: 'test-key' });

  assert.equal(feed.newest[0].official, false);
});

test('fetchFeed rejects when a channel has no uploads playlist', async () => {
  const channel = { id: 'UCbad', name: 'Битый канал' };
  const fetchImpl = fakeFetch([
    ['/channels?', { items: [] }],
  ]);
  await assert.rejects(
    () => fetchFeed([channel], { fetchImpl, apiKey: 'test-key' }),
    /Не найден uploads-плейлист/
  );
});

test('fetchFeed rejects when the API returns a non-OK status', async () => {
  const channel = { id: 'UCabc', name: 'Тестовый канал' };
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(
    () => fetchFeed([channel], { fetchImpl, apiKey: 'test-key' }),
    /YouTube API вернул 403/
  );
});
