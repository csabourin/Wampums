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

    // ============================================
    // MOUNT MODULAR ROUTES
    // ============================================

    // Authentication
    app.use("/api/v1/auth", authRoutes);
    app.use("/", legacyApiDeprecationLogger, authRoutes);

    // Organizations
    app.use("/api/v1/organizations", organizationsRoutes);
    app.use("/api", legacyApiDeprecationLogger, organizationsRoutes);
    app.use("/public", organizationsRoutes);

    // User Management
    app.use("/api/v1/users/me", userProfileRoutes);
    app.use("/api/users/me", legacyApiDeprecationLogger, userProfileRoutes);
    app.use("/api/v1/users", usersRoutes);
    app.use("/api", legacyApiDeprecationLogger, usersRoutes);
    app.use("/api/v1", rolesRoutes);
    app.use("/", legacyApiDeprecationLogger, rolesRoutes);

    // Features
    app.use("/api/v1/meetings", meetingsRoutes);
    app.use("/api", legacyApiDeprecationLogger, meetingsRoutes);

    app.use("/api/v1/groups", groupsRoutes);
    app.use("/api/v1/local-groups", localGroupsRoutes);

    app.use("/api/v1/ai", aiRoutes);
    app.use("/api/ai", legacyApiDeprecationLogger, aiRoutes);

    app.use("/api/v1/calendars", calendarsRoutes);
    app.use("/api", legacyApiDeprecationLogger, calendarsRoutes);

    app.use("/api/v1/fundraisers", fundraisersRoutes);
    app.use("/api", legacyApiDeprecationLogger, fundraisersRoutes);

    app.use("/api/v1/forms", formsRoutes);
    app.use("/api", legacyApiDeprecationLogger, formsRoutes);

    app.use("/api/v1/form-builder", formBuilderRoutes);
    app.use("/api", legacyApiDeprecationLogger, formBuilderRoutes);

    app.use("/api/v1/reports", reportsRoutes);
    app.use("/api", legacyApiDeprecationLogger, reportsRoutes);

    app.use("/api/v1/dashboards", dashboardsRoutes);
    app.use("/api", legacyApiDeprecationLogger, dashboardsRoutes);

    app.use("/api/v1/badges", badgesRoutes);
    app.use("/api", legacyApiDeprecationLogger, badgesRoutes);

    app.use("/api/v1/guardians", guardiansRoutes);
    app.use("/api", legacyApiDeprecationLogger, guardiansRoutes);

    app.use("/api/v1/notifications", notificationsRoutes);
    app.use("/api", legacyApiDeprecationLogger, notificationsRoutes);

    app.use("/api/v1/announcements", announcementsRoutes);
    app.use("/api", legacyApiDeprecationLogger, announcementsRoutes);

    app.use("/api/v1/google-chat", googleChatRoutes);
    app.use("/api", legacyApiDeprecationLogger, googleChatRoutes);

    app.use("/api/v1/honors", honorsRoutes);
    app.use("/api", legacyApiDeprecationLogger, honorsRoutes);

    app.use("/api/v1/points", pointsRoutes);
    app.use("/api", legacyApiDeprecationLogger, pointsRoutes);

    app.use("/api/v1/attendance", attendanceRoutes);
    app.use("/api", legacyApiDeprecationLogger, attendanceRoutes);

    app.use("/api/v1/public", publicRoutes);
    app.use("/api", legacyApiDeprecationLogger, publicRoutes);

    app.use("/api/v1/import", importRoutes);
    app.use("/api", legacyApiDeprecationLogger, importRoutes);

    app.use("/api/v1/finance", financeRoutes);
    app.use("/api", legacyApiDeprecationLogger, financeRoutes);

    app.use("/api/v1/stripe", stripeRoutes);
    app.use("/api", legacyApiDeprecationLogger, stripeRoutes);

    app.use("/api/v1/budgets", budgetsRoutes);
    app.use("/api", legacyApiDeprecationLogger, budgetsRoutes);

    app.use("/api/v1/revenue/external", externalRevenueRoutes);
    app.use("/api", legacyApiDeprecationLogger, externalRevenueRoutes);

    app.use("/api/v1/resources", resourcesRoutes);

    app.use("/api/v1/medication", medicationRoutes);
    app.use("/api", legacyApiDeprecationLogger, medicationRoutes);

    app.use("/api/v1/activities", activitiesRoutes);
    app.use("/api/v1/offline", offlineRoutes);
    app.use("/api/v1/carpools", carpoolsRoutes);

    // WhatsApp
    app.use("/api", whatsappBaileysRoutes);

    // Participants (Mount LAST due to catch-all /:id)
    app.use("/api/v1/participants", participantsRoutes);
    app.use("/api", legacyApiDeprecationLogger, participantsRoutes);

    logger.info("✅ All modular routes mounted");
};
