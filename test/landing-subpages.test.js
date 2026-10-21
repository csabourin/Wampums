/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
/*
 * The public site's inner pages (features, modules, comparisons, FAQ, blog)
 * share the home page's look: its stylesheet, header, footer and demo dialog.
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const axe = require('axe-core');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const LANDING = path.join(__dirname, '..', 'landing');
const VIEWS = path.join(__dirname, '..', 'views');

/** Every static page except the two home pages, as paths like /fr/modules/finance/. */
function innerPages() {
  const found = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'index.html') {
        found.push(`/${path.relative(LANDING, path.dirname(full)).split(path.sep).join('/')}/`);
      }
    });
  };
  ['en', 'fr'].forEach((lang) => fs.readdirSync(path.join(LANDING, lang), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .forEach((entry) => walk(path.join(LANDING, lang, entry.name))));
  return found.sort();
}

const read = (pagePath) => fs.readFileSync(path.join(LANDING, pagePath, 'index.html'), 'utf8');

/** Put a page in the document and run the site script, as the browser would. */
function load(html) {
  document.documentElement.lang = /<html lang="([^"]+)"/.exec(html)[1];
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)[1];
  jest.isolateModules(() => {
    require('../landing/landing.js');
  });
}

const PAGES = innerPages();

const BLOG_POST = {
  lang: 'fr',
  slug: 'premier-article',
  title: 'Premier <article>',
  description: 'Un résumé.',
  date: '2026-10-01',
  updated: '2026-10-02',
  readingTime: 4,
  category: 'guides',
  image: 'https://wampums.app/images/og-wampums-1200x630.jpg',
  toc: [],
  content: '<p>Bonjour.</p>',
};

function renderBlog(template, locals) {
  return ejs.renderFile(path.join(VIEWS, 'blog', template), locals);
}

describe('inner pages of the public site', () => {
  test('every feature, module, comparison and FAQ page is found', () => {
    expect(PAGES).toEqual(expect.arrayContaining([
      '/en/faq/', '/fr/faq/', '/fr/modules/finance/', '/en/features/attendance/', '/fr/comparer/wampums-vs-tableurs/',
    ]));
    expect(PAGES.length).toBeGreaterThanOrEqual(36);
  });

  test.each(PAGES)('%s uses the home page stylesheet, header, footer and demo dialog', (pagePath) => {
    const html = read(pagePath);
    expect(html).toContain('<link rel="stylesheet" href="/site.css" />');
    expect(html).not.toMatch(/landing\.css|marketing\.css|class="top-bar"/);
    expect(html).toContain('<header class="site-header">');
    expect(html).toContain('<footer class="site-footer">');
    expect(html).toContain('id="demoModal"');
    expect(html).toContain('<script src="/landing.js" defer></script>');
    expect(html).not.toMatch(/btn-primary|btn-secondary/);
  });

  test.each(PAGES)('%s switches language to its own translation', (pagePath) => {
    const html = read(pagePath);
    const lang = pagePath.slice(1, 3);
    const other = lang === 'en' ? 'fr' : 'en';
    const alternate = new RegExp(`hreflang="${other}(?:-CA)?" href="https://wampums\\.app([^"]+)"`).exec(html)[1];
    const switcher = /<span class="lang-switch">([\s\S]*?)<\/span>\s*<\/nav>/.exec(html)[1];
    expect(switcher).toContain(`<a href="${pagePath}" lang="${lang}-CA" aria-current="page">`);
    expect(switcher).toContain(`<a href="${alternate}" lang="${other}-CA"`);
  });

  test.each(PAGES.filter((pagePath) => !pagePath.endsWith('/faq/')))('%s shows a real screen of the app in its own language', (pagePath) => {
    const html = read(pagePath);
    const lang = pagePath.slice(1, 3);
    expect(html).not.toMatch(/screenshot-placeholder|coming soon|bientôt disponible/i);

    const shots = [...html.matchAll(/<figure class="app-shot">[\s\S]*?<img src="([^"]+)"[^>]*alt="([^"]+)"[\s\S]*?<figcaption>([^<]+)<\/figcaption>/g)];
    expect(shots).toHaveLength(1);
    const [, src, alt, caption] = shots[0];
    expect(src).toMatch(new RegExp(`^/images/screenshots/[a-z]+-${lang}\\.webp$`));
    expect(fs.existsSync(path.join(LANDING, src))).toBe(true);
    expect(alt.length).toBeGreaterThan(40);
    expect(caption.trim().length).toBeGreaterThan(10);
  });

  test('every screenshot in the images folder is shown on a page', () => {
    const shown = new Set(PAGES.flatMap((pagePath) => [...read(pagePath).matchAll(/src="\/images\/screenshots\/([^"]+)"/g)].map((match) => match[1])));
    const files = fs.readdirSync(path.join(LANDING, 'images', 'screenshots'));
    expect(files.filter((file) => !shown.has(file))).toEqual([]);
  });

  test('a module page offers the demo dialog from its call to action, and Escape returns focus', () => {
    load(read('/fr/modules/finance/'));
    const opener = document.querySelector('.final [data-open-demo-modal]');
    opener.click();
    expect(document.getElementById('demoModal').hidden).toBe(false);

    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.getElementById('demoModal').hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  test.each([
    '/en/faq/', '/fr/faq/', '/fr/modules/finance/', '/en/features/attendance/',
    '/fr/comparer/wampums-vs-trooptrack/', '/en/compare/wampums-vs-scoutbook/',
  ])('%s has no accessibility violations', async (pagePath) => {
    load(read(pagePath));
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);
  });
});

describe('blog pages', () => {
  const paths = { enPath: '/en/blog/first-post/', frPath: '/fr/blogue/premier-article/' };

  test('an article uses the home page look, links its translation and escapes its title', async () => {
    const html = await renderBlog('post.ejs', {
      post: BLOG_POST, prev: null, next: null, alternatePost: null, canonicalPath: paths.frPath, ...paths,
    });
    expect(html).toContain('href="/site.css"');
    expect(html).toContain('<footer class="site-footer">');
    expect(html).toContain('id="demoModal"');
    expect(html).toContain('<h1>Premier &lt;article&gt;</h1>');
    expect(html).toContain('<a href="/en/blog/first-post/" lang="en-CA" hreflang="en-CA">EN');

    load(html);
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);
  });

  test('the list of articles uses the home page look and has no accessibility violations', async () => {
    const html = await renderBlog('index.ejs', {
      lang: 'en', posts: [{ ...BLOG_POST, lang: 'en', title: 'First post' }], page: 1, pages: 2, total: 1,
      canonicalPath: '/en/blog/', enPath: '/en/blog/', frPath: '/fr/blogue/',
      pageTitle: 'Wampums Blog', pageDescription: 'Guides.', ogImage: null,
    });
    expect(html).toContain('href="/site.css"');
    expect(html).toContain('<a class="nav-pages" href="/en/blog/" aria-current="page">Blog</a>');

    load(html);
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);
  });
});
