# CLAUDE.md - Development Guidelines for Wampums Scout Management System

**Last Updated:** 2026-10-23
**Project:** Wampums Scout Management System
**Tech Stack:** Node.js + Express, PostgreSQL, Vite (SPA), Vanilla JavaScript (ES modules), Expo/React Native (mobile)

**Scope.** Work is on the API and the web SPA (`spa/`). **`mobile/` is frozen**: it will be ported
from the SPA in one piece once the SPA is stable, so do not change it unless a task explicitly asks. **The tests are the most current specification** (§12): read
those of the area you touch before you change it. §7 says how to build an SPA screen, and the templates
at the end show one.

---

## Core Principles

### 1) Language & Internationalization

**The app is bilingual (English/French) with support for additional languages.**

- ✅ **No mixed languages on a single page** — each view renders in one language only. The one
  exception: an optional language (below) falls back key by key to the unit's fallback language.
- ✅ **French and English are always offered** and kept at parity. A unit may add the optional
  languages listed in `config/interface_languages.json` (mirrored in `spa/config/languages.js`; a test
  keeps them equal) — today Ukrainian, Italian and Indonesian — under Unit settings › Unit languages
  (`interface_languages` setting: `{ enabled, fallback }`, fallback `en` or `fr`). Their bundles may be
  partial; `translate()` and form texts fall back to the unit's fallback language for a missing key.
- ✅ All user-facing text must be translatable via `lang/en.json`, `lang/fr.json`, or translation APIs.
- ✅ Use language codes consistently (`en`, `fr`).
- ✅ Date/time formatting must respect locale (`formatDate(date, lang)` in `spa/utils/DateUtils.js`).
- ✅ Number and money formatting must respect locale (`formatCurrency` in `spa/utils/NumberUtils.js`,
  or `Intl` with `localeForLanguage(lang)` from `spa/utils/InterfaceLanguageUtils.js`).
- ✅ **The server's `message` is never shown.** It is English, written for developers. Explain a failed
  call with `apiErrorMessage(error, fallbackKey)` from `spa/utils/ApiErrorUtils.js`, which picks a
  translated key from the status, the error code, or a server message that is itself a known key.
- ✅ **Never show a raw key or internal name.** Use the label helpers: `roleLabel()` (role
  `display_name`, never `role_name`), `badgeLabel()`, `formTypeLabel()`.
- ✅ **Unit vocabulary.** A unit names its subgroups and sections (dens, lodges, patrols…) through
  `unit_vocabulary` (`spa/utils/UnitVocabularyUtils.js`, `devdocs/UNIT_CUSTOMIZATION.md`).
  `translate()` substitutes the unit's terms, so write the keys and do not hard-code "group"/"tanière"
  in strings. French strings around a vocabulary term avoid gendered articles (the term may be
  masculine or feminine).

**Implementation:**
- Frontend: `translate(key)` (import from `spa/app.js`) with keys from `lang/*.json`. `translate()`
  answers an unknown key with the key itself, so a missing key shows up on screen as `some_key`.
- Backend: translation keys from the `translations` table (see `routes/formBuilder.js`).
- Forms: use `organization_form_formats` for multilingual form definitions.
- ✅ **`lang/en.json` and `lang/fr.json` must have exactly the same set of keys** — enforced by `npm run lint:i18n-parity`. Any key added to one file must be added to both.
- ✅ **Every key the SPA uses must exist in both.** `test/spa/TranslationCoverage.test.js` reads every
  literal `translate('…')` call in `spa/`. A key built at runtime (`` `state_${state}` ``) or held in a
  lookup table is not seen there. Add such keys for every value, and extend that test when you add a
  new family of them.
- ✅ Optional-language bundles (`lang/uk.json`, …) keep every `{placeholder}` of the English text and
  have no byte-order mark (`test/optional-language-bundles.test.js`).

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
- `403` - Forbidden (authenticated but insufficient permissions); response MUST include `required: string[]` and `missing: string[]` — use `forbidden(res, message, required, missing)` from `middleware/response.js`; `blockDemoRoles` 403 MUST include `isDemo: true`
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

**Never check a role's name** (`roleNames.includes('unitadmin')`, `hasRole('district')`). A custom
or renamed role holding the right permissions would be refused. The role-based `authorize()` and
`hasAnyRole()` helpers have been removed.
- ✅ What someone may **do**: a permission (`requirePermission`, `req.user.permissions`, `hasPermission()` in the SPA).
- ✅ Whether someone sees the **whole unit or only their own children**: the role's `data_scope`
  (`getUserDataScope(req, pool)` → `'organization'` or `'linked'`).
- ✅ Whether an account is **a parent and nothing more** (scout-year cleanup, alumni, erasure,
  transfers): every role it holds has `data_scope = 'linked'`; any other scope, or none, is staff
  (`r.data_scope IS DISTINCT FROM 'linked'`, as in migration 011). Never a list of role names.
- ⚠️ Role names are only for describing the kind of account (demo, parent dashboard) and display.

Passwordless demo sign-in requires the unit's `demo_sign_in` setting and a verified, active
account holding only demo roles. The account must belong exclusively to that unit: any membership
elsewhere, including an inactive one, makes it unavailable for passwordless sign-in.

**Every protected route uses the shared authorization engine.** `authenticate`
checks active membership, and `requirePermission` reads current permissions and
role metadata from the database, once per request and organization. Membership,
keys, role scope, demo status and per-form rights share one SQL snapshot, so
concurrent role edits cannot combine privileges from different states. JWT claims
are snapshots and never authorize a request. `req.userPermissions`,
`req.userRoles`, and the refreshed `req.user.permissions` come from that context;
`requireAnyPermission` and `userHasPermission` use the same engine.

- `requirePermission('a', 'b')` requires both keys; `requireAnyPermission('a', 'b')`
  requires either. A trusted request selector may choose additional required
  keys for conditional operations, such as an alumni mailing or linking another
  account. Request fields never select the authenticated organization.
- `requirePermission()` checks active membership and loads metadata for
  member-only operations, such as subscribing one's own device or listing
  public form types. It is not a substitute for a protected resource's keys.
- Ownership alternatives live in middleware policies, delegated through
  `requirePermission`. `resourceScope` must check the resource belongs to the
  authenticated unit even for staff; `resourceAccess` may then allow an explicit
  ownership alternative. Medication signatures require live child access and
  the named guardian relationship. A retained contact cannot bypass revoked
  access. Scheduling medication requires `medication.manage`.
- Per-form rights remain in `middleware/formAuthorization.js`; they use current
  role metadata and the same permission engine. Form view, submit/edit, approval
  and review confirmation retain their distinct rules. Collection filtering
  and child ownership checks still restrict which records a user may reach.
- All authorization 403 responses use `forbidden()` and include `required` and
  `missing`, including membership, demo and resource-scope denials. Database
  failures return 500, not a misleading permission denial or invalid-token 401.

`verifyOrganizationMembership` and the role-based `requireOrganizationRole` have
been removed. The `manual-auth` policy baseline is zero: do not add a route-local
JWT verifier or membership/permission lookup. `getCurrentOrganizationId` is a
public-only domain/header resolver and never reads bearer credentials; protected
routes use `getOrganizationId`. Public bootstrap uses `optionalAuth` for session
description, sharing the active-membership check with `authenticate`.

**Permission Naming Convention:**
- Format: `{resource}.{action}`
- Examples: `users.view`, `users.manage`, `finance.manage`, `reports.view`, `carpools.view`
- Common actions: `view`, `manage`, `create`, `edit`, `delete`, `assign_roles`
- ✅ A new key is created by a migration in the same change that first checks it. A key no migration
  creates refuses everyone, admins included (`test/permission-catalog.integration.test.js`).

#### Roles Belong to Units
- ✅ **Built-in roles** (`organization_id IS NULL`, `is_system_role`) are shared by every unit and read-only
  to them; change them only through migrations, since an edit would apply to every unit.
- ✅ **Custom roles** belong to one unit (`roles.organization_id`, migration 014). Another unit cannot see,
  assign, edit, or delete them, and they are deleted with their unit.
- ✅ Any query that lists or accepts roles from the catalog — rather than through a member's own
  `role_ids` — must keep to the roles the unit may use: `findRolesInUnit()` in
  `services/roleAssignment.js`, or inline
  `r.organization_id = $unit OR (r.organization_id IS NULL AND r.is_system_role)`.
- ✅ A custom role's `role_name` is an internal key the server generates (`u<unit>_<slug>`); show
  `display_name` to people. Built-in roles may be looked up by name; custom roles never collide with them.
- ✅ **A unit may hide a built-in role it replaced** (migration 038, `services/roleVisibility.js`).
  `roles.customized_from_role_id` records the built-in role a unit role was customized from; while one
  exists, the unit may hide the original (`organization_hidden_roles`; never the role holding every
  permission). Hiding changes no one's rights. A list that **offers** roles leaves hidden ones out
  (`AND NOT EXISTS (SELECT 1 FROM organization_hidden_roles h WHERE h.organization_id = $unit AND
  h.role_id = r.id)`, or `rolesToOffer()` from `spa/utils/RoleVisibilityUtils.js`, which keeps one the
  member already holds), and a **new** grant of one answers 409 `role_hidden_in_unit`
  (`findHiddenAmong`). Removing the last unit role replacing it shows it again.
- ✅ **Automatic grants follow the replacement.** Code that grants a built-in role by itself
  (registration, family invitations and links, walk-ins, reactivation, transfers, imports) takes its id
  from `resolveUnitRoleId(db, 'parent', unit)`: the built-in role, or the unit role replacing it once
  hidden. An invitation naming a role hidden since is granted the replacement (`replaceHiddenRoleIds`).
- ✅ **One invitation screen** (`/invitations`, `GET /api/v1/parent-invitations/roles`). The invitation
  names the role: a team role (scope `organization`) makes a leader invitation; a family role, or none
  (the unit's parent role, `default_family`), a family one. Naming a role takes `users.assign_roles`
  and its permissions; the parent role needs only `users.invite`.

#### Granting Roles and Permissions
- ✅ **Someone may grant only what they hold.** Adding or removing a member's role, adding or removing a
  permission on a role, deleting a role, and roles handed out by imports all go through
  `services/roleAssignment.js` (`checkRoleChange`, `checkRolesGrantable`). Removal is covered too, so nobody
  can demote someone holding permissions they lack. A refusal answers 403 through `forbidden()` with
  `required` and `missing`.
- ✅ One exception: a permission marked `permissions.self_scoped` does not count in a role whose
  `data_scope` is `'linked'`, because there it only acts on the holder's own children
  (`participants.create_own`, `permission_slips.sign`). In an organization-wide role it counts like any
  other. Mark a new permission `self_scoped` only if, in a linked role, it acts solely on the holder's own
  children.
- ✅ **The district role holds every permission.** It is marked `roles.grants_all_permissions` (migration 016):
  it was given every existing permission, and a trigger gives it each permission created later, however
  it is created. Never remove a permission from it; to restrict an admin, give them another role.
- ✅ `GET /api/v1/roles` lists every role with `assignable`. Forms show the others disabled, keeping their
  state, so saving sends them back unchanged.

#### Role Permission Matrices

Roles have one destination, `/roles` ("Rôles et permissions", `TABBED_PAGES.roles`): assigning roles
(`users.view` + `users.assign_roles`), role permissions (the matrix with `roles.manage`, the read-only
catalog with only `roles.view`) and form access (`forms.manage`). `/role-management`,
`/roles/permissions` and `/form-permissions` redirect to their tab. The matrix is also where a unit
hides a built-in role it customized (`PUT /api/v1/roles/:roleId/visibility`, `roles.manage`), and
where a custom role created before migration 038 is marked as replacing one. The Roles tab of `/district` requires
`roles.manage_district` as well as unit management rights. It switches the active authenticated
unit using `/api/v1/organizations/switch`; matrix requests never accept a target unit ID.
Built-in roles remain read-only. Customization copies their permissions, data scope and this
unit's per-form rights into an ordinary unit role, without the automatic-all-permissions flags.
An explicit `reassign_members` option transfers this unit's members, retaining their other
roles and recording each assignment in the same transaction.

`services/roleAssignment.js` shares the permission-change policy between single-cell and bulk
writes: Manage requires its catalogued View; linked roles cannot receive unit financial rights;
added and removed permissions must be held by the caller, with the existing self-scoped exception.
Scope changes check the authority exposed by both scopes. District-only permissions also require
`roles.manage_district`. Complete replacements can include `expected_permission_ids`; a stale
editor receives 409 instead of overwriting a concurrent change. Each role mutation locks its row.
Create, metadata, permission and deletion snapshots are stored in `role_permission_audit` in the
mutation's transaction. Deletion also removes and audits member references to the deleted role.

Edits remain local until Save, and roles save sequentially; an earlier successful save stays saved
when a later role fails. Role writes require an online connection and are never queued for replay.
Navigation, tab changes and active-unit changes confirm abandoning unsaved permission changes;
a live refresh cannot replace an editor's pending work. Phone controls and the desktop table share
one state. Built-in roles can be inspected from either layout.

#### Protecting Write Operations
- ✅ Use `blockDemoRoles` middleware for write operations to prevent demo accounts from making changes
```javascript
const { blockDemoRoles } = require('../middleware/auth');
router.post('/users', authenticate, blockDemoRoles, requirePermission('users.manage'), handler);
router.delete('/data', authenticate, blockDemoRoles, requirePermission('data.delete'), handler);
```
- ✅ Its 403 carries `isDemo: true` and `code: 'demo_read_only'`; the SPA explains the demo from that code.
- ✅ **The demo unit is a sandbox** (`demo_sign_in`, migrations 039 and 041). A route whose request carries no
  free text may use `allowDemoSandbox(DEMO_SANDBOX.<policy>)` from `middleware/demoSandbox.js` instead: in that
  unit only, a demo account may send exactly the fields the policy names (ids, near dates, small numbers, short
  codes). Today: points, attendance, and honors without a reason. Whatever it opens, the night reset
  (`scripts/demo/reset-demo-sandbox.js`, `services/demoSandbox.js`) must restore; add its table there too.

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

#### Access to Children (`user_participants`)
- ✅ **Never write `user_participants` directly.** Grant and revoke through `services/participantAccess.js`
  (`grantParticipantAccess`, `revokeAllAccessForPair`, `revokeAllAccessInUnit`, `revokeGrantsFromSource`).
  Every grant records *why* it exists in `participant_access_grants` (`direct`, `guardian`, `admin`,
  `family_link`); `user_participants` is only the cache the rest of the app reads. A direct write creates
  access nothing can explain or selectively revoke — ending a family link removes exactly the grants that
  link made, and relies on every other grant being recorded.
- ✅ Linking an account to a child must check that **both** belong to the caller's unit
  (`isAssociationInUnit`). A child can be enrolled in several units, and `user_participants` has no
  organization column of its own.
- ✅ Parents register children through `participants.create_own` (`/api/v1/parent-onboarding`), which links
  the child to the family in the same transaction. `participants.create` is unscoped; do not grant it more
  widely to make a parent feature work.

#### Emailed Links
- ✅ Links that act for whoever holds them (invitations, family-link requests) use opaque tokens from
  `utils/invitation-tokens.js`. Store only the SHA-256 digest; never log, persist, or return the raw token.
- ✅ A `GET` on such a link only **describes** it. Acting on it takes a `POST` the person submitted — mail
  scanners open links before people do.
- ✅ Build link URLs from `resolveOrganizationBaseUrl` (`utils/public-url.js`), never from request headers.
- ✅ **Calendar subscription links** (`services/calendarFeeds.js`, `GET /api/v1/calendar-feeds/:token.ics`)
  follow the same rules: digest only, shown once, one active link per person and unit. A link only
  names its holder (`authenticateCalendarFeed`); every fetch then goes through `requirePermission`,
  so leaving the unit or losing `activities.view` closes the feed with nothing to revoke.

### 4) Database Conventions

The current schema is dumped in `attached_assets/Full_Database_schema.sql`, and the permission
inventory in `attached_assets/permissions_list.sql`. Migration SQL in `migrations/` remains
authoritative for repository-managed changes.
Schema refreshes must preserve `COMMENT ON` documentation. Export schema only, omit ownership
and grants, and review comments and DDL literals for PII or secrets before committing the dump.

#### ID Column Types
- ✅ **Users:** `id UUID` (generated via `gen_random_uuid()`)
- ✅ **Most other tables:** `id INTEGER` (using sequences)
- ✅ **Never use `parseInt()` on user IDs** - they are UUIDs (strings)
- ✅ Use appropriate type: `req.params.userId` (UUID string); integer ids validated with `validateIdParam()`
  then read with `Number(req.params.participantId)`

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

### 5) Mobile-First Design and Accessibility (Web)

- ✅ Build for small screens first; enhance with `min-width` media queries. Nothing may scroll the page
  sideways at 390px: put wide tables in a scroll container, and let fieldsets and option lists wrap.
- ✅ Buttons and links are touch targets of at least 44px (`--touch-target-min` in `css/styles.css`).
  Checkboxes and radio buttons are at least 24px, and a lone checkbox sits before its label, on one row
  (`test/spa/FormControlTargets.test.js`, `ContactLinkTargets.test.js`).
- ✅ **WCAG 2.2 AA.** Use native controls (`<button>`, `<a href>`, `<input>`, `<select>`) with labels,
  never a `div` with a click handler. Tie errors to their field (`aria-describedby`) and announce them
  (`role="alert"`). Loading text uses `role="status"`. Never convey state by colour alone.
- ✅ Focus stays visible: outlines use the `--color-focus-ring` token (at least 3:1 against the
  surface), and no rule removes the outline from form inputs.
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
- ✅ PWA features supported (`src-sw.js`, `vite-plugin-pwa`; caching rules are pinned by
  `test/service-worker-*.test.js`).

### 6) Security First

- ✅ **Sanitize all user input and HTML.**
  - Frontend: `spa/utils/SecurityUtils.js` (`escapeHTML`, `escapeAttribute`, `sanitizeURL`, `sanitizeHTML`; which to use when is in §7)
  - Backend: `utils/api-helpers.js` exports `escapeHtml` and shared helpers
  - Formatted text (announcement messages, activity descriptions, form information texts) is written in
    `spa/modules/rich-text/RichTextEditor.js` and limited to paragraphs, bold, italic, lists and links. The
    server never trusts it: `utils/richText.js` rebuilds it before storing or emailing it and derives the plain
    text (`message`, `description`) that push, WhatsApp, Google Chat, calendars and the mobile app read. The
    formatted copy lives beside it (`message_html`, `description_html`); a write sending only plain text clears it.
- ✅ **Use parameterized queries for ALL SQL** - never string concatenation; enforced by `npm run lint:sql-params`
- ✅ **Validate inputs** using `express-validator` and shared utilities
- ✅ **Rate limiting** on sensitive endpoints (login, password reset); all API responses must include rate-limit headers (`ratelimit-limit` / `x-ratelimit-limit`)
- ✅ **Never log secrets** (JWT tokens, passwords, API keys)
- ✅ **Real people's information never reaches an AI tool.** The site promises families that youth and
  family information never goes through the AI used to build Wampums, and that every test runs on
  fictional data. Develop, test, debug and take screenshots only on fictional data: the seeded unit
  (`.claude/skills/run-wampums/seed.mjs`) and the showcase pack (`site-screenshots/showcase.cjs`). Never
  connect a session to a production database (`.env` points at one; `start.sh` overrides it), and never
  paste production rows, exports, logs, error reports or screenshots that name a youth, a parent or a
  leader into a prompt. To reproduce a production bug, rebuild it with invented names. Fixtures and
  examples in tests and docs use invented people (`Ada Lovelace`, `Léa Tremblay`), never real ones.
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

### Points hors ligne en camp

Les ajouts et retraits de points sont conservés dans la file IndexedDB de la SPA,
associés au compte et à l’unité. Chaque lot porte un `Idempotency-Key` dès le premier
envoi : `point_mutation_receipts` et les points sont validés dans la même transaction.
Une réponse perdue peut donc être retransmise sans doubler les points. Déployer la
migration `044_point_mutation_receipts.sql` avant le nouveau client.
Les totaux mis en cache par la préparation sont ceux de l'année scoute active, comme
`GET /api/v1/points` ; en ligne, l'écran des points recharge toujours les totaux du serveur.
Une présence verrouille l'inscription du jeune avant de comparer son statut : deux appareils
qui marquent le même jeune au même moment ne donnent les points de présence qu'une fois.
Les onglets ouverts partagent une seule file : un seul à la fois la rejoue (Web Lock
`wampums-offline-outbox-replay`), les autres n'envoient rien et réessaient plus tard.
L'onglet qui rejoue relaie `offlineMutationReplayed` / `offlineMutationRejected` aux autres
(BroadcastChannel `wampums-offline-outbox`) : l'écran qui a mis un changement en file
l'apprend même si un autre onglet l'a envoyé.
`attendance.points_awarded` (migration 047) retient les points qu'une présence a donnés :
un changement de statut ou une journée supprimée reprend exactement ceux-là (une journée
reprise de la veille n'en donne aucun). Un niveau de badge donne ses points une seule fois
(`badge_progress.points_awarded`, migration 048), même approuvé de nouveau.

Les camps des sept prochains jours se préparent automatiquement lorsque la SPA
est ouverte avec du réseau, pour les comptes ayant `activities.view` et une portée
unité. `CampPreparation` vérifie les données IndexedDB, les écrans, les traductions
et le document HTML en cache avant d'annoncer « Prêt hors ligne sur cet appareil ».
Les préparations et le mode camp sont isolés par compte, unité et année scoute ;
un ancien indicateur sans preuve ne suffit pas. Les données sont actualisées chaque
heure et après synchronisation, avec une nouvelle tentative chaque minute en cas
d'échec. Une file locale non vide reporte le téléchargement pour préserver les
modifications. Les camps futurs n'activent le mode camp qu'à leur début.
« Vérifier la disponibilité hors ligne » permet une actualisation manuelle depuis
les activités ou la préparation hors ligne ; vérifier chaque appareil avant de partir.
Les totaux locaux restent
consultables après expiration du cache tant que l’appareil est hors ligne ou qu’un
lot attend son envoi. La SPA ouverte synchronise au retour du réseau, à son retour
au premier plan et réessaie toutes les 30 secondes. Garder les présences avant les
points dans la file ; une erreur temporaire suspend les opérations suivantes.
Les refus définitifs sont annoncés et les totaux sont rechargés après synchronisation.

### Action rosters during activities

Attendance, points and honors share `ActionRoster` and `/api/v1/action-roster`.
An activity with issued permission requests defaults to its signed participants;
an activity without permission requests offers the whole unit. Once attendance
exists for the day, points and honors show only present/late participants still
on site. Attendance keeps the eligible roster visible so late arrivals can be
marked. A planned meeting defaults to the whole unit in attendance. The explicit
meeting/activity selector resolves overlapping dates; its choice follows navigation.
“Show all participants” is an explicit exception for that screen, reset on a context
change. Group and individual awards send that scope and the server enforces it.
Unit enrollment checks always apply, including with an exception.

Attendance remains daily, shared by the unit: an activity selector filters the
roster; it does not create a second attendance register for the same day.
`POST /api/v1/attendance/departure` sets `is_on_site = false` while retaining the
recorded status and earned points. Marking present/late again clears the departure.
Departures do not carry forward to the next camp day. Attendance writes keep their
outbox order across reconnections. Camp preparation caches the authorization and
roster snapshots as well as attendance; local unsent arrivals/departures overlay
them when another action screen opens offline. Apply migration 045 before the client.

### 7) Frontend Best Practices

#### Where code goes
- ✅ ES modules only. **New screens go in `spa/modules/<feature>/`**; no new files in the `spa/` root
  (`npm run lint:spa-files`).
- ✅ **Every screen lives in `spa/modules/<feature>/`.** Only shared infrastructure stays in the root
  (`app.js`, `router.js`, `config.js`, `ajax-functions.js`, `indexedDB.js`, `JSONFormRenderer.js`,
  `dynamicFormHandler.js`, `functions.js`, `jwt-helper.js`, `offline-init.js`, `pwa-update-manager.js`):
  many files import it. `SPA_ALLOW_LIST` in `scripts/modernization/check-spa-files.js` lists exactly these.
- ✅ **Touching an older screen means bringing it into line.** The screens moved out of the root in
  October 2026 (`spa/modules/badges/BadgeTracker.js`, `spa/modules/finance/Budgets.js`, …) were moved,
  not rewritten. The app is to read as one codebase, however long it has been built:
  - bring the parts you change up to this section (back link, states, escaping, `apiErrorMessage`,
    `showMessage`, `openModal`, `button` classes), and at least what a test of your change exercises;
  - moving or renaming a file: `git mv`, so history follows; update its imports, the router's loader,
    every test's import and `jest.mock` path; and, since the lint ratchets count by path, rename its key
    in `scripts/modernization/policy-baseline.json` and in `eslint-suppressions.json`, counts unchanged.
    This rename is the only hand edit those files accept;
  - do a move in its own commit, before the behaviour change, so the review can tell them apart.
- ✅ Shared helpers go in `spa/utils/`, configuration in `spa/config.js` and `spa/config/*.js`, and a
  feature's API calls in `spa/api/api-<feature>.js`. Check `spa/utils/` before writing a helper; most
  needs (dates, money, labels, dialogs, scroll lock, back link, errors) already have one there.
- ✅ Reference screens to imitate: `spa/modules/walk-in/WalkInChildren.js`,
  `spa/modules/messages/Messages.js`, `spa/modules/family-access/`.

#### Adding a screen
1. Module class in `spa/modules/<feature>/<Screen>.js` with `constructor(app)`, `async init()`, and
   `destroy()` when it holds listeners, timers or subscriptions (extend `BaseModule` from
   `spa/utils/BaseModule.js`, or abort an `AbortController`). The router calls `destroy()` on the
   previous screen, and re-rendering must not stack listeners.
2. In `spa/router.js`: a lazy loader in the module map, the path in `routes`, and a `case` that guards
   with **the permission its endpoints require**: `guard(hasPermission('x.view'))`. Only public pages
   (sign-in, registration, password reset, pages opened from an emailed link) join the logged-out
   allow-list.
3. A dashboard tile, if any, is declared once in `spa/config/dashboard-tiles.js`, with a `tile_*` label
   naming the task and a `gate` on the same permission as the page.
4. API functions in `spa/api/api-<feature>.js`; strings in `lang/en.json` **and** `lang/fr.json`.
5. A jsdom test in `test/spa/` (see §12).

#### Rendering a page
- ✅ Render into `#app` with `setContent()` from `spa/utils/DOMUtils.js`. ❌ **Never assign
  `innerHTML =`** outside `DOMUtils.js` and `SecurityUtils.js` (`npm run lint:spa-innerhtml`).
- ✅ Every screen opens with `renderBackLink(href)` (`spa/utils/BackLinkUtils.js`), first in the page,
  above the `<h1>`, in **every** state it renders.
- ✅ Every screen has a loading state (`role="status"`, or `spa/utils/SkeletonUtils.js`), an error
  state (`role="alert"`, with a retry button when a reload could help), and an empty state that says
  what would fill it. A failed load is never shown as "nothing here".
- ✅ Buttons use the `button` classes: `button button--primary`, `--secondary`, `--ghost`, `--danger`,
  `--small`. Do not use the older `btn btn-*` classes in new code.
- ✅ Stacked mobile tables retain a translated label for every data value. Use
  `mobile-labeled-table` with `data-label` on each data cell, or keep the columns in a labelled
  scroll region. Never hide quantities, monetary values or row actions just to fit a phone.
- ✅ Fixed page controls leave room for the page heading. Connection status belongs above the
  content, clear of fixed action bars; an informational notice must not look like a saved change.

#### Escaping what you inject
`setContent()` sanitizes markup with DOMPurify, but that does not stop a name from becoming markup.
- ✅ Text from the server or a person: `escapeHTML()`. Inside an attribute value: `escapeAttribute()`.
- ✅ Formatted text (`message_html`, `description_html`): `richTextOrPlain(html, text)` from
  `spa/utils/RichTextUtils.js`; edit it with `spa/modules/rich-text/RichTextEditor.js`.
- ✅ URLs: `sanitizeURL()`. `sanitizeHTML()` is only for markup you mean to keep.
- ✅ Toasts (`showMessage`) and `DialogUtils` messages are set as text: pass them unescaped, or a name
  shows as `&amp;`. `openModal()` `title`/`body`/`footer` are HTML: escape what goes into them.
- ❌ Never give an element an `id` or `name` that collides with a property of `document` or of a
  form (`name`, `action`, `submit`, `location`…). DOMPurify silently strips it
  (`test/spa/DomPurifyClobbering.test.js`). Prefix ids with the feature: `walk-in-retry`.

#### Feedback and errors
- ✅ Toasts: `this.app.showMessage(translate('thing_saved'), 'success')`. The type is `'success'`,
  `'error'` or `'info'`; a bare key (`'thing_saved'`) is translated for you.
- ✅ A failed call: `apiErrorMessage(error, 'screen_fallback_key')` (§1), never `error.message`. A
  refused action reads as a refusal, not as a generic error. A failed request is never reported as
  success, and a write that committed but whose reload failed says it was saved and offers a retry.
- ✅ The API client preserves structured field errors on `error.errors`, alongside `status`, `code`
  and `data`, so forms can associate failures with their fields.
- ✅ Form errors: check what you can before sending, show server field errors next to their field
  (`aria-describedby`), and clear a message as soon as its field changes.
- ✅ A form disables its submit while saving (`withFormBusy`), so a double click sends one request.

#### Modals
- ✅ Every modal uses `openModal()` from `spa/utils/ModalUtils.js`: one markup (`.modal-overlay > .modal-dialog`
  with header, body, footer), focus moved in and returned to the opener, Tab kept inside, Escape and the
  backdrop close the topmost dialog, page scroll locked, and the router closes it on navigation.
- ✅ Action buttons go in `footer`; a submit button outside its form names it with `form="<form-id>"`
  (`withFormBusy` disables those too). Cancel buttons carry `data-modal-close`. Use `canClose` to keep a
  dialog open while it saves, and `closeOnBackdrop: false` for a form that would lose work.
- ✅ Confirmations, alerts and prompts use `confirm` / `confirmDestructive` / `alert` / `prompt` from
  `spa/utils/DialogUtils.js`, never the browser's. Declining a confirmation changes nothing.
  While one is open, underlying modals defer keyboard handling to it.
- ✅ Any other overlay locks scrolling with `lockBodyScroll(owner)` / `unlockBodyScroll(owner)` from
  `spa/utils/ScrollLockUtils.js`, never by setting `overflow` itself.
- ❌ No hand-built overlays, native `<dialog>`, or page styles for `.modal-*` classes.

#### Permissions in the SPA
- ✅ `hasPermission()`, `hasAnyPermission()`, `hasAllPermissions()` and the `can*()` helpers from
  `spa/utils/PermissionUtils.js` decide what is shown. Each action button follows the permission its
  endpoint requires (create, edit and delete separately). The server decides; the SPA only stops offering
  what would be refused.
- ✅ Parent or staff: `isParent()` and `canAccessParentTools()`, which read the role's data scope.
  ❌ Never `hasRole('…')` (`npm run lint:role-names`). A person can be both a parent and a leader.
- ✅ A demo account is read-only: `isDemoUser()`.

#### API calls and the cache
- ✅ Go through `API` from `spa/api/api-core.js`, wrapped in `spa/api/api-<feature>.js`. Older screens
  import from `spa/api/api-endpoints.js` or `spa/ajax-functions.js`; do not add new functions to those
  two files. Never `fetch()` an authenticated endpoint directly.
- ✅ Endpoints are written without the prefix: `API.get('v1/messages')`. `API.get(endpoint, params,
  { cacheDuration, forceRefresh })` caches in IndexedDB (`CONFIG.CACHE_DURATION.*`); use
  `API.getNoCache()` for data that must be fresh (anything just written by someone else, links).
- ✅ **A confirmed write invalidates the cache itself.** When the server accepts it,
  `API.post/put/patch/delete` clear the cached responses built from that resource, and every screen
  derived from the roster when the roster changes (`spa/utils/CacheInvalidation.js`). Do not hand-clear
  cache keys after such a write. To reload after one, call the read again with `forceRefresh: true`.
  A write that was only **queued** (`{ queued: true }`) gets less. Queued while known to be offline, it
  clears only the resource it touched, not the screens derived from it. Queued after a network error,
  it clears nothing, and a replay the server accepts clears nothing either, so reload with
  `forceRefresh: true` once it is sent.
- ✅ **A queued write the server refuses on replay is never reported as saved.** A 400, 403, 404, 409,
  410 or 422 drops it from the queue, clears every cached copy of it (its API resource, and the keys its
  screen stores under its own name, `SCREEN_CACHE_PREFIXES`; for attendance only the refused date, so a
  camp's other prepared days survive), even with that screen closed, and announces
  `offlineMutationRejected` (`{ url, method, kind, mutationId, status }`; `queueMutation` returns the
  `mutationId`, and `api-core` hands it back as `result.mutationId`). The sync then says what was
  refused (`sync.rejected`) instead of "all changes synced". A screen that queues writes reloads when
  its `kind` is refused, and a form waiting on its own `mutationId` hands itself back for correction.
  A new queueable write gets a `kind` in `SAFE_OFFLINE_MUTATIONS`, its screen's own cache keys in
  `SCREEN_CACHE_PREFIXES`, and a `sync.rejected_kind_<kind>` key.
- ✅ Cache keys and in-flight read deduplication are scoped by user, unit and selected scout year
  (`spa/utils/OfflineCacheKeys.js`); never build one by hand. Simultaneous reads share one request;
  a forced refresh starts a new one. An aborted read is never retried.
- ✅ Offline, writes are queued and answer `{ queued: true }`. Resources listed in
  `CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES` (invitations, parent onboarding, walk-ins, family links)
  refuse instead, with the code `online_required`. Do not report a queued or unconfirmed write as delivered.
- ✅ Never put an organization id in a request body or query: `api-core` sends the unit, and for a
  signed-in person the server takes it from the token and ignores anything else.

#### Scout years and archives
- ✅ A leader may consult an archived scout year (`spa/modules/scout-year/`). The API layer then sends
  the year with every read and refuses every write, and `ArchiveReadOnly` disables every control in
  `#app`. Mark a control used to browse (date picker, filter, search) with `data-archive-safe`.
- ✅ Lists of youth are the roster of the year being consulted, not every participant ever enrolled.

#### Configuration
- ✅ **No hardcoded values** - use `spa/config.js`
```javascript
import { CONFIG } from '../../config.js';
const ttl = CONFIG.CACHE_DURATION.SHORT;
```

#### Logging
- ✅ Use `debugLog()` / `debugError()` from `spa/utils/DebugUtils.js`
- ❌ **Never use `console.*` in SPA files** — enforced by `npm run lint:spa-console` (only `DebugUtils.js` and `config.js` are exempt)

#### State Management
- ✅ Optimistic updates go through `spa/utils/OptimisticUpdateManager.js`: a failure restores exactly the
  previous state, and a successful server write is never rolled back because a local step failed.
- ✅ A response that arrives after the person has left the screen must not draw over the next one.
  `#app` outlives every screen, so check something the screen owns: a `destroyed` flag set in
  `destroy()`, or the screen's own root element inside `#app`.

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

- ✅ A 500 response from `error()` omits validation details (`errors`) as well as the internal message.
- ✅ A 5xx never sends `error.message`, a provider's error, or a database error to the client
  (`test/server-error-leaks.test.js` checks every route file). Log it and answer a generic message.
- ✅ Bad input is a 400, never a 500: a malformed id, a non-array where an array is expected, an id
  beyond the integer range. Validate ids strictly with `validateIdParam()` / `validateIdBody()` /
  `validateIdQuery()` + `checkValidation`, which accept only 1 to 2147483647 (a PostgreSQL `integer`),
  not with `parseInt()`, which reads `12abc` as 12. As a safety net, the global error handler
  (`config/app.js`) answers PostgreSQL's `22P02` (value unreadable as its type) and `22003` (out of
  range) with 400 `invalid_request`. It only reaches errors a route lets propagate, so validate anyway.
- ✅ A message the SPA may show is a translation key (`invalid_or_expired_token`); the SPA displays a
  server message only when it is a key it knows (§1).

#### Frontend
```javascript
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';

try {
  const response = await getThings();
  this.things = Array.isArray(response?.data) ? response.data : [];
  this.render();
} catch (error) {
  debugError('Failed to load things:', error);
  this.renderError();                       // in the page, with a retry button
}

try {
  await saveThing(payload);
  this.app.showMessage(translate('thing_saved'), 'success');
} catch (error) {
  debugError('Failed to save thing:', error);
  this.app.showMessage(apiErrorMessage(error, 'thing_save_failed'), 'error');
}
```

### 10) ESLint Rules (`eslint.config.js`)

The project enforces ESLint 9 rules. **Errors block CI; warnings must be resolved before merge** — both are enforced.

- Errors that predate CI enforcement are frozen in `eslint-suppressions.json` (`npm run lint:eslint`). A **new** error fails CI.
- Warnings that predate CI enforcement are counted per file in `scripts/modernization/policy-baseline.json`
  (`npm run lint:eslint-warnings`, part of `lint:policy`). A file that **gains** a warning fails CI; after removing
  warnings, lower the baseline with `npm run lint:policy -- --update-baseline`.
- After fixing a suppressed error, run `npm run lint:eslint:prune` and commit the smaller file — CI also
  fails while the suppressions list errors that no longer exist.
- Never add to `eslint-suppressions.json` by hand (renaming a moved file's key, §7, is the one exception). A false positive gets an inline
  `// eslint-disable-next-line <rule> -- <reason>`.
- `mobile/` has its own toolchain and is not linted by the root config.

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
- `*.test.js`, `*.spec.js` — `no-magic-numbers`, `no-console` and `no-script-url` are off
- `migrations/`, `config/` — `no-magic-numbers` is off
- Backend files are parsed as CommonJS; `spa/` and the shared `config/roles.js` / `config/meeting_sections.js` as ES modules

### 11) Automated Lint Scripts

Run `npm run lint:all` before every PR — it runs every check below, and it is exactly what CI runs.

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
| `npm run lint:api-contracts` | Each endpoint listed in `config/spa-api-contracts.json` is still mounted and routed on the server and called by its SPA client file |
| `npm run lint:role-names` | No access decided by a role name (§3) — server code, plus `hasRole('…')` in `spa/` and `mobile/src/` |
| `npm run lint:client-org-id` | No `organization_id` / `x-organization-id` read from the client outside `getOrganizationId` and `getCurrentOrganizationId` |
| `npm run lint:manual-auth` | No `verifyJWT`, `verifyOrganizationMembership` or `getCurrentOrganizationId` in routes — use `authenticate` + `requirePermission` |
| `npm run lint:catch-shadow` | No `catch (error)` hiding the `error()` response helper |
| `npm run lint:eslint-warnings` | No file gains an ESLint warning (§10) |
| `npm run lint:eslint` | ESLint errors (§10) |

**Policy checks (`lint:policy` runs the five above) are a ratchet.** Existing violations are counted per
file in `scripts/modernization/policy-baseline.json`:

- A file may never gain a violation. Fix it, or — only for a use CLAUDE.md permits — annotate it on that
  line or the line above, with a reason: `// policy-allow manual-auth: public login route, no session yet`
  (inside SQL, use `-- policy-allow …`). ESLint warnings are not annotated this way: fix them, or disable a
  false positive inline with `// eslint-disable-next-line <rule> -- <reason>`.
- When you remove violations, run `npm run lint:policy -- --update-baseline` and commit the lower counts;
  CI fails while the baseline overstates them. The script refuses to raise a count.

### SISC import limits

`POST /api/v1/import/sisc` validates the complete CSV before acquiring its import database connection.
`SISC_IMPORT_LIMITS` in `config/constants.js` caps one synchronous import at 5 MiB of UTF-8,
1,000 nonblank data rows (plus the header), 128 columns, 64 Ki characters per physical line,
and 16 Ki characters per field. These bounds limit parsing memory and transaction work for a
unit-sized import. Split larger imports into batches. Non-string content, missing data rows
and unclosed quotes return 400; exceeded limits return 413 through the standard error helper.
The format remains semicolon-delimited, with quoted separators and blank lines supported.

SPA link navigation parses URLs before checking new-tab, download or modifier gestures.
Only HTTP, HTTPS, mailto, tel and blob links may reach browser navigation; other protocols are
cancelled. Only same-origin HTTP(S) links are routed inside the SPA.

### 12) Tests

**Tests are the most current statement of how the app behaves.** When this document and a test
disagree, the test wins. Fix the document in the same change. Read the tests of the area you touch
before changing it.

- ✅ Sanitization security tests use real DOMPurify under jsdom, including the production hooks;
  regex substitutes cannot establish that hostile markup is safe.
- ✅ Every behaviour change comes with a test. Name tests as plain statements of behaviour, from the
  person's side: `'a parent cannot read another family\'s health form'`, not `'test GET /forms 403'`.
- ✅ **SPA tests** live in `test/spa/<Screen>.test.js`, under `/** @jest-environment jsdom */`. They mock
  `spa/utils/DebugUtils.js`, mock `spa/app.js` with `translate: (key) => key`, mock the feature's API
  module, render into a `#app` element, and act through the DOM (click, type, submit), the way a person
  would. Assert on what the person sees and on the payload sent, not on private methods.
- ✅ **Every new screen, dialog or form has an accessibility test**: `axe-core` with the WCAG 2.x A/AA
  tags (`color-contrast` off, since jsdom does no layout; see `AXE_OPTIONS` in
  `test/spa/ModalUtils.test.js`), plus keyboard checks for focus, Tab and Escape where it has a dialog.
- ✅ Test that names coming from people are escaped: render a name such as `<img src=x onerror=…>` and
  assert it shows as text.
- ✅ **Route tests** (`test/routes-*.test.js`) use `supertest` and the mocked pool from
  `test/mock-helpers.js`. Cover 401 without a token, 403 with `required`/`missing` without the
  permission, `isDemo` for demo writes, 404 for another unit's resource, and 400 for malformed input.
- ✅ **Integration tests** (`*.integration.test.js`) run against a real PostgreSQL built from the
  schema baseline and every migration. They skip without `TEST_DATABASE_URL`. Anything about access to
  children, roles, family links or scout years needs one. Run them locally with the command under Development Workflow › Migrations.
- ✅ **Accessibility in a real browser** (`e2e/accessibility.spec.mjs`, `npm run test:a11y`): Playwright
  and axe at phone and desktop size, signed out and as a parent, a leader and an admin. It fails on any
  WCAG 2.2 A/AA violation (contrast included), sideways scroll at 390px, a screen left `aria-busy`, a
  title not named after the screen's `<h1>`, a screen that shows the 404 or 403 page instead of
  itself, and focus that is invisible, hidden, or lost after a navigation or in a dialog. A new
  screen joins `SCREENS` there; a detail screen opens on a record `seed.mjs` creates (`seededRecord`). `KNOWN_VIOLATIONS` only shrinks: fix
  an entry when you touch its screen. It needs a running seeded app
  (`run-wampums` skill: `db.sh`, `seed.mjs`, `start.sh`).
- ✅ CI runs `npm run lint:all`, `npm run build`, `npm run test:quality` (every Jest suite; the
  integration ones skip without `TEST_DATABASE_URL`), the integration job and the accessibility job.
  Run the same before a PR.
- ✅ To see a change in a real browser (phone or desktop size, as admin, leader or parent), use the
  `run-wampums` project skill (`.claude/skills/run-wampums/`).

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
- **Utilities:** `utils/api-helpers.js`; logging is configured in `config/logger.js`
- **Services:** `services/` - Business logic layer
- **Database migrations:** `migrations/*.sql`

### Web SPA (Vite + ES Modules)
- **Entry:** `index.html`, `spa/app.js`, `spa/router.js`
- **Configuration:** `spa/config.js` (app-wide constants), `spa/config/*.js` (dashboard tiles,
  parent-dashboard buttons, languages, tabbed pages)
- **Utilities:** `spa/utils/*`
  - `DOMUtils.js` - `setContent`, `setText`, `withFormBusy`
  - `SecurityUtils.js` - `escapeHTML`, `escapeAttribute`, `sanitizeURL`, `sanitizeHTML`
  - `ModalUtils.js` / `DialogUtils.js` / `ScrollLockUtils.js` - Dialogs and scroll locking
  - `ApiErrorUtils.js` - Translated explanation of a failed call
  - `BackLinkUtils.js`, `NotFoundUtils.js`, `SkeletonUtils.js` - Shared page chrome and states
  - `PermissionUtils.js` - Permission and data-scope checks
  - `DateUtils.js`, `NumberUtils.js`, `InterfaceLanguageUtils.js` - Locale formatting and languages
  - `RoleLabelUtils.js`, `BadgeLabelUtils.js`, `FormLabelUtils.js`, `UnitVocabularyUtils.js` - Labels
  - `RichTextUtils.js` - Showing and converting formatted text
  - `CacheInvalidation.js`, `OfflineCacheKeys.js` - What a write makes stale; scoped cache keys
  - `OptimisticUpdateManager.js` - Optimistic UI updates
  - `BaseModule.js` - Listener, timer and observer cleanup for screens
  - `DebugUtils.js` - Logging (`debugLog`, `debugError`)
- **API Layer:** `spa/api/`
  - `api-core.js` - `API.get/getNoCache/post/put/patch/delete`: auth, caching, offline queue,
    archive read-only, cache invalidation
  - `api-<feature>.js` - Feature API modules (where new functions go)
  - `api-endpoints.js`, `../ajax-functions.js` - Older catch-all endpoint files; do not grow them
- **Modules:** `spa/modules/<feature>/` (every screen)
- **Assets:** `assets/`, `css/`, `spa/assets/`

### Mobile App (Expo / React Native)
- **Location:** `mobile/`
- **Entry:** `mobile/index.js`, `mobile/App.js`
- **Utilities:** `mobile/src/utils/*` (mirrors web utilities where appropriate)
- **Security:** `mobile/src/utils/SecurityUtils.js` (same patterns as web)

### Directory Structure

```
wampums/
├── api.js                      # Express server entry point
├── package.json
├── vite.config.mjs
├── middleware/
│   ├── auth.js                 # authenticate, requirePermission, blockDemoRoles, getOrganizationId
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
│   ├── api-helpers.js          # escapeHtml and shared helpers
│   └── richText.js             # Server-side rich-text rebuild
├── config/                     # logger.js, interface_languages.json, spa-api-contracts.json…
├── migrations/                 # Database migrations
├── spa/                        # Frontend SPA
│   ├── app.js                  # App initialization
│   ├── router.js               # Client-side routing
│   ├── config.js               # Frontend configuration
│   ├── config/                 # dashboard-tiles.js, languages.js, …
│   ├── api/                    # API client layer
│   │   ├── api-core.js
│   │   ├── api-endpoints.js
│   │   └── api-*.js
│   ├── utils/                  # Frontend utilities
│   │   ├── DebugUtils.js
│   │   ├── DateUtils.js
│   │   ├── SecurityUtils.js
│   │   └── ...
│   └── modules/                # Feature modules (every screen)
├── assets/                     # Static assets
├── css/                        # Stylesheets
├── lang/                       # Translation files
│   ├── en.json
│   ├── fr.json
│   └── ...
├── mobile/                     # React Native mobile app
├── attached_assets/            # Reference SQL dumps
│   ├── Full_Database_schema.sql
│   └── permissions_list.sql
├── test/                       # Jest: routes, integration, security
│   ├── spa/                    # jsdom tests of SPA screens and utilities
│   └── user-stories/           # End-to-end stories per feature (attendance, points, honors)
└── .claude/skills/run-wampums/ # Run and screenshot the app locally
```

---

## Development Workflow

### Web (Vite + API)

```bash
npm install
npm run dev      # Vite dev server (port 5173)
npm start        # API server (port 5000 by default)
```

### Mobile (Expo)

```bash
cd mobile
npm install
npm run start    # Expo dev server
```

### Migrations

Schema changes are `.sql` or `.js` files in `migrations/`, applied automatically by
`scripts/deploy-migrate.js`. **Do not apply migration SQL to production by hand** — the runner is
part of the deploy.

| Command | What it does |
|---|---|
| `npm run db:migrate:deploy` | Applies every pending migration. Runs before the server starts via `deploy:start`. |
| `npm run db:migrate:base` | Same application step, without the deploy wrapper. |
| `node scripts/run-migration.js <file>` | Applies one named migration. |

How the runner behaves, and what it demands of a migration file:

- ✅ Files are applied in **filename order** and recorded in `schema_migrations`, so each runs once.
  Prefix new files with the next number (`007_`, `008_`, …).
- ✅ The **whole run is one transaction**, serialized across instances by an advisory lock. A single
  failing statement rolls back every migration in that run and exits non-zero, so the server does
  not boot. One bad migration blocks the deploy — it does not merely skip itself.
- ✅ Migrations must **not** contain `BEGIN`/`COMMIT`; the runner owns the transaction.
- ✅ Write every statement to be **re-runnable**: `CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`. Note that `ALTER TABLE … ADD
  CONSTRAINT` has **no** `IF NOT EXISTS` — declare foreign keys and checks inside `CREATE TABLE`.
- ⚠️ **Inserting into a table seeded with explicit ids** (notably `permissions`, whose catalog was
  loaded with ids 1–86 while its sequence still sits at 1) will collide on the primary key. Advance
  the sequence first:
  ```sql
  SELECT setval(
    pg_get_serial_sequence('public.permissions', 'id'),
    COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1,
    false
  );
  ```
- ✅ A `.js` migration exports `up(client, context)` and may set a `description`.

- ✅ **Every schema change the code relies on must exist in `attached_assets/Full_Database_schema.sql` or
  in `migrations/`.** In August 2026 seven migrations were lost when the folder was reset; the code kept
  using their tables and columns, and every database built from the repository broke until
  `015_restore_lost_migrations.sql`. Never apply schema SQL that is not committed here.
- ✅ CI (`database-integration` job) builds a PostgreSQL 17 database from the baseline, the permission
  catalog, and every migration, then clears `schema_migrations` and executes every migration again — a
  migration that cannot run twice fails here — and runs all
  `*.integration.test.js` suites against it. Locally:
  `TEST_DATABASE_URL=postgresql://… npx jest --runInBand --testPathPatterns 'integration\.test\.js$'`.

Validate a migration against a disposable database before committing it, rather than reading it and
hoping — load `attached_assets/Full_Database_schema.sql` into a scratch database, apply the file,
then apply it a second time to prove it is re-runnable.

---

## Environment Variables (Server)

**Required:**
```bash
PORT=5000
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
const { validateIdParam, checkValidation } = require('../middleware/validation');

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
    validateIdParam('id'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const resourceId = Number(req.params.id);
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
    validateIdParam('id'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const resourceId = Number(req.params.id);
      
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

A new screen, modelled on `spa/modules/walk-in/WalkInChildren.js` and `spa/modules/messages/Messages.js`.

```javascript
// spa/api/api-resources.js
import { API } from './api-core.js';

/** @returns {Promise<Object>} The unit's resources */
export function getResources(options = {}) {
  return API.get('v1/resources', {}, options);   // options: { forceRefresh, cacheDuration }
}

/** @returns {Promise<Object>} API response */
export function deleteResource(resourceId) {
  return API.delete(`v1/resources/${encodeURIComponent(resourceId)}`);  // invalidates the cache itself
}
```

```javascript
// spa/modules/resources/ResourceManager.js
/**
 * Resources — what the unit lends out, and removing what it no longer has.
 *
 * @module spa/modules/resources/ResourceManager
 */
import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { getResources, deleteResource } from '../../api/api-resources.js';

export class ResourceManager {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.resources = [];
    // The permission the DELETE route requires, so the button is offered exactly when it would work.
    this.canManage = hasPermission('resources.manage');
    this.destroyed = false;
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {Promise<void>} */
  async init() {
    this.renderLoading();
    try {
      await this.load();
      this.render();
    } catch (error) {
      debugError('Failed to load resources:', error);
      this.renderError();
    }
  }

  /** @param {{forceRefresh?: boolean}} [options] */
  async load(options = {}) {
    const response = await getResources(options);
    this.resources = Array.isArray(response?.data) ? response.data : [];
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  renderLoading() {
    setContent(this.root(), `
      <section class="page resources" aria-busy="true">
        ${renderBackLink()}
        <h1>${translate('resources_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  renderError() {
    if (this.destroyed) {
      return;
    }
    setContent(this.root(), `
      <section class="page resources">
        ${renderBackLink()}
        <h1>${translate('resources_title')}</h1>
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button" id="resources-retry">${translate('retry')}</button>
      </section>
    `);
    document.getElementById('resources-retry')?.addEventListener('click', () => this.init());
  }

  render() {
    // #app outlives every screen: a late answer must not draw over the next one.
    if (this.destroyed) {
      return;
    }
    const root = this.root();
    const items = this.resources.map((resource) => `
      <li class="resource-card">
        <span>${escapeHTML(resource.name)}</span>
        ${this.canManage ? `
          <button type="button" class="button button--small button--danger" data-delete="${Number(resource.id)}">
            ${translate('delete')}
          </button>` : ''}
      </li>`).join('');
    setContent(root, `
      <section class="page resources">
        ${renderBackLink()}
        <h1>${translate('resources_title')}</h1>
        ${items ? `<ul class="resource-list">${items}</ul>` : `<p>${translate('resources_empty')}</p>`}
      </section>
    `);
    // The markup was just replaced, so these listeners never stack.
    root.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', () => this.remove(Number(button.dataset.delete)));
    });
  }

  /** @param {number} resourceId */
  async remove(resourceId) {
    const resource = this.resources.find((item) => item.id === resourceId);
    const confirmed = await confirmDestructive({
      title: translate('resources_delete_title'),
      message: translate('resources_delete_confirm').replace('{name}', resource?.name ?? ''),
    });
    if (!confirmed) {
      return;
    }
    let result;
    try {
      result = await deleteResource(resourceId);
    } catch (error) {
      debugError('Failed to delete resource:', error);
      this.app.showMessage(apiErrorMessage(error, 'resources_delete_failed'), 'error');
      return;
    }
    // Offline, the delete is only queued: say so rather than claim it is done.
    this.app.showMessage(
      translate(result?.queued ? 'resources_delete_queued' : 'resources_deleted'),
      result?.queued ? 'info' : 'success',
    );
    // The delete stands even if the reload fails: show the error state, not "delete failed".
    try {
      await this.load({ forceRefresh: true });
      this.render();
    } catch (error) {
      debugError('Failed to reload resources:', error);
      this.renderError();
    }
  }
}
```

Then register it in `spa/router.js` (loader, path, `guard(hasPermission('resources.view'))`), add every
key to `lang/en.json` and `lang/fr.json`, and add `test/spa/ResourceManager.test.js` (§12).

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

**Frontend (SPA):**
- [ ] New screens in `spa/modules/<feature>/`, API calls in `spa/api/api-<feature>.js` through `API`
- [ ] An older screen that was touched has been brought into line (§7); any move in its own commit
- [ ] Route guarded by the permission its endpoints require; dashboard tile gated the same way
- [ ] `setContent()` only; text escaped with `escapeHTML()`, attributes with `escapeAttribute()`
- [ ] Back link first; loading, error (with retry) and empty states
- [ ] Every key in both `en.json` and `fr.json`; no raw keys, role names or server messages on screen
- [ ] Errors explained with `apiErrorMessage()`; success via `this.app.showMessage()`
- [ ] Modals with `openModal()`, confirmations with `DialogUtils`, no browser dialogs
- [ ] Native, labelled controls; 44px touch targets; visible focus; works at 390px wide
- [ ] Permission checks with `hasPermission()` / `isParent()`, never `hasRole()`
- [ ] No listeners stacked across re-renders; `destroy()` releases document-level ones
- [ ] `test/spa/` test covering the behaviour, escaping, and an axe check
- [ ] `debugLog`/`debugError` instead of `console.*`; `spa/config.js` constants, no hardcoded values

**Linting (run all before PR):**
- [ ] `npm run lint:all` passes (all checks in §11, ESLint included)
- [ ] Baselines lowered when violations were removed; no new `policy-allow` without a CLAUDE.md-permitted reason

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

**This document is the source of truth for development practices, after the tests (§12). When in doubt, read the tests of the area, then the reference screens named in §7 and existing code in `routes/` and `middleware/`. When a test and this document disagree, fix this document.**
