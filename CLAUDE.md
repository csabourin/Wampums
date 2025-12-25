# CLAUDE.MD - Development Guidelines for Wampums Scout Management System

**Last Updated:** December 1, 2025
**Project:** Wampums Scout Management System
**Tech Stack:** Node.js, Express, PostgreSQL, Vite, Vanilla JavaScript (ES6 modules)

---

## Core Principles

### 1. Language & Internationalization

**The app is bilingual (English/French) with support for additional languages.**

- ✅ **NO mixed languages on a single page** - Each page must display in one language only
- ✅ Store translations in JSON format (`lang/en.json`, `lang/fr.json`)
- ✅ Use the `translations` database table for dynamic content
- ✅ All user-facing text must be translatable
- ✅ Use language codes consistently: `en`, `fr`
- ✅ Date/time formatting must respect locale (`formatDate(date, lang)`)
- ✅ Number formatting must respect locale (commas vs periods)

**Implementation:**
- Frontend: Use `translations` API endpoint and `getTranslation(key, lang)` utility
- Backend: Store multilingual content in JSONB columns where appropriate
- Forms: Use `organization_form_formats` table for customizable multilingual forms

### 2. RESTful API Architecture

**All APIs must follow RESTful conventions.**

- ✅ Use resource-based URLs: `/api/v1/participants` (NOT `/api?action=getParticipants`)
- ✅ Use proper HTTP verbs:
  - `GET` - Retrieve resources
  - `POST` - Create resources
  - `PUT` - Update entire resources
  - `PATCH` - Partial updates
  - `DELETE` - Remove resources
- ✅ API versioning: All new endpoints must use `/api/v1/` prefix
- ✅ Consistent response format:
  ```json
  {
    "success": true,
    "message": "Operation successful",
    "data": { ... },
    "timestamp": "2025-12-01T12:00:00.000Z"
  }
  ```
- ✅ Use proper HTTP status codes:
  - `200` - Success
  - `201` - Created
  - `400` - Bad Request (validation errors)
  - `401` - Unauthorized (missing/invalid token)
  - `403` - Forbidden (insufficient permissions)
  - `404` - Not Found
  - `500` - Internal Server Error

**Authentication:**
- All API endpoints (except public routes) MUST require JWT authentication
- Use `authenticate` middleware for protected routes
- Use `authorize(roles...)` middleware for role-based access
- Token format: `Authorization: Bearer <token>`

### 3. Mobile-First Design

**Always design for mobile screens first, then scale up.**

- ✅ Responsive design is MANDATORY
- ✅ Test on mobile devices (320px width minimum)
- ✅ Touch-friendly UI elements (minimum 44px tap targets)
- ✅ Optimize images and assets for mobile bandwidth
- ✅ Progressive Web App (PWA) features:
  - Service Worker for offline support
  - Installable on home screen
  - Push notifications support
- ✅ Mobile navigation patterns (hamburger menu, bottom nav)
- ✅ Consider thumb zones for important actions

**CSS Strategy:**
```css
/* Mobile first - default styles */
.element { font-size: 14px; }

/* Tablet and up */
@media (min-width: 768px) {
  .element { font-size: 16px; }
}

/* Desktop */
@media (min-width: 1024px) {
  .element { font-size: 18px; }
}
```

### 4. Simple and Consistent UI

**UI must be simple, intuitive, and consistent across all pages.**

- ✅ Use consistent components across the application
- ✅ Follow established design patterns within the codebase
- ✅ Maintain visual hierarchy (headings, spacing, colors)
- ✅ Use loading states (spinners, skeletons) consistently
- ✅ Display clear error messages in user's language
- ✅ Provide user feedback for all actions (success/error toasts)
- ✅ Keep forms simple - only ask for necessary information
- ✅ Use progressive disclosure (show advanced options only when needed)

**Component Consistency:**
- Buttons: Same styling and behavior across pages
- Forms: Consistent validation, error display, and submission flow
- Tables: Consistent sorting, filtering, and pagination
- Modals: Same animation and backdrop behavior
- Icons: Use consistent icon library throughout

### 5. Best Practices Only - No Hacks

**Write clean, maintainable code. Never use shortcuts or hacks.**

- ✅ **NO `eval()`, `innerHTML` with user data, or other security risks**
- ✅ **NO hardcoded values** - Use configuration files (`spa/config.js`)
- ✅ **NO magic numbers** - Use named constants
- ✅ **NO commented-out code** - Use git history instead
- ✅ **NO duplicate code** - Create reusable utilities
- ✅ Use proper error handling (try-catch with meaningful errors)
- ✅ Use async/await (NOT callback hell or `.then()` chains)
- ✅ Validate ALL user input (frontend AND backend)
- ✅ Sanitize ALL user input before displaying
- ✅ Use prepared statements for database queries (prevent SQL injection)
- ✅ Follow separation of concerns:
  - Routes handle HTTP requests/responses
  - Modules contain business logic
  - Utilities provide reusable functions
  - Components render UI

**Code Quality Standards:**
```javascript
// ❌ BAD - Magic number
setTimeout(() => { ... }, 300000);

// ✅ GOOD - Named constant
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
setTimeout(() => { ... }, CACHE_DURATION_MS);

// ❌ BAD - Hardcoded
fetch('http://localhost:3000/api/participants')

// ✅ GOOD - Use config
import { CONFIG } from './config.js';
fetch(`${CONFIG.API_BASE_URL}/api/v1/participants`)

// ❌ BAD - String concatenation in SQL
db.query(`SELECT * FROM users WHERE id = ${userId}`)

// ✅ GOOD - Parameterized query
db.query('SELECT * FROM users WHERE id = $1', [userId])
```

### 6. Backward Compatibility Not Important

**Feel free to make breaking changes to improve the codebase.**

- ✅ Refactor without worrying about old code
- ✅ Remove deprecated endpoints when better ones exist
- ✅ Update database schema via migrations (rollback capability)
- ✅ Change data structures to improve clarity
- ✅ Rename functions/variables for better readability
- ✅ Delete unused code aggressively

**However:**
- ⚠️ Document breaking changes in migration docs
- ⚠️ Communicate changes to team
- ⚠️ Test thoroughly after breaking changes

### 7. Code Must Be Well Documented

**All code must include clear documentation.**

- ✅ **JSDoc comments** for all functions:
  ```javascript
  /**
   * Retrieve all participants for the current organization
   * @param {number} organizationId - Organization ID
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Items per page (default: 50)
   * @returns {Promise<{data: Array, pagination: Object}>}
   */
  async function getParticipants(organizationId, page = 1, limit = 50) {
    // Implementation
  }
  ```
- ✅ Explain WHY, not just WHAT:
  ```javascript
  // ❌ BAD - States the obvious
  // Set status to 'P'
  status = 'P';

  // ✅ GOOD - Explains why
  // Mark as present to award attendance points
  status = 'P';
  ```
- ✅ Document complex algorithms or business logic
- ✅ Add README files for major features/modules
- ✅ Keep API documentation (Swagger) up to date
- ✅ Document database schema changes in migrations
- ✅ Add usage examples for utilities and modules

---

## Project Architecture

### Technology Stack

**Backend:**
- Node.js 18+ with Express.js
- PostgreSQL 15+ (with JSONB support)
- JWT authentication (`jsonwebtoken`)
- Database migrations (`node-pg-migrate`)
- API documentation (Swagger/OpenAPI)
- Compression middleware (gzip)
- Web push notifications (`web-push`)

**Frontend:**
- Vanilla JavaScript (ES6 modules)
- Vite 7.2+ (build system)
- Progressive Web App (PWA)
- Service Worker (offline support)
- No framework dependencies (intentional choice)

**Development:**
- Vite dev server (port 5173)
- Hot Module Replacement (HMR)
- Environment variables (`.env.*` files)
- Bundle analysis (Rollup visualizer)

### Directory Structure

```
/home/user/Wampums/
├── api.js                      # Main Express server
├── package.json                # Dependencies and scripts
├── vite.config.js              # Vite build configuration
├── .env.example                # Environment variables template
│
├── middleware/                 # Express middleware
│   ├── auth.js                 # JWT authentication
│   └── response.js             # Standardized responses
│
├── routes/                     # RESTful API routes
│   ├── participants.js         # Participant CRUD
│   ├── attendance.js           # Attendance tracking
│   └── groups.js               # Group management
│
├── config/                     # Configuration files
│   └── swagger.js              # OpenAPI/Swagger config
│
├── migrations/                 # Database migrations
│   └── [timestamp]_*.js        # Migration files
│
├── spa/                        # Frontend application
│   ├── index.html              # Entry point
│   ├── app.js                  # Application initialization
│   ├── router.js               # Client-side routing
│   ├── config.js               # Frontend configuration
│   │
│   ├── utils/                  # Utility modules
│   │   ├── DebugUtils.js       # Debug logging
│   │   ├── DateUtils.js        # Date manipulation
│   │   ├── StorageUtils.js     # LocalStorage helpers
│   │   └── ValidationUtils.js  # Form validation
│   │
│   ├── modules/                # Feature modules
│   │   ├── attendance.js       # Attendance page
│   │   ├── participants.js     # Participants page
│   │   ├── manage_points.js    # Points management
│   │   └── ...                 # Other modules
│   │
│   └── assets/                 # Static assets
│       ├── css/                # Stylesheets
│       ├── images/             # Images
│       └── icons/              # Icon files
│
├── lang/                       # Translation files
│   ├── en.json                 # English translations
│   └── fr.json                 # French translations
│
└── attached_assets/            # Documentation
    ├── API_Endpoints.md        # API documentation
    ├── PHASE1_MIGRATION.md     # Migration phase 1 docs
    ├── PHASE2_FRONTEND_OPTIMIZATION.md
    ├── PHASE3_RESTFUL_API.md
    └── Full_Database_schema.txt
```

### Database Schema

**Key Tables:**
- `organizations` - Multi-tenant organizations
- `users` - User accounts with JWT authentication
- `participants` - Scout members
- `groups` - Patrols/groups within organizations
- `attendance` - Meeting attendance tracking
- `points` - Individual and group points
- `badges` - Badge progress tracking
- `honors` - Honor/award tracking
- `form_submissions` - Dynamic form submissions (JSONB)
- `organization_form_formats` - Customizable form structures (JSONB)
- `organization_settings` - Organization-specific settings (JSONB)

**Important Patterns:**
- All tables have `organization_id` for multi-tenant isolation
- JSONB columns for flexible, customizable data
- Timestamps: `created_at`, `updated_at`
- Foreign keys with CASCADE deletes where appropriate

### Authentication & Authorization

**Roles:**
- `admin` - Full system access
- `animation` - Staff/animator access (attendance, points, meetings)
- `parent` - Parent/guardian access (view child info only)

**Middleware Usage:**
```javascript
// Require authentication
router.get('/participants', authenticate, handler);

// Require specific role
router.delete('/participants/:id', authenticate, authorize('admin'), handler);

// Multiple roles allowed
router.post('/attendance', authenticate, authorize('admin', 'animation'), handler);
```

**Organization Isolation:**
- Always filter queries by `req.user.organizationId`
- Never allow cross-organization data access
- Use `getOrganizationId(req, pool)` from auth middleware

---

## Development Workflow

### Environment Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env.development
   # Edit .env.development with your database credentials
   ```

3. **Run migrations:**
   ```bash
   export DATABASE_URL="postgresql://user:pass@localhost:5432/wampums"
   npm run migrate up
   ```

4. **Start development servers:**
   ```bash
   # Terminal 1: Frontend (Vite)
   npm run dev

   # Terminal 2: Backend (Node.js)
   npm start
   ```

5. **Access application:**
   - Frontend: `http://localhost:5173`
   - Backend API: `http://localhost:3000`
   - API Docs: `http://localhost:3000/api-docs`

### Creating New Features

#### 1. API Endpoint

```javascript
// routes/example.js
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

module.exports = (pool) => {
  const router = express.Router();

  /**
   * @swagger
   * /api/v1/example:
   *   get:
   *     summary: Get example data
   *     tags: [Example]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Success
   */
  router.get('/', authenticate, asyncHandler(async (req, res) => {
    const organizationId = req.user.organizationId;

    const result = await pool.query(
      'SELECT * FROM example_table WHERE organization_id = $1',
      [organizationId]
    );

    return success(res, result.rows);
  }));

  return router;
};
```

#### 2. Frontend Module

```javascript
// spa/modules/example.js
import { ajax } from './ajax-functions.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { CONFIG } from './config.js';

export class ExampleModule {
  constructor() {
    this.data = [];
  }

  /**
   * Initialize the example module
   */
  async init() {
    debugLog('Initializing ExampleModule');
    await this.loadData();
    this.render();
  }

  /**
   * Load data from API
   */
  async loadData() {
    try {
      const response = await ajax({
        url: `${CONFIG.API_BASE_URL}/api/v1/example`,
        method: 'GET'
      });

      if (response.success) {
        this.data = response.data;
      }
    } catch (err) {
      debugError('Failed to load example data:', err);
      throw err;
    }
  }

  /**
   * Render the module UI
   */
  render() {
    const container = document.getElementById('content');
    container.innerHTML = `
      <h1 data-i18n="example.title">Example</h1>
      <div id="example-list"></div>
    `;
    this.renderList();
  }

  /**
   * Render data list
   */
  renderList() {
    const listContainer = document.getElementById('example-list');
    listContainer.innerHTML = this.data.map(item => `
      <div class="example-item">
        <span>${item.name}</span>
      </div>
    `).join('');
  }
}
```

#### 3. Database Migration

```bash
npm run migrate create add-example-table
```

```javascript
// migrations/XXXXXX_add-example-table.js
exports.up = (pgm) => {
  pgm.createTable('example_table', {
    id: 'id',
    organization_id: {
      type: 'integer',
      notNull: true,
      references: 'organizations',
      onDelete: 'CASCADE'
    },
    name: {
      type: 'varchar(255)',
      notNull: true
    },
    description: {
      type: 'text'
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  pgm.createIndex('example_table', 'organization_id');
};

exports.down = (pgm) => {
  pgm.dropTable('example_table');
};
```

### Code Review Checklist

Before submitting code, verify:

- [ ] All functions have JSDoc comments
- [ ] API endpoints use RESTful conventions
- [ ] Authentication/authorization middleware applied
- [ ] Database queries use parameterized queries
- [ ] User input is validated (frontend AND backend)
- [ ] Error handling is implemented
- [ ] Translations added for all user-facing text
- [ ] Mobile-responsive design tested
- [ ] No hardcoded values (use CONFIG)
- [ ] No duplicate code (use utilities)
- [ ] Code follows established patterns
- [ ] Browser console has no errors
- [ ] API documentation (Swagger) updated

---

## Best Practices by Area

### Database

- ✅ **Always use parameterized queries** to prevent SQL injection
- ✅ Use transactions for multi-step operations
- ✅ Add indexes for frequently queried columns
- ✅ Use `organization_id` in all WHERE clauses
- ✅ Leverage JSONB for flexible data structures
- ✅ Create migrations for all schema changes
- ✅ Test migrations with up/down cycle before deploying

**Example:**
```javascript
// ❌ BAD - SQL injection risk
const result = await pool.query(
  `SELECT * FROM participants WHERE id = ${id}`
);

// ✅ GOOD - Parameterized
const result = await pool.query(
  'SELECT * FROM participants WHERE id = $1 AND organization_id = $2',
  [id, organizationId]
);
```

### API Design

- ✅ Use plural nouns for resources: `/participants` not `/participant`
- ✅ Nest related resources: `/participants/:id/attendance`
- ✅ Use query parameters for filtering: `/participants?group_id=5`
- ✅ Use query parameters for pagination: `?page=2&limit=50`
- ✅ Return consistent response format (use response middleware)
- ✅ Include pagination metadata for list endpoints
- ✅ Use proper HTTP status codes
- ✅ Document all endpoints in Swagger

### Frontend

- ✅ Use ES6 modules (`import`/`export`)
- ✅ Lazy load modules via dynamic imports
- ✅ Use utility modules (DebugUtils, DateUtils, etc.)
- ✅ Store configuration in `spa/config.js`
- ✅ Use `ajax()` function for all API calls
- ✅ Handle loading states (spinners)
- ✅ Display user-friendly error messages
- ✅ Validate forms before submission
- ✅ Use `localStorage` through StorageUtils
- ✅ Test on mobile devices

### Security

- ✅ **Never trust user input** - Validate and sanitize everything
- ✅ Use JWT tokens (NOT sessions)
- ✅ Store JWT in localStorage (NOT cookies for this app)
- ✅ Include `Authorization: Bearer <token>` header in all API calls
- ✅ Sanitize HTML before rendering (`sanitizeHTML()`)
- ✅ Use HTTPS in production
- ✅ Set proper CORS headers
- ✅ Use helmet.js for security headers
- ✅ Rate limit authentication endpoints
- ✅ Hash passwords with bcrypt (12+ rounds)
- ✅ Never log sensitive data (passwords, tokens)

### Performance

- ✅ Use code splitting (Vite handles this)
- ✅ Lazy load modules on demand
- ✅ Enable gzip compression (already enabled)
- ✅ Use database indexes
- ✅ Paginate large datasets
- ✅ Cache static assets (service worker)
- ✅ Optimize images (WebP, proper sizing)
- ✅ Use connection pooling for database
- ✅ Minimize database queries (avoid N+1 problems)

---

## Common Patterns

### Fetching Data

```javascript
import { ajax } from './ajax-functions.js';
import { CONFIG } from './config.js';
import { debugLog, debugError } from './utils/DebugUtils.js';

async function fetchParticipants(page = 1, limit = 50) {
  try {
    const response = await ajax({
      url: `${CONFIG.API_BASE_URL}/api/v1/participants?page=${page}&limit=${limit}`,
      method: 'GET'
    });

    if (response.success) {
      debugLog('Participants loaded:', response.data.length);
      return response.data;
    } else {
      throw new Error(response.message);
    }
  } catch (error) {
    debugError('Failed to fetch participants:', error);
    throw error;
  }
}
```

### Form Validation

```javascript
import { validateParticipant } from './utils/ValidationUtils.js';

function submitForm() {
  const data = {
    first_name: document.getElementById('first_name').value,
    last_name: document.getElementById('last_name').value,
    email: document.getElementById('email').value,
    date_naissance: document.getElementById('date_naissance').value
  };

  const validation = validateParticipant(data);

  if (!validation.isValid) {
    displayErrors(validation.errors);
    return;
  }

  // Submit to API
  saveParticipant(data);
}
```

### Error Handling

```javascript
async function saveData(data) {
  try {
    const response = await ajax({
      url: `${CONFIG.API_BASE_URL}/api/v1/participants`,
      method: 'POST',
      body: JSON.stringify(data)
    });

    if (response.success) {
      showToast(getTranslation('success.saved'), 'success');
      return response.data;
    } else {
      throw new Error(response.message);
    }
  } catch (error) {
    debugError('Save failed:', error);
    showToast(getTranslation('error.saveFailed'), 'error');
    throw error;
  }
}
```

### Date Formatting

```javascript
import { formatDate, getTodayISO, isValidDate } from './utils/DateUtils.js';

// Get today's date
const today = getTodayISO(); // "2025-12-01"

// Format for display
const displayDate = formatDate('2025-12-01', 'fr'); // "1 décembre 2025"

// Validate date
if (!isValidDate(userInput)) {
  showError('Invalid date');
}
```

---

## Deployment

### Production Build

```bash
# 1. Install dependencies
npm ci --only=production

# 2. Build frontend
npm run build

# 3. Run migrations
export DATABASE_URL="${PRODUCTION_DATABASE_URL}"
npm run migrate up

# 4. Start server
NODE_ENV=production npm start
```

### Environment Variables

**Required for production:**
```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/wampums
JWT_SECRET_KEY=<secure-random-key>
VAPID_PUBLIC=<vapid-public-key>
VAPID_PRIVATE=<vapid-private-key>
```

**Optional:**
```bash
SENDGRID_API_KEY=<for-email-notifications>
SENTRY_DSN=<for-error-tracking>
LOG_LEVEL=info
```

---

## Troubleshooting

### Common Issues

**API returns 401 Unauthorized:**
- Check JWT token is included in Authorization header
- Verify JWT_SECRET_KEY matches between environments
- Token may be expired - user needs to re-login

**Database connection fails:**
- Verify DATABASE_URL is correct
- Check PostgreSQL is running
- Ensure user has proper permissions

**Build fails:**
- Clear build cache: `rm -rf dist/ node_modules/.vite`
- Reinstall dependencies: `npm install`
- Check for syntax errors in imports

**Service Worker not updating:**
- Unregister old service worker in DevTools
- Hard refresh browser (Ctrl+Shift+R)
- Check service-worker.js version number

---

## Resources

### Documentation Files
- `API_Endpoints.md` - Complete API documentation
- `PHASE1_MIGRATION.md` - PHP to Node.js migration
- `PHASE2_FRONTEND_OPTIMIZATION.md` - Vite build system
- `PHASE3_RESTFUL_API.md` - RESTful API architecture
- `README-MIGRATIONS.md` - Database migration guide
- `REFACTORING_REPORT.md` - Code refactoring details

### API Documentation
- Swagger UI: `http://localhost:3000/api-docs`
- Interactive testing and documentation

### Database
- Schema: See `Full_Database_schema.txt`
- Migrations: Run `npm run migrate status` to see applied migrations

---

## Questions or Issues?

When encountering issues:

1. Check browser console for errors
2. Check server logs (`error.log`, `combined.log`)
3. Review API documentation at `/api-docs`
4. Check database connection and migrations
5. Verify environment variables are set correctly

---

**This document is the source of truth for development practices. When in doubt, refer to this document and the established patterns in the codebase.**
