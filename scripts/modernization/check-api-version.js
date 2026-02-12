/**
 * check-api-version.js
 * 
 * Deterministic checker for Wampums API versioning policy.
 * Ensures that app.use() mounts in api.js follow the versioning policy.
 */

const fs = require('fs');
const path = require('path');

const API_JS_PATH = path.join(__dirname, '../../api.js');

const LEGACY_ALLOW_LIST = [
    'app.use("/", authRoutes)',
    'app.use("/api", organizationsRoutes)',
    'app.use("/public", organizationsRoutes)',
    'app.use("/api", usersRoutes)',
    'app.use("/api", userProfileRoutes)',
    'app.use("/", rolesRoutes)',
    'app.use("/api/ai", aiRoutes)', // This is currently duplicated in api.js
    'app.use("/api", meetingsRoutes)',
    'app.use("/api", calendarsRoutes)',
    'app.use("/api", fundraisersRoutes)',
    'app.use("/api", formsRoutes)',
    'app.use("/api", formBuilderRoutes)',
    'app.use("/api", reportsRoutes)',
    'app.use("/api", dashboardsRoutes)',
    'app.use("/api", badgesRoutes)',
    'app.use("/api", guardiansRoutes)',
    'app.use("/api", notificationsRoutes)',
    'app.use("/api", announcementsRoutes)',
    'app.use("/api", whatsappBaileysRoutes)',
    'app.use("/api", googleChatRoutes)',
    'app.use("/api", honorsRoutes)',
    'app.use("/api", pointsRoutes)',
    'app.use("/api/attendance", attendanceRoutes)', // Mixed prefix
    'app.use("/api", attendanceRoutes)',           // Legacy alias
    'app.use("/api", publicRoutes)',
    'app.use("/api", importRoutes)',
    'app.use("/api", financeRoutes)',
    'app.use("/api", stripeRoutes)',
    'app.use("/api", budgetsRoutes)',
    'app.use("/api", externalRevenueRoutes)',
    'app.use("/api", medicationRoutes)',
    'app.use("/api", participantsRoutes)'
];

const CANONICAL_PREFIXES = [
    '/api/v1/',
    '/api/v1'
];

function checkApiVersion() {
    const content = fs.readFileSync(API_JS_PATH, 'utf8');
    const lines = content.split('\n');
    let errors = [];

    // Match app.use("/...", [middleware,] ...router)
    const mountRegex = /app\.use\(\s*["']([^"']+)["']\s*,\s*(?:[^,]+,\s*)?([^)]+)\)/g;
    let match;

    while ((match = mountRegex.exec(content)) !== null) {
        const fullMatch = match[0].trim();
        const path = match[1];

        // Ignore non-API mounts (static, health, etc.)
        if (path === '/' || path === '/health' || path === '/robots.txt' || path === '/api-docs' || path.startsWith('/assets') || path.startsWith('/lang')) {
            // Special case for root mounts that are actually routers (like authRoutes)
            const router = match[2].trim();
            if (router.endsWith('Routes')) {
                // Check if it's in allow-list
                if (!LEGACY_ALLOW_LIST.some(allow => fullMatch.includes(allow))) {
                    errors.push(`Unauthorized legacy root mount: ${fullMatch}`);
                }
            }
            continue;
        }

        // Check if it's a versioned path
        const isVersioned = CANONICAL_PREFIXES.some(prefix => path.startsWith(prefix));

        if (!isVersioned) {
            // If not versioned, must be in allow-list
            // We strip legacyApiDeprecationLogger from fullMatch for allow-list matching to keep list cleaner
            const cleanMatch = fullMatch.replace(/legacyApiDeprecationLogger\s*,\s*/, '');
            const isInAllowList = LEGACY_ALLOW_LIST.some(allow => cleanMatch.includes(allow));

            if (!isInAllowList) {
                errors.push(`Unauthorized legacy API mount: ${fullMatch}`);
            }
        }
    }

    if (errors.length > 0) {
        console.error('❌ API Versioning Policy Violations:');
        errors.forEach(err => console.error(`  - ${err}`));
        console.error('\nAll new API routes must use the /api/v1/ prefix.');
        process.exit(1);
    } else {
        console.log('✅ API Versioning check passed.');
    }
}

checkApiVersion();
