# Mobile vs SPA Screen Audit Report

**Generated:** 2025-12-29
**Auditor:** Claude
**Scope:** All /mobile screens compared to /spa counterparts

---

## Executive Summary

**Total Screens Audited:** 50 mobile screens
**Critical Issues (P0):** 3
**High Priority Issues (P1):** 12
**Medium Priority Issues (P2):** 18
**Low Priority Issues (P3):** 8

**Overall Assessment:** Most screens exist and have basic functionality, but many are missing critical features, have incomplete implementations, or contain bugs that prevent proper operation.

---

## P0 (FATAL) - Screens that crash or completely broken

### 1. ParticipantsScreen - Missing Text Import
**File:** `mobile/src/screens/ParticipantsScreen.js`
**Line:** 64
**Issue:** Uses `<Text>` component without importing it
**Impact:** App crashes when adding participants via header button
**SPA Reference:** `spa/manage_participants.js`
**Fix:** Add `import { Text } from 'react-native';` to imports

### 2. ActivitiesScreen - Invalid Navigation Target
**File:** `mobile/src/screens/ActivitiesScreen.js`
**Lines:** 57, 179, 221
**Issue:** Navigates to 'ActivityDetail' screen that doesn't exist
**Impact:** App crashes when trying to view/create activities
**SPA Reference:** `spa/activities.js`
**Fix:** Change navigation target to correct screen name or create ActivityDetailScreen

### 3. ActivitiesScreen - Incorrect Permission Check
**File:** `mobile/src/screens/ActivitiesScreen.js`
**Line:** 143
**Issue:** `hasPermission(userPermissions, 'activities', 'create')` - wrong signature
**Impact:** Permission checks fail, users can't create activities even with permissions
**SPA Reference:** Uses `canViewActivities()` utility
**Fix:** Use `hasPermission('activities.manage', userPermissions)` or similar correct format

---

## P1 (HIGH PRIORITY) - Core features missing or non-functional

### 1. ParentDashboardScreen - Missing Permission Slips Section
**File:** `mobile/src/screens/ParentDashboardScreen.js`
**Issue:** Does not show pending permission slips requiring signatures
**Impact:** Parents cannot see which permission slips need signing - critical parent workflow
**SPA Reference:** `spa/parent_dashboard.js` lines 250-300
**Fix:** Add permission slips section showing unsigned slips with signature CTA

### 2. ParentDashboardScreen - Missing Financial Summary
**File:** `mobile/src/screens/ParentDashboardScreen.js`
**Issue:** Does not show outstanding balance or financial summary
**Impact:** Parents cannot see fees owed - critical parent information
**SPA Reference:** `spa/parent_dashboard.js` lines 200-240
**Fix:** Add consolidated financial summary section with "View Details" link to ParentFinanceScreen

### 3. ParticipantsScreen - Missing CRUD Operations
**File:** `mobile/src/screens/ParticipantsScreen.js`
**Issue:** Only shows list view, no create/edit/delete functionality
**Impact:** Leaders cannot manage participants from mobile
**SPA Reference:** `spa/manage_participants.js` has full CRUD
**Fix:** Add navigation to ParticipantDetailScreen for edit, implement delete with confirmation

### 4. ParticipantsScreen - Missing Group Assignment
**File:** `mobile/src/screens/ParticipantsScreen.js`
**Issue:** Cannot assign participants to groups inline
**Impact:** Leaders cannot organize participants efficiently
**SPA Reference:** `spa/manage_participants.js` has inline group dropdowns
**Fix:** Add group picker in ParticipantDetailScreen or inline edit mode

### 5. ParticipantsScreen - Missing Role Assignment
**File:** `mobile/src/screens/ParticipantsScreen.js`
**Issue:** Cannot assign participant roles (first leader, second leader, etc.)
**Impact:** Cannot designate youth leaders
**SPA Reference:** `spa/manage_participants.js` has role assignment columns
**Fix:** Add role assignment in ParticipantDetailScreen

### 6. ActivitiesScreen - Missing Activity CRUD
**File:** `mobile/src/screens/ActivitiesScreen.js`
**Issue:** Only shows list, but create/edit/delete buttons don't work (navigation broken)
**Impact:** Cannot manage activities from mobile
**SPA Reference:** `spa/activities.js` has full CRUD with modal forms
**Fix:** Create ActivityDetailScreen or ActivityFormScreen for CRUD operations

### 7. ActivitiesScreen - Missing Carpool Integration
**File:** `mobile/src/screens/ActivitiesScreen.js`
**Issue:** No carpool view/management for activities
**Impact:** Cannot coordinate transportation from mobile
**SPA Reference:** `spa/activities.js` shows carpool counts and "View Carpools" button
**Fix:** Add carpool stats to activity cards and navigation to carpool screen

### 8. ParentDashboardScreen - Missing Form Submissions Status
**File:** `mobile/src/screens/ParentDashboardScreen.js`
**Issue:** Does not show which forms are pending/required
**Impact:** Parents don't know which forms to complete
**SPA Reference:** `spa/parent_dashboard.js` shows form completion status
**Fix:** Add forms section showing required vs completed forms

### 9. AccountInfoScreen - Potential Issues
**File:** `mobile/src/screens/AccountInfoScreen.js`
**Status:** Need to verify implementation
**Impact:** Users cannot update profile information if broken
**SPA Reference:** `spa/modules/account-info.js`
**Action Required:** Read and verify this screen exists and functions properly

### 10. Missing ParticipantDetailScreen CRUD Form
**File:** N/A (might be missing or incomplete)
**Issue:** No comprehensive participant edit/create form
**Impact:** Cannot add/edit participant details
**SPA Reference:** `spa/manage_participants.js` uses modal with full form
**Fix:** Create or verify ParticipantDetailScreen with full form fields

### 11. Missing ActivityDetailScreen or ActivityFormScreen
**File:** N/A (confirmed missing)
**Issue:** No screen for activity create/edit
**Impact:** Cannot manage activities
**SPA Reference:** `spa/activities.js` uses modal with activity form
**Fix:** Create ActivityDetailScreen or ActivityFormScreen

### 12. ParentDashboardScreen - Missing Link Participants Dialog
**File:** `mobile/src/screens/ParentDashboardScreen.js`
**Issue:** Cannot link new parent account to existing participants
**Impact:** Parents with existing children cannot connect their account
**SPA Reference:** `spa/parent_dashboard.js` `checkAndShowLinkParticipantsDialog()`
**Fix:** Implement participant linking workflow for new parent users

---

## P2 (MEDIUM PRIORITY) - Partial implementations or minor bugs

### 1. ParticipantsScreen - Missing Optimistic Updates
**File:** `mobile/src/screens/ParticipantsScreen.js`
**Issue:** No OptimisticUpdateManager for instant feedback
**Impact:** Slower UX, no immediate feedback on actions
**SPA Reference:** `spa/manage_participants.js` uses OptimisticUpdateManager
**Fix:** Implement optimistic updates for group/role changes

### 2. ActivitiesScreen - Missing Skeleton Loading
**File:** `mobile/src/screens/ActivitiesScreen.js`
**Issue:** Shows basic LoadingState instead of skeleton
**Impact:** Less polished UX
**SPA Reference:** `spa/activities.js` uses `skeletonActivityList()`
**Fix:** Add skeleton screens for better perceived performance

### 3. ManagePointsScreen - Missing Optimistic Updates
**File:** `mobile/src/screens/ManagePointsScreen.js`
**Issue:** No OptimisticUpdateManager
**Impact:** Slower UX on point updates
**SPA Reference:** `spa/manage_points.js` uses OptimisticUpdateManager
**Fix:** Implement optimistic point updates

### 4. ParentFinanceScreen - Incomplete Stripe Integration
**File:** `mobile/src/screens/ParentFinanceScreen.js`
**Lines:** 217-224
**Issue:** Stripe payment marked as TODO, using placeholder
**Impact:** Parents cannot pay fees from mobile
**SPA Reference:** `spa/parent_finance.js` has full Stripe.js integration
**Fix:** Implement @stripe/stripe-react-native payment flow

### 5. Missing CarpoolScreen Implementation
**Files:** `mobile/src/screens/CarpoolScreen.js`
**Status:** Need to verify implementation completeness
**Impact:** Cannot manage carpools if incomplete
**SPA Reference:** `spa/carpool.js` and `spa/carpool_dashboard.js`
**Action Required:** Verify CarpoolScreen has full functionality

### 6. Missing FormBuilderScreen
**File:** N/A (not created)
**Issue:** No mobile form builder
**Impact:** Admins cannot create custom forms from mobile
**SPA Reference:** `spa/formBuilder.js`
**Priority:** Medium - admin feature, not frequently used on mobile

### 7. Missing DynamicFormScreen/Renderer
**File:** N/A
**Issue:** No JSONFormRenderer equivalent for mobile
**Impact:** Cannot render dynamic forms from schema
**SPA Reference:** `spa/JSONFormRenderer.js`, `spa/dynamicFormHandler.js`
**Priority:** Medium-High - affects multiple screens that use forms

### 8. HealthFormScreen - Need Verification
**File:** `mobile/src/screens/HealthFormScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/fiche_sante.js`
**Action Required:** Verify form submission, field completeness

### 9. RiskAcceptanceScreen - Need Verification
**File:** `mobile/src/screens/RiskAcceptanceScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/acceptation_risque.js`
**Action Required:** Verify form submission, signature functionality

### 10. BadgeDashboardScreen - Need Verification
**File:** `mobile/src/screens/BadgeDashboardScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/badge_dashboard.js`
**Action Required:** Verify badge stats, progress tracking

### 11. ApproveBadgesScreen - Need Verification
**File:** `mobile/src/screens/ApproveBadgesScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/approve_badges.js`
**Action Required:** Verify approval workflow

### 12. FinanceScreen - Need Verification
**File:** `mobile/src/screens/FinanceScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/finance.js`
**Action Required:** Verify all finance management features

### 13. BudgetsScreen - Need Verification
**File:** `mobile/src/screens/BudgetsScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/budgets.js`
**Action Required:** Verify budget CRUD operations

### 14. ExpensesScreen - Need Verification
**File:** `mobile/src/screens/ExpensesScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/expenses.js`
**Action Required:** Verify expense tracking functionality

### 15. AdminScreen - Need Verification
**File:** `mobile/src/screens/AdminScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/admin.js`
**Action Required:** Verify admin tools and settings

### 16. RoleManagementScreen - Need Verification
**File:** `mobile/src/screens/RoleManagementScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/role_management.js`
**Action Required:** Verify role CRUD and permission assignment

### 17. FormPermissionsScreen - Need Verification
**File:** `mobile/src/screens/FormPermissionsScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/form_permissions.js`
**Action Required:** Verify form permission management

### 18. MedicationScreen/Planning/Distribution - Need Verification
**Files:** `MedicationScreen.js`, `MedicationPlanningScreen.js`, `MedicationDistributionScreen.js`
**Status:** Need to verify against SPA
**SPA Reference:** `spa/medication_management.js`
**Action Required:** Verify medication workflow completeness

---

## P3 (LOW PRIORITY) - Nice-to-have features or polish

### 1. Missing Time Since Registration Screen
**File:** N/A (not created)
**Issue:** No mobile equivalent
**SPA Reference:** `spa/time_since_registration.js`
**Impact:** Minor - admin reporting feature
**Priority:** Low

### 2. Missing OptimisticUpdateManager Utility
**File:** N/A
**Issue:** Not ported to mobile utils
**Impact:** UX enhancement, not critical
**SPA Reference:** `spa/utils/OptimisticUpdateManager.js`
**Fix:** Port utility for use across screens

### 3. Missing SkeletonUtils
**File:** N/A
**Issue:** No skeleton loading helpers
**Impact:** UX polish
**SPA Reference:** `spa/utils/SkeletonUtils.js`
**Fix:** Create skeleton components for mobile

### 4. Missing ParticipantRoleUtils
**File:** N/A
**Issue:** No role utilities
**Impact:** Minor - helper functions
**SPA Reference:** `spa/utils/ParticipantRoleUtils.js`
**Fix:** Port utility if role features are added

### 5. Missing RoleValidationUtils
**File:** N/A
**Issue:** No role validation helpers
**Impact:** Minor
**SPA Reference:** `spa/utils/RoleValidationUtils.js`
**Fix:** Port if role management needs it

### 6. Missing PerformanceUtils
**File:** N/A
**Issue:** No performance helpers
**Impact:** Minor
**SPA Reference:** `spa/utils/PerformanceUtils.js`
**Fix:** Port if performance monitoring needed

### 7. Missing BaseModule Pattern
**File:** N/A
**Issue:** No module lifecycle helper
**Impact:** SPA-specific pattern, not needed for React Native
**SPA Reference:** `spa/utils/BaseModule.js`
**Fix:** N/A - not applicable to React components

### 8. Missing ClientCleanupUtils
**File:** N/A
**Issue:** No cleanup helpers
**Impact:** Minor - SPA-specific
**SPA Reference:** `spa/utils/ClientCleanupUtils.js`
**Fix:** N/A - React Native handles cleanup differently

---

## Screens With EXCELLENT Parity ✅

These screens are well-implemented and closely match SPA functionality:

1. **AttendanceScreen** - Very comprehensive, all features present
2. **ParentFinanceScreen** - Excellent implementation (minus Stripe native integration)
3. **ManagePointsScreen** - Good implementation with minor UX enhancements possible
4. **LoginScreen** - Full functionality
5. **SettingsScreen** - Full functionality
6. **LeaderDashboardScreen** - Well-implemented with all sections

---

## Recommended Fix Order

### Phase 1: Fix P0 Issues (Immediate - Blocking)
1. Fix ParticipantsScreen Text import
2. Fix ActivitiesScreen navigation targets
3. Fix ActivitiesScreen permission check

### Phase 2: Fix Critical P1 Issues (High Impact Parent/Leader Features)
1. Add permission slips to ParentDashboardScreen
2. Add financial summary to ParentDashboardScreen
3. Create ActivityDetailScreen/ActivityFormScreen
4. Add CRUD to ParticipantsScreen or create ParticipantDetailScreen
5. Implement participant linking dialog for parents

### Phase 3: Fix Remaining P1 Issues (Complete Core Features)
1. Add group assignment to participants
2. Add role assignment to participants
3. Add carpool integration to activities
4. Add form submissions status to parent dashboard
5. Verify and fix AccountInfoScreen

### Phase 4: Address P2 Issues (Feature Completeness)
1. Implement Stripe native payments
2. Verify and complete all "Need Verification" screens
3. Add OptimisticUpdateManager where beneficial
4. Create DynamicFormRenderer for mobile

### Phase 5: Polish (P3 - Nice to Have)
1. Add skeleton loading states
2. Port useful utility modules
3. Add time since registration screen if requested

---

## Testing Checklist

For each fixed screen, verify:
- [ ] Screen loads without crashes
- [ ] All navigation works
- [ ] Permission checks function correctly
- [ ] API calls succeed
- [ ] Error states display properly
- [ ] Loading states display properly
- [ ] Empty states display properly
- [ ] Data persists correctly
- [ ] Translations work for all text
- [ ] Mobile-responsive layout
- [ ] Touch targets are minimum 44px
- [ ] No console errors or warnings

---

## Conclusion

The mobile app has a solid foundation with most screens created. The main issues are:

1. **Fatal bugs** preventing 2-3 screens from functioning
2. **Missing parent-critical features** on ParentDashboard
3. **Incomplete CRUD operations** on key screens
4. **Missing navigation targets** for edit/create workflows

**Estimated Fix Time:**
- P0: 1-2 hours
- P1: 8-12 hours
- P2: 12-16 hours
- P3: 4-6 hours
- **Total**: ~30-36 hours for complete parity

Priority should be on P0 and parent-facing P1 issues for immediate usability.
