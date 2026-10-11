'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const DENY = /^\/(\.|server(\/|$)|tools(\/|$)|docs(\/|$)|node_modules(\/|$))/;

// DEV ONLY: lets `node server/index.js` serve the whole site from one origin on localhost.
// In production nginx serves static files and /uploads/.
function createStaticHandler({ root, uploadsDir }) {
  const rootDir = path.resolve(root);
  const uploadsRoot = path.resolve(uploadsDir);

  function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }

  return function serve(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return notFound(res);
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/map') pathname = '/map.html';
    if (pathname === '/account') pathname = '/account.html';
    if (pathname === '/privacy') pathname = '/privacy.html';

    let base = rootDir;
    let rel = pathname;
    if (pathname.startsWith('/uploads/')) {
      base = uploadsRoot;
      rel = pathname.slice('/uploads'.length);
    } else if (DENY.test(pathname)) {
      return notFound(res);
    }
    const abs = path.resolve(base, '.' + rel);
    if (!abs.startsWith(base + path.sep)) return notFound(res);
    fs.stat(abs, (err, st) => {
      if (err || !st.isFile()) return notFound(res);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(abs).pipe(res);
    });
  };
}

module.exports = { createStaticHandler };
