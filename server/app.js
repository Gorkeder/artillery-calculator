'use strict';

const { HttpError, sendJson } = require('./http-util');
const { parseCookies, getSessionUser, touchSession, createRateLimiter } = require('./auth');
const { createUnconfiguredMailer } = require('./mailer');

const ROUTE_MODULES = [
  require('./routes/auth'),
  require('./routes/account'),
  require('./routes/content'),
  require('./routes/images'),
];

function compile(pattern) {
  const keys = [];
  const source = pattern.replace(/:([a-z]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { re: new RegExp('^' + source + '/?$'), keys };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function createApp(opts) {
  const { db, uploadsDir, cookieSecure = true, now = Date.now } = opts;
  const mailer = opts.mailer || createUnconfiguredMailer();
  const publicUrl = (opts.publicUrl || 'https://anoma-wiki.ru').replace(/\/+$/, '');
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const limiters = {
    login: opts.loginLimiter || createRateLimiter({ max: 10, windowMs: 10 * MIN }),
    loginAccount: createRateLimiter({ max: 10, windowMs: 10 * MIN }),
    registerIp: createRateLimiter({ max: 5, windowMs: HOUR }),
    registerEmail: createRateLimiter({ max: 3, windowMs: 24 * HOUR }),
    mailIp: createRateLimiter({ max: 10, windowMs: HOUR }),
    mailEmail: createRateLimiter({ max: 3, windowMs: HOUR }),
    ...(opts.limiters || {}),
  };
  const routes = ROUTE_MODULES.flat().map((r) => ({ ...r, ...compile(r.pattern) }));

  return async function app(req, res) {
    try {
      // CSRF guard first: a cross-site form/fetch cannot set this header without a CORS preflight.
      if (req.method !== 'GET' && !req.headers['x-requested-with']) {
        throw new HttpError(403, 'missing X-Requested-With header');
      }
      const url = new URL(req.url, 'http://localhost');
      let route = null;
      const params = {};
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        route = r;
        try {
          r.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
        } catch {
          throw new HttpError(400, 'bad url encoding');
        }
        break;
      }
      if (!route) throw new HttpError(404, 'not found');
      const token = parseCookies(req.headers.cookie).sid || null;
      const user = getSessionUser(db, token, now());
      if (user) touchSession(db, token, now());
      const ip = clientIp(req);
      const c = {
        db, uploadsDir, cookieSecure, now, req, res,
        loginLimiter: limiters.login, limiters, mailer, publicUrl,
        params, query: url.searchParams, user, token, headers: {}, ip,
        clientMeta: { ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) },
      };
      const result = await route.handler(c);
      sendJson(res, result.status || 200, result.body === undefined ? { ok: true } : result.body, c.headers);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      return sendJson(res, 500, { error: 'internal error' });
    }
  };
}

module.exports = { createApp };
