# Technical Debt Audit Report
**Date:** December 27, 2025
**Project:** Wampums Scout Management System
**Scope:** Full codebase including backend (Node.js), frontend (SPA), and mobile (React Native)

---

## Executive Summary

This comprehensive technical debt audit identified **9 major categories** of technical debt across the Wampums application. The findings range from critical architecture issues to minor code quality improvements.

### Priority Matrix

| Priority | Count | Category |
|----------|-------|----------|
| 🔴 **CRITICAL** | 3 | Role hardcoding, Data scope architecture, Legacy authorization |
| 🟠 **HIGH** | 4 | Code duplication, Promise chains, innerHTML usage, Console logs |
| 🟡 **MEDIUM** | 2 | Missing TODOs, Mobile navigation stubs |
| 🟢 **LOW** | 3 | Documentation, Magic numbers, Equality operators |

---

## 🔴 CRITICAL PRIORITY

### 1. Role Hardcoding Throughout Codebase

**Issue:** Role names are hardcoded as string literals throughout the application, creating maintenance burden and inconsistency.

**Impact:**
- Adding/removing roles requires changes across dozens of files
- Typos can cause silent permission failures
- Difficult to refactor role system
- Violates DRY (Don't Repeat Yourself) principle

**Locations Found:**

#### Backend Routes (27+ instances)
```javascript
// routes/participants.js:70-71
const parentOnlyRoles = ['parent', 'demoparent'];
const staffParticipantRoles = ['district', 'unitadmin', 'leader', 'admin', 'animation', 'demoadmin'];

// routes/participants.js:991-992
const staffRoles = ['admin', 'animation', 'district', 'unitadmin', 'demoadmin'];
const hasStaffRole = req.userRoles && req.userRoles.some(role => staffRoles.includes(role));

// routes/dashboards.js:200-201
const parentOnlyRoles = ['parent', 'demoparent'];
const staffParticipantRoles = ['district', 'unitadmin', 'leader', 'admin', 'animation', 'demoadmin'];

// routes/finance.js:716-717
const staffRoles = ['district', 'unitadmin', 'leader', 'finance', 'administration', 'demoadmin'];
const isStaff = hasAnyRole(req, ...staffRoles);

// routes/forms.js:91-92
const staffRoles = ['admin', 'animation', 'district', 'unitadmin', 'demoadmin'];
const hasStaffRole = userRoles.some(role => staffRoles.includes(role));

// routes/formBuilder.js (11 instances)
authorize('admin') // Hardcoded admin role checks

// routes/carpools.js:176, 247, 343, 436
const isStaff = ['animation', 'admin'].includes(userRole);

// routes/auth.js:64-65
const animationAliases = ['animation', 'animator', 'animateur'];
return animationAliases.includes(sanitizedUserType) ? 'animation' : 'parent';

// routes/auth.js:250, 409
const rolePriority = ['district', 'unitadmin', 'leader', 'finance', 'equipment', 'administration', 'parent', 'demoadmin', 'demoparent'];

// routes/roles.js:34-63 (SQL CASE statements with hardcoded role names)
WHEN 'unitadmin' THEN 1
WHEN 'leader' THEN 2
WHEN 'demoadmin' THEN 7

// routes/honors.js:366
if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role))

// routes/whatsapp-baileys.js:45, 97, 138, 184
authorize(['admin', 'animation'])

// routes/announcements.js:20
const ALLOWED_ROLES = ['admin', 'animation', 'parent'];

// routes/stripe.js:31
const isStaff = hasAnyRole(req.user, ['district', 'unitadmin', 'leader', 'finance', 'administration', 'demoadmin']);

// routes/users.js:142, 313-316, 339, 497
Hard-coded role mappings and checks
```

#### Frontend SPA
```javascript
// spa/utils/PermissionUtils.js:163-168
const parentFriendlyStaffRoles = [
  'district',
  'unitadmin',
  'leader',
  'demoadmin'
];

// spa/utils/PermissionUtils.js:186-188
export function isAdmin() {
  return hasAnyRole('district', 'unitadmin');
}

// spa/utils/PermissionUtils.js:500
return hasAnyRole('district', 'unitadmin', 'leader', 'demoadmin');
```

#### Mobile App
```javascript
// Mobile app uses permission-based approach (✅ GOOD)
// But still has some hardcoded role checks in legacy code
```

**Recommended Solution:**

Create a centralized role configuration system:

```javascript
// config/role-constants.js (NEW FILE)
/**
 * Centralized role definitions and groupings
 * Single source of truth for all role-related logic
 */

// Individual role names
export const ROLES = {
  DISTRICT: 'district',
  UNIT_ADMIN: 'unitadmin',
  LEADER: 'leader',
  FINANCE: 'finance',
  EQUIPMENT: 'equipment',
  ADMINISTRATION: 'administration',
  PARENT: 'parent',
  DEMO_ADMIN: 'demoadmin',
  DEMO_PARENT: 'demoparent',
  // Legacy (to be removed)
  ADMIN: 'admin',
  ANIMATION: 'animation',
};

// Role groupings by data access scope
export const ROLE_GROUPS = {
  // Can view ALL participants in organization
  STAFF_PARTICIPANT_ACCESS: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN,
    ROLES.LEADER,
    ROLES.ADMIN,
    ROLES.ANIMATION,
    ROLES.DEMO_ADMIN
  ],

  // Can only view LINKED participants
  PARENT_ONLY: [
    ROLES.PARENT,
    ROLES.DEMOPARENT
  ],

  // Staff roles (non-parent, non-demo)
  STAFF: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN,
    ROLES.LEADER,
    ROLES.FINANCE,
    ROLES.EQUIPMENT,
    ROLES.ADMINISTRATION
  ],

  // Administrative roles
  ADMIN: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN
  ],

  // Demo roles (read-only)
  DEMO: [
    ROLES.DEMO_ADMIN,
    ROLES.DEMO_PARENT
  ],

  // Financial access
  FINANCE_ACCESS: [
    ROLES.DISTRICT,
    ROLES.UNIT_ADMIN,
    ROLES.FINANCE,
    ROLES.ADMINISTRATION,
    ROLES.DEMO_ADMIN
  ]
};

// Role priority for default selection
export const ROLE_PRIORITY = [
  ROLES.DISTRICT,
  ROLES.UNIT_ADMIN,
  ROLES.LEADER,
  ROLES.FINANCE,
  ROLES.EQUIPMENT,
  ROLES.ADMINISTRATION,
  ROLES.PARENT,
  ROLES.DEMO_ADMIN,
  ROLES.DEMO_PARENT
];

// Helper functions
export function isStaffRole(roleName) {
  return ROLE_GROUPS.STAFF_PARTICIPANT_ACCESS.includes(roleName);
}

export function isParentOnlyRole(roleName) {
  return ROLE_GROUPS.PARENT_ONLY.includes(roleName);
}

export function isDemoRole(roleName) {
  return ROLE_GROUPS.DEMO.includes(roleName);
}

// Check if user roles array contains any staff role
export function hasStaffRole(userRoles) {
  return userRoles.some(role => isStaffRole(role));
}

// Check if user has ONLY parent roles
export function isParentOnly(userRoles) {
  return userRoles.length > 0 && userRoles.every(role => isParentOnlyRole(role));
}
```

**Migration Steps:**
1. Create `config/role-constants.js` with all role definitions
2. Update all route files to import and use `ROLE_GROUPS` instead of hardcoded arrays
3. Update frontend `spa/utils/PermissionUtils.js` to use constants
4. Update mobile app to use constants
5. Add tests to ensure role groupings match database configuration
6. Document in CLAUDE.md

**Estimated Effort:** 4-6 hours
**Files to Update:** ~30 files

---

### 2. Data Scope vs Permission Separation

**Issue:** The application correctly uses permissions for "CAN they do X?" but incorrectly uses hardcoded role checks for "WHICH data can they see?"

**Current Problem:**
```javascript
// routes/participants.js:70-76
const parentOnlyRoles = ['parent', 'demoparent'];
const staffParticipantRoles = ['district', 'unitadmin', 'leader', 'admin', 'animation', 'demoadmin'];

// TECHNICAL DEBT - Role Hardcoding:
// This hardcodes staff role names. This is necessary because:
// - Permission system handles: "Can they view participants?" (Yes/No)
// - This code handles: "Which participants can they view?" (All vs Linked)
// - This is DATA SCOPE, not permission checking
// - Future: Add role.data_scope property ('organization' vs 'linked')
```

**Root Cause:**
The role system lacks a `data_scope` property to distinguish between:
- **Organization-wide access**: See all participants in the organization
- **Linked-only access**: See only participants they're linked to (parents)

**Recommended Solution:**

Add `data_scope` field to roles table:

```sql
-- Migration: Add data_scope to roles
ALTER TABLE roles ADD COLUMN data_scope VARCHAR(50) DEFAULT 'organization';

-- Update existing roles
UPDATE roles SET data_scope = 'linked' WHERE role_name IN ('parent', 'demoparent');
UPDATE roles SET data_scope = 'organization' WHERE role_name IN ('district', 'unitadmin', 'leader', 'finance', 'equipment', 'administration', 'demoadmin');
```

Then update middleware to handle data scope:

```javascript
// middleware/auth.js (NEW FUNCTION)
/**
 * Get user's data scope based on their roles
 * @param {Object} req - Express request with user attached
 * @param {Object} pool - Database pool
 * @returns {Promise<string>} 'organization' or 'linked'
 */
exports.getUserDataScope = async (req, pool) => {
  const organizationId = await exports.getOrganizationId(req, pool);

  const result = await pool.query(`
    SELECT DISTINCT r.data_scope
    FROM user_organizations uo
    CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
    JOIN roles r ON r.id = role_id_text::integer
    WHERE uo.user_id = $1 AND uo.organization_id = $2
    ORDER BY r.data_scope ASC
  `, [req.user.id, organizationId]);

  // If user has ANY organization-scoped role, they get organization access
  // 'organization' < 'linked' alphabetically, so will come first
  return result.rows[0]?.data_scope || 'linked';
};
```

Update participant routes:

```javascript
// routes/participants.js (REFACTORED)
router.get('/', authenticate, requirePermission('participants.view'), asyncHandler(async (req, res) => {
  const organizationId = await getOrganizationId(req, pool);
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const groupId = req.query.group_id;

  // Use data scope instead of hardcoded role checks
  const dataScope = await getUserDataScope(req, pool);
  const userId = req.user.id;

  let query, params, countQuery, countParams;

  if (dataScope === 'organization') {
    // Organization-wide access - show ALL participants
    query = `
      SELECT p.*, pg.group_id, g.name as group_name, ...
      FROM participants p
      JOIN participant_organizations po ON p.id = po.participant_id
      LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
      LEFT JOIN groups g ON pg.group_id = g.id
      WHERE po.organization_id = $1
    `;
    params = [organizationId];

    if (groupId) {
      query += ` AND pg.group_id = $${params.length + 1}`;
      params.push(groupId);
    }

    // ... rest of query
  } else {
    // Linked-only access - show only linked participants
    query = `
      SELECT p.*, pg.group_id, g.name as group_name, ...
      FROM participants p
      JOIN user_participants up ON p.id = up.participant_id
      JOIN participant_organizations po ON p.id = po.participant_id
      LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
      LEFT JOIN groups g ON pg.group_id = g.id
      WHERE up.user_id = $2 AND po.organization_id = $1
    `;
    params = [organizationId, userId];

    // ... rest of query
  }

  // Execute query...
}));
```

**Benefits:**
- ✅ No hardcoded role names in business logic
- ✅ Easy to add new roles with different data scopes
- ✅ Database-driven configuration
- ✅ Clearer separation of concerns
- ✅ Easier to test and maintain

**Estimated Effort:** 6-8 hours
**Files to Update:** Migration + ~10 route files

---

### 3. Legacy `authorize()` Middleware Still in Use

**Issue:** The codebase has both new permission-based (`requirePermission`) and old role-based (`authorize`) middleware, creating confusion and inconsistency.

**Locations:**
- `routes/formBuilder.js`: 11 instances of `authorize('admin')`
- `routes/whatsapp-baileys.js`: 4 instances
- Other routes: Scattered usage

**Current State:**
```javascript
// ❌ OLD (role-based)
router.get('/form-formats', authenticate, authorize('admin'), async (req, res) => {
  // ...
});

// ✅ NEW (permission-based)
router.get('/form-formats', authenticate, requirePermission('forms.view'), async (req, res) => {
  // ...
});
```

**Problem:**
- Old `authorize()` only checks `req.user.role` (single role)
- Doesn't support multi-role users
- Doesn't leverage permission system
- Creates two different authorization patterns

**Recommended Solution:**

1. **Deprecate `authorize()` middleware** - Add deprecation notice:

```javascript
// middleware/auth.js
/**
 * @deprecated Use requirePermission() instead
 * Check if user has required role(s)
 * THIS IS DEPRECATED - Use permission-based checks with requirePermission()
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    console.warn(`DEPRECATED: authorize() middleware used. Migrate to requirePermission()`);
    // ... existing implementation
  };
};
```

2. **Create migration mapping** of role → permission:

```javascript
// Form builder admin-only → forms.manage permission
authorize('admin') → requirePermission('forms.manage')

// WhatsApp admin/animation → communications.send permission
authorize('admin', 'animation') → requirePermission('communications.send')
```

3. **Update all routes** systematically:

```bash
# Files to update:
routes/formBuilder.js       # 11 instances
routes/whatsapp-baileys.js  # 4 instances
routes/announcements.js     # 1 instance
# Total: ~16 instances
```

**Estimated Effort:** 2-3 hours
**Files to Update:** 3-4 files

---

## 🟠 HIGH PRIORITY

### 4. Excessive Code Duplication in Routes

**Issue:** Identical role checking logic is duplicated across multiple route files.

**Examples:**

```javascript
// DUPLICATED across 5+ files:
const staffRoles = ['district', 'unitadmin', 'leader', 'admin', 'animation', 'demoadmin'];
const hasStaffRole = userRoles.some(role => staffRoles.includes(role));
const isParentOnly = userRoles.every(role => parentOnlyRoles.includes(role));
```

**Files Affected:**
- `routes/participants.js`
- `routes/dashboards.js`
- `routes/forms.js`
- `routes/finance.js`
- `routes/carpools.js`

**Recommended Solution:**

Use the `getUserDataScope()` middleware (from Critical #2) OR create utility functions:

```javascript
// utils/role-helpers.js (NEW FILE)
const { ROLE_GROUPS } = require('../config/role-constants');

/**
 * Check if user has staff-level data access
 * @param {Array<string>} userRoles - User's role names
 * @returns {boolean}
 */
function hasStaffDataAccess(userRoles) {
  return userRoles.some(role => ROLE_GROUPS.STAFF_PARTICIPANT_ACCESS.includes(role));
}

/**
 * Check if user has parent-only access
 * @param {Array<string>} userRoles - User's role names
 * @returns {boolean}
 */
function isParentOnlyAccess(userRoles) {
  return userRoles.length > 0 &&
         userRoles.every(role => ROLE_GROUPS.PARENT_ONLY.includes(role));
}

module.exports = {
  hasStaffDataAccess,
  isParentOnlyAccess
};
```

Then use in routes:

```javascript
const { hasStaffDataAccess, isParentOnlyAccess } = require('../utils/role-helpers');

// Before (duplicated):
const staffParticipantRoles = ['district', 'unitadmin', 'leader', 'admin', 'animation', 'demoadmin'];
const hasStaffRole = userRoles.some(role => staffParticipantRoles.includes(role));

// After (reusable):
const hasStaffRole = hasStaffDataAccess(userRoles);
```

**Estimated Effort:** 2-3 hours
**Files to Update:** 5-6 files

---

### 5. Promise Chains (.then/.catch) Instead of Async/Await

**Issue:** 134 instances of `.then()` and `.catch()` found across the codebase, violating the CLAUDE.md guideline to "Use async/await (NOT callback hell or `.then()` chains)".

**Impact:**
- Less readable code
- Harder error handling
- Inconsistent with modern JavaScript best practices
- Violates project coding standards

**Examples Found:**

```javascript
// spa/router.js:50 instances
// spa/app.js:8 instances
// spa/dashboard.js:5 instances
// spa/finance.js:4 instances
// spa/budgets.js:5 instances
// spa/indexedDB.js:8 instances
// ... and 31 more files
```

**Recommended Solution:**

**Before:**
```javascript
// ❌ Promise chains
fetch('/api/participants')
  .then(response => response.json())
  .then(data => {
    console.log(data);
    return processData(data);
  })
  .catch(error => {
    console.error(error);
  });
```

**After:**
```javascript
// ✅ Async/await
async function loadParticipants() {
  try {
    const response = await fetch('/api/participants');
    const data = await response.json();
    console.log(data);
    return await processData(data);
  } catch (error) {
    console.error(error);
  }
}
```

**Migration Strategy:**
1. Start with most critical files (router.js, app.js, dashboard.js)
2. Use automated refactoring tools where possible
3. Ensure all async functions have proper try/catch blocks
4. Test thoroughly after each file migration

**Estimated Effort:** 8-12 hours (can be done incrementally)
**Files to Update:** ~37 files

---

### 6. innerHTML Usage (Security Risk)

**Issue:** 203 instances of `innerHTML` found across the SPA, creating potential XSS vulnerabilities.

**Files with Most Usage:**
- `spa/formBuilder.js`: 9 instances
- `spa/admin.js`: 12 instances
- `spa/reports.js`: 8 instances
- `spa/medication_management.js`: 8 instances
- `spa/attendance.js`: 7 instances
- 57 more files

**Security Risk:**
If user-controlled data is inserted via `innerHTML`, it can lead to Cross-Site Scripting (XSS) attacks.

**Current Mitigation:**
The codebase has `spa/utils/SecurityUtils.js` with `sanitizeHTML()` function, but it's not consistently used.

**Recommended Solution:**

1. **Audit all innerHTML usage** - Categorize as:
   - ✅ Safe (static content only)
   - ⚠️ Needs sanitization (dynamic content)
   - 🔴 Unsafe (user input without sanitization)

2. **Enforce sanitization pattern:**

```javascript
// ❌ UNSAFE
element.innerHTML = userData;

// ⚠️ BETTER (but manual)
import { sanitizeHTML } from './utils/SecurityUtils.js';
element.innerHTML = sanitizeHTML(userData);

// ✅ BEST (use helper)
import { setContent } from './utils/DOMUtils.js';
setContent(element, userData); // Automatically sanitizes
```

3. **Create `DOMUtils.js` helper:**

```javascript
// spa/utils/DOMUtils.js (NEW FILE)
import { sanitizeHTML } from './SecurityUtils.js';

/**
 * Safely set HTML content (auto-sanitizes)
 * @param {HTMLElement} element - Target element
 * @param {string} content - Content to set (will be sanitized)
 */
export function setContent(element, content) {
  element.innerHTML = sanitizeHTML(content);
}

/**
 * Set text content (no HTML, completely safe)
 * @param {HTMLElement} element - Target element
 * @param {string} text - Text content
 */
export function setText(element, text) {
  element.textContent = text;
}
```

4. **Add ESLint rule** to warn on direct `innerHTML` usage:

```javascript
// .eslintrc.js
rules: {
  'no-unsanitized/property': 'warn'  // Warns on innerHTML/outerHTML
}
```

**Estimated Effort:** 10-15 hours (high due to code review needed)
**Files to Update:** ~62 files

---

### 7. Excessive Console Logging

**Issue:** 668 instances of `console.log`, `console.error`, and `console.warn` found across the codebase.

**Breakdown:**
- Backend: ~200 instances (many legitimate for server logs)
- Frontend SPA: ~300 instances (should use DebugUtils)
- Mobile: ~150 instances (should use DebugUtils)
- Scripts: ~18 instances (acceptable for CLI tools)

**Problem:**
- Console logs in production expose internal logic
- Clutters browser console for end users
- Performance impact in tight loops
- Not all logs respect `CONFIG.debugMode`

**Current Good Practice:**
Both SPA and mobile have `DebugUtils.js` with debug mode checking:

```javascript
// spa/utils/DebugUtils.js
export function debugLog(...args) {
  if (CONFIG.debugMode) {
    console.log('[DEBUG]', ...args);
  }
}
```

But many files bypass this and use `console.log` directly.

**Recommended Solution:**

1. **Replace direct console usage:**

```javascript
// ❌ BEFORE
console.log('User data:', userData);
console.error('API failed:', error);

// ✅ AFTER
import { debugLog, debugError } from './utils/DebugUtils.js';
debugLog('User data:', userData);
debugError('API failed:', error);
```

2. **Backend logging** - Already using winston logger (✅ GOOD), but some routes use console directly:

```javascript
// ❌ BEFORE
console.log('Processing request...');

// ✅ AFTER
logger.info('Processing request...');
```

3. **Add ESLint rule:**

```javascript
// .eslintrc.js
rules: {
  'no-console': ['warn', { allow: ['warn', 'error'] }]
}
```

**Estimated Effort:** 6-8 hours (can use find-replace)
**Files to Update:** ~60 files

---

## 🟡 MEDIUM PRIORITY

### 8. TODO Comments Not Tracked

**Issue:** Multiple TODO comments found in mobile app with no tracking or completion timeline.

**Locations:**

```javascript
// mobile/src/screens/LeaderDashboardScreen.js:594
// TODO: Replace hardcoded fallback logo with a mobile-specific S3 asset.

// mobile/src/screens/SettingsScreen.js:52
// TODO: Load push notification preference when implemented

// mobile/src/screens/SettingsScreen.js:67
// TODO: Force app reload/navigation reset

// mobile/src/components/DistrictDashboardSection.js:192
// TODO: Navigate to reports screen

// mobile/src/components/DistrictDashboardSection.js:204
// TODO: Navigate to finance screen

// mobile/src/components/DistrictDashboardSection.js:216
// TODO: Navigate to groups screen

// mobile/src/components/DistrictDashboardSection.js:249
// TODO: Navigate to activity detail
```

**Recommended Solution:**

1. Create GitHub issues for each TODO
2. Link TODO comments to issue numbers:

```javascript
// TODO #123: Replace hardcoded fallback logo with a mobile-specific S3 asset
```

3. Set up automated TODO tracking (GitHub Actions or pre-commit hook)
4. Review TODOs quarterly and close completed ones

**Estimated Effort:** 1-2 hours

---

### 9. Mobile Navigation Stubs

**Issue:** Several navigation actions in mobile app are stubbed out with TODO comments.

**Impact:**
- Incomplete user experience
- Dead-end UI buttons
- Features appear broken

**Files Affected:**
- `mobile/src/components/DistrictDashboardSection.js`: 4 navigation TODOs

**Recommended Solution:**

Implement missing screens or hide buttons until ready:

```javascript
// Option 1: Hide button until screen exists
{canViewReports() && ROUTES.REPORTS_SCREEN && (
  <Button onPress={handleReportsPress}>Reports</Button>
)}

// Option 2: Show "Coming Soon" alert
const handleReportsPress = () => {
  Alert.alert(
    'Coming Soon',
    'Reports feature will be available in the next update.',
    [{ text: 'OK' }]
  );
};
```

**Estimated Effort:** 4-6 hours (implement missing screens)

---

## 🟢 LOW PRIORITY

### 10. Magic Numbers in Theme

**Issue:** Some spacing calculations use magic numbers instead of named constants.

**Example:**
```javascript
// mobile/src/screens/LeaderDashboardScreen.js:719-720
maxWidth: theme.spacing.xxxl * 5,  // What is 5?
height: theme.spacing.xxxl * 4,    // What is 4?
```

**Recommended Solution:**

Define semantic constants:

```javascript
// mobile/src/theme/index.js
export const LAYOUT_SIZES = {
  logoMaxWidth: theme.spacing.xxxl * 5,  // 320px
  logoHeight: theme.spacing.xxxl * 4,     // 256px
  // ... other layout sizes
};
```

**Estimated Effort:** 1-2 hours

---

### 11. Inconsistent Equality Operators

**Issue:** Mix of `==` and `===` operators found (821 instances of `===`, unclear how many `==`).

**Best Practice:**
Always use strict equality (`===`) unless type coercion is explicitly needed.

**Recommended Solution:**

1. Add ESLint rule:

```javascript
// .eslintrc.js
rules: {
  'eqeqeq': ['error', 'always']  // Enforce ===
}
```

2. Run auto-fix:

```bash
npx eslint --fix spa/**/*.js
```

**Estimated Effort:** 1 hour (automated)

---

### 12. Missing JSDoc Documentation

**Issue:** While many functions have good JSDoc comments, some routes and utilities are missing documentation.

**CLAUDE.md Requirement:**
> "All code must include clear documentation. JSDoc comments for all functions."

**Files Needing More Documentation:**
- Some route handlers in older files
- Utility functions in `utils/` directories
- Complex business logic sections

**Recommended Solution:**

Add JSDoc to undocumented functions:

```javascript
/**
 * Process participant attendance for a meeting
 * @param {number} meetingId - Meeting identifier
 * @param {number} participantId - Participant identifier
 * @param {string} status - Attendance status (P=Present, A=Absent, E=Excused)
 * @param {Object} pool - Database pool
 * @returns {Promise<Object>} Attendance record
 */
async function recordAttendance(meetingId, participantId, status, pool) {
  // ...
}
```

**Estimated Effort:** 4-6 hours (ongoing)

---

## Summary of Recommendations

### Immediate Actions (Next Sprint)

1. **Create `config/role-constants.js`** (Critical #1)
   - Centralizes all role definitions
   - Fixes 30+ files with hardcoded roles
   - **Effort:** 4-6 hours

2. **Add `data_scope` to roles table** (Critical #2)
   - Eliminates role hardcoding for data filtering
   - Future-proofs the authorization system
   - **Effort:** 6-8 hours

3. **Deprecate `authorize()` middleware** (Critical #3)
   - Migrate to permission-based checks
   - **Effort:** 2-3 hours

### Short-term (Next Month)

4. **Consolidate role-checking logic** (High #4)
   - Reduce code duplication
   - **Effort:** 2-3 hours

5. **Audit innerHTML usage** (High #6)
   - Security review
   - Implement sanitization helpers
   - **Effort:** 10-15 hours

6. **Replace console.log with DebugUtils** (High #7)
   - Clean up production logs
   - **Effort:** 6-8 hours

### Long-term (Next Quarter)

7. **Migrate Promise chains to async/await** (High #5)
   - Improve code readability
   - Can be done incrementally
   - **Effort:** 8-12 hours

8. **Implement missing mobile navigation** (Medium #9)
   - Complete user experience
   - **Effort:** 4-6 hours

9. **Add ESLint rules** (Low #11)
   - Enforce `===`, no-console, no-unsanitized
   - **Effort:** 1 hour

### Total Estimated Effort
- **Critical:** 12-17 hours
- **High:** 26-38 hours
- **Medium:** 5-8 hours
- **Low:** 6-9 hours
- **TOTAL:** 49-72 hours (~1.5-2 weeks of focused work)

---

## Testing Strategy

For each refactoring:

1. **Unit Tests:**
   - Test role constant imports
   - Test data scope logic
   - Test permission helpers

2. **Integration Tests:**
   - Test route authorization
   - Test data filtering (staff vs parent)
   - Test multi-role users

3. **Manual Testing:**
   - Test as each role type (district, leader, parent, etc.)
   - Verify data visibility
   - Check error messages

4. **Regression Testing:**
   - Run full test suite after each major change
   - Test existing features still work

---

## Monitoring and Prevention

### Prevent Future Technical Debt:

1. **Pre-commit Hooks:**
   ```bash
   # .husky/pre-commit
   npx eslint --fix
   npm test
   ```

2. **Code Review Checklist:**
   - ✅ No hardcoded role names
   - ✅ Uses `requirePermission()` not `authorize()`
   - ✅ Uses `async/await` not `.then()`
   - ✅ Uses `DebugUtils` not `console.log`
   - ✅ Sanitizes user input in `innerHTML`
   - ✅ Has JSDoc comments

3. **Automated Tools:**
   - ESLint with custom rules
   - SonarQube for code quality
   - GitHub Actions for CI/CD

4. **Documentation:**
   - Update CLAUDE.md with new patterns
   - Document common pitfalls
   - Maintain architecture decision records (ADRs)

---

## Conclusion

The Wampums codebase is generally well-structured and follows modern best practices. The main technical debt stems from the evolution of the role/permission system, where newer permission-based approaches coexist with older role-based hardcoding.

**Key Takeaways:**

✅ **Strengths:**
- Good separation of concerns (routes, middleware, utils)
- Strong permission system foundation
- Comprehensive documentation (CLAUDE.md)
- Mobile and web apps share similar patterns

⚠️ **Areas for Improvement:**
- Hardcoded role names throughout codebase
- Lack of data scope abstraction
- Inconsistent use of modern JavaScript patterns
- Security concerns with innerHTML usage

🎯 **Priority Focus:**
The **critical priority items** (role constants, data scope, authorize deprecation) should be addressed first as they:
1. Have the highest impact on maintainability
2. Affect the most code files
3. Create foundation for future features
4. Reduce risk of permission bugs

With a systematic approach and the recommended solutions, this technical debt can be resolved in **1.5-2 weeks** of focused engineering effort.

---

**Report Prepared By:** Claude Code
**Review Date:** December 27, 2025
**Next Review:** March 2026 (Quarterly)
