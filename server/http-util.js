'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Reads the whole body but drains (instead of destroying the socket) when over the limit,
// so the client still receives a clean 413 response.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooBig = true;
        chunks.length = 0;
      } else if (!tooBig) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'payload too large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 100 * 1024) {
  const buf = await readBody(req, limit);
  if (buf.length === 0) return {};
  let value;
  try {
    // fatal: a non-UTF-8 client must get an error, not silently stored U+FFFD characters
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf));
  } catch {
    throw new HttpError(400, 'invalid json');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'json object expected');
  }
  return value;
}

function sendJson(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

module.exports = { HttpError, readBody, readJson, sendJson };
