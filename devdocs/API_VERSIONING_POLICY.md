# Wampums API Versioning Policy

## 1. Overview
To ensure a stable and maintainable codebase, all new API endpoints and significant updates to existing functionality must follow the versioning standards defined in this document.

## 2. Canonical Versioning
- **Canonical Prefix**: `/api/v1/`
- **Standard**: All new routes MUST be registered under the `/api/v1/` prefix.
- **Location**: Route definitions should live in `routes/*.js` and be mounted in `api.js`.

## 3. Legacy Routes
- **Prefix**: `/api/` (without version) or root `/` mounts.
- **Status**: Deprecated.
- **Policy**:
    - No new routes should be added to the legacy `/api/` mount.
    - When a legacy endpoint requires a major change or bug fix, it should be migrated to `/api/v1/` if feasible.
    - A temporary compatibility alias may be kept during Wave 1 & 2 of the modernization.

## 4. Modernization Target
By the end of the modernization program:
- All active client traffic (SPA/Mobile) must use `/api/v1/`.
- Legacy `/api/` mounts will be removed or restricted to a strict allow-list for external integrations only.

## 5. Enforcement
- **Linting**: CI/CD will run `npm run lint:api-version` to ensure no new legacy mounts are added.
- **Duplicate Mounts**: `npm run lint:duplicate-mounts` checks for accidental multiple registrations of the same router.
