# GitHub Copilot Instructions for Wampums

This document guides AI code generation for the Wampums Scout Management System.

## Project Overview

**Tech Stack:** Node.js + Express, PostgreSQL, Vite, Vanilla JavaScript (ES6 modules)
**Architecture:** Multi-tenant SaaS, JWT authentication, RESTful API, Progressive Web App

## Core Development Principles

### 1. Bilingual & Internationalization
- **NO mixed languages on a single page** - each page displays in one language only
- Store translations in `lang/en.json`, `lang/fr.json` and `translations` table
- All user-facing text MUST be translatable via `getTranslation(key, lang)`
- Use locale-aware date/number formatting: `formatDate(date, lang)`
- Language codes: `en`, `fr` (lowercase, consistent)

### 2. RESTful API Standards
- Use resource-based URLs: `/api/v1/participants` NOT `/api?action=getParticipants`
- HTTP verbs: GET (read), POST (create), PUT (full update), PATCH (partial), DELETE
- All endpoints require JWT: `Authorization: Bearer <token>`
- Response format:
  ```json
  {
    "success": true,
    "message": "Operation successful",
    "data": {...},
    "timestamp": "2025-12-01T12:00:00.000Z"
  }
  ```
- Status codes: 200 (success), 201 (created), 400 (validation), 401 (auth), 403 (forbidden), 404 (not found), 500 (error)

### 3. Mobile-First Design
- Default styles for 320px+ screens, use `@media (min-width: 768px)` to enhance
- Minimum 44px touch targets
- Test responsive behavior on mobile screens
- Progressive Web App features enabled (service worker, installable)

### 4. Security First
- **ALWAYS use parameterized queries**: `pool.query('SELECT * FROM users WHERE id = $1', [userId])`
- **NEVER use string concatenation in SQL** - prevents SQL injection
- Sanitize ALL user input before display (use `SecurityUtils`, `escapeHtml`)
- Validate input on both frontend AND backend
- Filter all queries by `organization_id` for multi-tenant isolation
- JWT tokens in localStorage, include in all API calls
- Hash passwords with bcrypt (12+ rounds)

### 5. No Hacks - Best Practices Only
- **NO hardcoded values** - use `CONFIG` constants from `spa/config.js`
- **NO magic numbers** - use named constants
- **NO commented-out code** - use git history
- **NO duplicate code** - create reusable utilities
- **NO eval(), innerHTML with user data**
- Use async/await (NOT callback hell or `.then()` chains)
- Proper error handling with try-catch blocks

### 6. Code Documentation
- JSDoc comments for ALL functions with params, return types, and descriptions
- Explain WHY, not just WHAT in comments
- Document complex business logic
- Update API docs (Swagger) when changing endpoints

### 7. Backward Compatibility NOT Required
- Feel free to refactor and make breaking changes
- Remove deprecated code aggressively
- Use migrations for schema changes
- Document breaking changes in migration docs

## Code Patterns

### Database Queries
```javascript
// ✅ GOOD - Parameterized query with organization isolation
const result = await pool.query(
  'SELECT * FROM participants WHERE id = $1 AND organization_id = $2',
  [id, organizationId]
);

// ❌ BAD - SQL injection risk
const result = await pool.query(
  `SELECT * FROM participants WHERE id = ${id}`
);
```

### API Endpoint Structure
```javascript
// routes/resource.js
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

module.exports = (pool) => {
  const router = express.Router();
  
  router.get('/', authenticate, asyncHandler(async (req, res) => {
    const organizationId = req.user.organizationId;
    const result = await pool.query(
      'SELECT * FROM table WHERE organization_id = $1',
      [organizationId]
    );
    return success(res, result.rows);
  }));
  
  return router;
};
```

### Frontend Module Pattern
```javascript
// spa/modules/feature.js
import { ajax } from './ajax-functions.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { CONFIG } from './config.js';

export class FeatureModule {
  async init() {
    debugLog('Initializing FeatureModule');
    await this.loadData();
    this.render();
  }
  
  async loadData() {
    try {
      const response = await ajax({
        url: `${CONFIG.API_BASE_URL}/api/v1/resource`,
        method: 'GET'
      });
      if (response.success) {
        this.data = response.data;
      }
    } catch (err) {
      debugError('Failed to load data:', err);
      throw err;
    }
  }
  
  render() {
    const container = document.getElementById('content');
    container.innerHTML = `<h1 data-i18n="feature.title">Title</h1>`;
  }
}
```

### Error Handling
```javascript
async function saveData(data) {
  try {
    const response = await ajax({
      url: `${CONFIG.API_BASE_URL}/api/v1/resource`,
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

## Directory Structure
```
├── api.js                      # Main Express server
├── middleware/                 # auth.js, response.js
├── routes/                     # RESTful API routes (participants.js, etc.)
├── migrations/                 # Database migrations
├── spa/                        # Frontend application
│   ├── app.js                  # Application initialization
│   ├── router.js               # Client-side routing
│   ├── config.js               # Frontend configuration
│   ├── utils/                  # DebugUtils, DateUtils, StorageUtils, ValidationUtils
│   └── modules/                # Feature modules (attendance.js, participants.js)
├── lang/                       # en.json, fr.json translations
└── attached_assets/            # Documentation
```

## Key Database Schema Patterns
- All tables have `organization_id` for multi-tenant isolation
- JSONB columns for flexible data (`organization_settings`, `form_submissions`)
- Timestamps: `created_at`, `updated_at`
- Foreign keys with CASCADE deletes where appropriate

## Authentication & Authorization
**Roles:** `admin` (full access), `animation` (staff), `parent` (view child only)

```javascript
// Require authentication
router.get('/resource', authenticate, handler);

// Require specific role
router.delete('/resource/:id', authenticate, authorize('admin'), handler);

// Multiple roles
router.post('/resource', authenticate, authorize('admin', 'animation'), handler);
```

## Utility Modules
- `DebugUtils.js` - Use `debugLog()`, `debugError()` instead of console
- `DateUtils.js` - `formatDate()`, `getTodayISO()`, `isValidDate()`
- `StorageUtils.js` - LocalStorage helpers
- `ValidationUtils.js` - Form validation
- `SecurityUtils.js` - Input sanitization

## Common Tasks

### Adding a New API Endpoint
1. Create route in `routes/` with authentication middleware
2. Use parameterized queries with `organization_id` filtering
3. Use `success()` or `error()` from response middleware
4. Add Swagger documentation comments
5. Test with proper JWT token

### Adding a New Frontend Module
1. Create module in `spa/modules/`
2. Import utilities (`ajax`, `DebugUtils`, `CONFIG`)
3. Use `ajax()` for API calls with proper error handling
4. Sanitize HTML before rendering
5. Add translations to `lang/*.json`

### Database Migration
```bash
npm run migrate create description-of-change
```
- Always include `organization_id` in new tables
- Use parameterized queries in migrations
- Test up/down cycle before deploying

## Code Review Checklist
When generating code, ensure:
- [ ] JSDoc comments on all functions
- [ ] RESTful API conventions followed
- [ ] Authentication/authorization middleware applied
- [ ] Parameterized database queries (no string concatenation)
- [ ] User input validated (frontend AND backend)
- [ ] Error handling with try-catch
- [ ] Translations for user-facing text
- [ ] No hardcoded values (use CONFIG)
- [ ] Mobile-responsive design
- [ ] Organization isolation in queries

## Environment Variables
Required: `DATABASE_URL`, `JWT_SECRET_KEY`, `VAPID_PUBLIC`, `VAPID_PRIVATE`

## Resources
- Full guidelines: `CLAUDE.MD`
- API docs: `attached_assets/API_Endpoints.md`
- Schema: `attached_assets/Full_Database_schema.txt`
- Migration guide: `attached_assets/README-MIGRATIONS.md`

---

**When in doubt, prioritize security, mobile-first design, and code simplicity. Always sanitize input, use parameterized queries, and maintain organization isolation.**
