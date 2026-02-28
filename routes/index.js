/**
 * Canonical Route Registry
 * 
 * Centralizes all route registrations and mounting.
 */
const logger = require("../config/logger");

// Middleware
const legacyApiDeprecationLogger = (req, res, next) => {
    if (req.path.startsWith("/api") && !req.path.startsWith("/api/v1")) {
        logger.warn(`Legacy API Hit: ${req.method} ${req.originalUrl} - Please migrate to /api/v1`);
    }
    next();
};

/**
 * Build a standardized deprecation response payload for legacy endpoints.
 *
 * @param {string} replacementPrefix - Canonical replacement prefix.
 * @returns {Function} Express middleware.
 */
const createLegacyApiDeprecationResponder = (replacementPrefix = "/api/v1") => (req, res) => {
    const normalizedPath = req.originalUrl.split("?")[0];
    const replacementPath = normalizedPath.startsWith("/api/")
        ? normalizedPath.replace(/^\/api\//, `${replacementPrefix}/`)
        : `${replacementPrefix}${normalizedPath}`;

    return res.status(410).json({
        success: false,
        message: "legacy_api_deprecated",
        deprecated_endpoint: normalizedPath,
        replacement_endpoint: replacementPath,
        documentation: "/api-docs",
        warning: "Use versioned endpoints under /api/v1."
    });
};

const legacyApiDeprecationResponder = (req, res, next) => {
    if (req.path.startsWith("/v1")) {
        return next();
    }

    return createLegacyApiDeprecationResponder("/api/v1")(req, res);
};

module.exports = (app, pool) => {
    const serviceManager = require("../services/manager");
    const whatsappService = serviceManager.getWhatsAppService();
    const googleChatService = serviceManager.getGoogleChatService();

    // Import all route modules
    const authRoutes = require("./auth")(pool, logger);
    const organizationsRoutes = require("./organizations")(pool, logger);
    const usersRoutes = require("./users")(pool, logger);
    const userProfileRoutes = require("./userProfile")(pool, logger);
    const rolesRoutes = require("./roles")(pool, logger);
    const meetingsRoutes = require("./meetings")(pool, logger);
    const participantsRoutes = require("./participants")(pool);
    const attendanceRoutes = require("./attendance")(pool, logger);
    const groupsRoutes = require("./groups")(pool, logger);
    const localGroupsRoutes = require("./localGroups")(pool, logger);
    const aiRoutes = require("./ai");
    const calendarsRoutes = require("./calendars")(pool, logger);
    const fundraisersRoutes = require("./fundraisers")(pool, logger);
    const formsRoutes = require("./forms")(pool, logger);
    const formBuilderRoutes = require("./formBuilder")(pool, logger);
    const reportsRoutes = require("./reports")(pool, logger);
    const dashboardsRoutes = require("./dashboards")(pool, logger);
    const badgesRoutes = require("./badges")(pool, logger);
    const guardiansRoutes = require("./guardians")(pool, logger);
    const notificationsRoutes = require("./notifications")(pool, logger);
    const announcementsRoutes = require("./announcements")(pool, logger, whatsappService, googleChatService);
    const whatsappBaileysRoutes = require("./whatsapp-baileys")(pool, logger, whatsappService);
    const googleChatRoutes = require("./google-chat")(pool, logger);
    const honorsRoutes = require("./honors")(pool, logger);
    const pointsRoutes = require("./points")(pool, logger);
    const publicRoutes = require("./public")(pool, logger);
    const importRoutes = require("./import")(pool, logger);
    const financeRoutes = require("./finance")(pool, logger);
    const stripeRoutes = require("./stripe")(pool, logger);
    const budgetsRoutes = require("./budgets")(pool, logger);
    const externalRevenueRoutes = require("./external-revenue")(pool, logger);
    const resourcesRoutes = require("./resources")(pool, logger);
    const medicationRoutes = require("./medication")(pool, logger);
    const activitiesRoutes = require("./activities")(pool);
    const offlineRoutes = require("./offline")(pool, logger);
    const carpoolsRoutes = require("./carpools")(pool);
    const programProgressRoutes = require("./programProgress")(pool, logger);

    // ============================================
    // MOUNT MODULAR ROUTES
    // ============================================

    // NOTE: authRoutes currently defines absolute internal paths (/public/* and /api/auth/*).
    // Mounting at root preserves those canonical paths while avoiding double prefixes.
    app.use("/", authRoutes);

    // Organizations
    app.use("/api/v1/organizations", organizationsRoutes);
    app.use("/public", organizationsRoutes);
    app.use("/public/organizations", organizationsRoutes);

    // User Management
    app.use("/api/v1/users/me", userProfileRoutes);
    app.use("/api/v1/users", usersRoutes);
    // Roles & permissions management (handles /roles/* and /permissions paths)
    app.use("/api/v1", rolesRoutes);

    // Features
    app.use("/api/v1/meetings", meetingsRoutes);

    app.use("/api/v1/groups", groupsRoutes);
    app.use("/api/v1/local-groups", localGroupsRoutes);

    app.use("/api/v1/ai", aiRoutes);

    app.use("/api/v1/calendars", calendarsRoutes);

    app.use("/api/v1/fundraisers", fundraisersRoutes);

    app.use("/api/v1/forms", formsRoutes);

    app.use("/api/v1/form-builder", formBuilderRoutes);

    app.use("/api/v1/reports", reportsRoutes);

    app.use("/api/v1/dashboards", dashboardsRoutes);

    app.use("/api/v1/badges", badgesRoutes);

    app.use("/api/v1/guardians", guardiansRoutes);

    app.use("/api/v1/notifications", notificationsRoutes);

    app.use("/api", announcementsRoutes);

    app.use("/api/v1/google-chat", googleChatRoutes);

    app.use("/api", honorsRoutes);

    app.use("/api/v1/points", pointsRoutes);

    app.use("/api/v1/attendance", attendanceRoutes);

    app.use("/api/v1/public", publicRoutes);

    app.use("/api/v1/import", importRoutes);

    app.use("/api", financeRoutes);

    app.use("/api", stripeRoutes);

    app.use("/api", budgetsRoutes);

    app.use("/api", externalRevenueRoutes);

    app.use("/api/v1/resources", resourcesRoutes);

    app.use("/api", medicationRoutes);

    app.use("/api/v1/activities", activitiesRoutes);
    app.use("/api/v1/offline", offlineRoutes);
    app.use("/api/v1/carpools", carpoolsRoutes);
    app.use("/api/v1/program-progress", programProgressRoutes);

    // WhatsApp routes already include /v1/* internally.
    app.use("/api", whatsappBaileysRoutes);

    // Participants (Mount LAST due to catch-all /:id)
    app.use("/api/v1/participants", participantsRoutes);

    // Removed duplicate non-versioned mounts in favor of canonical /api/v1 paths:
    // / (authRoutes, rolesRoutes), /api (organizationsRoutes, usersRoutes, meetingsRoutes,
    // aiRoutes, calendarsRoutes, fundraisersRoutes, formsRoutes, formBuilderRoutes,
    // reportsRoutes, dashboardsRoutes, badgesRoutes, guardiansRoutes, notificationsRoutes,
    // announcementsRoutes, googleChatRoutes, honorsRoutes, pointsRoutes, attendanceRoutes,
    // publicRoutes, importRoutes, financeRoutes, stripeRoutes, budgetsRoutes,
    // externalRevenueRoutes, medicationRoutes, whatsappBaileysRoutes, participantsRoutes),
    // and /api/users/me (userProfileRoutes).
    // Explicit deprecation for all remaining legacy non-versioned API paths
    app.use("/api", legacyApiDeprecationLogger, legacyApiDeprecationResponder);

    logger.info("✅ All modular routes mounted");
};
