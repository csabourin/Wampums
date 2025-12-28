# SPA to Mobile Screen Porting Plan

This plan inventories the remaining SPA pages in `/spa` and maps them to React Native screens under `/mobile/src/screens`, while preserving the existing web interface look and feel. It aligns with `CLAUDE.MD` requirements (bilingual pages, translation keys in `lang/*.json`, locale-aware date/number formatting, RESTful `/api/v1` endpoints) and the mobile-first design rules.

## 1. Inventory & gap map (SPA → Mobile)

**Already present in mobile (verify parity only):**
- `spa/login.js` → `mobile/src/screens/LoginScreen.js`
- `spa/dashboard.js` → `mobile/src/screens/DashboardScreen.js`
- `spa/parent_dashboard.js` → `mobile/src/screens/ParentDashboardScreen.js`
- `spa/district_management.js` → `mobile/src/screens/DistrictDashboardScreen.js`
- `spa/attendance.js` → `mobile/src/screens/AttendanceScreen.js`
- `spa/manage_points.js` → `mobile/src/screens/ManagePointsScreen.js`
- `spa/preparation_reunions.js` → `mobile/src/screens/MeetingPreparationScreen.js`
- `spa/upcoming_meeting.js` → `mobile/src/screens/NextMeetingScreen.js`
- `spa/activities.js` → `mobile/src/screens/ActivitiesScreen.js`
- `spa/manage_honors.js` → `mobile/src/screens/HonorsScreen.js`
- `spa/medication_management.js` → `mobile/src/screens/MedicationScreen.js`, `MedicationPlanningScreen.js`, `MedicationDistributionScreen.js`
- `spa/manage_participants.js` → `mobile/src/screens/ParticipantsScreen.js` + `ParticipantDetailScreen.js`

**Remaining SPA pages to port (exhaustive from `spa/router.js` + SPA root):**

| SPA route / feature | SPA file(s) | Target mobile screen(s) |
|---|---|---|
| Admin panel | `spa/admin.js` | `AdminScreen.js` |
| Parent finance | `spa/parent_finance.js` | `ParentFinanceScreen.js` |
| Registration (parent) | `spa/formulaire_inscription.js` | `RegistrationFormScreen.js` |
| Time since registration | `spa/time_since_registration.js` | `TimeSinceRegistrationScreen.js` |
| Manage users ↔ participants | `spa/manage_users_participants.js` | `UserParticipantLinkScreen.js` |
| Manage groups | `spa/manage_groups.js` | `GroupsScreen.js` |
| Participant documents | `spa/view_participant_documents.js` | `ParticipantDocumentsScreen.js` |
| Parent contact list | `spa/parent_contact_list.js` | `ParentContactListScreen.js` |
| Approve badges | `spa/approve_badges.js` | `ApproveBadgesScreen.js` |
| Badge dashboard | `spa/badge_dashboard.js` | `BadgeDashboardScreen.js` |
| Badge form | `spa/badge_form.js` | `BadgeFormScreen.js` |
| Health form (fiche santé) | `spa/fiche_sante.js` | `HealthFormScreen.js` |
| Risk acceptance | `spa/acceptation_risque.js` | `RiskAcceptanceScreen.js` |
| User register | `spa/register.js` | `RegisterScreen.js` |
| Reset password | `spa/reset_password.js` | `ResetPasswordScreen.js` |
| Register organization | `spa/register_organization.js` | `RegisterOrganizationScreen.js` |
| Create organization | `spa/create_organization.js` | `CreateOrganizationScreen.js` |
| Mailing list | `spa/mailing_list.js` | `MailingListScreen.js` |
| Fundraisers | `spa/fundraisers.js` | `FundraisersScreen.js` |
| Calendars | `spa/calendars.js` | `CalendarScreen.js` |
| Reports | `spa/reports.js` | `ReportsScreen.js` |
| Finance | `spa/finance.js` | `FinanceScreen.js` |
| Budgets | `spa/budgets.js` | `BudgetsScreen.js` |
| External revenue | `spa/external-revenue.js` | `ExternalRevenueScreen.js` |
| Expenses | `spa/expenses.js` | `ExpensesScreen.js` |
| Revenue dashboard | `spa/revenue-dashboard.js` | `RevenueDashboardScreen.js` |
| Resource dashboard | `spa/resource_dashboard.js` | `ResourceDashboardScreen.js` |
| Inventory | `spa/inventory.js` | `InventoryScreen.js` |
| Material management | `spa/material_management.js` | `MaterialManagementScreen.js` |
| Permission slips dashboard | `spa/permission_slip_dashboard.js` | `PermissionSlipsScreen.js` |
| Permission slip sign | `spa/permission_slip_sign.js` | `PermissionSlipSignScreen.js` |
| Account info | `spa/modules/account-info.js` + `css/account-info.css` | `AccountInfoScreen.js` |
| Form builder | `spa/formBuilder.js` | `FormBuilderScreen.js` |
| Carpool landing | `spa/carpool.js` | `CarpoolScreen.js` |
| Carpool detail | `spa/carpool_dashboard.js` | `CarpoolDetailScreen.js` |
| Role management | `spa/role_management.js` + `css/role-management.css` | `RoleManagementScreen.js` |
| Form permissions | `spa/form_permissions.js` | `FormPermissionsScreen.js` |
| Group participant report | `spa/group-participant-report.js` | `GroupParticipantReportScreen.js` |
| Dynamic forms | `spa/dynamicFormHandler.js`, `spa/JSONFormRenderer.js` | `DynamicFormScreen.js` |
| Parent forms (if still used) | `spa/formulaire_parents.js` | `ParentFormScreen.js` |

## 2. Design parity plan (look & feel)

1. **Theme token alignment**
   - Validate `mobile/src/theme/index.js` against `/css/styles.css` to ensure color, spacing, typography, and state styles match.
   - Port page-specific CSS from `/css/account-info.css`, `/css/carpool.css`, `/css/manage_names.css`, and `/css/role-management.css` into shared RN styles where applicable.

2. **Component parity**
   - Map SPA patterns (cards, tables, filters, modals, alerts, toasts, loading states) to shared RN components under `mobile/src/components`.
   - Implement missing base components: Table/List rows, FilterBar, Modal, Toast, EmptyState, and FormField variations using `theme` and `commonStyles`.

3. **Typography & spacing**
   - Enforce `theme.fontSize`, `theme.lineHeight`, `theme.spacing`, and `theme.touchTarget.min` across all screens.

## 3. Data/API parity plan

1. **Endpoint mapping**
   - Audit SPA API calls per module and mirror them in `mobile/src/api/api-endpoints.js` using JWT auth from `StorageUtils`.

2. **Permissions parity**
   - Apply the same permission gating as `spa/utils/PermissionUtils.js` using `mobile/src/utils/PermissionUtils`.

3. **Multi-tenant isolation**
   - Preserve server-side `organization_id` filtering via JWT context for all `/api/v1` calls.

4. **Security**
   - Use sanitization utilities for any rendered user content (e.g., mobile `SecurityUtils` equivalent).
   - Validate inputs before submission and handle errors consistently.

## 4. Navigation parity plan

1. **Routes & stacks**
   - Add stack routes in `mobile/src/navigation` for every remaining screen.
   - Replace placeholder tabs in `MainTabNavigator` with their real screens once implemented.

2. **Role-based access**
   - Mirror SPA routing guards (parent vs leader vs admin vs district roles).

3. **Deep links / params**
   - Implement navigation params for all `/:id` SPA routes (badge form, health form, risk acceptance, permission slip sign, carpool, calendars).

## 5. Screen-by-screen implementation plan (grouped by domain)

### A) Auth & organization setup
- **Register / reset / org setup**
  - Files: `register.js`, `reset_password.js`, `register_organization.js`, `create_organization.js`
  - Recreate form flows and validation rules; integrate `/api/v1` endpoints; store tokens on success; ensure bilingual keys.

### B) Admin & access control
- **Admin, role management, form permissions**
  - Files: `admin.js`, `role_management.js`, `form_permissions.js`
  - Rebuild tables and admin actions with shared RN components; honor permissions and role checks.

### C) Participants & parents
- **Participants, documents, registration, contact list**
  - Files: `manage_participants.js`, `view_participant_documents.js`, `formulaire_inscription.js`, `parent_contact_list.js`
  - Implement list/detail flow, uploads, and parent-facing forms with parity layouts.

### D) Badges & honors
- **Approve badges, badge dashboard, badge form, honors**
  - Files: `approve_badges.js`, `badge_dashboard.js`, `badge_form.js`, `manage_honors.js`
  - Preserve status colors, approval workflows, and tile/summary layouts.

### E) Health & permissions
- **Health form, risk acceptance, permission slips**
  - Files: `fiche_sante.js`, `acceptation_risque.js`, `permission_slip_dashboard.js`, `permission_slip_sign.js`
  - Port dynamic form rendering and add a mobile-friendly signature/export flow.

### F) Activities & carpools
- **Fundraisers, calendars, carpool**
  - Files: `fundraisers.js`, `calendars.js`, `carpool.js`, `carpool_dashboard.js`
  - Maintain dashboards, filters, and navigation flows.

### G) Finance & budgets
- **Finance suite**
  - Files: `finance.js`, `budgets.js`, `external-revenue.js`, `expenses.js`, `revenue-dashboard.js`, `parent_finance.js`
  - Build finance dashboards with consistent formatting and permissions.

### H) Inventory & resources
- **Resource dashboard, inventory, material management**
  - Files: `resource_dashboard.js`, `inventory.js`, `material_management.js`
  - Port tables, CRUD flows, and empty/loading states.

### I) Reports & printable content
- **Reports and printable group report**
  - Files: `reports.js`, `group-participant-report.js`
  - Replace print-only UX with share/export if needed for mobile.

### J) Dynamic forms / form builder
- **Dynamic forms & builder**
  - Files: `dynamicFormHandler.js`, `JSONFormRenderer.js`, `formBuilder.js`
  - Recreate schema-driven forms with full translation support.

## 6. i18n & locale plan

- Use translation keys from `lang/en.json` and `lang/fr.json` via `mobile/src/i18n`.
- Enforce one language per screen.
- Apply locale-aware date and number formatting across screens.

## 7. QA & parity validation plan

For each migrated screen:
1. Visual comparison to SPA (spacing, colors, typography, button styles).
2. Verify loading, empty, and error states.
3. Confirm permission gating matches SPA routing rules.
4. Validate multi-tenant data isolation.
5. Ensure translations and locale formatting are correct.

## 8. Recommended delivery order

1. Shared RN components + theme parity.
2. High-traffic screens (Participants, Activities, Attendance, Points).
3. Health & permissions flows.
4. Admin + finance suite.
5. Remaining long-tail pages (inventory, carpool, form builder, reports).
