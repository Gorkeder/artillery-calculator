'use strict';

const { sniffImageType, imageSize } = require('./validate');
const { EXT, storeFile, unlinkAll } = require('./files');
const repo = require('./repo');

function extractDataUri(text) {
  const m = /data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/.exec(text);
  if (!m) throw new Error('no base64 image data URI found');
  return { type: m[1], buf: Buffer.from(m[2], 'base64') };
}

function seedMap(db, uploadsDir, { slug, title, text }) {
  const { buf } = extractDataUri(text);
  const type = sniffImageType(buf);
  const size = imageSize(buf);
  if (!type || !size) throw new Error('data URI does not contain a valid png/jpeg/webp image');
  const rel = storeFile(uploadsDir, 'maps', buf, EXT[type]);
  try {
    return repo.insertRow(db, 'maps', {
      slug,
      title,
      image_path: rel,
      width: size.width,
      height: size.height,
      sort: 0,
      published: 1,
    });
  } catch (err) {
    unlinkAll(uploadsDir, [rel]);
    throw err;
  }
}

module.exports = { extractDataUri, seedMap };
