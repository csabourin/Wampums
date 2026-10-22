/**
 * Blog pages of wampums.app as readers receive them.
 *
 * The landing middleware serves these pages, and IndexNow fingerprints the
 * same output, so a change to a template, a shared partial or any displayed
 * field is seen by both.
 *
 * @module services/blogPages
 */

const path = require('path');
const ejs = require('ejs');
const { BLOG_INDEX_PATHS } = require('../config/landing-pages');

/** Views directory for EJS templates */
const VIEWS_DIR = path.join(process.cwd(), 'views');

const BLOG_POSTS_PER_PAGE = 10;

const LISTING_COPY = {
  en: {
    pageTitle: 'Wampums Blog — Resources for Scout Leaders',
    pageDescription: 'Guides, tips, and resources for scout leaders, parents, and administrators of bilingual youth groups in Canada.',
  },
  fr: {
    pageTitle: 'Blogue Wampums — Ressources pour chefs scouts',
    pageDescription: 'Guides, conseils et ressources pour les chefs scouts, parents et administrateurs de groupes jeunesse bilingues au Canada.',
  },
};

/**
 * Render an EJS template file with provided locals.
 * @param {string} template - relative path under views/ (e.g. 'blog/index.ejs')
 * @param {Object} locals
 * @returns {Promise<string>}
 */
function renderView(template, locals) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(path.join(VIEWS_DIR, template), locals, { rmWhitespace: false }, (err, html) => {
      if (err) {reject(err);}
      else {resolve(html);}
    });
  });
}

/**
 * One page of a language's blog listing.
 * @param {Object} blog - services/blog.js
 * @param {'en'|'fr'} lang
 * @param {number} [page] - 1-based
 * @returns {Promise<string>} HTML
 */
function renderBlogIndex(blog, lang, page = 1) {
  const { posts, total, pages } = blog.getPosts(lang, page, BLOG_POSTS_PER_PAGE);
  return renderView('blog/index.ejs', {
    lang,
    posts,
    page,
    pages,
    total,
    canonicalPath: BLOG_INDEX_PATHS[lang],
    enPath: BLOG_INDEX_PATHS.en,
    frPath: BLOG_INDEX_PATHS.fr,
    ...LISTING_COPY[lang],
    ogImage: null,
  });
}

/**
 * One article, with its neighbours and its translation linked.
 * @param {Object} blog - services/blog.js
 * @param {'en'|'fr'} lang
 * @param {string} slug
 * @returns {Promise<string|null>} HTML, or null when no such article exists
 */
function renderBlogPost(blog, lang, slug) {
  const post = blog.getPost(lang, slug);
  if (!post) {
    return Promise.resolve(null);
  }
  const otherLang = lang === 'en' ? 'fr' : 'en';
  const { prev, next } = blog.getAdjacentPosts(post);
  const alternatePost = post.alternate ? blog.getPost(otherLang, post.alternate) : null;
  const canonicalPath = `${BLOG_INDEX_PATHS[lang]}${slug}/`;
  const alternatePath = alternatePost ? `${BLOG_INDEX_PATHS[otherLang]}${alternatePost.slug}/` : BLOG_INDEX_PATHS[otherLang];

  return renderView('blog/post.ejs', {
    post,
    prev,
    next,
    alternatePost,
    canonicalPath,
    enPath: lang === 'en' ? canonicalPath : alternatePath,
    frPath: lang === 'fr' ? canonicalPath : alternatePath,
  });
}

module.exports = { renderBlogIndex, renderBlogPost };
