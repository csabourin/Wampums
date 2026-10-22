/**
 * IndexNow — tells search engines which wampums.app pages changed.
 *
 * After a deploy (and after a blog refresh), every public page is fingerprinted
 * from what a reader sees: its title, meta description, image descriptions and
 * visible text. Markup, classes, styles and scripts are left out, so a layout
 * or tracking change submits nothing. Only pages that are new, whose
 * fingerprint changed, or that left the site are submitted, and a page
 * submitted less than INDEXNOW.DEBOUNCE_MS ago waits for the window to pass.
 *
 * What was sent is kept in `indexnow_submissions` (migration 040): a container
 * does not outlive a deploy. A transaction-level advisory lock lets only one
 * process submit at a time, should a deploy briefly overlap two.
 *
 * Submissions run only where INDEXNOW_ENABLED=true (production's app.env), so a
 * development server never announces pages.
 *
 * @module services/indexNow
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');
const { INDEXNOW } = require('../config/constants');
const { LANDING_BASE_URL, BLOG_INDEX_PATHS, LANDING_STATIC_PAGES } = require('../config/landing-pages');

const LANDING_DIR = path.join(process.cwd(), 'landing');
const ACCEPTED_STATUSES = new Set(INDEXNOW.ACCEPTED_STATUSES);

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} Whether this deployment announces pages
 */
function isIndexNowEnabled(env = process.env) {
  return env.INDEXNOW_ENABLED === 'true';
}

/**
 * Text a reader sees on a page, without the markup that lays it out.
 * @param {string} html - Page or article HTML
 * @returns {string} Whitespace-normalised text
 */
function meaningfulText(html) {
  const source = String(html || '');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] || '';
  const description = /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(source)?.[1] || '';
  const alts = [...source.matchAll(/<img\b[^>]*\balt=["']([^"']*)["']/gi)].map((match) => match[1]);
  const body = source
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return [title, description, ...alts, body].join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} content - Anything JSON-serialisable
 * @returns {string} SHA-256 hex digest
 */
function fingerprint(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Fingerprint every public page the site serves right now.
 * @param {Object} [options]
 * @param {string} [options.landingDir] - Directory of the static pages
 * @param {{ getAllPosts: Function }|null} [options.blog] - Blog index (services/blog.js)
 * @returns {Map<string, string>} Absolute URL → fingerprint
 */
function collectPages({ landingDir = LANDING_DIR, blog = null } = {}) {
  const pages = new Map();
  const blogIndexes = new Set(Object.values(BLOG_INDEX_PATHS));

  for (const page of LANDING_STATIC_PAGES) {
    for (const pagePath of [page.en, page.fr]) {
      if (blogIndexes.has(pagePath)) {
        continue;
      }
      const file = path.join(landingDir, pagePath, 'index.html');
      if (fs.existsSync(file)) {
        pages.set(`${LANDING_BASE_URL}${pagePath}`, fingerprint(meaningfulText(fs.readFileSync(file, 'utf8'))));
      }
    }
  }

  if (!blog) {
    return pages;
  }
  const posts = blog.getAllPosts();
  for (const [lang, indexPath] of Object.entries(BLOG_INDEX_PATHS)) {
    const listed = posts
      .filter((post) => post.lang === lang)
      .map((post) => [post.slug, post.title, post.description, post.date]);
    pages.set(`${LANDING_BASE_URL}${indexPath}`, fingerprint(listed));
  }
  for (const post of posts) {
    const indexPath = BLOG_INDEX_PATHS[post.lang];
    if (!indexPath) {
      continue;
    }
    pages.set(`${LANDING_BASE_URL}${indexPath}${post.slug}/`, fingerprint([
      post.title,
      post.description,
      post.updated || post.date,
      meaningfulText(post.content),
    ]));
  }
  return pages;
}

/**
 * Decide what to submit by comparing the site with what was last sent.
 * @param {Map<string, string>} current - URL → fingerprint, from collectPages()
 * @param {Array<{url: string, fingerprint: string|null, submitted_at: Date, removed_at: Date|null}>} previous
 * @param {number} now - Epoch milliseconds
 * @param {number} [debounceMs]
 * @returns {{ submit: Array<{url: string, fingerprint: string|null}>, deferred: string[], retryInMs: number|null }}
 *   A null fingerprint marks a page that left the site.
 */
function planSubmissions(current, previous, now, debounceMs = INDEXNOW.DEBOUNCE_MS) {
  const submit = [];
  const deferred = [];
  let retryInMs = null;
  const previousByUrl = new Map(previous.map((row) => [row.url, row]));

  const consider = (url, nextFingerprint) => {
    const row = previousByUrl.get(url);
    const elapsed = row ? now - new Date(row.submitted_at).getTime() : Infinity;
    if (elapsed < debounceMs) {
      deferred.push(url);
      retryInMs = Math.min(retryInMs ?? Infinity, debounceMs - elapsed);
      return;
    }
    submit.push({ url, fingerprint: nextFingerprint });
  };

  for (const [url, pageFingerprint] of current) {
    const row = previousByUrl.get(url);
    if (!row || row.fingerprint !== pageFingerprint) {
      consider(url, pageFingerprint);
    }
  }
  for (const row of previous) {
    if (!current.has(row.url) && !row.removed_at) {
      consider(row.url, null);
    }
  }
  return { submit, deferred, retryInMs };
}

/**
 * Send one batch of URLs to IndexNow.
 * @param {string[]} urls - Absolute URLs on LANDING_BASE_URL
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<number>} HTTP status
 */
async function postUrls(urls, fetchImpl) {
  const response = await fetchImpl(INDEXNOW.ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(LANDING_BASE_URL).host,
      key: INDEXNOW.KEY,
      keyLocation: `${LANDING_BASE_URL}/${INDEXNOW.KEY}.txt`,
      urlList: urls,
    }),
    signal: AbortSignal.timeout(INDEXNOW.REQUEST_TIMEOUT_MS),
  });
  return response.status;
}

/**
 * Submit the pages that changed since the last submission, and record them.
 * @param {Object} options
 * @param {import('pg').Pool} options.pool
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.now] - Epoch milliseconds
 * @param {string} [options.landingDir]
 * @param {{ getAllPosts: Function }|null} [options.blog]
 * @returns {Promise<{ submitted: string[], deferred: string[], retryInMs: number|null, status: number|null, skipped?: string }>}
 *   `retryInMs` asks the caller to run again: pages are waiting out their window,
 *   or IndexNow could not take them yet.
 */
async function syncIndexNow({ pool, fetchImpl = fetch, now = Date.now(), landingDir, blog = null }) {
  const current = collectPages({ landingDir, blog });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [INDEXNOW.ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.locked) {
      await client.query('ROLLBACK');
      return { submitted: [], deferred: [], retryInMs: null, status: null, skipped: 'locked' };
    }

    const previous = await client.query(
      'SELECT url, fingerprint, submitted_at, removed_at FROM public.indexnow_submissions'
    );
    const plan = planSubmissions(current, previous.rows, now);
    if (plan.deferred.length > 0) {
      logger.info(`[IndexNow] ${plan.deferred.length} page(s) submitted within the debounce window wait their turn`);
    }
    if (plan.submit.length === 0) {
      await client.query('COMMIT');
      return { submitted: [], deferred: plan.deferred, retryInMs: plan.retryInMs, status: null };
    }

    const submitted = [];
    let status = null;
    let retryInMs = plan.retryInMs;
    for (let start = 0; start < plan.submit.length; start += INDEXNOW.MAX_URLS_PER_REQUEST) {
      const batch = plan.submit.slice(start, start + INDEXNOW.MAX_URLS_PER_REQUEST);
      const urls = batch.map((entry) => entry.url);
      try {
        // eslint-disable-next-line no-await-in-loop -- batches go one after another, to stay under the rate limit
        status = await postUrls(urls, fetchImpl);
      } catch (err) {
        logger.error(`[IndexNow] Submission of ${urls.length} URL(s) failed: ${err.message}`);
        retryInMs = INDEXNOW.DEBOUNCE_MS;
        break;
      }
      if (!ACCEPTED_STATUSES.has(status)) {
        const level = status === INDEXNOW.RATE_LIMITED_STATUS ? 'warn' : 'error';
        logger[level](`[IndexNow] ${urls.length} URL(s) refused with HTTP ${status}`);
        if (status === INDEXNOW.RATE_LIMITED_STATUS) {
          retryInMs = INDEXNOW.DEBOUNCE_MS;
        }
        break;
      }
      logger.info(`[IndexNow] Submitted ${urls.length} URL(s), HTTP ${status}: ${urls.join(' ')}`);
      // eslint-disable-next-line no-await-in-loop -- each accepted batch is recorded before the next is sent
      await client.query(
        `INSERT INTO public.indexnow_submissions (url, fingerprint, submitted_at, removed_at, last_status)
         SELECT entry.url, entry.fingerprint, $3::timestamptz,
                CASE WHEN entry.fingerprint IS NULL THEN $3::timestamptz END, $4::integer
         FROM unnest($1::text[], $2::text[]) AS entry(url, fingerprint)
         ON CONFLICT (url) DO UPDATE SET
           fingerprint = EXCLUDED.fingerprint,
           submitted_at = EXCLUDED.submitted_at,
           removed_at = EXCLUDED.removed_at,
           last_status = EXCLUDED.last_status`,
        [urls, batch.map((entry) => entry.fingerprint), new Date(now), status]
      );
      submitted.push(...urls);
    }
    await client.query('COMMIT');
    return { submitted, deferred: plan.deferred, retryInMs, status };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let pendingTimer = null;

/**
 * Run syncIndexNow() after a delay, and again while pages are waiting.
 * A request made while one is pending replaces it, so bursts submit once.
 * @param {import('pg').Pool} pool
 * @param {Object} [options]
 * @param {number} [options.delayMs]
 * @param {number} [options.attempt] - Retries already made
 * @returns {boolean} Whether a submission was scheduled
 */
function scheduleIndexNowSync(pool, { delayMs = 0, attempt = 0 } = {}) {
  if (!isIndexNowEnabled()) {
    return false;
  }
  if (pendingTimer) {
    clearTimeout(pendingTimer);
  }
  pendingTimer = setTimeout(async () => {
    pendingTimer = null;
    try {
      const result = await syncIndexNow({ pool, blog: require('./blog') });
      if (result.retryInMs !== null && attempt < INDEXNOW.MAX_RETRIES) {
        scheduleIndexNowSync(pool, { delayMs: result.retryInMs, attempt: attempt + 1 });
      }
    } catch (err) {
      logger.error(`[IndexNow] Sync failed: ${err.message}`);
    }
  }, delayMs);
  pendingTimer.unref?.();
  return true;
}

module.exports = {
  isIndexNowEnabled,
  meaningfulText,
  fingerprint,
  collectPages,
  planSubmissions,
  syncIndexNow,
  scheduleIndexNowSync,
};
