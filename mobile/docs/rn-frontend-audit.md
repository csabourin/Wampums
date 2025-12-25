# React Native Frontend Audit (SPA + shared utils)

This document catalogs SPA entrypoints under `spa/` and shared utilities under `utils/`, focusing on API endpoints, auth token handling, translation usage, and UI flows to replicate on mobile.

## Scope & source files reviewed

- **SPA entrypoints & routing**: `spa/app.js`, `spa/router.js`, `spa/login.js`, `spa/register.js`, `spa/reset_password.js`, `spa/offline-init.js`, `spa/pwa-update-manager.js`.
- **API clients & helpers**: `spa/api/api-core.js`, `spa/api/api-helpers.js`, `spa/api/api-endpoints.js`, `spa/api/api-activities.js`, `spa/api/api-carpools.js`, `spa/api/api-offline-wrapper.js`, `spa/ajax-functions.js`.
- **Storage & permissions**: `spa/utils/StorageUtils.js`, `spa/utils/ClientCleanupUtils.js`, `spa/utils/PermissionUtils.js`, `spa/jwt-helper.js`.
- **Shared backend utilities**: `utils/*.js` (Node utilities used by server routes).

## 1) API endpoints used (with /api/v1 highlights)

### 1.1 API URL conventions

- `API.*` helpers build URLs as `/api/<endpoint>` (`spa/api/api-core.js`).
- RESTful endpoints are typically versioned as `/api/v1/*` (see `spa/config.js`).
- Some public endpoints use `/public/*` (login and org lookup) and are called via `fetchPublic` in `spa/api/api-helpers.js` / `spa/api/api-endpoints.js`.

### 1.2 Endpoints referenced in SPA (unique list)

> Below are **all endpoint strings referenced in `spa/`**, either as explicit `/api/...` strings or via `API.get/post/put/delete('...')`, which are resolved under `/api/<endpoint>`.

#### `/api/v1/*` (explicit or via `API.*('v1/...')`)
- `/api/v1/activities`
- `/api/v1/activities/:id`
- `/api/v1/activities/:id/participants`
- `/api/v1/announcements`
- `/api/v1/attendance`
- `/api/v1/attendance/dates`
- `/api/v1/carpools/activity/:id`
- `/api/v1/carpools/activity/:id/unassigned`
- `/api/v1/carpools/assignments`
- `/api/v1/carpools/my-children-assignments`
- `/api/v1/carpools/my-offers`
- `/api/v1/carpools/offers`
- `/api/v1/expenses/bulk`
- `/api/v1/expenses/monthly`
- `/api/v1/expenses/summary`
- `/api/v1/finance/fee-definitions`
- `/api/v1/finance/participant-fees`
- `/api/v1/finance/reports/summary`
- `/api/v1/groups`
- `/api/v1/medication/distributions`
- `/api/v1/medication/fiche-medications`
- `/api/v1/medication/participant-medications`
- `/api/v1/medication/requirements`
- `/api/v1/participants`
- `/api/v1/push-subscription` (explicit `fetch` in `spa/app.js`)
- `/api/v1/resources/equipment`
- `/api/v1/resources/equipment/:id/photo`
- `/api/v1/resources/equipment/reservations`
- `/api/v1/resources/equipment/reservations/bulk`
- `/api/v1/resources/permission-slips`
- `/api/v1/resources/permission-slips/:id/view`
- `/api/v1/resources/permission-slips/send-emails`
- `/api/v1/resources/permission-slips/send-reminders`
- `/api/v1/resources/status/dashboard`
- `/api/v1/revenue/by-category`
- `/api/v1/revenue/by-source`
- `/api/v1/revenue/comparison`
- `/api/v1/revenue/dashboard`
- `/api/v1/revenue/external`
- `/api/v1/revenue/external/summary`
- `/api/v1/roles`
- `/api/v1/roles/bundles`
- `/api/v1/stripe/create-payment-intent`
- `/api/v1/users`
- `/api/v1/audit/roles`
- `/api/v1/budget/categories`
- `/api/v1/budget/expenses`
- `/api/v1/budget/items`
- `/api/v1/budget/plans`
- `/api/v1/budget/reports/revenue-breakdown`
- `/api/v1/budget/reports/summary`

#### `/api/*` (non-v1 or legacy)
- `/api/auth/logout`
- `/api/auth/register`
- `/api/auth/reset-password`
- `/api/auth/request-reset`
- `/api/auth/verify-session`
- `/api/organization-settings`
- `/api/organization-jwt`
- `/api/initial-data`
- `/api/news`
- `/api/translations`
- `/api/mailing-list`
- `/api/parent-contact-list`
- `/api/reunion-preparation`
- `/api/attendance-dates`
- `/api/participants` (legacy or wrapper in some modules)
- `/api/participant-details`
- `/api/points-data`
- `/api/update-points`
- `/api/award-honor`
- `/api/honors`
- `/api/badge-summary`
- `/api/badge-system-settings`
- `/api/send-notification`
- `/api/refresh-token`
- `/api/check-auth`
- `/api/check-permission`
- `/api/test-connection`
- `/api/switch-organization`
- `/api/roles`
- `/api/users`
- `/api/organizations`
- `/api/user-organizations`
- `/api/user-children`
- `/api/verify-email`
- `/api/get-organization-id`
- `/api/guardian-info`
- `/api/guardians`
- `/api/guardians-for-participant`
- `/api/parent-users`
- `/api/participant-age`
- `/api/participant-progress`
- `/api/participants-with-users`
- `/api/points-leaderboard`
- `/api/points-report`
- `/api/push-subscribers`
- `/api/leave-alone-report`
- `/api/media-authorization-report`
- `/api/health-report`
- `/api/health-contact-report`
- `/api/attendance-report`
- `/api/missing-documents-report`
- `/api/vaccine-report`
- `/api/allergies-report`
- `/api/medication-report`
- `/api/acceptation-risque`
- `/api/activites-rencontre`
- `/api/animateurs`
- `/api/approve-badge`
- `/api/reject-badge`
- `/api/approve-user`
- `/api/associate-user`
- `/api/available-dates`
- `/api/badge-history`
- `/api/badge-progress`
- `/api/current-stars`
- `/api/fiche-sante`
- `/api/form-types`
- `/api/form-submission`
- `/api/form-submissions`
- `/api/form-formats`
- `/api/form-formats/:id`
- `/api/form-formats/:orgId/:formType/copy`
- `/api/fundraisers`
- `/api/guests-by-date`
- `/api/honors-history`
- `/api/honors-report`
- `/api/import-sisc`
- `/api/link-parent-to-participant`
- `/api/link-user-participants`
- `/api/link-participant-to-organization`
- `/api/remove-participant-from-organization`
- `/api/remove-guardians`
- `/api/next-meeting-info`
- `/api/organization-form-formats`
- `/api/participant-calendar`
- `/api/calendars`
- `/api/update-calendar`
- `/api/update-calendar-paid`
- `/api/update-calendar-amount-paid`
- `/api/recent-honors`
- `/api/register-for-organization`
- `/api/reminder`
- `/api/reunion-dates`
- `/api/save-acceptation-risque`
- `/api/save-badge-progress`
- `/api/save-fiche-sante`
- `/api/save-form-submission`
- `/api/save-guardian`
- `/api/save-guardian-form-submission`
- `/api/save-guest`
- `/api/save-participant`
- `/api/save-reminder`
- `/api/save-reunion-preparation`
- `/api/update-user-role`

#### `/public/*` (public auth/org lookup)
- `/public/get_organization_id`
- `/public/login`
- `/public/verify-2fa`
- `/public/authenticate`

### 1.3 SPA modules that define API usage

- **`spa/api/api-endpoints.js`**: Canonical API wrapper for most endpoints listed above (public auth, users, participants, guardians, finance, groups, reports, etc.).
- **`spa/api/api-activities.js`**: Activities CRUD and activity participants (v1 routes).
- **`spa/api/api-carpools.js`**: Carpool offers and assignments (v1 routes).
- **`spa/app.js`**: Push subscription POST to `/api/v1/push-subscription`.
- **`spa/permission_slip_sign.js`**: Public permission slip view `/api/v1/resources/permission-slips/:id/view`.
- **`spa/formBuilder.js`**: Form format APIs and translations API.
- **`spa/parent_dashboard.js`**: Session validation via `/api/auth/verify-session`.

## 2) Auth token acquisition & storage

### 2.1 Acquisition flow

- **Login**: `Login` class (`spa/login.js`) submits credentials via `login()` from `spa/ajax-functions.js` → `api-endpoints.js` (`POST /public/login`).
  - Headers include `x-organization-id` and optional `x-device-token` from localStorage.
- **2FA verification**: `verify2FA()` uses `POST /public/verify-2fa` and returns a JWT token upon successful OTP verification.
- **Organization context**: `app.init()` ensures a valid organization ID, either from local storage or `fetchOrganizationId()` (`/public/get_organization_id`).

### 2.2 Storage & session keys

- JWT token stored as **`localStorage.jwtToken`** via `StorageUtils.setStorageMultiple()` (`spa/login.js`).
- Additional keys stored during login:
  - `userId`, `userRole`, `userRoles`, `userPermissions`, `userFullName`
  - `organizationId`, `currentOrganizationId`
  - Optional: `guardianParticipants`
- **Device trust token** stored as `localStorage.device_token` for 2FA trust (preserved across logout in `StorageUtils.clearUserData()`).
- **Token helpers**:
  - `spa/jwt-helper.js` provides `setCurrentJWT`, `getCurrentJWT`, `decodeJWT`, `clearJWT`, and helpers to build auth headers.
  - `spa/api/api-helpers.js` attaches `Authorization: Bearer <jwt>` when present.

### 2.3 Logout & invalid session handling

- `api-core.js` clears auth storage on `401` responses and redirects to `/login`.
- `StorageUtils.clearUserData()` preserves device tokens and language preferences while wiping user session data.

## 3) Translation usage (lang files + translation API)

### 3.1 Static translation loading (`lang/*.json`)

- `spa/app.js` loads language JSON via `fetch('/lang/<code>.json')` in `loadTranslation()`.
- `app.init()` sets `document.documentElement.lang` and preloads the current language **before routing** to avoid flicker.
- `translate()` is used extensively throughout SPA screens (`translate('key')` patterns across modules).

### 3.2 Translation API calls

- `CONFIG.ENDPOINTS.TRANSLATIONS` → `/api/translations`.
- `spa/formBuilder.js` creates/updates translation keys through `POST /api/translations`.
- `spa/api/api-offline-wrapper.js` caches `/api/translations` for offline support.

### 3.3 Implication for RN

- RN should mirror:
  - **Local translation bundles** loaded per locale (matching `lang/*.json`).
  - **Runtime translation API** for custom form field labels and user-entered content.
  - **Locale persistence** in storage (`language`, `lang`, `wampums-lang`).

## 4) UI flows & screens to replicate on mobile

### 4.1 Route → module mapping (from `spa/router.js`)

| Route | Module | Notes |
| --- | --- | --- |
| `/` `/dashboard` | `spa/dashboard.js` | Role-based dashboard; parent users redirected to parent dashboard. |
| `/login` | `spa/login.js` | Login + 2FA flow. |
| `/logout` | `spa/login.js` + `api/logout` | Clears session; redirect to login. |
| `/register` | `spa/register.js` | Account creation. |
| `/reset-password` | `spa/reset_password.js` | Request reset link + reset with token. |
| `/parent-dashboard` | `spa/parent_dashboard.js` | Parent-centric dashboard + permission slip checks. |
| `/parent-finance` | `spa/parent_finance.js` | Parent billing + Stripe payment intent. |
| `/admin` | `spa/admin.js` | Admin panel + user approval + notifications. |
| `/attendance` | `spa/attendance.js` | Attendance entry, guest add, status updates. |
| `/manage-participants` | `spa/manage_participants.js` | CRUD participants. |
| `/manage-users-participants` | `spa/manage_users_participants.js` | Link users ↔ participants. |
| `/manage-groups` | `spa/manage_groups.js` | Group management. |
| `/view-participant-documents` | `spa/view_participant_documents.js` | Document management. |
| `/manage-points` | `spa/manage_points.js` | Points dashboard + updates. |
| `/manageHonors` | `spa/manage_honors.js` | Honors tracking. |
| `/badge-dashboard` | `spa/badge_dashboard.js` | Badges overview. |
| `/approve-badges` | `spa/approve_badges.js` | Badge approval queue. |
| `/badge-form/:id` | `spa/badge_form.js` | Badge submission. |
| `/fiche-sante/:id` | `spa/fiche_sante.js` | Health form. |
| `/acceptation-risque/:id` | `spa/acceptation_risque.js` | Risk acceptance form. |
| `/dynamic-form/*` | `spa/dynamicFormHandler.js` | Generic dynamic form handling. |
| `/formulaire-inscription/:id?` | `spa/formulaire_inscription.js` | Registration form. |
| `/form-builder` | `spa/formBuilder.js` | Form builder + translation editor. |
| `/activities` | `spa/activities.js` | Activities admin. |
| `/carpool` `/carpool/:id` | `spa/carpool.js` / `spa/carpool_dashboard.js` | Carpool coordination. |
| `/permission-slips` | `spa/permission_slip_dashboard.js` | Permission slip dashboard. |
| `/permission-slip/:id` | `spa/permission_slip_sign.js` | Public signing flow. |
| `/resources` | `spa/resource_dashboard.js` | Equipment reservations + inventory. |
| `/inventory` | `spa/inventory.js` | Inventory management. |
| `/material-management` | `spa/material_management.js` | Material management. |
| `/medication-planning` `/medication-dispensing` | `spa/medication_management.js` | Medication planning & dispensing workflow. |
| `/finance` | `spa/finance.js` | Fee definitions, payments, plans, reports. |
| `/budgets` | `spa/budgets.js` | Budget categories/items/expenses. |
| `/expenses` | `spa/expenses.js` | Expense tracking & bulk add. |
| `/external-revenue` | `spa/external-revenue.js` | External revenue inputs. |
| `/revenue-dashboard` | `spa/revenue-dashboard.js` | Revenue analytics. |
| `/fundraisers` | `spa/fundraisers.js` | Fundraiser management. |
| `/calendars/:id` | `spa/calendars.js` | Fundraiser sales calendar. |
| `/reports` | `spa/reports.js` | Reporting hub (health, attendance, media, etc.). |
| `/parent-contact-list` | `spa/parent_contact_list.js` | Parent contact directory. |
| `/mailing-list` | `spa/mailing_list.js` | Mailing list & announcements. |
| `/upcoming-meeting` | `spa/upcoming_meeting.js` | Meeting prep view. |
| `/preparation-reunions` | `spa/preparation_reunions.js` | Meeting preparation. |
| `/role-management` | `spa/role_management.js` | Role/permission management. |
| `/district-management` | `spa/district_management.js` | District admin. |
| `/group-participant-report` | `spa/group-participant-report.js` | Printable group report. |
| `/account-info` | `spa/modules/account-info.js` | Profile & account info. |

### 4.2 Key flows to replicate in RN (mobile-first)

- **Authentication + 2FA**: login → 2FA verification → store JWT + roles → redirect by role.
- **Organization resolution**: fetch org ID by hostname (RN likely needs a user-provided org selector or domain mapping).
- **Role-based routing**: guard access based on roles/permissions; parent users go to parent dashboard.
- **Offline support**: `spa/offline-init.js` and IndexedDB caching; offline queueing in `api-offline-wrapper`.
- **Push notifications**: subscription registration in `spa/app.js` (RN will need platform-native push token registration and `/api/v1/push-subscription` payload compatibility).
- **Dynamic forms + translations**: dynamic form workflows (health/permission slips/registration forms) + translation editor in form builder.
- **Finance**: definitions → participant fees → payments + plans → reports.
- **Activities + carpool**: activities CRUD + carpool offers/assignments.
- **Resources + permission slips**: equipment inventory + reservation flows and permission slip sign/verification (including public access for signing).
- **Medication management**: planning + dispensing views with schedule-driven alerts.
- **Reports**: multiple report types (attendance, health, media authorization, missing docs, etc.).

## 5) Shared utilities in `utils/` (server-side dependencies to mirror)

While not used directly in the SPA, these utilities influence API behavior and data contracts the mobile app depends on:

- **`utils/api-helpers.js`**: JWT verification, org resolution, and standardized JSON responses for API routes.
- **`utils/validation-helpers.js`**: Input validation patterns expected by API endpoints.
- **`utils/twoFactor.js`**: 2FA device token logic; aligns with `device_token` storage in SPA.
- **`utils/supabase-storage.js`**: Storage integration (file uploads) affecting resource/document workflows.
- **`utils/carpool-notifications.js`**: Carpool-related notifications.
- **`utils/programSections.js`** / **`utils/meeting-sections.js`**: Shared configuration used by server and UI.

## 6) Dependencies to mirror in RN

- **API client**: Equivalent to `spa/api/api-core.js` + `api-endpoints.js` for consistent auth headers, retries, and caching.
- **Storage keys**: Match `CONFIG.STORAGE_KEYS` and localStorage usage to maintain session + org context.
- **Translation pipeline**: Load `lang/*.json`, support translate keys, and call `/api/translations` for dynamic content.
- **Role/permission guards**: Mirror `PermissionUtils` logic for route access.
- **Offline caching & queue**: Replace IndexedDB with RN storage + offline queueing strategies.

---

If you want this expanded into a migration checklist or a per-screen API matrix, I can add that as a follow-up.
