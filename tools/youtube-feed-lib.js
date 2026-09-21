'use strict';

function pickNewest(videos, n) {
  return videos
    .slice()
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, n);
}

function pickPopular(videos, { sinceMs, limit }, nowMs) {
  const cutoff = nowMs - sinceMs;
  return videos
    .filter((v) => new Date(v.publishedAt).getTime() >= cutoff)
    .slice()
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

function parseChannelsConfig(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(':');
      if (idx === -1) {
        throw new Error('Некорректная запись канала (нужен формат id:Имя): ' + entry);
      }
      return { id: entry.slice(0, idx).trim(), name: entry.slice(idx + 1).trim() };
    });
}

module.exports = { pickNewest, pickPopular, parseChannelsConfig };
