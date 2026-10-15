const rateLimit = require('express-rate-limit');

function loopback(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function limiter(config, key, message = 'TOO_MANY_REQUESTS') {
  return rateLimit({
    windowMs: config.limits.windowMs,
    limit: config.limits[key],
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => config.mode !== 'production' && loopback(req),
    handler: (req, res) => {
      // Security telemetry only: never log credentials, tokens or cookies.
      if (config.mode !== 'test') console.warn('[security] rate limit', key, req.method, req.path, String(req.ip || '').slice(0, 64));
      res.status(429).json({ error: message });
    }
  });
}
module.exports = { limiter, loopback };
