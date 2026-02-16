/**
 * Blog Service
 *
 * Loads and parses Markdown blog articles from content/blog/{en,fr}/ at startup.
 * Maintains an in-memory index for fast serving.
 * Supports in-place refresh without server restart.
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');
const logger = require('../config/logger');

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog');

// Renderer for marked that adds IDs to headings for ToC
const renderer = new marked.Renderer();
renderer.heading = function ({ tokens, depth }) {
    const text = tokens.map(t => t.raw || t.text || '').join('');
    const id = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
    return `<h${depth} id="${id}">${text}</h${depth}>\n`;
};

marked.setOptions({ renderer, gfm: true, breaks: false });

/**
 * @typedef {Object} BlogPost
 * @property {string} slug
 * @property {string} title
 * @property {string} date
 * @property {string} updated
 * @property {string} lang
 * @property {string} alternate
 * @property {string} description
 * @property {string[]} keywords
 * @property {string} author
 * @property {string} category
 * @property {boolean} featured
 * @property {string} image
 * @property {string} imageAlt
 * @property {string} content  - rendered HTML
 * @property {number} readingTime  - estimated minutes
 * @property {Array<{id: string, text: string, level: number}>} toc
 */

/** @type {{ en: BlogPost[], fr: BlogPost[] }} */
let index = { en: [], fr: [] };

/** @type {Map<string, BlogPost>} slug → post */
const slugMap = new Map();

/**
 * Extract table of contents from rendered HTML
 * @param {string} html
 * @returns {Array<{id: string, text: string, level: number}>}
 */
function extractToc(html) {
    const toc = [];
    const re = /<h([23]) id="([^"]+)">([^<]+)<\/h[23]>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        toc.push({ level: parseInt(m[1], 10), id: m[2], text: m[3] });
    }
    return toc;
}

/**
 * Estimate reading time in minutes
 * @param {string} markdown
 * @returns {number}
 */
function readingTime(markdown) {
    const words = markdown.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
}

/**
 * Parse a single Markdown file into a BlogPost object.
 * @param {string} filepath
 * @param {string} lang
 * @returns {BlogPost|null}
 */
function parseFile(filepath, lang) {
    try {
        const src = fs.readFileSync(filepath, 'utf8');
        const { data, content } = matter(src);

        if (!data.slug || !data.title) {
            logger.warn(`[Blog] Skipping ${filepath}: missing slug or title`);
            return null;
        }

        const html = marked(content);
        const toc = extractToc(html);
        const rt = readingTime(content);

        return {
            slug: data.slug,
            title: data.title,
            date: data.date || new Date().toISOString().slice(0, 10),
            updated: data.updated || data.date || new Date().toISOString().slice(0, 10),
            lang: data.lang || lang,
            alternate: data.alternate || '',
            description: data.description || '',
            keywords: Array.isArray(data.keywords) ? data.keywords : [],
            author: data.author || 'Wampums Team',
            category: data.category || 'guides',
            featured: data.featured || false,
            image: data.image || '/images/og-wampums-1200x630.jpg',
            imageAlt: data.imageAlt || data.title,
            content: html,
            readingTime: rt,
            toc,
        };
    } catch (err) {
        logger.error(`[Blog] Error parsing ${filepath}:`, err);
        return null;
    }
}

/**
 * Load all posts for a given language from disk.
 * @param {string} lang
 * @returns {BlogPost[]}
 */
function loadLang(lang) {
    const dir = path.join(BLOG_DIR, lang);
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    const posts = [];

    for (const file of files) {
        const post = parseFile(path.join(dir, file), lang);
        if (post) posts.push(post);
    }

    // Sort newest first
    posts.sort((a, b) => b.date.localeCompare(a.date));
    return posts;
}

/**
 * Rebuild the in-memory index from disk.
 */
function rebuild() {
    slugMap.clear();

    index.en = loadLang('en');
    index.fr = loadLang('fr');

    for (const post of [...index.en, ...index.fr]) {
        slugMap.set(`${post.lang}:${post.slug}`, post);
    }

    logger.info(`[Blog] Index rebuilt: ${index.en.length} EN, ${index.fr.length} FR`);
}

/**
 * Get paginated posts for a language.
 * @param {string} lang
 * @param {number} page  1-based
 * @param {number} perPage
 * @returns {{ posts: BlogPost[], total: number, pages: number }}
 */
function getPosts(lang, page = 1, perPage = 10) {
    const all = index[lang] || [];
    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;
    const posts = all.slice(start, start + perPage);
    return { posts, total, pages };
}

/**
 * Get a single post by language and slug.
 * @param {string} lang
 * @param {string} slug
 * @returns {BlogPost|null}
 */
function getPost(lang, slug) {
    return slugMap.get(`${lang}:${slug}`) || null;
}

/**
 * Get previous and next posts relative to a given post.
 * @param {BlogPost} post
 * @returns {{ prev: BlogPost|null, next: BlogPost|null }}
 */
function getAdjacentPosts(post) {
    const all = index[post.lang] || [];
    const idx = all.findIndex(p => p.slug === post.slug);
    return {
        prev: idx > 0 ? all[idx - 1] : null,
        next: idx < all.length - 1 ? all[idx + 1] : null,
    };
}

/**
 * Get all posts for sitemap generation.
 * @returns {BlogPost[]}
 */
function getAllPosts() {
    return [...index.en, ...index.fr];
}

// Initial load
rebuild();

// Watch for changes in development
if (process.env.NODE_ENV !== 'production') {
    try {
        fs.watch(BLOG_DIR, { recursive: true }, (event, filename) => {
            if (filename && filename.endsWith('.md')) {
                logger.info(`[Blog] File changed: ${filename}, rebuilding index…`);
                rebuild();
            }
        });
        logger.info('[Blog] Watching content/blog/ for changes');
    } catch (err) {
        logger.warn('[Blog] File watching not available:', err.message);
    }
}

module.exports = { rebuild, getPosts, getPost, getAdjacentPosts, getAllPosts };
