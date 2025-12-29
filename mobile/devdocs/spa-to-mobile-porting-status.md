# SPA ➜ Mobile Porting Status (Initial Comparison)

## Scope & Sources
This document compares the **web SPA** (`/spa`) with the **React Native mobile app** (`/mobile`) to assess porting coverage across:

1. **Pages / Screens**
2. **Utility modules**
3. **API endpoint wrappers**

**Source files reviewed:**
- SPA routes/pages: `spa/router.js` (route map + lazy module list)
- SPA utilities: `spa/utils/*.js`
- SPA API client: `spa/api/api-endpoints.js`
- Mobile screens: `mobile/src/screens/*.js`
- Mobile utilities: `mobile/src/utils/*.js`
- Mobile API client: `mobile/src/api/api-endpoints.js`

> This is a baseline comparison (first pass). It identifies parity, near-parity, and gaps for follow-up porting.

---

## 1) SPA Route Inventory (Source of Truth)
Extracted from `spa/router.js` routes map.

| SPA Route | Router Target | Notes |
| --- | --- | --- |
| `/` | `dashboard` | Dashboard landing |
| `/admin` | `admin` | Admin panel |
| `/dashboard` | `dashboard` | Dashboard alias |
| `/login` | `login` | Login screen |
| `/logout` | `logout` | Logout handler |
| `/parent-dashboard` | `parentDashboard` | Parent dashboard |
| `/parent-finance` | `parentFinance` | Parent finance view |
| `/formulaire-inscription` | `formulaireInscription` | Registration form (French) |
| `/formulaire-inscription/:id` | `formulaireInscription` | Registration form (with ID) |
| `/attendance` | `attendance` | Attendance tracking |
| `/managePoints` | `managePoints` | Manage points (legacy) |
| `/manage-points` | `managePoints` | Manage points |
| `/time-since-registration` | `timeSinceRegistration` | Time-since-registration report |
| `/manageHonors` | `manageHonors` | Honor management |
| `/manage-participants` | `manageParticipants` | Participant management |
| `/manage-groups` | `manageGroups` | Group management |
| `/view-participant-documents` | `viewParticipantDocuments` | Participant documents |
| `/approve-badges` | `approveBadges` | Badge approvals |
| `/badge-dashboard` | `badgeDashboard` | Badge overview |
| `/parent-contact-list` | `parentContactList` | Parent contacts |
| `/mailing-list` | `mailingList` | Mailing list |
| `/fiche-sante/:id` | `ficheSante` | Health form |
| `/acceptation-risque/:id` | `acceptationRisque` | Risk acceptance |
| `/badge-form/:id` | `badgeForm` | Badge form |
| `/register` | `register` | Register account |
| `/fundraisers` | `fundraisers` | Fundraisers |
| `/calendars/:id` | `calendars` | Calendar by activity |
| `/reset-password` | `resetPassword` | Password reset |
| `/reports` | `reports` | Reports dashboard |
| `/preparation-reunions` | `preparation_reunions` | Meeting preparation |
| `/register-organization` | `registerOrganization` | Org registration |
| `/manage-users-participants` | `manageUsersParticipants` | User ↔ participant links |
| `/dynamic-form/fiche_sante/:id` | `ficheSante` | Dynamic form wrapper |
| `/create-organization` | `createOrganization` | Create organization |
| `/group-participant-report` | `PrintableGroupParticipantReport` | Group/participant report |
| `/upcoming-meeting` | `UpcomingMeeting` | Next meeting view |
| `/finance` | `finance` | Finance module |
| `/budgets` | `budgets` | Budget module |
| `/external-revenue` | `externalRevenue` | External revenue |
| `/expenses` | `expenses` | Expenses |
| `/revenue-dashboard` | `revenueDashboard` | Revenue dashboard |
| `/resources` | `resourceDashboard` | Resource dashboard |
| `/inventory` | `inventory` | Inventory |
| `/material-management` | `materialManagement` | Material management |
| `/medication-management` | `medicationPlanning` | Medication planning |
| `/medication-planning` | `medicationPlanning` | Medication planning (alias) |
| `/medication-dispensing` | `medicationDispensing` | Medication distribution |
| `/permission-slips` | `permissionSlipDashboard` | Permission slips |
| `/permission-slip/:id` | `permissionSlipSign` | Sign a permission slip |
| `/account-info` | `accountInfo` | Account info module |
| `/form-builder` | `formBuilder` | Form builder |
| `/admin/form-builder` | `formBuilder` | Form builder admin alias |
| `/activities` | `activities` | Activities |
| `/carpool` | `carpoolLanding` | Carpool landing |
| `/carpool/:id` | `carpool` | Carpool details |
| `/role-management` | `roleManagement` | Role management |
| `/district-management` | `districtManagement` | District management |
| `/form-permissions` | `formPermissions` | Form permissions |

---

## 2) Mobile Screen Inventory
Extracted from `mobile/src/screens/*.js`.

- AccountInfoScreen
- ActivitiesScreen
- AdminScreen
- ApproveBadgesScreen
- AttendanceScreen
- BadgeDashboardScreen
- BadgeFormScreen
- BudgetsScreen
- CalendarScreen
- CarpoolScreen
- CreateOrganizationScreen
- DashboardScreen
- DistrictDashboardScreen
- ExpensesScreen
- ExternalRevenueScreen
- FinanceScreen
- FormPermissionsScreen
- FundraisersScreen
- GroupParticipantReportScreen
- GroupsScreen
- HealthFormScreen
- HonorsScreen
- InventoryScreen
- LeaderDashboardScreen
- LoginScreen
- MailingListScreen
- ManagePointsScreen
- MaterialManagementScreen
- MedicationDistributionScreen
- MedicationPlanningScreen
- MedicationScreen
- MeetingPreparationScreen
- NextMeetingScreen
- OrganizationSelectScreen
- ParentContactListScreen
- ParentDashboardScreen
- ParticipantDetailScreen
- ParticipantDocumentsScreen
- ParticipantsScreen
- PermissionSlipSignScreen
- PermissionSlipsScreen
- RegisterOrganizationScreen
- RegisterScreen
- ReportsScreen
- ResetPasswordScreen
- ResourceDashboardScreen
- RevenueDashboardScreen
- RiskAcceptanceScreen
- RoleManagementScreen
- SettingsScreen
- UserParticipantLinkScreen

---

## 3) Page/Screen Parity Map
**Legend:** ✅ = present (name-aligned), ⚠️ = partial/renamed/needs verification, ❌ = missing

| SPA Page (file / router target) | Mobile Screen | Status | Notes |
| --- | --- | --- | --- |
| `dashboard.js` (`dashboard`) | `DashboardScreen` | ✅ | Core landing in both apps. |
| `login.js` (`login`) | `LoginScreen` | ✅ | Login parity. |
| `admin.js` (`admin`) | `AdminScreen` | ✅ | Admin access screen exists. |
| `parent_dashboard.js` (`parentDashboard`) | `ParentDashboardScreen` | ✅ | Parent view mapped. |
| `parent_finance.js` (`parentFinance`) | _(none)_ | ❌ | No `ParentFinanceScreen`. Finance exists but not parent-specific. |
| `formulaire_inscription.js` (`formulaireInscription`) | _(none)_ | ❌ | No mobile equivalent of “formulaire-inscription”. |
| `attendance.js` (`attendance`) | `AttendanceScreen` | ✅ | Attendance parity. |
| `manage_points.js` (`managePoints`) | `ManagePointsScreen` | ✅ | Points management aligned. |
| `time_since_registration.js` (`timeSinceRegistration`) | _(none)_ | ❌ | Not present in mobile screens. |
| `manage_honors.js` (`manageHonors`) | `HonorsScreen` | ⚠️ | Screen exists but check if it includes management tools (not just viewing). |
| `manage_participants.js` (`manageParticipants`) | `ParticipantsScreen` | ✅ | Participant list management aligned. |
| `manage_users_participants.js` (`manageUsersParticipants`) | `UserParticipantLinkScreen` | ✅ | User ↔ participant linking. |
| `manage_groups.js` (`manageGroups`) | `GroupsScreen` | ✅ | Group management screen present. |
| `view_participant_documents.js` (`viewParticipantDocuments`) | `ParticipantDocumentsScreen` | ✅ | Document list exists. |
| `approve_badges.js` (`approveBadges`) | `ApproveBadgesScreen` | ✅ | Badge approval workflow present. |
| `badge_dashboard.js` (`badgeDashboard`) | `BadgeDashboardScreen` | ✅ | Badge dashboard present. |
| `parent_contact_list.js` (`parentContactList`) | `ParentContactListScreen` | ✅ | Parent contact list present. |
| `mailing_list.js` (`mailingList`) | `MailingListScreen` | ✅ | Mailing list present. |
| `fiche_sante.js` (`ficheSante`) | `HealthFormScreen` | ✅ | Health form screen mapped. |
| `acceptation_risque.js` (`acceptationRisque`) | `RiskAcceptanceScreen` | ✅ | Risk acceptance mapped. |
| `badge_form.js` (`badgeForm`) | `BadgeFormScreen` | ✅ | Badge form mapped. |
| `register.js` (`register`) | `RegisterScreen` | ✅ | Registration screen present. |
| `fundraisers.js` (`fundraisers`) | `FundraisersScreen` | ✅ | Fundraisers mapped. |
| `calendars.js` (`calendars`) | `CalendarScreen` | ✅ | Calendar screen mapped. |
| `reset_password.js` (`resetPassword`) | `ResetPasswordScreen` | ✅ | Password reset present. |
| `reports.js` (`reports`) | `ReportsScreen` | ✅ | Reports screen mapped. |
| `preparation_reunions.js` (`preparation_reunions`) | `MeetingPreparationScreen` | ✅ | Meeting prep mapped. |
| `register_organization.js` (`registerOrganization`) | `RegisterOrganizationScreen` | ✅ | Registration for organizations mapped. |
| `create_organization.js` (`createOrganization`) | `CreateOrganizationScreen` | ✅ | Create organization mapped. |
| `group-participant-report.js` (`PrintableGroupParticipantReport`) | `GroupParticipantReportScreen` | ✅ | Report screen present. |
| `upcoming_meeting.js` (`UpcomingMeeting`) | `NextMeetingScreen` | ✅ | Next meeting mapped. |
| `finance.js` (`finance`) | `FinanceScreen` | ✅ | Finance module present. |
| `budgets.js` (`budgets`) | `BudgetsScreen` | ✅ | Budgets present. |
| `external-revenue.js` (`externalRevenue`) | `ExternalRevenueScreen` | ✅ | External revenue mapped. |
| `expenses.js` (`expenses`) | `ExpensesScreen` | ✅ | Expenses mapped. |
| `revenue-dashboard.js` (`revenueDashboard`) | `RevenueDashboardScreen` | ✅ | Revenue dashboard mapped. |
| `resource_dashboard.js` (`resourceDashboard`) | `ResourceDashboardScreen` | ✅ | Resources mapped. |
| `inventory.js` (`inventory`) | `InventoryScreen` | ✅ | Inventory mapped. |
| `material_management.js` (`materialManagement`) | `MaterialManagementScreen` | ✅ | Material management mapped. |
| `medication_management.js` (`medicationPlanning` / `medicationDispensing`) | `MedicationPlanningScreen` / `MedicationDistributionScreen` | ✅ | Both planning and dispensing exist as separate screens. |
| `permission_slip_dashboard.js` (`permissionSlipDashboard`) | `PermissionSlipsScreen` | ✅ | Permission slip list mapped. |
| `permission_slip_sign.js` (`permissionSlipSign`) | `PermissionSlipSignScreen` | ✅ | Sign flow mapped. |
| `modules/account-info.js` (`accountInfo`) | `AccountInfoScreen` | ✅ | Account info mapped. |
| `formBuilder.js` (`formBuilder`) | _(none)_ | ❌ | No mobile form builder screen. |
| `activities.js` (`activities`) | `ActivitiesScreen` | ✅ | Activities mapped. |
| `carpool.js` (`carpoolLanding` / `carpool`) | `CarpoolScreen` | ⚠️ | Only one screen; check if it covers both landing + detail flows. |
| `carpool_dashboard.js` (`carpoolDashboard`) | `CarpoolScreen` | ⚠️ | No dedicated dashboard in mobile. |
| `role_management.js` (`roleManagement`) | `RoleManagementScreen` | ✅ | Role management mapped. |
| `district_management.js` (`districtManagement`) | `DistrictDashboardScreen` | ✅ | District dashboard mapped. |
| `form_permissions.js` (`formPermissions`) | `FormPermissionsScreen` | ✅ | Form permissions mapped. |
| `dynamicFormHandler.js` | _(none)_ | ❌ | No explicit mobile dynamic form handler screen. |
| `init-activity-widget.js` | _(none)_ | ❌ | Web widget initializer not represented in mobile. |

### Mobile-only Screens (No SPA Equivalent)
These are **mobile-exclusive** or not clearly mapped to a specific SPA page:
- `LeaderDashboardScreen` (no dedicated SPA screen found)
- `OrganizationSelectScreen` (mobile-specific org selection)
- `ParticipantDetailScreen` (SPA uses `manage_participants.js` + modal/route patterns)
- `SettingsScreen` (no SPA settings page)
- `MedicationScreen` (SPA splits via medication management/dispensing)

---

## 4) Utility Module Parity
Comparison between `spa/utils/*.js` and `mobile/src/utils/*.js`.

### Utilities with direct equivalents
| SPA Utility | Mobile Utility | Status | Notes |
| --- | --- | --- | --- |
| `DateUtils` | `DateUtils` | ✅ | Both exist. Verify locale handling parity. |
| `DebugUtils` | `DebugUtils` | ✅ | Both exist. Mobile also has `DebugConfig`. |
| `PermissionUtils` | `PermissionUtils` | ✅ | Permission checks in both. |
| `SecurityUtils` | `SecurityUtils` | ✅ | Sanitization exists in both. |
| `StorageUtils` | `StorageUtils` | ✅ | Storage helpers exist. |
| `ValidationUtils` | `ValidationUtils` | ✅ | Validation exists. |

### SPA utilities missing in mobile
| SPA Utility | Status | Notes |
| --- | --- | --- |
| `BaseModule` | ❌ | SPA module lifecycle helper; no mobile equivalent. |
| `ClientCleanupUtils` | ❌ | SPA-specific cleanup helpers. |
| `DOMUtils` | ❌ | Web DOM utilities have no RN analog. |
| `OptimisticUpdateManager` | ❌ | No RN equivalent found. Useful for offline/optimistic UX parity. |
| `ParticipantRoleUtils` | ❌ | No RN counterpart found. |
| `PerformanceUtils` | ❌ | No RN counterpart. |
| `RoleValidationUtils` | ❌ | No RN counterpart. |
| `SimpleWYSIWYG` | ❌ | SPA-only editor utility. |
| `SkeletonUtils` | ❌ | No RN skeleton loading helper. |
| `meetingSections` | ❌ | No RN counterpart; likely config or data structure for meeting prep UI. |

### Mobile utilities not present in SPA
| Mobile Utility | Status | Notes |
| --- | --- | --- |
| `CacheManager` | ⚠️ | Mobile-only caching utility; SPA uses IndexedDB helpers instead. |
| `DebugConfig` | ⚠️ | Mobile-specific debug configuration. |
| `FormatUtils` | ⚠️ | Number/string formatting helper not present in SPA. |
| `NumberUtils` | ⚠️ | Number helper not present in SPA. |

**Utility parity summary:**
- **Core utilities (Date, Debug, Permissions, Security, Storage, Validation) are aligned.**
- **SPA has several UI/DOM-centric utilities missing in RN**, which may be acceptable (DOM-specific), but some (e.g., `OptimisticUpdateManager`, `SkeletonUtils`) represent UX parity gaps rather than platform constraints.

---

## 5) API Endpoint Parity
Comparison between `spa/api/api-endpoints.js` (218 functions) and `mobile/src/api/api-endpoints.js` (105 functions).

### 5.1 Summary
- **SPA has 218 endpoint wrappers**.
- **Mobile has 105 endpoint wrappers**.
- **SPA-only wrappers:** 152
- **Mobile-only wrappers:** 39

### 5.2 SPA Endpoint Wrappers Missing in Mobile
Grouped by domain for clarity (exact function names from SPA):

**Authentication / Session / Organization**
- `authenticate`, `checkAuthStatus`, `validateToken`, `testConnection`, `testApiConnection`, `getPublicInitialData`, `getPublicNews`, `getPublicOrganizationSettings`, `getNews`, `getApiOrganizationId`, `createOrganization`, `fetchOrganizationJwt`, `registerForOrganization`, `getSubscribers`

**Users / Roles / Permissions**
- `getUsers` (mobile has but lacks organizationId variant), `getPendingUsers`, `approveUser`, `updateUserRole`, `getRoleCatalog`, `getRolePermissions`, `getRoleAuditLog`, `getUserOrganizations`, `getUserRoleAssignments`, `updateUserRolesV1`, `updateUserRoleBundles`, `checkPermission`, `clearUserCaches`

**Participants / Parents / Guardians**
- `fetchParticipant`, `getParticipantDetails`, `getParticipantAge`, `fetchParticipants`, `getParticipantsWithUsers`, `getParticipantsWithDocuments`, `linkParticipantToOrganization`, `removeParticipantFromOrganization`
- `getGuardians`, `fetchGuardians`, `getGuardianInfo`, `getGuardianCoreInfo`, `getGuardiansForParticipant`, `saveParent`, `saveGuardian`, `saveGuardianFormSubmission`, `linkParentToParticipant`, `linkGuardianToParticipant`, `removeGuardians`, `fetchParents`, `getParentUsers`, `getParentDashboard`, `getUserChildren`, `associateUser`, `linkUserParticipants`

**Groups / Points**
- `addGroup`, `removeGroup`, `updateGroupName`, `updateParticipantGroup`, `getParticipantProgressReport`

**Badges**
- `getPendingBadges` (exists in mobile), `getCurrentStars` (exists in mobile), `getBadgeSummary` (exists in mobile)
- SPA-only: `getBadgeHistory`, `updateBadgeProgress`, `approveBadge`, `rejectBadge`, `updateBadgeStatus` (mobile has similar names, verify params)

**Attendance / Reports**
- `getAttendanceReport`, `getHealthContactReport`, `getHealthReport`, `getAllergiesReport`, `getMedicationReport`, `getVaccineReport`, `getLeaveAloneReport`, `getMediaAuthorizationReport`, `getMissingDocumentsReport`

**Calendars / Fundraisers / Reminders**
- `getCalendars`, `updateCalendar`, `updateCalendarPaid`, `updateCalendarAmountPaid`, `getParticipantCalendar`
- `getFundraisers`, `getFundraiser`, `createFundraiser`, `updateFundraiser`, `archiveFundraiser`, `getCalendarsForFundraiser`, `updateCalendarEntry`, `updateCalendarPayment`
- `getActivitesRencontre`, `saveReminder`, `getReminder`

**Finance / Payments / Budgets / External Revenue**
- `getFinanceReport`, `getParticipantStatement`
- `getFeeDefinitions`, `createFeeDefinition`, `updateFeeDefinition`, `deleteFeeDefinition`
- `getParticipantFees`, `createParticipantFee`, `updateParticipantFee`
- `getParticipantPayments`, `createParticipantPayment`, `updatePayment`
- `getPaymentPlans`, `createPaymentPlan`, `updatePaymentPlan`, `deletePaymentPlan`
- `createStripePaymentIntent`, `getStripePaymentStatus`
- `createBudgetCategory`, `updateBudgetCategory`, `deleteBudgetCategory`
- `createBudgetItem`, `updateBudgetItem`, `deleteBudgetItem`
- `createBudgetExpense`, `updateBudgetExpense`, `deleteBudgetExpense`
- `createBudgetPlan`, `updateBudgetPlan`, `deleteBudgetPlan`
- `getBudgetSummaryReport`, `getBudgetRevenueBreakdown`, `getBudgetPlans`
- `getExternalRevenue`, `createExternalRevenue`, `updateExternalRevenue`, `deleteExternalRevenue`, `getExternalRevenueSummary`
- `getRevenueDashboard`, `getRevenueBySource`, `getRevenueByCategory`, `getRevenueComparison`

**Equipment / Resources / Permission Slips**
- `getEquipmentInventory`, `saveEquipmentItem`, `updateEquipmentItem`, `deleteEquipmentItem`
- `uploadEquipmentPhoto`, `deleteEquipmentPhoto`
- `getEquipmentReservations`, `saveEquipmentReservation`, `updateEquipmentReservation`, `saveBulkReservations`
- `getResourceDashboard`
- `getPermissionSlips` (mobile has), but SPA-only: `savePermissionSlip`, `archivePermissionSlip`, `signPermissionSlip`, `sendPermissionSlipEmails`, `sendPermissionSlipReminders`

**Forms / Form Builder**
- `getFormTypes`, `getFormStructure`, `getFormSubmissions`
- `getOrganizationFormFormats` (mobile has but signature differs), `getFormSubmission` (mobile has), `saveFormSubmission` (mobile has)
- `importSISC`

**Miscellaneous**
- `getMailingList` (mobile has mailing list screen but lacks endpoint wrapper)
- `getReports`
- `getAnnouncements`, `createAnnouncement`
- `getInitialData` (mobile has)

### 5.3 Mobile Endpoint Wrappers Not in SPA
These wrappers exist in mobile but are absent in SPA or are named differently:
- `assignParticipantToCarpool`, `createCarpoolOffer`, `getCarpoolOffers`, `getMyCarpoolOffers`, `getMyChildrenAssignments`, `getUnassignedParticipants`
- `createActivity`, `updateActivity`, `deleteActivity`, `getActivity`, `getActivityParticipants`, `getActivities`
- `createParticipant`, `updateParticipant`, `deleteParticipant`
- `createGroup`, `updateGroup`, `deleteGroup` (SPA uses `addGroup`, `updateGroupName`, `removeGroup`)
- `createAttendance` (SPA uses `updateAttendance` + `saveGuest` patterns)
- `getFinanceSummary` (SPA uses `getFinanceReport`)
- `getMeetingActivities` (SPA uses `getActivitesRencontre`)
- `getRiskAcceptance`, `saveRiskAcceptance` (SPA uses `fetchAcceptationRisque`, `saveAcceptationRisque`)
- `getRoles` (SPA uses `getRoleCatalog`/`getRolePermissions`)
- `getTranslations`, `saveTranslation` (SPA handled via other flows or direct DB routes)
- `viewPermissionSlip` (SPA uses `getPermissionSlips` + `signPermissionSlip`)
- `registerPushSubscription`
- `verifySession`
- `changePassword`, `getUserProfile`, `updateUserProfile`

### 5.4 Key API Findings
- **Mobile covers the core “day-to-day” flows but lacks many admin + reporting endpoints** (roles, audits, detailed finance and health reports, bulk operations).
- **Several endpoint names diverge** (e.g., group management, risk acceptance, meeting activities). This complicates shared logic and increases the chance of drift.
- **Permission slip workflows** are reduced on mobile (view/sign only).
- **Finance coverage in mobile is partial** (summary, fees, budgets list, but lacks CRUD for most finance objects).

---

## 6) Findings Summary (Initial)
1. **Page parity is high for core modules** but **administrative and tooling pages are missing** on mobile (Form Builder, Parent Finance, Time-since-registration, Dynamic form handler). 
2. **Utilities are only partially aligned**; platform-specific gaps are expected, but **Optimistic updates and skeleton loading are missing in RN**, which may be user-visible regressions.
3. **API coverage is incomplete on mobile**. Many SPA API wrappers for admin/reporting/finance/permissions are not yet ported.
4. **Naming drift** between SPA and Mobile APIs will require a mapping layer or normalization.

---

## 7) Suggested Next Steps (Documentation-Only)
- **Establish a canonical “feature parity checklist”** per module (Activities, Badges, Finance, Forms, Reports, etc.).
- **Normalize API wrapper names** (or document intentional differences) so shared feature docs can reference consistent identifiers.
- **Port high-impact utilities first** (`OptimisticUpdateManager`, `SkeletonUtils`) to reduce UX regressions.
- **Decide on mobile scope for admin/reporting** (if required, prioritize porting of missing endpoint wrappers).

---

## Appendix A: SPA Page Modules from `spa/router.js`
- `acceptation_risque.js`
- `activities.js`
- `admin.js`
- `approve_badges.js`
- `attendance.js`
- `badge_dashboard.js`
- `badge_form.js`
- `budgets.js`
- `calendars.js`
- `carpool.js`
- `carpool_dashboard.js`
- `create_organization.js`
- `district_management.js`
- `dynamicFormHandler.js`
- `expenses.js`
- `external-revenue.js`
- `fiche_sante.js`
- `finance.js`
- `formBuilder.js`
- `form_permissions.js`
- `formulaire_inscription.js`
- `fundraisers.js`
- `group-participant-report.js`
- `init-activity-widget.js`
- `inventory.js`
- `mailing_list.js`
- `manage_groups.js`
- `manage_honors.js`
- `manage_participants.js`
- `manage_points.js`
- `manage_users_participants.js`
- `material_management.js`
- `medication_management.js`
- `modules/account-info.js`
- `parent_contact_list.js`
- `parent_dashboard.js`
- `parent_finance.js`
- `permission_slip_dashboard.js`
- `permission_slip_sign.js`
- `preparation_reunions.js`
- `register.js`
- `register_organization.js`
- `reports.js`
- `reset_password.js`
- `resource_dashboard.js`
- `revenue-dashboard.js`
- `role_management.js`
- `time_since_registration.js`
- `upcoming_meeting.js`
- `view_participant_documents.js`

---

## Appendix B: Mobile Screen Modules
- `AccountInfoScreen.js`
- `ActivitiesScreen.js`
- `AdminScreen.js`
- `ApproveBadgesScreen.js`
- `AttendanceScreen.js`
- `BadgeDashboardScreen.js`
- `BadgeFormScreen.js`
- `BudgetsScreen.js`
- `CalendarScreen.js`
- `CarpoolScreen.js`
- `CreateOrganizationScreen.js`
- `DashboardScreen.js`
- `DistrictDashboardScreen.js`
- `ExpensesScreen.js`
- `ExternalRevenueScreen.js`
- `FinanceScreen.js`
- `FormPermissionsScreen.js`
- `FundraisersScreen.js`
- `GroupParticipantReportScreen.js`
- `GroupsScreen.js`
- `HealthFormScreen.js`
- `HonorsScreen.js`
- `InventoryScreen.js`
- `LeaderDashboardScreen.js`
- `LoginScreen.js`
- `MailingListScreen.js`
- `ManagePointsScreen.js`
- `MaterialManagementScreen.js`
- `MedicationDistributionScreen.js`
- `MedicationPlanningScreen.js`
- `MedicationScreen.js`
- `MeetingPreparationScreen.js`
- `NextMeetingScreen.js`
- `OrganizationSelectScreen.js`
- `ParentContactListScreen.js`
- `ParentDashboardScreen.js`
- `ParticipantDetailScreen.js`
- `ParticipantDocumentsScreen.js`
- `ParticipantsScreen.js`
- `PermissionSlipSignScreen.js`
- `PermissionSlipsScreen.js`
- `RegisterOrganizationScreen.js`
- `RegisterScreen.js`
- `ReportsScreen.js`
- `ResetPasswordScreen.js`
- `ResourceDashboardScreen.js`
- `RevenueDashboardScreen.js`
- `RiskAcceptanceScreen.js`
- `RoleManagementScreen.js`
- `SettingsScreen.js`
- `UserParticipantLinkScreen.js`
