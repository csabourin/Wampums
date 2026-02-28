const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("../config/swagger");
const logger = require("../config/logger");
const ejs = require("ejs");

const isProduction = process.env.NODE_ENV === "production";
const REQUEST_BODY_LIMIT = "20mb";

/**
 * Resolve the preferred localized landing route from the incoming request.
 *
 * @param {import("express").Request} req - Incoming HTTP request.
 * @returns {"/fr/"|"/en/"} Preferred landing page path.
 */
function getPreferredLandingPath(req) {
    const requestedLang = typeof req.query.lang === "string"
        ? req.query.lang.trim().toLowerCase()
        : "";

    if (requestedLang.startsWith("fr")) {
        return "/fr/";
    }

    if (requestedLang.startsWith("en")) {
        return "/en/";
    }

    // Use Express's req.acceptsLanguages which respects q-values and priority order
    // Only if Accept-Language header exists (otherwise acceptsLanguages returns first item in array)
    if (req.headers["accept-language"]) {
        const preferred = typeof req.acceptsLanguages === "function"
            ? req.acceptsLanguages(["fr", "en"])
            : null;

        if (typeof preferred === "string" && preferred.toLowerCase().startsWith("fr")) {
            return "/fr/";
        }
    }

    return "/en/";
}

/** Base URL for all canonical links */
const BASE_URL = "https://wampums.app";

/** Views directory for EJS templates */
const VIEWS_DIR = path.join(process.cwd(), "views");

/**
 * Render an EJS template file with provided locals.
 * @param {string} template - relative path under views/ (e.g. 'blog/index.ejs')
 * @param {Object} locals
 * @returns {Promise<string>}
 */
function renderView(template, locals) {
    return new Promise((resolve, reject) => {
        ejs.renderFile(path.join(VIEWS_DIR, template), locals, { rmWhitespace: false }, (err, html) => {
            if (err) reject(err);
            else resolve(html);
        });
    });
}

/**
 * Build a sitemap <url> entry with hreflang.
 */
function sitemapUrl({ loc, enPath, frPath, lastmod, changefreq = "monthly", priority = "0.8" }) {
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
    const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || "20mb";

    // Trust proxy - use 1 (trust first proxy hop) instead of true
    // to avoid express-rate-limit ERR_ERL_PERMISSIVE_TRUST_PROXY warning
    app.set("trust proxy", 1);

    // Compression
    try {
        const compression = require("compression");
        app.use(compression());
    } catch (e) {
        logger.info("Compression not available");
    }

    // Body Parsing
    app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
    app.use(express.urlencoded({ limit: REQUEST_BODY_LIMIT, extended: true }));

    // ETag
    app.set("etag", "strong");

    // Helmet / CSP
    const connectSrc = [
        "'self'",
        "https://cdn.jsdelivr.net",
        "https://cdnjs.cloudflare.com",
        "https://*.supabase.co",
        "https://demo.wampums.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ];

    const apiBaseUrl = process.env.API_BASE_URL || process.env.VITE_API_BASE_URL;
    if (apiBaseUrl) {
        try {
            connectSrc.push(new URL(apiBaseUrl).origin);
        } catch (e) {
            console.warn("Invalid API_BASE_URL for CSP connectSrc", e);
        }
    }

    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                    styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
                    imgSrc: ["'self'", "data:", "blob:", "https://*.supabase.co", "https://www.gravatar.com"],
                    connectSrc: connectSrc,
                    fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'none'"],
                },
            },
            crossOriginResourcePolicy: { policy: "cross-origin" },
        })
    );

    // CORS
    const corsOptions = {
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            const allowedPatterns = [
                /^https:\/\/([a-z0-9-]+\.)?wampums\.app$/,
                /^http:\/\/localhost:\d+$/,
                /^http:\/\/127\.0\.0\.1:\d+$/,
            ];
            if (allowedPatterns.some((pattern) => pattern.test(origin))) {
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
    const staticDir = isProduction ? path.join(process.cwd(), "dist") : process.cwd();
    const landingDir = path.join(process.cwd(), "landing");
    const landingHosts = new Set(["wampums.app", "www.wampums.app"]);

    // Lazy-load blog service to avoid crashing on startup if content dir is missing
    let blogService = null;
    function getBlogService() {
        if (!blogService) {
            try {
                blogService = require("../services/blog");
            } catch (err) {
                logger.error("[Blog] Could not load blog service:", err.message);
            }
        }
        return blogService;
    }

    // Robots.txt (served on all hostnames)
    app.get("/robots.txt", (req, res) => {
        const isLanding = landingHosts.has(req.hostname);
        res.type("text/plain");
        if (isLanding) {
            res.send([
                "User-agent: *",
                "Allow: /",
                "",
                "# Block authenticated app routes",
                "Disallow: /api/",
                "Disallow: /api-docs",
                "Disallow: /dashboard",
                "Disallow: /attendance",
                "Disallow: /badges",
                "Disallow: /activities",
                "Disallow: /finance",
                "Disallow: /budgets",
                "Disallow: /settings",
                "Disallow: /login",
                "Disallow: /register",
                "Disallow: /admin",
                "Disallow: /reports",
                "Disallow: /carpool",
                "Disallow: /communications",
                "Disallow: /form-builder",
                "Disallow: /manage-",
                "Disallow: /badge-",
                "Disallow: /medication",
                "Disallow: /permission-slips",
                "Disallow: /program-progress",
                "",
                `Sitemap: ${BASE_URL}/sitemap.xml`,
            ].join("\n"));
        } else {
            res.send("User-agent: *\nDisallow: /\n");
        }
    });

    // Dynamic sitemap.xml
    app.get("/sitemap.xml", (req, res) => {
        const today = new Date().toISOString().slice(0, 10);
        const blog = getBlogService();
        const blogPosts = blog ? blog.getAllPosts() : [];

        const staticPages = [
            { en: "/en/", fr: "/fr/", freq: "weekly", pri: "1.0" },
            { en: "/en/features/attendance/", fr: "/fr/fonctionnalites/presences/", freq: "monthly", pri: "0.8" },
            { en: "/en/features/badges/", fr: "/fr/fonctionnalites/badges/", freq: "monthly", pri: "0.8" },
            { en: "/en/features/communication/", fr: "/fr/fonctionnalites/communication/", freq: "monthly", pri: "0.8" },
            { en: "/en/features/finance/", fr: "/fr/fonctionnalites/finances/", freq: "monthly", pri: "0.8" },
            { en: "/en/features/forms/", fr: "/fr/fonctionnalites/formulaires/", freq: "monthly", pri: "0.8" },
            { en: "/en/features/logistics/", fr: "/fr/fonctionnalites/logistique/", freq: "monthly", pri: "0.8" },
            { en: "/en/modules/finance/", fr: "/fr/modules/finance/", freq: "monthly", pri: "0.7" },
            { en: "/en/modules/carpool/", fr: "/fr/modules/carpool/", freq: "monthly", pri: "0.7" },
            { en: "/en/modules/on-site/", fr: "/fr/modules/on-site/", freq: "monthly", pri: "0.7" },
            { en: "/en/modules/offline/", fr: "/fr/modules/offline/", freq: "monthly", pri: "0.7" },
            { en: "/en/modules/medications/", fr: "/fr/modules/medications/", freq: "monthly", pri: "0.7" },
            { en: "/en/modules/fundraising/", fr: "/fr/modules/fundraising/", freq: "monthly", pri: "0.7" },
            { en: "/en/compare/wampums-vs-sporteasy/", fr: "/fr/comparer/wampums-vs-sporteasy/", freq: "monthly", pri: "0.7" },
            { en: "/en/compare/wampums-vs-trooptrack/", fr: "/fr/comparer/wampums-vs-trooptrack/", freq: "monthly", pri: "0.7" },
            { en: "/en/compare/wampums-vs-spreadsheets/", fr: "/fr/comparer/wampums-vs-tableurs/", freq: "monthly", pri: "0.7" },
            { en: "/en/compare/wampums-vs-scoutbook/", fr: "/fr/comparer/wampums-vs-scoutbook/", freq: "monthly", pri: "0.7" },
            { en: "/en/compare/wampums-vs-scouts-digital/", fr: "/fr/comparer/wampums-vs-scouts-digital/", freq: "monthly", pri: "0.7" },
            { en: "/en/blog/", fr: "/fr/blogue/", freq: "weekly", pri: "0.8" },
            { en: "/en/faq/", fr: "/fr/faq/", freq: "monthly", pri: "0.6" },
        ];

        const urlEntries = staticPages.map(p =>
            sitemapUrl({ loc: p.en, enPath: p.en, frPath: p.fr, lastmod: today, changefreq: p.freq, priority: p.pri })
        );

        for (const post of blogPosts) {
            const enSlug = post.lang === "en" ? post.slug : (post.alternate || post.slug);
            const frSlug = post.lang === "fr" ? post.slug : (post.alternate || post.slug);
            const enPath = `/en/blog/${enSlug}/`;
            const frPath = `/fr/blogue/${frSlug}/`;
            const loc = post.lang === "en" ? enPath : frPath;
            urlEntries.push(sitemapUrl({ loc, enPath, frPath, lastmod: post.updated || post.date, changefreq: "monthly", priority: "0.7" }));
        }

        res.type("application/xml");
        res.send([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
            '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
            urlEntries.join("\n"),
            "</urlset>",
        ].join("\n"));
    });

    // Blog refresh endpoint (protected by secret)
    app.post("/api/blog/refresh", (req, res) => {
        const secret = process.env.BLOG_REFRESH_SECRET;
        const provided = req.headers["x-refresh-secret"];
        if (secret && provided !== secret) {
            return res.status(401).json({ success: false, message: "unauthorized" });
        }
        const blog = getBlogService();
        if (!blog) {
            return res.status(503).json({ success: false, message: "blog_service_unavailable" });
        }
        blog.rebuild();
        return res.json({ success: true, message: "blog_index_refreshed" });
    });

    const landingStatic = express.static(landingDir);

    // Middleware for wampums.app hostname: blog (SSR) + static landing pages
    app.use(async (req, res, next) => {
        if (!landingHosts.has(req.hostname)) {
            return next();
        }

        if (req.path === "/" || req.path === "/index.html") {
            return res.redirect(302, getPreferredLandingPath(req));
        }

        if (req.path === "/en" || req.path === "/fr") {
            return res.redirect(301, `${req.path}/`);
        }

        if (req.path === "/landing" || req.path === "/landing/" || req.path === "/landing/index.html") {
            return res.redirect(302, getPreferredLandingPath(req));
        }

        // Trailing slash redirect for clean URLs
        if (req.path.match(/^\/(?:en|fr)\/.+[^/]$/) && !req.path.match(/\.[a-z]{2,4}$/i)) {
            return res.redirect(301, `${req.path}/`);
        }

        // Redirect legacy /fr/comparatif/ URLs to canonical /fr/comparer/
        const comparatifRedirects = {
            "/fr/comparatif/wampums-vs-scoutbook/": "/fr/comparer/wampums-vs-scoutbook/",
            "/fr/comparatif/wampums-vs-scouts-digital/": "/fr/comparer/wampums-vs-scouts-digital/",
            "/fr/comparatif/wampums-vs-sporteasy/": "/fr/comparer/wampums-vs-sporteasy/",
            "/fr/comparatif/wampums-vs-spreadsheets/": "/fr/comparer/wampums-vs-tableurs/",
            "/fr/comparatif/wampums-vs-trooptrack/": "/fr/comparer/wampums-vs-trooptrack/",
        };
        if (comparatifRedirects[req.path]) {
            return res.redirect(301, comparatifRedirects[req.path]);
        }

        // --- Blog EN ---
        const enBlogIndex = req.path === "/en/blog" || req.path === "/en/blog/";
        const enBlogPost = req.path.match(/^\/en\/blog\/([^/]+)\/?$/);

        // --- Blog FR ---
        const frBlogIndex = req.path === "/fr/blogue" || req.path === "/fr/blogue/";
        const frBlogPost = req.path.match(/^\/fr\/blogue\/([^/]+)\/?$/);

        if (enBlogIndex || frBlogIndex || enBlogPost || frBlogPost) {
            const blog = getBlogService();
            if (!blog) {
                return res.status(503).send("Blog service unavailable");
            }

            try {
                const lang = (enBlogIndex || enBlogPost) ? "en" : "fr";
                const blogBase = lang === "en" ? "/en/blog/" : "/fr/blogue/";
                const altBase = lang === "en" ? "/fr/blogue/" : "/en/blog/";

                if (enBlogIndex || frBlogIndex) {
                    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
                    const { posts, total, pages } = blog.getPosts(lang, page, 10);
                    const html = await renderView("blog/index.ejs", {
                        lang,
                        posts,
                        page,
                        pages,
                        total,
                        canonicalPath: blogBase,
                        enPath: "/en/blog/",
                        frPath: "/fr/blogue/",
                        pageTitle: lang === "fr" ? "Blogue Wampums — Ressources pour chefs scouts" : "Wampums Blog — Resources for Scout Leaders",
                        pageDescription: lang === "fr"
                            ? "Guides, conseils et ressources pour les chefs scouts, parents et administrateurs de groupes jeunesse bilingues au Canada."
                            : "Guides, tips, and resources for scout leaders, parents, and administrators of bilingual youth groups in Canada.",
                        ogImage: null,
                    });
                    return res.send(html);
                }

                const slug = (enBlogPost || frBlogPost)[1];
                const post = blog.getPost(lang, slug);

                if (!post) {
                    return next();
                }

                const { prev, next: nextPost } = blog.getAdjacentPosts(post);
                const alternatePost = post.alternate ? blog.getPost(lang === "en" ? "fr" : "en", post.alternate) : null;

                const enPath = lang === "en" ? req.path.endsWith("/") ? req.path : `${req.path}/` : (alternatePost ? `/en/blog/${alternatePost.slug}/` : "/en/blog/");
                const frPath = lang === "fr" ? req.path.endsWith("/") ? req.path : `${req.path}/` : (alternatePost ? `/fr/blogue/${alternatePost.slug}/` : "/fr/blogue/");

                const html = await renderView("blog/post.ejs", {
                    post,
                    prev,
                    next: nextPost,
                    alternatePost,
                    canonicalPath: req.path.endsWith("/") ? req.path : `${req.path}/`,
                    enPath,
                    frPath,
                });
                return res.send(html);
            } catch (err) {
                logger.error("[Blog] Render error:", err);
                return next(err);
            }
        }

        return landingStatic(req, res, next);
    });

    app.use('/vendor/fontawesome', express.static(path.join(process.cwd(), 'node_modules/@fortawesome/fontawesome-free')));

    app.use(express.static(staticDir, {
        setHeaders: (res, filepath) => {
            if (isProduction && filepath.includes("-") && (filepath.endsWith(".js") || filepath.endsWith(".css"))) {
                res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            } else if (isProduction && /\.(js|css|png|jpg|webp)$/.test(filepath)) {
                res.setHeader("Cache-Control", "public, max-age=2592000");
            } else if (!isProduction && /\.(js|css)$/.test(filepath)) {
                res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            }
        }
    }));

    // In dev, also serve from assets/ so /images/... resolves to assets/images/...
    // matching Vite's publicDir: "assets" behaviour. In production Vite copies
    // publicDir into dist/ so the main staticDir already covers this.
    if (!isProduction) {
        app.use(express.static(path.join(process.cwd(), "assets")));
    }

    // Swagger Documentation
    app.use(
        "/api-docs",
        swaggerUi.serve,
        swaggerUi.setup(swaggerSpecs, {
            explorer: true,
            customCss: ".swagger-ui .topbar { display: none }",
            customSiteTitle: "Wampums API Documentation",
        }),
    );

    app.get("/api-docs.json", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.send(swaggerSpecs);
    });

    // Health check
    app.get("/health", (req, res) => {
        res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
    });

    logger.info("✅ Global middleware initialized");
};
