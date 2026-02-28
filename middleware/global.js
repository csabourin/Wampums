const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("../config/swagger");
const logger = require("../config/logger");

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

    const landingStatic = express.static(landingDir);
    app.use((req, res, next) => {
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
