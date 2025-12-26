# Translation Key Mapping

This document maps the nested translation keys used in the mobile app to the flat keys in the main lang.json files.

## Background

The mobile app was initially using nested keys (e.g., `auth.loginTitle`) expecting a nested JSON structure, but the main lang.json files use flat keys with underscores (e.g., `login`, `account_info_email_label`).

This mapping ensures the mobile app uses the correct flat keys from the existing lang.json files.

## Key Mapping

### Auth Keys

| Mobile Key (Nested) | Lang.json Key (Flat) | English Value |
|---------------------|----------------------|---------------|
| `auth.loginTitle` | `login` | "Login" |
| `auth.email` | `email` | "Email" |
| `auth.password` | `password` | "Password" |
| `auth.login` | `login` | "Login" |
| `auth.createAccount` | `create_account` | "Create Account" |
| `auth.forgotPassword` | `forgot_password` | "Forgot Password?" |
| `auth.loginFailed` | `invalid_email_or_password` | "Invalid email or password" |
| `auth.twoFactorTitle` | `two_factor_email_heading` | "Wampums Verification Code" |
| `auth.enterCode` | `two_factor_message` | "We've sent a 6-digit verification code to your email..." |
| `auth.verificationCode` | `verification_code_sent` | "A verification code has been sent to your email." |
| `auth.trustDevice` | `trust_device` | "Trust this device" (NEW KEY NEEDED) |
| `auth.verify` | `verify` | "Verify" |
| `auth.backToLogin` | `back_to_login` | "Back to login" |
| `auth.invalidCode` | `invalid_verification_code` | "Invalid verification code" (NEW KEY NEEDED) |
| `auth.verificationFailed` | `verification_failed` | "Verification failed" (NEW KEY NEEDED) |

### Common Keys

| Mobile Key (Nested) | Lang.json Key (Flat) | English Value |
|---------------------|----------------------|---------------|
| `common.loading` | `loading` | "Loading..." |
| `common.save` | `save` | "Save" |
| `common.cancel` | `cancel` | "Cancel" |
| `common.ok` | `ok` | "OK" |
| `common.error` | `error` | "Error" |
| `common.success` | `success` | "Success" |
| `common.errorLoadingData` | `error_loading_data` | "Error loading data" |
| `common.years` | `years` | "years" |
| `common.notProvided` | `not_provided` | "Not provided" (NEW KEY NEEDED) |
| `common.offline` | `offline` | "Offline" |
| `common.viewingCachedData` | `viewing_cached_data` | "Viewing cached data" (NEW KEY NEEDED) |
| `common.comingSoon` | `coming_soon` | "Coming soon" (NEW KEY NEEDED) |
| `common.edit` | `edit` | "Edit" |
| `common.retry` | `retry` | "Retry" |
| `common.permissionDenied` | `permission_denied` | "Permission denied" (NEW KEY NEEDED) |
| `common.queued` | `queued` | "Queued" (NEW KEY NEEDED) |
| `common.willSyncWhenOnline` | `will_sync_when_online` | "Will sync when online" (NEW KEY NEEDED) |
| `common.viewAll` | `view_all` | "View all" (NEW KEY NEEDED) |
| `common.noLocation` | `no_location` | "No location" (NEW KEY NEEDED) |

### Dashboard Keys

| Mobile Key (Nested) | Lang.json Key (Flat) | English Value |
|---------------------|----------------------|---------------|
| `dashboard.welcomeLeader` | `welcome_leader` | "Welcome, Leader!" (NEW KEY NEEDED) |
| `dashboard.welcomeAdmin` | `welcome_admin` | "Welcome, Admin!" (NEW KEY NEEDED) |
| `dashboard.yourGroup` | `your_group` | "Your Group" (NEW KEY NEEDED) |
| `dashboard.overview` | `overview` | "Overview" |
| `dashboard.participants` | `participants` | "Participants" |
| `dashboard.upcomingActivities` | `upcoming_activities` | "Upcoming Activities" |
| `dashboard.groups` | `groups` | "Groups" |
| `dashboard.permissionSlips` | `permission_slips` | "Permission Slips" |
| `dashboard.quickActions` | `quick_actions` | "Quick Actions" |
| `dashboard.takeAttendance` | `take_attendance` | "Take Attendance" |
| `dashboard.createActivity` | `create_activity` | "Create Activity" |
| `dashboard.carpools` | `carpools` | "Carpools" |
| `dashboard.adminActions` | `dashboard_admin_section` | "District management" |
| `dashboard.errorLoading` | `error_loading_dashboard` | "Error loading dashboard" |
| `dashboard.recentActivities` | `recent_activities` | "Recent Activities" |
| `dashboard.noRecentActivities` | `no_recent_activities` | "No recent activities" (NEW KEY NEEDED) |
| `dashboard.noGroupsFound` | `no_groups_found` | "No groups found" (NEW KEY NEEDED) |
| `dashboard.registered` | `registered` | "Registered" |
| `dashboard.districtOverview` | `district_overview` | "District Overview" (NEW KEY NEEDED) |
| `dashboard.districtStatistics` | `district_statistics` | "District Statistics" (NEW KEY NEEDED) |
| `dashboard.totalParticipants` | `total_participants` | "Total Participants" (NEW KEY NEEDED) |
| `dashboard.totalGroups` | `total_groups` | "Total Groups" (NEW KEY NEEDED) |
| `dashboard.activeLeaders` | `active_leaders` | "Active Leaders" (NEW KEY NEEDED) |
| `dashboard.totalActivities` | `total_activities` | "Total Activities" (NEW KEY NEEDED) |
| `dashboard.revenue` | `revenue` | "Revenue" |
| `dashboard.reports` | `reports` | "Reports" |
| `dashboard.finance` | `finance` | "Finance" |
| `dashboard.manageGroups` | `manage_groups` | "Manage Groups" |
| `dashboard.settings` | `settings` | "Settings" |
| `dashboard.leaders` | `leaders` | "Leaders" |
| `dashboard.activityDetailComingSoon` | `activity_detail_coming_soon` | "Activity details coming soon" (NEW KEY NEEDED) |

### Participants Keys

| Mobile Key (Nested) | Lang.json Key (Flat) | English Value |
|---------------------|----------------------|---------------|
| `participants.age` | `age` | "Age" |
| `participants.group` | `group` | "Group" |
| `participants.searchPlaceholder` | `search_participants` | "Search participants" (NEW KEY NEEDED) |
| `participants.allGroups` | `all_groups` | "All Groups" |
| `participants.noParticipants` | `no_participants` | "No children registered" |
| `participants.errorLoading` | `error_loading_manage_participants` | "Error loading participant management" |
| `participants.firstName` | `first_name` | "First name" |
| `participants.lastName` | `last_name` | "Last name" |
| `participants.enterFirstName` | `enter_first_name` | "Enter first name" (NEW KEY NEEDED) |
| `participants.enterLastName` | `enter_last_name` | "Enter last name" (NEW KEY NEEDED) |
| `participants.birthdate` | `date_naissance` | "Date of birth" |
| `participants.email` | `email` | "Email" |
| `participants.phone` | `phone` | "Phone" |
| `participants.enterEmail` | `enter_email` | "Enter email" (NEW KEY NEEDED) |
| `participants.enterPhone` | `enter_phone` | "Enter phone" (NEW KEY NEEDED) |
| `participants.address` | `address` | "Address" |
| `participants.streetAddress` | `street_address` | "Street Address" |
| `participants.city` | `city` | "City" |
| `participants.province` | `province` | "Province" |
| `participants.postalCode` | `postal_code` | "Postal Code" |
| `participants.enterAddress` | `enter_address` | "Enter address" (NEW KEY NEEDED) |
| `participants.enterCity` | `enter_city` | "Enter city" (NEW KEY NEEDED) |
| `participants.enterProvince` | `enter_province` | "Enter province" (NEW KEY NEEDED) |
| `participants.enterPostalCode` | `enter_postal_code` | "Enter postal code" (NEW KEY NEEDED) |
| `participants.basicInformation` | `basic_information` | "Basic Information" |
| `participants.healthInformation` | `health_information` | "Health Information" |
| `participants.guardianContacts` | `guardian_contacts` | "Guardian Contacts" |
| `participants.badgeProgress` | `badge_progress` | "Badge Progress" |
| `participants.financialStatus` | `financial_status` | "Financial Status" |
| `participants.errorFirstNameRequired` | `first_name_required` | "First name is required" (NEW KEY NEEDED) |
| `participants.errorLastNameRequired` | `last_name_required` | "Last name is required" (NEW KEY NEEDED) |
| `participants.errorInvalidEmail` | `account_info_email_invalid` | "Please enter a valid email address" |
| `participants.errorInvalidBirthdate` | `invalid_birthdate` | "Invalid birthdate" (NEW KEY NEEDED) |
| `participants.savedSuccessfully` | `data_saved` | "Saved successfully" |
| `participants.errorSaving` | `error_saving_participant` | "Error saving participant" |
| `participants.noEditPermission` | `no_edit_permission` | "You don't have permission to edit" (NEW KEY NEEDED) |
| `participants.yearsOld` | `years_old` | "years old" (NEW KEY NEEDED) |

### Settings Keys

| Mobile Key (Nested) | Lang.json Key (Flat) | English Value |
|---------------------|----------------------|---------------|
| `settings.profile` | `profile` | "Profile" |
| `settings.language` | `language` | "Language" |
| `settings.languageChanged` | `language_changed` | "Language changed" (NEW KEY NEEDED) |
| `settings.restartRequired` | `restart_required` | "App restart required" (NEW KEY NEEDED) |
| `settings.confirmLogout` | `confirm_logout` | "Confirm Logout" (NEW KEY NEEDED) |
| `settings.confirmLogoutMessage` | `confirm_logout_message` | "Are you sure you want to logout?" (NEW KEY NEEDED) |
| `settings.logout` | `logout` | "Logout" |
| `settings.notifications` | `notifications` | "Notifications" |
| `settings.pushNotifications` | `push_notifications` | "Push Notifications" |
| `settings.pushNotificationsHelp` | `push_notifications_help` | "Receive notifications about activities" (NEW KEY NEEDED) |
| `settings.appInfo` | `app_info` | "App Info" |
| `settings.version` | `version` | "Version" |
| `settings.build` | `build` | "Build" |
| `settings.madeWith` | `made_with` | "Made with" (NEW KEY NEEDED) |
| `settings.forScouts` | `for_scouts` | "for Scouts" (NEW KEY NEEDED) |

### Navigation Keys

| Mobile Key (Nested) | Lang.json Key (Flat) | English Value |
|---------------------|----------------------|---------------|
| `nav.dashboard` | `dashboard_title` | "Dashboard" |
| `nav.participants` | `participants` | "Participants" |
| `nav.activities` | `activities` | "Activities" |
| `nav.finance` | `finance` | "Finance" |
| `nav.settings` | `settings` | "Settings" |

### Activities Keys

| Mobile Key (Nested) | Lang.json Key (Flat) | English Value |
|---------------------|----------------------|---------------|
| `activities.upcoming` | `upcoming` | "Upcoming" |
| `activities.past` | `past` | "Past" |
| `activities.all` | `all` | "All" |
| `activities.today` | `today` | "Today" |
| `activities.participants` | `participants` | "Participants" |
| `activities.noActivities` | `no_activities` | "No activities" (NEW KEY NEEDED) |

### Parent Dashboard Keys

| Mobile Key (Nested) | Lang.json Key (Flat) | English Value |
|---------------------|----------------------|---------------|
| `parentDashboard.title` | `parent_dashboard` | "Parent Dashboard" (NEW KEY NEEDED) |
| `parentDashboard.myChildren` | `my_children` | "My Children" |
| `parentDashboard.noChildren` | `no_participants` | "No children registered" |
| `parentDashboard.age` | `age` | "Age" |
| `parentDashboard.group` | `group` | "Group" |
| `parentDashboard.upcomingActivities` | `upcoming_activities` | "Upcoming Activities" |
| `parentDashboard.noActivities` | `no_upcoming_activities` | "No upcoming activities" (NEW KEY NEEDED) |
| `parentDashboard.carpoolAssignments` | `carpool_assignments` | "Carpool Assignments" (NEW KEY NEEDED) |
| `parentDashboard.driver` | `driver` | "Driver" |
| `parentDashboard.spots` | `spots` | "Spots" |
| `parentDashboard.quickActions` | `quick_actions` | "Quick Actions" |
| `parentDashboard.viewFees` | `view_fees` | "View Fees" (NEW KEY NEEDED) |
| `parentDashboard.permissionSlips` | `permission_slips` | "Permission Slips" |

## Notes

- Keys marked with "(NEW KEY NEEDED)" indicate that the key doesn't currently exist in lang.json and needs to be added
- For keys that exist, the mobile app code will be updated to use the flat key format
- For new keys, we'll add them to both en.json and fr.json files

## Migration Strategy

1. Update all mobile screen files to use flat keys directly
2. No changes needed to the lang.json files themselves (except adding missing keys if desired)
3. The i18n system will work with flat keys without modification since it's using i18n-js which supports both nested and flat structures
