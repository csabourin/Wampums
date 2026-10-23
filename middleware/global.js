const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('../config/swagger');
const logger = require('../config/logger');
const { sanitizeServerErrorResponses } = require('./response');
const { getStorageImageOrigins } = require('../utils/railway-storage');
const { isAllowedOrigin } = require('../config/cors');
const { setStaticHeaders } = require('../utils/static-cache');
const { LANDING_HOSTS, LANDING_BASE_URL, LANDING_STATIC_PAGES } = require('../config/landing-pages');
const { renderBlogIndex, renderBlogPost } = require('../services/blogPages');
const { landingLimiter, blogRefreshLimiter } = require('../config/rate-limit');

const isProduction = process.env.NODE_ENV === 'production';
const REQUEST_BODY_LIMIT = '20mb';

/**
 * Allow an analytics CSP source only on the public marketing hosts.
 * @param {string} origin - Google Analytics source expression.
 * @returns {function(import('express').Request): string} Helmet directive callback.
 */
function landingAnalyticsSource(origin) {
  return (req) => LANDING_HOSTS.has(req.hostname) ? origin : '';
}
// Stripe signs the exact bytes it sends; its route reads them with express.raw(),
// which finds nothing left once the JSON parser has consumed the body.
const RAW_BODY_PATHS = new Set(['/api/v1/stripe/webhook']);

/**
 * Resolve the preferred localized landing route from the incoming request.
 *
 * @param {import("express").Request} req - Incoming HTTP request.
 * @returns {"/fr/"|"/en/"} Preferred landing page path.
 */
function getPreferredLandingPath(req) {
  const requestedLang = typeof req.query.lang === 'string'
    ? req.query.lang.trim().toLowerCase()
    : '';

  if (requestedLang.startsWith('fr')) {
    return '/fr/';
  }

  if (requestedLang.startsWith('en')) {
    return '/en/';
  }

  // Use Express's req.acceptsLanguages which respects q-values and priority order
  // Only if Accept-Language header exists (otherwise acceptsLanguages returns first item in array)
  if (req.headers['accept-language']) {
    const preferred = typeof req.acceptsLanguages === 'function'
      ? req.acceptsLanguages(['fr', 'en'])
      : null;

    if (typeof preferred === 'string' && preferred.toLowerCase().startsWith('fr')) {
      return '/fr/';
    }
  }

  return '/en/';
}

/** Base URL for all canonical links */
const BASE_URL = LANDING_BASE_URL;

/**
 * Build the image CSP from fixed application sources and the exact configured
 * Railway bucket origin. Avoid allowing every tenant on storageapi.dev.
 * @returns {string[]}
 */
function getContentSecurityImageSources() {
  return [
    "'self'",
    'data:',
    'blob:',
    ...getStorageImageOrigins(),
    'https://www.gravatar.com',
  ];
}

/**
 * Build a sitemap <url> entry with hreflang.
 */
function sitemapUrl({ loc, enPath, frPath, lastmod, changefreq = 'monthly', priority = '0.8' }) {
  return `  <url>
    <loc>${BASE_URL}${loc}</loc>
    <xhtml:link rel="alternate" hreflang="en-CA" href="${BASE_URL}${enPath}"/>
    <xhtml:link rel="alternate" hreflang="fr-CA" href="${BASE_URL}${frPath}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}${enPath}"/>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

module.exports = (app) => {
  const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '20mb';

  // Trust proxy - use 1 (trust first proxy hop) instead of true
  // to avoid express-rate-limit ERR_ERL_PERMISSIVE_TRUST_PROXY warning
  app.set('trust proxy', 1);

  // Compression
  try {
    const compression = require('compression');
    app.use(compression());
  } catch (e) {
    logger.info('Compression not available');
  }

  // Body Parsing
  const jsonParser = express.json({ limit: REQUEST_BODY_LIMIT });
  app.use((req, res, next) => (RAW_BODY_PATHS.has(req.path) ? next() : jsonParser(req, res, next)));
  app.use(express.urlencoded({ limit: REQUEST_BODY_LIMIT, extended: true }));
  app.use(sanitizeServerErrorResponses);

  // ETag
  app.set('etag', 'strong');

  // Helmet / CSP
  const connectSrc = [
    "'self'",
    'https://cdn.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
    'https://demo.wampums.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  const apiBaseUrl = process.env.API_BASE_URL || process.env.VITE_API_BASE_URL;
  if (apiBaseUrl) {
    try {
      connectSrc.push(new URL(apiBaseUrl).origin);
    } catch (e) {
      console.warn('Invalid API_BASE_URL for CSP connectSrc', e);
    }
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://js.stripe.com', landingAnalyticsSource('https://*.googletagmanager.com')],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
          imgSrc: getContentSecurityImageSources().concat([
            landingAnalyticsSource('https://*.google-analytics.com'),
            landingAnalyticsSource('https://*.googletagmanager.com'),
          ]),
          connectSrc: connectSrc.concat([
            'https://api.stripe.com',
            landingAnalyticsSource('https://*.google-analytics.com'),
            landingAnalyticsSource('https://*.analytics.google.com'),
            landingAnalyticsSource('https://*.googletagmanager.com'),
          ]),
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ['https://js.stripe.com'],
          workerSrc: ["'self'", 'blob:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // CORS
  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin) {return callback(null, true);}
      if (isAllowedOrigin(origin)) {
        callback(null, origin);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
  };
  app.use(cors(corsOptions));

  // Static files
  const staticDir = isProduction ? path.join(process.cwd(), 'dist') : process.cwd();
  const landingDir = path.join(process.cwd(), 'landing');

  // Lazy-load blog service to avoid crashing on startup if content dir is missing
  let blogService = null;
  function getBlogService() {
    if (!blogService) {
      try {
        blogService = require('../services/blog');
      } catch (err) {
        logger.error('[Blog] Could not load blog service:', err.message);
      }
    }
    return blogService;
  }

  // Robots.txt (served on all hostnames)
  app.get('/robots.txt', (req, res) => {
    const isLanding = LANDING_HOSTS.has(req.hostname);
    res.type('text/plain');
    if (isLanding) {
      res.send([
        'User-agent: *',
        'Allow: /',
        '',
        '# Block authenticated app routes',
        'Disallow: /api/',
        'Disallow: /api-docs',
        'Disallow: /dashboard',
        'Disallow: /attendance',
        'Disallow: /badges',
        'Disallow: /activities',
        'Disallow: /finance',
        'Disallow: /budgets',
        'Disallow: /settings',
        'Disallow: /login',
        'Disallow: /register',
        'Disallow: /admin',
        'Disallow: /reports',
        'Disallow: /carpool',
        'Disallow: /communications',
        'Disallow: /form-builder',
        'Disallow: /manage-',
        'Disallow: /badge-',
        'Disallow: /medication',
        'Disallow: /permission-slips',
        'Disallow: /program-progress',
        '',
        `Sitemap: ${BASE_URL}/sitemap.xml`,
      ].join('\n'));
    } else {
      res.send('User-agent: *\nDisallow: /\n');
    }
  });

  // Per-language sitemaps were once static files listing a dozen pages each;
  // anything still pointing at them is sent to the complete one.
  app.get(['/en/sitemap.xml', '/fr/sitemap.xml'], (req, res) => res.redirect(301, '/sitemap.xml'));

  // Dynamic sitemap.xml
  app.get('/sitemap.xml', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const blog = getBlogService();
    const blogPosts = blog ? blog.getAllPosts() : [];

    const urlEntries = LANDING_STATIC_PAGES.map(p =>
      sitemapUrl({ loc: p.en, enPath: p.en, frPath: p.fr, lastmod: today, changefreq: p.freq, priority: p.pri })
    );

    for (const post of blogPosts) {
      const enSlug = post.lang === 'en' ? post.slug : (post.alternate || post.slug);
      const frSlug = post.lang === 'fr' ? post.slug : (post.alternate || post.slug);
      const enPath = `/en/blog/${enSlug}/`;
      const frPath = `/fr/blogue/${frSlug}/`;
      const loc = post.lang === 'en' ? enPath : frPath;
      urlEntries.push(sitemapUrl({ loc, enPath, frPath, lastmod: post.updated || post.date, changefreq: 'monthly', priority: '0.7' }));
    }

    res.type('application/xml');
    res.send([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
      '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      urlEntries.join('\n'),
      '</urlset>',
    ].join('\n'));
  });

  // Blog refresh endpoint (protected by secret)
  app.post('/api/blog/refresh', blogRefreshLimiter, (req, res) => {
    const secret = process.env.BLOG_REFRESH_SECRET;
    const provided = req.headers['x-refresh-secret'];
    if (secret && provided !== secret) {
      return res.status(401).json({ success: false, message: 'unauthorized' });
    }
    const blog = getBlogService();
    if (!blog) {
      return res.status(503).json({ success: false, message: 'blog_service_unavailable' });
    }
    blog.rebuild();
    const indexNow = require('../services/indexNow');
    if (indexNow.isIndexNowEnabled()) {
      indexNow.scheduleIndexNowSync(require('../config/database').pool);
    }
    return res.json({ success: true, message: 'blog_index_refreshed' });
  });

  const landingStatic = express.static(landingDir);

  // Middleware for wampums.app hostname: blog (SSR) + static landing pages
  app.use(landingLimiter, async (req, res, next) => {
    if (!LANDING_HOSTS.has(req.hostname)) {
      return next();
    }

    if (req.path === '/' || req.path === '/index.html') {
      return res.redirect(302, getPreferredLandingPath(req));
    }

    if (req.path === '/en' || req.path === '/fr') {
      return res.redirect(301, req.path === '/en' ? '/en/' : '/fr/');
    }

    if (req.path === '/landing' || req.path === '/landing/' || req.path === '/landing/index.html') {
      return res.redirect(302, getPreferredLandingPath(req));
    }

    // Trailing slash redirect for clean URLs. The target is rebuilt behind a
    // literal /en/ or /fr/, so it can only ever name a page on this site.
    const cleanUrl = /^\/(en|fr)\/(.+[^/])$/.exec(req.path);
    if (cleanUrl && !/\.[a-z]{2,4}$/i.test(req.path)) {
      const langPrefix = cleanUrl[1] === 'en' ? '/en/' : '/fr/';
      return res.redirect(301, `${langPrefix}${cleanUrl[2]}/`);
    }

    // Redirect retired URLs: legacy /fr/comparatif/ pages, the comparison that
    // named "Scouts Digital" (Scouts Canada's tools are MyScouts and ScoutsTracker),
    // and an old link to the bilingual article.
    const comparatifRedirects = {
      '/fr/comparatif/wampums-vs-scoutbook/': '/fr/comparer/wampums-vs-scoutbook/',
      '/fr/comparatif/wampums-vs-scouts-digital/': '/fr/comparer/wampums-vs-scoutstracker/',
      '/fr/comparer/wampums-vs-scouts-digital/': '/fr/comparer/wampums-vs-scoutstracker/',
      '/en/compare/wampums-vs-scouts-digital/': '/en/compare/wampums-vs-scoutstracker/',
      '/en/blog/bilingual-scout-challenges/': '/en/blog/bilingual-scout-group-challenges-canada/',
      '/fr/comparatif/wampums-vs-sporteasy/': '/fr/comparer/wampums-vs-sporteasy/',
      '/fr/comparatif/wampums-vs-spreadsheets/': '/fr/comparer/wampums-vs-tableurs/',
      '/fr/comparatif/wampums-vs-trooptrack/': '/fr/comparer/wampums-vs-trooptrack/',
    };
    if (comparatifRedirects[req.path]) {
      return res.redirect(301, comparatifRedirects[req.path]);
    }

    // --- Blog EN ---
    const enBlogIndex = req.path === '/en/blog' || req.path === '/en/blog/';
    const enBlogPost = req.path.match(/^\/en\/blog\/([^/]+)\/?$/);

    // --- Blog FR ---
    const frBlogIndex = req.path === '/fr/blogue' || req.path === '/fr/blogue/';
    const frBlogPost = req.path.match(/^\/fr\/blogue\/([^/]+)\/?$/);

    if (enBlogIndex || frBlogIndex || enBlogPost || frBlogPost) {
      const blog = getBlogService();
      if (!blog) {
        return res.status(503).send('Blog service unavailable');
      }

      try {
        const lang = (enBlogIndex || enBlogPost) ? 'en' : 'fr';

        if (enBlogIndex || frBlogIndex) {
          const page = Math.max(1, parseInt(req.query.page, 10) || 1);
          return res.send(await renderBlogIndex(blog, lang, page));
        }

        const html = await renderBlogPost(blog, lang, (enBlogPost || frBlogPost)[1]);
        if (!html) {
          return next();
        }
        return res.send(html);
      } catch (err) {
        logger.error('[Blog] Render error:', err);
        return next(err);
      }
    }

    return landingStatic(req, res, next);
  });

  // Browser modules must pass through Vite in development so bare imports
  // and import.meta.env are transformed. Redirect only top-level HTML
  // navigation; API, public, and module requests stay on Express.
  if (!isProduction) {
    const developmentWebOrigin = process.env.DEV_WEB_ORIGIN || 'http://localhost:5173';
    app.use((req, res, next) => {
      const acceptsHtml = req.headers.accept?.includes('text/html');
      const isApiPath = req.path.startsWith('/api')
                || req.path.startsWith('/public')
                || req.path.startsWith('/api-docs');

      if (req.method !== 'GET' || !acceptsHtml || isApiPath) {
        return next();
      }

      try {
        const target = new URL(developmentWebOrigin);
        const requestedUrl = new URL(req.originalUrl, 'http://wampums.local');
        target.pathname = requestedUrl.pathname;
        target.search = requestedUrl.search;
        return res.redirect(307, target.toString());
      } catch (error) {
        logger.warn(`Invalid DEV_WEB_ORIGIN; serving through Express: ${error.message}`);
        return next();
      }
    });
  }

  app.use('/vendor/fontawesome', express.static(path.join(process.cwd(), 'node_modules/@fortawesome/fontawesome-free')));

  app.use(express.static(staticDir, {
    setHeaders: (res, filepath, stat) => setStaticHeaders(res, filepath, stat, { staticRoot: staticDir, isProduction }),
  }));

  // In dev, also serve from assets/ so /images/... resolves to assets/images/...
  // matching Vite's publicDir: "assets" behaviour. In production Vite copies
  // publicDir into dist/ so the main staticDir already covers this.
  if (!isProduction) {
    app.use(express.static(path.join(process.cwd(), 'assets')));
  }

  // Swagger Documentation
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpecs, {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'Wampums API Documentation',
    }),
  );

  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpecs);
  });

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  logger.info('✅ Global middleware initialized');
};

module.exports.getContentSecurityImageSources = getContentSecurityImageSources;
