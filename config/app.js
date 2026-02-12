const express = require("express");
const http = require("http");
const { pool } = require("./database");
const logger = require("./logger");
const { generalLimiter } = require("./rate-limit");
const initGlobalMiddleware = require("../middleware/global");
const initRoutes = require("../routes/index");
const socketService = require("../services/socket");

/**
 * Create and configure the Express application
 * 
 * @returns {Object} { app, server, io }
 */
function createApp() {
    const app = express();
    const server = http.createServer(app);

    // Make pool available to middleware via app.locals
    app.locals.pool = pool;

    // 1. Initialize Global Middleware
    initGlobalMiddleware(app);

    // 2. Apply Rate Limiting
    app.use(generalLimiter);

    // 3. Initialize Socket.IO
    const io = socketService.init(server);

    // 4. Initialize Services (WhatsApp, etc.)
    const serviceManager = require("../services/manager");
    serviceManager.init(pool).catch((error) => {
        logger.error("Service initialization failed:", error);
        process.exit(1);
    });

    // 5. Initialize Routes
    initRoutes(app, pool);

    // 5. Global Error Handler
    app.use((err, req, res, next) => {
        const { OrganizationNotFoundError } = require("../utils/api-helpers");
        const { respondWithOrganizationFallback } = require("../utils/api-helpers");

        if (err instanceof OrganizationNotFoundError) {
            return respondWithOrganizationFallback(res);
        }

        logger.error("Unhandled error:", err);
        return res.status(500).json({ success: false, message: "internal_server_error" });
    });

    // 6. SPA Catch-all (Express 5 named wildcard)
    const path = require("path");
    const isProduction = process.env.NODE_ENV === "production";

    app.get("/*path", (req, res) => {
        if (req.path.startsWith("/api") || req.path.startsWith("/api-docs") ||
            /\.(js|css|png|jpg|jpeg|gif|heif|heic|svg|ico|woff|woff2|ttf|eot|webp|json)$/i.test(req.path)) {
            return res.status(404).json({ success: false, message: "Endpoint not found" });
        }

        const indexPath = isProduction
            ? path.join(process.cwd(), "dist", "index.html")
            : path.join(process.cwd(), "index.html");

        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.sendFile(indexPath);
    });

    return { app, server, io };
}

module.exports = createApp;
