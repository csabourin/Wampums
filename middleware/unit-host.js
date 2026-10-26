const { baseDomain } = require('../config/unit_subdomains.json');
const { LANDING_HOSTS, LANDING_BASE_URL } = require('../config/landing-pages');
const { generalLimiter } = require('../config/rate-limit');

const HTTP_FOUND = 302;
const UNIT_HOST_SUFFIX = `.${baseDomain}`;

/**
 * Send unassigned unit subdomains to the public home page before serving any
 * app routes or static files. Only exact domain assignments count here; a
 * public organization header or legacy wildcard cannot claim an unused name.
 * Database failures go to the error handler rather than redirecting real units.
 *
 * @param {import('express').Request} req - Incoming request.
 * @param {import('express').Response} res - Outgoing response.
 * @param {import('express').NextFunction} next - Continue the request.
 * @returns {Promise<*>} Middleware result.
 */
async function redirectUnassignedUnitHost(req, res, next) {
  const hostname = req.hostname.toLowerCase().replace(/\.$/, '');
  if (LANDING_HOSTS.has(hostname) || !hostname.endsWith(UNIT_HOST_SUFFIX)) {
    return next();
  }

  try {
    const result = await req.app.locals.pool.query(
      'SELECT 1 FROM organization_domains WHERE lower(domain) = $1 LIMIT 1',
      [hostname],
    );
    if (result.rows.length > 0) {
      return next();
    }

    return generalLimiter(req, res, () => {
      // A unit may claim this hostname later. Do not cache its current absence
      // or forward invitation tokens and other query data to the marketing site.
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
      return res.redirect(HTTP_FOUND, `${LANDING_BASE_URL}/`);
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { redirectUnassignedUnitHost };
