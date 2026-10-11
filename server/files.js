'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };

function storeFile(uploadsDir, subdir, buf, ext) {
  const rel = `${subdir}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const abs = path.join(uploadsDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return rel;
}

function unlinkAll(uploadsDir, relPaths) {
  const root = path.resolve(uploadsDir) + path.sep;
  for (const rel of relPaths) {
    if (!rel) continue;
    const abs = path.resolve(uploadsDir, rel);
    if (!abs.startsWith(root)) continue;
    try {
      fs.unlinkSync(abs);
    } catch {
      // already gone
    }
  }
}

module.exports = { EXT, storeFile, unlinkAll };
