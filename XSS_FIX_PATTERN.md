# XSS Vulnerability Fix Pattern

## Problem
The codebase has 197 `innerHTML` usages across 61 files that create XSS vulnerabilities when user-controlled data is inserted without sanitization.

## Solution Pattern

### 1. Add Required Imports

At the top of each file, add:

```javascript
import { setContent, clearElement } from "./utils/DOMUtils.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
```

### 2. Replace `innerHTML` Assignments

**Pattern 1: Simple content setting**
```javascript
// BEFORE (UNSAFE)
document.getElementById("app").innerHTML = content;
container.innerHTML = htmlString;

// AFTER (SAFE)
setContent(document.getElementById("app"), content);
setContent(container, htmlString);
```

**Pattern 2: Clearing content**
```javascript
// BEFORE
container.innerHTML = '';

// AFTER
clearElement(container);
```

**Pattern 3: Escaping user data in template literals**
```javascript
// BEFORE (UNSAFE - user data directly in HTML)
const html = `<h1>${user.name}</h1>`;
const html = `<p>${participant.first_name} ${participant.last_name}</p>`;
const html = `<input value="${activity.name}">`;

// AFTER (SAFE - user data escaped)
const html = `<h1>${escapeHTML(user.name)}</h1>`;
const html = `<p>${escapeHTML(participant.first_name)} ${escapeHTML(participant.last_name)}</p>`;
const html = `<input value="${escapeHTML(activity.name)}">`;
```

**Pattern 4: Static content (icons, skeletons)**
These are lower risk but should still use safe methods:
```javascript
// BEFORE
icon.innerHTML = '✓';
container.innerHTML = skeletonLoader();

// AFTER
setContent(icon, '✓');
setContent(container, skeletonLoader());
```

## Files Already Fixed (Examples to Follow)

1. **spa/acceptation_risque.js** - Form with user data
2. **spa/activities.js** - Complex component with cards and modals
3. **spa/app.js** - Error handling and toast messages
4. **spa/router.js** - Error pages
5. **spa/login.js** - Login and 2FA forms
6. **spa/register.js** - Registration form
7. **spa/create_organization.js** - Organization creation
8. **spa/register_organization.js** - Organization registration
9. **spa/reset_password.js** - Password reset form

## Files Remaining to Fix

### Dashboard Files (3 files, 15 innerHTML)
- spa/dashboard.js (7 innerHTML)
- spa/parent_dashboard.js (6 innerHTML)
- spa/admin.js (12 innerHTML)

### Participant/User Management Files (5 files, ~15 innerHTML)
- spa/manage_participants.js (2 innerHTML)
- spa/manage_users_participants.js (2 innerHTML)
- spa/view_participant_documents.js (3 innerHTML)
- spa/parent_contact_list.js (3 innerHTML)
- spa/time_since_registration.js (4 innerHTML)

### Attendance/Activities Files (3 files, ~10 innerHTML)
- spa/attendance.js (7 innerHTML)
- spa/preparation_reunions.js (2 innerHTML)
- spa/upcoming_meeting.js (3 innerHTML)

### Badge and Honors Files (4 files, ~16 innerHTML)
- spa/badge_form.js (2 innerHTML)
- spa/badge_dashboard.js (6 innerHTML)
- spa/approve_badges.js (2 innerHTML)
- spa/manage_honors.js (4 innerHTML)

### Finance Files (7 files, ~20 innerHTML)
- spa/finance.js (7 innerHTML)
- spa/expenses.js (2 innerHTML)
- spa/budgets.js (3 innerHTML)
- spa/parent_finance.js (2 innerHTML)
- spa/revenue-dashboard.js (2 innerHTML)
- spa/external-revenue.js (2 innerHTML)
- spa/fundraisers.js (1 innerHTML)

### Form Files (3 files, ~15 innerHTML)
- spa/formBuilder.js (9 innerHTML)
- spa/dynamicFormHandler.js (1 innerHTML)
- spa/form_permissions.js (1 innerHTML)
- spa/formulaire_inscription.js (2 innerHTML)

### Report Files (2 files, ~8 innerHTML)
- spa/reports.js (6 innerHTML)
- spa/group-participant-report.js (2 innerHTML)

### Remaining Files (~20 files, ~50 innerHTML)
- spa/manage_points.js (6 innerHTML)
- spa/manage_groups.js (2 innerHTML)
- spa/role_management.js (9 innerHTML)
- spa/calendars.js (2 innerHTML)
- spa/carpool.js (1 innerHTML)
- spa/carpool_dashboard.js (5 innerHTML)
- spa/district_management.js (2 innerHTML)
- spa/fiche_sante.js (2 innerHTML)
- spa/inventory.js (1 innerHTML)
- spa/mailing_list.js (2 innerHTML)
- spa/material_management.js (2 innerHTML)
- spa/medication_management.js (8 innerHTML)
- spa/permission_slip_dashboard.js (3 innerHTML)
- spa/permission_slip_sign.js (5 innerHTML)
- spa/resource_dashboard.js (1 innerHTML)
- spa/activity-widget.js (1 innerHTML)
- spa/pwa-update-manager.js (2 innerHTML)
- spa/modules/ActivityManager.js (1 innerHTML)
- spa/modules/FormManager.js (4 innerHTML)
- spa/modules/account-info.js (2 innerHTML)
- spa/components/OfflineIndicator.js (1 innerHTML)
- spa/utils/SimpleWYSIWYG.js (6 innerHTML)

## Important Notes

1. **ALL user-controlled data must be escaped** - This includes:
   - Names (first_name, last_name, etc.)
   - Descriptions
   - Addresses, emails, phone numbers
   - Form field values
   - Any data from API responses
   - Error messages that might contain user input

2. **Translation strings are generally safe** - Calls like `translate("key")` don't need escaping

3. **Numbers and dates from calculations are generally safe** - But dates from user input should be escaped

4. **Always use `setContent()` instead of direct `innerHTML` assignment** - This ensures sanitization happens automatically

5. **Test after fixing** - Make sure the application still works correctly after applying fixes

## Testing Checklist

After fixing files:
- [ ] Application loads without errors
- [ ] All forms still work
- [ ] User data displays correctly
- [ ] No console errors
- [ ] Build completes successfully
