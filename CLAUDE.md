# CLAUDE.md - Development Guidelines for Wampums Scout Management System

**Last Updated:** 2025-12-28
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

**Implementation highlights:**
- Frontend: translation helpers and keys from `lang/*.json`.
- Backend: translation keys from the `translations` table (see `routes/formBuilder.js`).
- Forms: use `organization_form_formats` for multilingual form definitions.

### 2) RESTful API Architecture

**All APIs should follow RESTful conventions.**

- ✅ Use resource-based URLs (`/api/v1/participants`).
- ✅ Proper HTTP verbs (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
- ✅ Prefer `/api/v1/*` for new endpoints; legacy `/api/*` still exists in `api.js`.
- ✅ Consistent response format via `middleware/response.js` (`success`, `error`, `paginated`).
- ✅ Use proper HTTP status codes.

**Authentication & Authorization:**
- Use JWT authentication via `middleware/auth.js`.
- Protect routes with `authenticate` and `authorize(roles...)`.
- Token header: `Authorization: Bearer <token>`.

### 3) Mobile-First Design (Web)

- ✅ Build for small screens first; enhance with `min-width` media queries.
- ✅ Touch-friendly targets (≥44px).
- ✅ Consistent UI patterns across pages (loading/error/empty states).
- ✅ PWA features are supported (`service-worker.js`, `vite-plugin-pwa`).

### 4) Security First

- ✅ Sanitize all user input and HTML.
  - Frontend: `spa/utils/SecurityUtils.js` (`sanitizeHTML`, `escapeHTML`, `sanitizeURL`).
  - Backend: `utils/api-helpers.js` exports `escapeHtml` and shared helpers.
- ✅ Use parameterized queries for all SQL.
- ✅ Validate inputs using `express-validator` and shared utilities.
- ✅ Keep JWT handling consistent and never log secrets.

### 5) No Hacks / Shared Utilities

- ✅ No hardcoded values — use configuration in `spa/config.js` or shared constants.
- ✅ Avoid magic numbers; use named constants.
- ✅ Remove commented-out or duplicate code.
- ✅ Use `debugLog` / `debugError` instead of `console.*` in frontend modules.

### 6) Documentation

- ✅ JSDoc for non-trivial functions and complex logic.
- ✅ Update docs when behavior changes.

---

## Project Architecture

### Backend (Node.js + Express)
- Entry point: `api.js`
- Routes: `routes/*.js` (modular; register in `api.js`)
- Middleware: `middleware/auth.js`, `middleware/response.js`
- Utilities: `utils/api-helpers.js`
- Database migrations: `migrations/*.js`

### Web SPA (Vite + ES Modules)
- Entry: `index.html`, `spa/app.js`, `spa/router.js`
- Utilities: `spa/utils/*` (`DebugUtils`, `DateUtils`, `SecurityUtils`, `StorageUtils`, etc.)
- Modules: `spa/modules/*` + feature-specific files in `spa/`
- Assets: `assets/`, `css/`, `spa/assets/`

### Mobile App (Expo / React Native)
- Location: `mobile/`
- Entry: `mobile/index.js`
- Utilities: `mobile/src/utils/*` (includes `SecurityUtils`)

### Directory Structure (Top-Level)

```
/workspace/Wampums/
├── api.js
├── package.json
├── vite.config.js
├── middleware/
├── routes/
├── services/
├── utils/
├── migrations/
├── spa/
├── assets/ css/ landing/ lang/
├── mobile/
├── attached_assets/
└── test/
```

---

## Development Workflow

### Web (Vite + API)

```bash
npm install
npm run dev      # Vite (SPA)
npm start        # API server
```

### Mobile (Expo)

```bash
cd mobile
npm install
npm run start
```

### Migrations

```bash
npm run migrate:up
npm run migrate:down
```

---

## Environment Variables (Server)

**Required**
```bash
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/wampums
JWT_SECRET_KEY=<secure-random-key>
```

**Optional**
```bash
VAPID_PUBLIC=<vapid-public-key>
VAPID_PRIVATE=<vapid-private-key>
SENDGRID_API_KEY=<email>
SENTRY_DSN=<error-tracking>
```

---

## Code Review Checklist

- [ ] API endpoints use REST conventions and `/api/v1` for new routes
- [ ] JWT authentication/authorization applied
- [ ] Parameterized queries only
- [ ] User input validated and sanitized
- [ ] Translations added for new UI text
- [ ] Mobile-first layout verified
- [ ] No hardcoded values or commented-out code
- [ ] JSDoc added for non-trivial logic

---

**This document is the source of truth for development practices.**
