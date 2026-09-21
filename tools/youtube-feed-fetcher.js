'use strict';

const fs = require('fs');
const path = require('path');
const { pickNewest, pickPopular, parseChannelsConfig } = require('./youtube-feed-lib');

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const POPULAR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const POPULAR_LIMIT = 8;
const NEWEST_LIMIT = 2;
const ITEMS_PER_CHANNEL = 20;

function redactUrl(url) {
  try {
    const redacted = new URL(url);
    if (redacted.searchParams.has('key')) {
      redacted.searchParams.set('key', '***');
    }
    return redacted.toString();
  } catch (err) {
    return url;
  }
}

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error('YouTube API вернул ' + res.status + ' для ' + redactUrl(url));
  }
  return res.json();
}

function buildUrl(pathname, params) {
  const url = new URL(API_BASE + pathname);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchChannelVideos(fetchImpl, apiKey, channel) {
  const channelsUrl = buildUrl('/channels', { part: 'contentDetails', id: channel.id, key: apiKey });
  const channelsData = await fetchJson(fetchImpl, channelsUrl);
  const uploadsPlaylistId = channelsData.items &&
    channelsData.items[0] &&
    channelsData.items[0].contentDetails.relatedPlaylists.uploads;
  if (!uploadsPlaylistId) {
    throw new Error('Не найден uploads-плейлист для канала ' + channel.id);
  }

  const playlistUrl = buildUrl('/playlistItems', {
    part: 'snippet',
    maxResults: ITEMS_PER_CHANNEL,
    playlistId: uploadsPlaylistId,
    key: apiKey,
  });
  const playlistData = await fetchJson(fetchImpl, playlistUrl);
  const videoIds = (playlistData.items || [])
    .map((item) => item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId)
    .filter(Boolean);
  if (videoIds.length === 0) return [];

  const videosUrl = buildUrl('/videos', { part: 'snippet,statistics', id: videoIds.join(','), key: apiKey });
  const videosData = await fetchJson(fetchImpl, videosUrl);
  return (videosData.items || []).map((item) => ({
    id: item.id,
    title: item.snippet.title,
    channel: channel.name,
    thumbnail: item.snippet.thumbnails && item.snippet.thumbnails.medium && item.snippet.thumbnails.medium.url,
    publishedAt: item.snippet.publishedAt,
    views: Number((item.statistics && item.statistics.viewCount) || 0),
  }));
}

async function fetchFeed(channels, { fetchImpl = fetch, apiKey, now = () => new Date() } = {}) {
  const allVideos = [];
  for (const channel of channels) {
    const videos = await fetchChannelVideos(fetchImpl, apiKey, channel);
    allVideos.push(...videos);
  }
  const nowMs = now().getTime();
  return {
    generatedAt: new Date(nowMs).toISOString(),
    newest: pickNewest(allVideos, NEWEST_LIMIT),
    popular: pickPopular(allVideos, { sinceMs: POPULAR_WINDOW_MS, limit: POPULAR_LIMIT }, nowMs),
  };
}

function writeAtomic(outputPath, data) {
  const tmpPath = outputPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, outputPath);
}

async function main() {
  const apiKey = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!apiKey) {
    console.error('YOUTUBE_API_KEY не задан');
    process.exit(1);
    return;
  }

  let channels;
  try {
    channels = parseChannelsConfig(process.env.YOUTUBE_CHANNELS);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
    return;
  }
  if (channels.length === 0) {
    console.error('YOUTUBE_CHANNELS пуст — нечего обновлять');
    process.exit(1);
    return;
  }

  const outputPath = process.env.OUTPUT_PATH || path.join(process.cwd(), 'videos.json');

  try {
    const feed = await fetchFeed(channels, { apiKey });
    writeAtomic(outputPath, feed);
    console.error('videos.json обновлён:', feed.newest.length, 'новых,', feed.popular.length, 'популярных');
  } catch (err) {
    console.error('Ошибка обновления videos.json, файл не тронут:', err.message);
    process.exit(1);
  }
}

module.exports = { fetchFeed, fetchChannelVideos, writeAtomic };

if (require.main === module) {
  main();
}
