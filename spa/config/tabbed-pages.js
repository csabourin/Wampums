/**
 * Tabbed page definitions.
 *
 * Each entry merges what used to be several dashboard tiles pointing at
 * separate pages into one destination with tabs. The dashboard then shows one
 * tile per *task area* instead of one per screen.
 *
 * Tabs are declared, never hand-rolled: `spa/modules/TabbedPage.js` renders the
 * shell, syncs `?tab=` with the URL, and mounts each tab's module into its
 * panel. Modules must follow the `spa/utils/PageMount.js` contract.
 *
 * Shape:
 *   path        canonical route
 *   titleKey    translation key for the <h1>
 *   defaultTab  tab key used when the URL says nothing
 *   tabs[]      { key, labelKey, load, options?, gate? }
 *     key       value used in `?tab=`
 *     labelKey  translation key for the tab button
 *     load      lazy import returning the page class
 *     options   extra constructor options for that module
 *     gate      optional () => boolean visibility test
 */

import {
  hasPermission,
  hasAnyPermission,
  canAccessAdminPanel,
} from '../utils/PermissionUtils.js';

export const TABBED_PAGES = {
  progression: {
    path: '/progression',
    titleKey: 'page_progression_title',
    defaultTab: 'badges',
    tabs: [
      {
        key: 'badges',
        labelKey: 'tab_progression_badges',
        // The route itself admits anyone who can see participants, so this tab
        // needs its own gate: without it a participants-only user lands on the
        // tracker's "not authorized" panel instead of the Programme tab.
        gate: () => hasAnyPermission('badges.view', 'badges.approve', 'badges.manage'),
        load: () => import('../modules/badges/BadgeTracker.js').then((m) => m.BadgeTracker),
      },
      {
        key: 'programme',
        labelKey: 'tab_progression_program',
        load: () =>
          import('../modules/program-progress/ProgramProgressDashboard.js').then(
            (m) => m.ProgramProgressDashboard,
          ),
      },
    ],
  },

  reunions: {
    path: '/reunions',
    titleKey: 'page_meetings_title',
    defaultTab: 'prochaine',
    tabs: [
      {
        key: 'prochaine',
        labelKey: 'tab_meetings_next',
        load: () => import('../modules/meetings/UpcomingMeeting.js').then((m) => m.UpcomingMeeting),
      },
      {
        key: 'preparation',
        labelKey: 'tab_meetings_prepare',
        gate: () => hasAnyPermission('meetings.view', 'meetings.manage'),
        load: () =>
          import('../modules/meetings/MeetingPrep.js').then((m) => m.MeetingPrep),
      },
    ],
  },

  district: {
    path: '/district',
    titleKey: 'page_district_title',
    defaultTab: 'unites',
    tabs: [
      {
        key: 'unites',
        labelKey: 'tab_district_units',
        gate: () => hasPermission('roles.view'),
        load: () =>
          import('../modules/district/DistrictManagement.js').then((m) => m.DistrictManagement),
      },
      {
        key: 'roles',
        labelKey: 'tab_district_roles',
        gate: () => hasPermission('roles.manage_district') && hasPermission('roles.manage'),
        options: { district: true },
        load: () => import('../modules/roles/RolePermissionMatrix.js').then((m) => m.RolePermissionMatrix),
      },
      {
        key: 'outils',
        labelKey: 'tab_district_tools',
        gate: () => canAccessAdminPanel(),
        load: () => import('../modules/admin/Admin.js').then((m) => m.Admin),
      },
    ],
  },

  // Who holds which role, what each role may do, and who may use each form.
  // Each tab keeps the permission its endpoints require.
  roles: {
    path: '/roles',
    titleKey: 'page_roles_title',
    defaultTab: 'attribution',
    tabs: [
      {
        key: 'attribution',
        labelKey: 'tab_roles_assign',
        // Listing the members takes users.view; changing their roles, users.assign_roles.
        gate: () => hasPermission('users.assign_roles') && hasPermission('users.view'),
        options: { view: 'users' },
        load: () => import('../modules/roles/RoleManagement.js').then((m) => m.RoleManagement),
      },
      {
        key: 'permissions',
        labelKey: 'tab_roles_permissions',
        gate: () => hasAnyPermission('roles.view', 'roles.manage'),
        options: { view: 'roles' },
        // Someone who may change roles edits the matrix (and hides the built-in
        // roles the unit replaced); anyone else reads the catalog.
        load: () => (hasPermission('roles.manage')
          ? import('../modules/roles/RolePermissionMatrix.js').then((m) => m.RolePermissionMatrix)
          : import('../modules/roles/RoleManagement.js').then((m) => m.RoleManagement)),
      },
      {
        key: 'formulaires',
        labelKey: 'tab_roles_forms',
        gate: () => canAccessAdminPanel() && hasPermission('forms.manage'),
        load: () => import('../modules/forms/FormPermissions.js').then((m) => m.FormPermissionsManager),
      },
    ],
  },
};

/**
 * Whether the person can see at least one tab of a tabbed page: the guard of
 * its route and of the dashboard tile that opens it.
 *
 * @param {string} key - Key into TABBED_PAGES
 * @returns {boolean}
 */
export function hasVisibleTab(key) {
  return (TABBED_PAGES[key]?.tabs || []).some((tab) => !tab.gate || tab.gate());
}

/**
 * Legacy routes kept working: each redirects to its tab inside the merged page,
 * so bookmarks, the service worker's cached URLs and any link we missed all
 * still land somewhere sensible.
 *
 * `/preparation-reunions/:date` is deliberately absent — it is a deep link to
 * one specific meeting and stays a standalone page.
 */
export const MERGED_ROUTE_REDIRECTS = {
  '/badge-tracker': '/progression?tab=badges',
  // Former standalone badge pages; the Badges tab covers both.
  '/badge-dashboard': '/progression?tab=badges',
  '/approve-badges': '/progression?tab=badges',
  '/program-progress': '/progression?tab=programme',
  '/upcoming-meeting': '/reunions?tab=prochaine',
  '/preparation-reunions': '/reunions?tab=preparation',
  '/district-management': '/district?tab=unites',
  '/admin': '/district?tab=outils',
  '/role-management': '/roles?tab=attribution',
  '/roles/permissions': '/roles?tab=permissions',
  '/form-permissions': '/roles?tab=formulaires',
  // Families and leaders are invited from one screen, choosing the role.
  '/parent-invitations': '/invitations',
  '/leader-invitations': '/invitations',
};
