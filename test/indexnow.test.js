/*
 * IndexNow: search engines hear about the wampums.app pages that changed,
 * and only those.
 */
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { INDEXNOW } = require('../config/constants');
const { LANDING_STATIC_PAGES, BLOG_INDEX_PATHS } = require('../config/landing-pages');
const {
  meaningfulText,
  collectPages,
  syncIndexNow,
  scheduleIndexNowSync,
} = require('../services/indexNow');

const MINUTE = 60 * 1000;
const T0 = Date.parse('2026-10-22T12:00:00Z');

/** A pool whose only table is indexnow_submissions, with transactions and the advisory lock. */
function fakePool({ locked = false } = {}) {
  let table = new Map();
  let snapshot = null;
  const client = {
    query(sql, params = []) {
      if (sql === 'BEGIN') {
        snapshot = new Map(table);
      } else if (sql === 'ROLLBACK') {
        table = snapshot;
      } else if (sql.includes('pg_try_advisory_xact_lock')) {
        return Promise.resolve({ rows: [{ locked: !locked }] });
      } else if (sql.startsWith('SELECT url')) {
        return Promise.resolve({ rows: [...table.values()] });
      } else if (sql.includes('INSERT INTO public.indexnow_submissions')) {
        const [urls, fingerprints, at, status] = params;
        urls.forEach((url, i) => table.set(url, {
          url,
          fingerprint: fingerprints[i],
          submitted_at: at,
          removed_at: fingerprints[i] === null ? at : null,
          last_status: status,
        }));
      }
      return Promise.resolve({ rows: [] });
    },
    release() {},
  };
  return { connect: () => Promise.resolve(client), rows: () => table };
}

const okFetch = (status = 200) => jest.fn(() => Promise.resolve({ status }));
const submittedUrls = (fetchImpl, call = 0) => JSON.parse(fetchImpl.mock.calls[call][1].body).urlList;

const page = (title, text, extra = '') => `<!doctype html><html><head><title>${title}</title>
  <meta name="description" content="About ${title}"><style>.a{color:red}</style>
  <script>gtag('config','G-1')</script></head>
  <body><main class="hero ${extra}"><h1>${title}</h1><p>${text}</p><img src="x.png" alt="Leaders at camp"></main></body></html>`;

let landingDir;
const writePage = (urlPath, html) => {
  fs.mkdirSync(path.join(landingDir, urlPath), { recursive: true });
  fs.writeFileSync(path.join(landingDir, urlPath, 'index.html'), html);
};

const article = (fields) => ({
  date: '2026-02-01', updated: '', author: 'Wampums', category: 'guides', image: '', imageAlt: '',
  keywords: [], featured: false, readingTime: 1, toc: [], alternate: '', ...fields,
});
const HELLO = article({ lang: 'en', slug: 'hello', title: 'Hello', description: 'First post', content: '<p>Hi</p>' });

/** Enough of services/blog.js for the real templates to render. */
const blog = {
  posts: [
    HELLO,
    article({ lang: 'fr', slug: 'bonjour', title: 'Bonjour', description: 'Premier', content: '<p>Salut</p>' }),
  ],
  getAllPosts() { return this.posts; },
  getPosts(lang) {
    const posts = this.posts.filter((post) => post.lang === lang);
    return { posts, total: posts.length, pages: 1 };
  },
  getPost(lang, slug) { return this.posts.find((post) => post.lang === lang && post.slug === slug) || null; },
  getAdjacentPosts() { return { prev: null, next: null }; },
};

beforeEach(() => {
  landingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-'));
  writePage('/en/', page('Wampums', 'Run your scout unit.'));
  writePage('/fr/', page('Wampums', 'Gérez votre unité scoute.'));
});

afterEach(() => {
  fs.rmSync(landingDir, { recursive: true, force: true });
});

describe('what counts as a change', () => {
  test('the key file search engines fetch holds the key the server submits', () => {
    const keyFile = path.join(__dirname, '..', 'landing', `${INDEXNOW.KEY}.txt`);
    expect(fs.readFileSync(keyFile, 'utf8').trim()).toBe(INDEXNOW.KEY);
  });

  test('every page the sitemap lists is a file the site serves, so none is silently left out', () => {
    const blogIndexes = Object.values(BLOG_INDEX_PATHS);
    const missing = LANDING_STATIC_PAGES
      .flatMap((entry) => [entry.en, entry.fr])
      .filter((urlPath) => !blogIndexes.includes(urlPath))
      .filter((urlPath) => !fs.existsSync(path.join(__dirname, '..', 'landing', urlPath, 'index.html')));
    expect(missing).toEqual([]);
  });

  test('restyling a page, renaming its classes or changing its tracking script is not a change', () => {
    const before = page('Wampums', 'Run your scout unit.');
    const after = before
      .replace('color:red', 'color:blue')
      .replace('class="hero ', 'class="hero hero--wide ')
      .replace("'G-1'", "'G-2'")
      .replace('<p>', '<p class="lead">\n   ');
    expect(meaningfulText(after)).toBe(meaningfulText(before));
  });

  test('a new sentence, title, description or image description is a change', () => {
    const base = page('Wampums', 'Run your scout unit.');
    for (const changed of [
      page('Wampums', 'Run your scout unit offline.'),
      page('Wampums app', 'Run your scout unit.'),
      base.replace('About Wampums', 'All about Wampums'),
      base.replace('Leaders at camp', 'Youth at camp'),
    ]) {
      expect(meaningfulText(changed)).not.toBe(meaningfulText(base));
    }
  });

  test('an edit after an apostrophe in a description or image description is a change', () => {
    const base = page('Wampums', 'Run your scout unit.')
      .replace('About Wampums', "L'application avant")
      .replace('Leaders at camp', "L'unité au camp");
    expect(meaningfulText(base.replace('avant', 'après'))).not.toBe(meaningfulText(base));
    expect(meaningfulText(base.replace('au camp', 'en forêt'))).not.toBe(meaningfulText(base));
  });

  test('blog articles and both blog listings are tracked alongside the static pages', async () => {
    const urls = [...(await collectPages({ landingDir, blog })).keys()];
    expect(urls).toEqual(expect.arrayContaining([
      'https://wampums.app/en/',
      'https://wampums.app/fr/',
      'https://wampums.app/en/blog/',
      'https://wampums.app/fr/blogue/',
      'https://wampums.app/en/blog/hello/',
      'https://wampums.app/fr/blogue/bonjour/',
    ]));
  });
});

describe('submitting', () => {
  test('the first run announces every page, with the site host, key and key location', async () => {
    const pool = fakePool();
    const fetchImpl = okFetch();
    const result = await syncIndexNow({ pool, fetchImpl, now: T0, landingDir, blog });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe(INDEXNOW.ENDPOINT);
    expect(JSON.parse(request.body)).toEqual({
      host: 'wampums.app',
      key: INDEXNOW.KEY,
      keyLocation: `https://wampums.app/${INDEXNOW.KEY}.txt`,
      urlList: expect.arrayContaining(['https://wampums.app/en/', 'https://wampums.app/en/blog/hello/']),
    });
    expect(result.submitted).toHaveLength(6);
    expect(pool.rows().get('https://wampums.app/en/').last_status).toBe(200);
  });

  test('a redeploy that changes nothing a reader sees submits nothing', async () => {
    const pool = fakePool();
    await syncIndexNow({ pool, fetchImpl: okFetch(), now: T0, landingDir, blog });
    writePage('/en/', page('Wampums', 'Run your scout unit.', 'restyled'));

    const fetchImpl = okFetch();
    const result = await syncIndexNow({ pool, fetchImpl, now: T0 + 10 * MINUTE, landingDir, blog });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.submitted).toEqual([]);
  });

  test('an edited page is submitted on its own', async () => {
    const pool = fakePool();
    await syncIndexNow({ pool, fetchImpl: okFetch(), now: T0, landingDir, blog });
    writePage('/fr/', page('Wampums', 'Gérez votre unité scoute, même hors ligne.'));

    const fetchImpl = okFetch(202);
    await syncIndexNow({ pool, fetchImpl, now: T0 + 10 * MINUTE, landingDir, blog });
    expect(submittedUrls(fetchImpl)).toEqual(['https://wampums.app/fr/']);
  });

  test('a page edited again within five minutes waits, then goes out once the window passes', async () => {
    const pool = fakePool();
    await syncIndexNow({ pool, fetchImpl: okFetch(), now: T0, landingDir, blog });
    writePage('/en/', page('Wampums', 'Run your scout unit, now offline.'));

    const early = okFetch();
    const waiting = await syncIndexNow({ pool, fetchImpl: early, now: T0 + 2 * MINUTE, landingDir, blog });
    expect(early).not.toHaveBeenCalled();
    expect(waiting.deferred).toEqual(['https://wampums.app/en/']);
    expect(waiting.retryInMs).toBe(3 * MINUTE);

    const later = okFetch();
    await syncIndexNow({ pool, fetchImpl: later, now: T0 + 5 * MINUTE, landingDir, blog });
    expect(submittedUrls(later)).toEqual(['https://wampums.app/en/']);
  });

  test('a page that leaves the site is announced once as removed', async () => {
    const pool = fakePool();
    await syncIndexNow({ pool, fetchImpl: okFetch(), now: T0, landingDir, blog });
    blog.posts = blog.posts.filter((post) => post.slug !== 'hello');

    try {
      const removal = okFetch();
      await syncIndexNow({ pool, fetchImpl: removal, now: T0 + 10 * MINUTE, landingDir, blog });
      expect(submittedUrls(removal)).toEqual(['https://wampums.app/en/blog/', 'https://wampums.app/en/blog/hello/']);
      expect(pool.rows().get('https://wampums.app/en/blog/hello/').removed_at).not.toBeNull();

      const again = okFetch();
      await syncIndexNow({ pool, fetchImpl: again, now: T0 + 20 * MINUTE, landingDir, blog });
      expect(again).not.toHaveBeenCalled();
    } finally {
      blog.posts.unshift(HELLO);
    }
  });
});

test('changing what an article page displays beyond its text, such as its category, resubmits it', async () => {
  const pool = fakePool();
  await syncIndexNow({ pool, fetchImpl: okFetch(), now: T0, landingDir, blog });
  HELLO.category = 'news';
  try {
    const fetchImpl = okFetch();
    await syncIndexNow({ pool, fetchImpl, now: T0 + 10 * MINUTE, landingDir, blog });
    expect(submittedUrls(fetchImpl)).toEqual(['https://wampums.app/en/blog/hello/']);
  } finally {
    HELLO.category = 'guides';
  }
});

describe('when IndexNow does not take the pages', () => {
  test('a rate limit records nothing and asks to try again after the window', async () => {
    const pool = fakePool();
    const result = await syncIndexNow({ pool, fetchImpl: okFetch(429), now: T0, landingDir, blog });
    expect(result.submitted).toEqual([]);
    expect(result.retryInMs).toBe(INDEXNOW.DEBOUNCE_MS);
    expect(pool.rows().size).toBe(0);
  });

  test('a refused key records nothing and is not retried until the next deploy', async () => {
    const pool = fakePool();
    const result = await syncIndexNow({ pool, fetchImpl: okFetch(403), now: T0, landingDir, blog });
    expect(result.status).toBe(403);
    expect(result.retryInMs).toBeNull();
    expect(pool.rows().size).toBe(0);
  });

  test('a network failure records nothing and asks to try again', async () => {
    const pool = fakePool();
    const fetchImpl = jest.fn(() => Promise.reject(new Error('ECONNRESET')));
    const result = await syncIndexNow({ pool, fetchImpl, now: T0, landingDir, blog });
    expect(result.retryInMs).toBe(INDEXNOW.DEBOUNCE_MS);
    expect(pool.rows().size).toBe(0);
  });

  test('while another instance is submitting, this one sends nothing', async () => {
    const fetchImpl = okFetch();
    const result = await syncIndexNow({ pool: fakePool({ locked: true }), fetchImpl, now: T0, landingDir, blog });
    expect(result.skipped).toBe('locked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

test('a deployment without INDEXNOW_ENABLED never schedules a submission', () => {
  const previous = process.env.INDEXNOW_ENABLED;
  delete process.env.INDEXNOW_ENABLED;
  try {
    expect(scheduleIndexNowSync(fakePool())).toBe(false);
  } finally {
    if (previous !== undefined) {
      process.env.INDEXNOW_ENABLED = previous;
    }
  }
});
