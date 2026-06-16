# CLAUDE.md - Development Guidelines for Wampums Scout Management System

**Last Updated:** 2026-06-16
**Project:** Wampums Scout Management System
**Tech Stack:** Node.js + Express, PostgreSQL, Vite (SPA), Vanilla JavaScript (ES modules), Expo/React Native (mobile)

---

## Core Principles

### 1) Language & Internationalization

**The app is bilingual (English/French) with support for additional languages.**

- ✅ **No mixed languages on a single page** — each view renders in one language only.
- ✅ All user-facing text must be translatable via `lang/en.json`, `lang/fr.json`, or translation APIs.
- ✅ Use language codes consistently (`en`, `fr`).
- ✅ Date/time formatting must respect locale (`formatDate(date, lang)` in `spa/utils/DateUtils.js`).
- ✅ Number formatting must respect locale.

**Implementation:**
- Frontend: translation helpers and keys from `lang/*.json`.
- Backend: translation keys from the `translations` table (see `routes/formBuilder.js`).
- Forms: use `organization_form_formats` for multilingual form definitions.
- ✅ **`lang/en.json` and `lang/fr.json` must have exactly the same set of keys** — enforced by `npm run lint:i18n-parity`. Any key added to one file must be added to both.

### 2) RESTful API Architecture

**All APIs must follow RESTful conventions with versioned endpoints.**

#### API Versioning
- ✅ **NEW ENDPOINTS:** Use `/api/v1/` for all new API routes
- ⚠️ **LEGACY:** Old `/api/` routes exist but should not be used for new features
- ✅ Version in URL path, not headers or query params
- ✅ All non-versioned `/api/*` requests are intercepted and return **410 Gone** with `{ success: false, message: '...deprecated...', replacement_endpoint: '/api/v1/...' }` — do not manually return 410; the `legacyApiDeprecationResponder` middleware handles it automatically
- ✅ New route mounts are registered in `routes/index.js`, not directly in `api.js`
- ✅ No duplicate `app.use()` mounts — enforced by `npm run lint:duplicate-mounts`
- ✅ Only routes on the explicit allow-list may use non-versioned mounts — enforced by `npm run lint:non-versioned-mounts`

#### HTTP Methods & URLs
- ✅ Use resource-based URLs: `/api/v1/participants`, `/api/v1/activities/{id}`
- ✅ Proper HTTP verbs:
  - `GET` - Read/retrieve resources
  - `POST` - Create new resources
  - `PUT` - Full update (replace entire resource)
  - `PATCH` - Partial update (modify specific fields)
  - `DELETE` - Remove resources
- ✅ Use plural nouns for collections: `/users`, `/participants`, `/activities`
- ✅ Use nested routes for relationships: `/api/v1/users/{userId}/roles`

#### Response Format
**ALL responses must use standardized format from `middleware/response.js`:**

```javascript
// Success response
const { success } = require('../middleware/response');
return success(res, data, 'Operation successful', 200);
// Returns: { success: true, message: '...', data: {...}, timestamp: '...' }

// Error response
const { error } = require('../middleware/response');
return error(res, 'Error message', 400, optionalValidationErrors);
// Returns: { success: false, message: '...', timestamp: '...', errors: [...] }

// Paginated response
const { paginated } = require('../middleware/response');
return paginated(res, items, page, limit, total);
// Returns: { success: true, data: [...], pagination: {...}, timestamp: '...' }
```

#### HTTP Status Codes
- `200` - OK (successful GET, PUT, PATCH)
- `201` - Created (successful POST)
- `204` - No Content (successful DELETE)
- `400` - Bad Request (validation error, malformed request); response includes `errors` array when from validation middleware
- `401` - Unauthorized (authentication required or failed); message must match `/authentication required/i`
- `403` - Forbidden (authenticated but insufficient permissions); response MUST include `required: string[]` and `missing: string[]`; `blockDemoRoles` 403 MUST include `isDemo: true`
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (duplicate, constraint violation)
- `410` - Gone (deprecated `/api/` legacy endpoint)
- `413` - Payload Too Large (request body exceeds 20 MB limit)
- `500` - Internal Server Error (unhandled server error); must NOT leak stack traces or internal paths

### 3) Authentication & Authorization

#### Authentication (Who are you?)
- ✅ Use `authenticate` middleware from `middleware/auth.js`
- ✅ JWT tokens in `Authorization: Bearer <token>` header
- ✅ Tokens contain: `user_id` (UUID), `roleIds`, `roleNames`, `permissions`, `organizationId`

```javascript
const { authenticate } = require('../middleware/auth');
router.get('/protected', authenticate, asyncHandler(async (req, res) => {
  // req.user available: { id, roleIds, roleNames, permissions, organizationId }
}));
```

#### Authorization (What can you do?)

**MODERN (Permission-Based) ✅ PREFERRED:**
```javascript
const { requirePermission } = require('../middleware/auth');
router.post('/budgets', authenticate, requirePermission('budget.manage'), handler);
router.get('/reports', authenticate, requirePermission('reports.view'), handler);
```

**DEPRECATED (Role-Based) ⚠️ AVOID:**
```javascript
// ❌ DON'T USE - deprecated, will be removed
const { authorize } = require('../middleware/auth');
router.get('/admin', authenticate, authorize('admin'), handler);
```

**Permission Naming Convention:**
- Format: `{resource}.{action}`
- Examples: `users.view`, `users.manage`, `finance.manage`, `reports.view`, `carpools.view`
- Common actions: `view`, `manage`, `create`, `edit`, `delete`, `assign_roles`

#### Protecting Write Operations
- ✅ Use `blockDemoRoles` middleware for write operations to prevent demo accounts from making changes
```javascript
const { blockDemoRoles } = require('../middleware/auth');
router.post('/users', authenticate, blockDemoRoles, requirePermission('users.manage'), handler);
router.delete('/data', authenticate, blockDemoRoles, requirePermission('data.delete'), handler);
```

#### Multi-Tenant Isolation
- ✅ **ALWAYS** filter queries by `organization_id`
- ✅ Use `getOrganizationId(req, pool)` helper to get organization context
- ✅ Organization ID from the JWT token **always takes precedence** over `x-organization-id` header and `organization_id` body field — never trust client-supplied org IDs for authenticated requests
- ✅ For unauthenticated public routes, the `x-organization-id` header (validated against `organization_domains` table) is used
```javascript
const { getOrganizationId } = require('../middleware/auth');
const organizationId = await getOrganizationId(req, pool);
const result = await pool.query(
  'SELECT * FROM participants WHERE organization_id = $1',
  [organizationId]
);
```

### 4) Database Conventions

#### ID Column Types
- ✅ **Users:** `id UUID` (generated via `gen_random_uuid()`)
- ✅ **Most other tables:** `id INTEGER` (using sequences)
- ✅ **Never use `parseInt()` on user IDs** - they are UUIDs (strings)
- ✅ Use appropriate type: `req.params.userId` (UUID string), `parseInt(req.params.participantId)` (integer)

#### Common Patterns
- ✅ All tables include `organization_id INTEGER` for multi-tenant isolation
- ✅ Timestamps: `created_at TIMESTAMP`, `updated_at TIMESTAMP`
- ✅ Soft deletes: `is_active BOOLEAN DEFAULT TRUE` or `deleted_at TIMESTAMP`
- ✅ JSONB columns for flexible data: `settings JSONB`, `metadata JSONB`
- ✅ Foreign key constraints with appropriate `ON DELETE` behavior

#### Query Security
```javascript
// ✅ GOOD - Parameterized query
const result = await pool.query(
  'SELECT * FROM participants WHERE id = $1 AND organization_id = $2',
  [participantId, organizationId]
);

// ❌ BAD - SQL injection vulnerability
const result = await pool.query(
  `SELECT * FROM participants WHERE id = ${id}` // NEVER DO THIS
);
```

### 5) Mobile-First Design (Web)

- ✅ Build for small screens first; enhance with `min-width` media queries.
- ✅ Touch-friendly targets (≥44px).
- ✅ CSS touch properties for mobile:
  ```css
  button {
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  ```
- ✅ Consistent UI patterns across pages (loading/error/empty states).
- ✅ PWA features supported (`service-worker.js`, `vite-plugin-pwa`).

### 6) Security First

- ✅ **Sanitize all user input and HTML.**
  - Frontend: `spa/utils/SecurityUtils.js` (`sanitizeHTML`, `escapeHTML`, `sanitizeURL`)
  - Backend: `utils/api-helpers.js` exports `escapeHtml` and shared helpers
- ✅ **Use parameterized queries for ALL SQL** - never string concatenation; enforced by `npm run lint:sql-params`
- ✅ **Validate inputs** using `express-validator` and shared utilities
- ✅ **Rate limiting** on sensitive endpoints (login, password reset); all API responses must include rate-limit headers (`ratelimit-limit` / `x-ratelimit-limit`)
- ✅ **Never log secrets** (JWT tokens, passwords, API keys)
- ✅ **HTTPS only** in production
- ✅ **Content Security Policy** headers set (via `helmet`); CSP must restrict `frame-src` to `https://js.stripe.com` and `object-src 'none'`
- ✅ **X-Content-Type-Options: nosniff** header required on all responses
- ✅ **CORS**: only `*.wampums.app` subdomains and `localhost` origins are allowed; all other origins are blocked (no `access-control-allow-origin` header emitted)
- ✅ **No stack traces in error responses** — `node_modules`, file paths, and `at <frame> (` patterns must never appear in response bodies
- ✅ **Request body limit**: 20 MB maximum; exceeded requests return `413 Payload Too Large`

#### Input Validation Rules (enforced by `middleware/validation.js` and tests)

**Email:**
- Valid format required (RFC-compliant, includes `@` and valid domain)
- Max 255 characters
- Auto-normalized to lowercase and trimmed before use

**Password (registration/change):**
- Min 8 characters
- At least one uppercase letter (`A–Z`)
- At least one lowercase letter (`a–z`)
- At least one digit (`0–9`)
- At least one special character
- Max 255 characters

**All validation failures return 400 with `{ success: false, message: '...', errors: [...] }`**

### 7) Frontend Best Practices

#### Module System
- ✅ Use ES6 modules (`import`/`export`)
- ✅ Organize utilities in `spa/utils/`
- ✅ **New feature modules go in `spa/modules/<feature>/`** — no new files may be added to the `spa/` root; enforced by `npm run lint:spa-files`

#### SPA DOM Manipulation
- ✅ Use `setContent()` from `spa/utils/DOMUtils.js` for all DOM updates
- ❌ **Never assign `innerHTML =` directly** (outside `DOMUtils.js` and `SecurityUtils.js`); enforced by `npm run lint:spa-innerhtml`

#### Configuration
- ✅ **No hardcoded values** - use `spa/config.js`
```javascript
import { CONFIG } from './config.js';
const url = `${CONFIG.API_BASE_URL}/api/v1/users`;
```

#### Logging
- ✅ Use `debugLog()` / `debugError()` from `spa/utils/DebugUtils.js`
- ❌ **Never use `console.*` in SPA files** — enforced by `npm run lint:spa-console` (only `DebugUtils.js` and `config.js` are exempt)
```javascript
import { debugLog, debugError } from './utils/DebugUtils.js';
debugLog('User data:', userData);
debugError('Failed to load:', error);
```

#### API Calls
- ✅ Use centralized API functions from `spa/api/api-endpoints.js`
- ✅ Leverage IndexedDB caching with appropriate duration
```javascript
import { getParticipants } from './api/api-endpoints.js';
const participants = await getParticipants({ forceRefresh: false });
```

#### State Management
- ✅ Use optimistic updates for better UX (`spa/utils/OptimisticUpdateManager.js`)
- ✅ Show loading skeletons during data fetch (`spa/utils/SkeletonUtils.js`)
- ✅ Handle error states gracefully

### 8) Code Quality

- ✅ **No magic numbers** - use named constants
- ✅ **Remove commented-out code** - use git history instead
- ✅ **No duplicate code** - extract to shared utilities
- ✅ **JSDoc for non-trivial functions:**
```javascript
/**
 * Assign participant to carpool offer
 * @param {string} participantId - UUID of participant
 * @param {number} carpoolOfferId - ID of carpool offer
 * @param {string} tripDirection - 'both', 'to_activity', or 'from_activity'
 * @returns {Promise<Object>} Assignment result
 */
async function assignToCarpool(participantId, carpoolOfferId, tripDirection) {
  // implementation
}
```

### 9) Error Handling

#### Backend
```javascript
const { asyncHandler } = require('../middleware/response');

router.get('/data', authenticate, asyncHandler(async (req, res) => {
  // asyncHandler catches errors and formats response
  const result = await pool.query('SELECT * FROM table WHERE id = $1', [id]);
  return success(res, result.rows);
}));
```

#### Frontend
```javascript
try {
  const data = await fetchData();
  this.render(data);
} catch (error) {
  debugError('Failed to fetch:', error);
  showToast(translate('error.generic'), 'error');
  this.renderErrorState();
}
```

### 10) ESLint Rules (`.eslintrc.js`)

The project enforces ESLint rules. **Errors block CI; warnings must be resolved before merge.**

**Errors (must fix):**
- `eqeqeq` — always use `===` / `!==`, never `==` / `!=`
- `no-var` — use `const` or `let`
- `no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url` — no dynamic code execution
- `no-with` — no `with` statements
- `no-eq-null` — use `=== null` not `== null`
- `no-extend-native` — don't extend built-in prototypes
- `no-fallthrough` — switch cases need `break` or `// falls through` comment
- `no-unused-expressions` — no expressions without side-effects
- `no-async-promise-executor` — no `async` inside `new Promise()`

**Warnings (keep clean):**
- `prefer-const` — use `const` when variable is never reassigned
- `prefer-arrow-callback` — use arrow functions for callbacks
- `prefer-template` — template literals over `+` string concatenation
- `no-magic-numbers` — use named constants (except `0`, `1`, `-1` and array indexes)
- `no-unused-vars` — prefix intentionally unused params/vars with `_`
- `no-param-reassign` — don't reassign function parameters
- `no-return-await` — don't `return await` inside async functions
- `no-await-in-loop` — avoid `await` inside loops; prefer `Promise.all()`
- `camelcase` — use camelCase for variable names (property names exempt)
- `curly` — always use curly braces for control structures (`if`, `for`, etc.)
- `consistent-return` — all code paths must either all return a value or none
- `require-await` — async functions must contain `await`
- `default-case` — switch statements need a `default` case
- `indent` — 2 spaces (switch cases indented 1 level)
- `quotes` — single quotes (double OK to avoid escaping)
- `semi` — semicolons required
- `linebreak-style` — Unix line endings (`\n`)

**Override exceptions:**
- `routes/`, `middleware/`, `services/`, `scripts/` — `no-console` is off (use `console.log` freely)
- `*.test.js`, `*.spec.js` — `no-magic-numbers` and `no-console` are off
- `migrations/`, `config/` — `no-magic-numbers` is off

### 11) Automated Lint Scripts

Run these before every PR. All must pass.

| Script | What it checks |
|---|---|
| `npm run lint:api-version` | New `app.use()` mounts in `api.js` use `/api/v1/` prefix |
| `npm run lint:duplicate-mounts` | No duplicate `app.use(path, router)` calls in `api.js` |
| `npm run lint:non-versioned-mounts` | Only allow-listed non-versioned mounts in `routes/index.js` |
| `npm run lint:spa-files` | No new JS files added to `spa/` root (use `spa/modules/`) |
| `npm run lint:spa-console` | No `console.*` calls in `spa/` (except `DebugUtils.js`, `config.js`) |
| `npm run lint:spa-innerhtml` | No `innerHTML =` assignments in `spa/` (except `DOMUtils.js`, `SecurityUtils.js`) |
| `npm run lint:sql-params` | No template-literal SQL (`pool.query(\`...${var}...\`)`)|
| `npm run lint:i18n-parity` | `lang/en.json` and `lang/fr.json` have identical key sets |

---

## Project Architecture

### Backend (Node.js + Express)
- **Entry point:** `api.js`
- **Routes:** `routes/*.js` (modular; register new routes in `routes/index.js`)
  - Use `/api/v1/` prefix for new routes
  - Each route file exports a function that takes `pool` parameter
- **Middleware:** 
  - `middleware/auth.js` - Authentication, authorization, organization context
  - `middleware/response.js` - Standardized API responses
  - `middleware/validation.js` - Input validation helpers
- **Utilities:** `utils/api-helpers.js`, `utils/logger.js`
- **Services:** `services/` - Business logic layer
- **Database migrations:** `migrations/*.sql` or `migrations/*.js`

### Web SPA (Vite + ES Modules)
- **Entry:** `index.html`, `spa/app.js`, `spa/router.js`
- **Configuration:** `spa/config.js` - All app-wide constants
- **Utilities:** `spa/utils/*`
  - `DebugUtils.js` - Logging (`debugLog`, `debugError`)
  - `DateUtils.js` - Date/time formatting and parsing
  - `SecurityUtils.js` - Input sanitization, XSS prevention
  - `StorageUtils.js` - LocalStorage/IndexedDB helpers
  - `ValidationUtils.js` - Form validation
  - `PermissionUtils.js` - Permission checks
  - `OptimisticUpdateManager.js` - Optimistic UI updates
  - `SkeletonUtils.js` - Loading states
- **API Layer:** `spa/api/`
  - `api-core.js` - Core HTTP client with retry logic
  - `api-endpoints.js` - Typed endpoint functions with caching
  - `api-*.js` - Feature-specific API modules
- **Modules:** `spa/modules/*` + feature files in `spa/`
- **Assets:** `assets/`, `css/`, `spa/assets/`

### Mobile App (Expo / React Native)
- **Location:** `mobile/`
- **Entry:** `mobile/index.js`, `mobile/App.js`
- **Utilities:** `mobile/src/utils/*` (mirrors web utilities where appropriate)
- **Security:** `mobile/src/utils/SecurityUtils.js` (same patterns as web)

### Directory Structure

```
/workspace/Wampums/
├── api.js                      # Express server entry point
├── package.json
├── vite.config.js
├── middleware/
│   ├── auth.js                 # authenticate, requirePermission, blockDemoRoles
│   ├── response.js             # success, error, paginated helpers
│   └── validation.js
├── routes/                     # API routes (all use pool parameter)
│   ├── auth.js                 # Login, 2FA, password reset
│   ├── users.js                # User management (UUID IDs)
│   ├── participants.js         # Participant CRUD (integer IDs)
│   ├── activities.js
│   ├── carpools.js
│   ├── finance.js
│   ├── roles.js                # Role & permission management
│   └── ...
├── services/                   # Business logic
├── utils/
│   ├── api-helpers.js          # getOrganizationId, escapeHtml, etc.
│   └── logger.js
├── migrations/                 # Database migrations
├── spa/                        # Frontend SPA
│   ├── app.js                  # App initialization
│   ├── router.js               # Client-side routing
│   ├── config.js               # Frontend configuration
│   ├── api/                    # API client layer
│   │   ├── api-core.js
│   │   ├── api-endpoints.js
│   │   └── api-*.js
│   ├── utils/                  # Frontend utilities
│   │   ├── DebugUtils.js
│   │   ├── DateUtils.js
│   │   ├── SecurityUtils.js
│   │   └── ...
│   └── modules/                # Feature modules
├── assets/                     # Static assets
├── css/                        # Stylesheets
├── lang/                       # Translation files
│   ├── en.json
│   ├── fr.json
│   └── ...
├── mobile/                     # React Native mobile app
├── attached_assets/            # Documentation
│   ├── Full_Database_schema.sql
│   └── README-MIGRATIONS.md
└── test/                       # Test files
```

---

## Development Workflow

### Web (Vite + API)

```bash
npm install
npm run dev      # Vite dev server (port 5173)
npm start        # API server (port 3000)
```

### Mobile (Expo)

```bash
cd mobile
npm install
npm run start    # Expo dev server
```

### Migrations

```bash
npm run migrate:up      # Apply migrations
npm run migrate:down    # Rollback migrations
npm run migrate:create  # Create new migration
```

---

## Environment Variables (Server)

**Required:**
```bash
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/wampums
JWT_SECRET_KEY=<secure-random-key>
```

**Optional:**
```bash
NODE_ENV=production
VAPID_PUBLIC=<vapid-public-key>
VAPID_PRIVATE=<vapid-private-key>
SENDGRID_API_KEY=<email-service-key>
SENTRY_DSN=<error-tracking>
STRIPE_SECRET_KEY=<payment-processing>
```

---

## Common Patterns & Examples

### Backend Route Template

```javascript
// routes/resource.js
const express = require('express');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

module.exports = (pool) => {
  const router = express.Router();

  // GET collection - read permission
  router.get('/v1/resources', 
    authenticate, 
    requirePermission('resources.view'), 
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      
      const result = await pool.query(
        'SELECT * FROM resources WHERE organization_id = $1 ORDER BY created_at DESC',
        [organizationId]
      );
      
      return success(res, result.rows);
    })
  );

  // POST create - manage permission + block demos
  router.post('/v1/resources', 
    authenticate, 
    blockDemoRoles,
    requirePermission('resources.manage'), 
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { name, description } = req.body;
      
      // Validate input
      if (!name) {
        return error(res, 'Name is required', 400);
      }
      
      const result = await pool.query(
        'INSERT INTO resources (name, description, organization_id) VALUES ($1, $2, $3) RETURNING *',
        [name, description, organizationId]
      );
      
      return success(res, result.rows[0], 'Resource created', 201);
    })
  );

  // PATCH update - manage permission + ownership check
  router.patch('/v1/resources/:id', 
    authenticate, 
    blockDemoRoles,
    requirePermission('resources.manage'), 
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const resourceId = parseInt(req.params.id);
      const { name, description } = req.body;
      
      // Verify resource exists and belongs to organization
      const check = await pool.query(
        'SELECT id FROM resources WHERE id = $1 AND organization_id = $2',
        [resourceId, organizationId]
      );
      
      if (check.rows.length === 0) {
        return error(res, 'Resource not found', 404);
      }
      
      const result = await pool.query(
        'UPDATE resources SET name = COALESCE($1, name), description = COALESCE($2, description), updated_at = NOW() WHERE id = $3 AND organization_id = $4 RETURNING *',
        [name, description, resourceId, organizationId]
      );
      
      return success(res, result.rows[0], 'Resource updated');
    })
  );

  // DELETE - manage permission
  router.delete('/v1/resources/:id', 
    authenticate, 
    blockDemoRoles,
    requirePermission('resources.manage'), 
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const resourceId = parseInt(req.params.id);
      
      const result = await pool.query(
        'DELETE FROM resources WHERE id = $1 AND organization_id = $2 RETURNING id',
        [resourceId, organizationId]
      );
      
      if (result.rows.length === 0) {
        return error(res, 'Resource not found', 404);
      }
      
      return success(res, null, 'Resource deleted');
    })
  );

  return router;
};
```

### Frontend Module Template

```javascript
// spa/resource-manager.js
import { translate } from './app.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { CONFIG } from './config.js';
import { getResources, createResource, updateResource, deleteResource } from './api/api-resources.js';
import { sanitizeHTML } from './utils/SecurityUtils.js';
import { setContent } from './utils/DOMUtils.js';
import { showToast } from './utils/ToastUtils.js';
import { requirePermission } from './utils/PermissionUtils.js';

export class ResourceManager {
  constructor(app) {
    this.app = app;
    this.resources = [];
    this.canManage = requirePermission('resources.manage');
  }

  async init() {
    debugLog('Initializing ResourceManager');
    
    try {
      await this.loadData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('Failed to initialize:', error);
      showToast(translate('error.loading_failed'), 'error');
    }
  }

  async loadData() {
    try {
      const response = await getResources({ forceRefresh: false });
      this.resources = response.data || [];
      debugLog('Loaded resources:', this.resources.length);
    } catch (error) {
      debugError('Failed to load resources:', error);
      throw error;
    }
  }

  render() {
    const container = document.getElementById('app');
    
    const html = `
      <section class="page">
        <header class="page__header">
          <h1>${translate('resources.title')}</h1>
          ${this.canManage ? `
            <button class="button button--primary" id="add-resource-btn">
              ${translate('resources.add')}
            </button>
          ` : ''}
        </header>
        
        <div class="resource-list">
          ${this.resources.length === 0 ? `
            <p class="empty-state">${translate('resources.empty')}</p>
          ` : this.resources.map(r => this.renderResourceCard(r)).join('')}
        </div>
      </section>
    `;
    
    setContent(container, html);
  }

  renderResourceCard(resource) {
    const safeName = sanitizeHTML(resource.name);
    const safeDescription = sanitizeHTML(resource.description || '');
    
    return `
      <div class="resource-card" data-id="${resource.id}">
        <h3>${safeName}</h3>
        <p>${safeDescription}</p>
        ${this.canManage ? `
          <div class="resource-card__actions">
            <button class="button button--small edit-btn" data-id="${resource.id}">
              ${translate('edit')}
            </button>
            <button class="button button--small button--danger delete-btn" data-id="${resource.id}">
              ${translate('delete')}
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  attachEventListeners() {
    if (this.canManage) {
      document.getElementById('add-resource-btn')?.addEventListener('click', () => {
        this.showResourceModal();
      });

      document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = parseInt(e.target.dataset.id);
          const resource = this.resources.find(r => r.id === id);
          if (resource) {
            this.showResourceModal(resource);
          }
        });
      });

      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = parseInt(e.target.dataset.id);
          await this.handleDelete(id);
        });
      });
    }
  }

  async handleDelete(id) {
    if (!confirm(translate('resources.confirm_delete'))) {
      return;
    }

    try {
      await deleteResource(id);
      showToast(translate('resources.deleted'), 'success');
      await this.loadData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('Delete failed:', error);
      showToast(translate('error.delete_failed'), 'error');
    }
  }

  // Additional methods...
}
```

---

## Code Review Checklist

Before submitting code, verify:

**API (Backend):**
- [ ] Uses `/api/v1/` prefix for new endpoints; registered in `routes/index.js`
- [ ] Proper HTTP methods and status codes (see §2 for full list including 410, 413)
- [ ] JWT authentication applied (`authenticate` middleware)
- [ ] Permission-based authorization (`requirePermission` middleware)
- [ ] `blockDemoRoles` on all write operations; returns `{ isDemo: true }` in 403 body
- [ ] 403 permission errors include `required` and `missing` arrays
- [ ] Parameterized queries only — no template-literal SQL (`${var}` inside backtick query)
- [ ] Organization ID filtering on all queries; use `getOrganizationId(req, pool)` not client headers
- [ ] Uses `success()`, `error()`, `paginated()` response helpers from `middleware/response.js`
- [ ] Proper error handling with `asyncHandler`; no stack traces in error responses
- [ ] Input validation via `middleware/validation.js`; password/email rules respected
- [ ] User IDs treated as UUIDs (strings), not parsed to integers
- [ ] No new keys added to `lang/en.json` without a matching key in `lang/fr.json`

**Frontend (Web/Mobile):**
- [ ] Uses `spa/config.js` constants (no hardcoded URLs)
- [ ] New features in `spa/modules/<feature>/`, not in `spa/` root
- [ ] No `innerHTML =` outside `DOMUtils.js` and `SecurityUtils.js`
- [ ] API calls through centralized functions
- [ ] `debugLog`/`debugError` instead of `console.*`
- [ ] All user input sanitized before display
- [ ] Translations for all user-facing text; keys added to both `en.json` and `fr.json`
- [ ] Mobile-responsive layout
- [ ] Loading/error/empty states
- [ ] Permission checks before showing UI elements

**Linting (run all before PR):**
- [ ] `npm run lint:api-version` passes
- [ ] `npm run lint:duplicate-mounts` passes
- [ ] `npm run lint:non-versioned-mounts` passes
- [ ] `npm run lint:spa-files` passes
- [ ] `npm run lint:spa-console` passes
- [ ] `npm run lint:spa-innerhtml` passes
- [ ] `npm run lint:sql-params` passes
- [ ] `npm run lint:i18n-parity` passes

**General:**
- [ ] No commented-out code
- [ ] No magic numbers or hardcoded values (use named constants)
- [ ] `const`/`let` only — no `var`
- [ ] `===`/`!==` only — no `==`/`!=`
- [ ] Curly braces on all control structures
- [ ] JSDoc for complex functions
- [ ] No duplicate code
- [ ] Follows existing code style (2-space indent, single quotes, semicolons, Unix line endings)

---

**This document is the source of truth for development practices. When in doubt, refer to existing code in `routes/`, `spa/`, and `middleware/` for examples.**
