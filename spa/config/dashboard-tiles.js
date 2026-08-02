/**
 * Dashboard Tiles — single source of truth.
 *
 * Every dashboard tile is declared exactly once, here. `spa/dashboard.js`
 * consumes this list; nothing else may redeclare tiles.
 *
 * Naming rules for `label` (see devdocs/REFONTE_TABLEAU_DE_BORD.md):
 *   - the tile names the TASK ("Faire les présences"), not the screen
 *     ("Présence") — hence the dedicated `tile_*` translation namespace,
 *     which leaves the generic keys free for page titles and table headers;
 *   - no two tiles in a group start with the same word;
 *   - the tile label matches the <h1> of the page it opens.
 *
 * Tile shape:
 *   href      route to open
 *   icon      Font Awesome class
 *   label     translation key (always `tile_*`)
 *   aliases   optional translation key holding comma-separated search
 *             synonyms for the command palette. Only set it when the key
 *             really exists in both lang files — `translate()` echoes back
 *             unknown keys, which would pollute search results.
 *   moment    "now" | "week" | "tools" — which slot on the dashboard
 *   domain    grouping + color; must be one of DOMAINS
 *   priority  optional ordering inside a moment bucket (lower wins)
 *   gate      optional visibility rule, resolved by dashboard.js:
 *               { permission: "x.view" }      hasPermission
 *               { any: ["a.view", "b.view"] } hasAnyPermission
 *               { check: "adminPanel" }       named PermissionUtils helper
 *   id        optional DOM id, for tiles with extra click behaviour
 */

export const DASHBOARD_TILES = [
  // ---------------------------------------------------------------
  // EN CE MOMENT — actions tied to a meeting happening right now.
  // Attendance leads: you mark who is here before awarding anything.
  // ---------------------------------------------------------------
  {
    featureKey: "attendance",
    href: "/attendance",
    icon: "fa-clipboard-check",
    label: "tile_attendance",
    aliases: "tile_attendance_aliases",
    moment: "now",
    domain: "attendance",
    priority: 0,
    gate: { any: ["attendance.view", "attendance.manage"] },
  },
  {
    featureKey: "points",
    href: "/managePoints",
    icon: "fa-coins",
    label: "tile_manage_points",
    aliases: "tile_manage_points_aliases",
    moment: "now",
    domain: "attendance",
    priority: 1,
    gate: { any: ["points.view", "points.manage"] },
  },
  {
    featureKey: "honors",
    href: "/manageHonors",
    icon: "fa-award",
    label: "tile_manage_honors",
    aliases: "tile_manage_honors_aliases",
    moment: "now",
    domain: "attendance",
    priority: 2,
    gate: { any: ["honors.view", "honors.create", "honors.manage"] },
  },
  {
    featureKey: "meetings",
    // Merged destination: "Prochaine réunion" + "Préparer la réunion".
    href: "/reunions",
    icon: "fa-calendar-day",
    label: "tile_meetings",
    aliases: "tile_meetings_aliases",
    moment: "now",
    domain: "attendance",
    priority: 3,
    gate: { any: ["meetings.view", "meetings.manage"] },
  },

  // ---------------------------------------------------------------
  // CETTE SEMAINE — what has to be ready before the next outing.
  // ---------------------------------------------------------------
  {
    featureKey: "permission_slips",
    href: "/permission-slips",
    icon: "fa-file-signature",
    label: "tile_permission_slips",
    aliases: "tile_permission_slips_aliases",
    moment: "week",
    domain: "safety",
  },
  {
    featureKey: "carpool",
    href: "/carpool",
    icon: "fa-car",
    label: "tile_carpool",
    aliases: "tile_carpool_aliases",
    moment: "week",
    domain: "logistics",
    id: "carpool-quick-access",
  },
  {
    featureKey: "activities",
    href: "/activities",
    icon: "fa-calendar-days",
    label: "tile_activities",
    aliases: "tile_activities_aliases",
    moment: "week",
    domain: "logistics",
    gate: { any: ["activities.view", "activities.create"] },
  },
  {
    featureKey: "yearly_planner",
    href: "/yearly-planner",
    icon: "fa-calendar-alt",
    label: "tile_yearly_planner",
    aliases: "tile_yearly_planner_aliases",
    moment: "week",
    domain: "logistics",
    gate: { any: ["meetings.view", "meetings.manage"] },
  },

  // ---------------------------------------------------------------
  // JEUNES ET FAMILLES — includes reaching out to them, which is why
  // the former standalone "Communications" group folds in here.
  // ---------------------------------------------------------------
  {
    featureKey: "parent_contacts",
    href: "/parent-contact-list",
    icon: "fa-address-book",
    label: "tile_parent_contact_list",
    aliases: "tile_parent_contact_list_aliases",
    moment: "tools",
    domain: "people",
  },
  {
    featureKey: "participants",
    href: "/manage-participants",
    icon: "fa-id-card",
    label: "tile_manage_participants",
    aliases: "tile_manage_participants_aliases",
    moment: "tools",
    domain: "people",
    gate: { permission: "participants.view" },
  },
  {
    featureKey: "groups",
    href: "/manage-groups",
    icon: "fa-people-group",
    label: "tile_manage_groups",
    aliases: "tile_manage_groups_aliases",
    moment: "tools",
    domain: "people",
    gate: { permission: "groups.view" },
  },
  {
    featureKey: "family_links",
    href: "/manage-users-participants",
    icon: "fa-user-gear",
    label: "tile_link_youth_parents",
    aliases: "tile_link_youth_parents_aliases",
    moment: "tools",
    domain: "people",
    gate: { permission: "users.view" },
  },
  {
    featureKey: "participant_documents",
    href: "/view-participant-documents",
    icon: "fa-file-lines",
    label: "tile_participant_documents",
    aliases: "tile_participant_documents_aliases",
    moment: "tools",
    domain: "people",
  },
  {
    featureKey: "den_report",
    href: "/group-participant-report",
    icon: "fa-table-list",
    label: "tile_den_list_report",
    aliases: "tile_den_list_report_aliases",
    moment: "tools",
    domain: "people",
    gate: { any: ["reports.view", "reports.export"] },
  },
  {
    featureKey: "progression",
    // Merged destination: "Suivre les badges" + "Étapes du programme".
    // Was its own "Progression" group until that merge left it with a single
    // tile — an accordion around one item is worse than no accordion.
    href: "/progression",
    icon: "fa-chart-bar",
    label: "tile_progression",
    aliases: "tile_progression_aliases",
    moment: "tools",
    domain: "people",
  },
  {
    featureKey: "parent_preview",
    href: "/parent-dashboard",
    icon: "fa-users",
    label: "tile_parent_preview",
    aliases: "tile_parent_preview_aliases",
    moment: "tools",
    domain: "people",
  },
  {
    featureKey: "mailing_list",
    href: "/mailing-list",
    icon: "fa-comments",
    label: "tile_mailing_list",
    aliases: "tile_mailing_list_aliases",
    moment: "tools",
    domain: "people",
    gate: { permission: "communications.send" },
  },

  // ---------------------------------------------------------------
  // SANTÉ ET SÉCURITÉ
  // ---------------------------------------------------------------
  {
    featureKey: "medication_planning",
    href: "/medication-planning",
    icon: "fa-pills",
    label: "tile_medication_planning",
    aliases: "tile_medication_planning_aliases",
    moment: "tools",
    domain: "safety",
  },
  {
    featureKey: "medication_dispensing",
    href: "/medication-dispensing",
    icon: "fa-pills",
    label: "tile_medication_dispensing",
    aliases: "tile_medication_dispensing_aliases",
    moment: "tools",
    domain: "safety",
  },
  {
    featureKey: "medication_reception",
    href: "/medication-reception",
    icon: "fa-hospital",
    label: "tile_medication_reception",
    aliases: "tile_medication_reception_aliases",
    moment: "tools",
    domain: "safety",
  },
  {
    featureKey: "incident_reports",
    href: "/incident-reports/new",
    icon: "fa-triangle-exclamation",
    label: "tile_report_incident",
    aliases: "tile_report_incident_aliases",
    moment: "tools",
    domain: "safety",
    gate: { permission: "incidents.manage" },
  },

  // ---------------------------------------------------------------
  // MATÉRIEL ET LOGISTIQUE — the catalogue and the bookings sit
  // together; splitting them was what made "Inventaire" vs "Gestion
  // du matériel" impossible to tell apart.
  // ---------------------------------------------------------------
  {
    featureKey: "inventory",
    href: "/inventory",
    icon: "fa-warehouse",
    label: "tile_inventory",
    aliases: "tile_inventory_aliases",
    moment: "tools",
    domain: "logistics",
  },
  {
    featureKey: "material_management",
    href: "/material-management",
    icon: "fa-calendar-check",
    label: "tile_material_management",
    aliases: "tile_material_management_aliases",
    moment: "tools",
    domain: "logistics",
  },

  // ---------------------------------------------------------------
  // ARGENT — the three `?tab=` duplicates of /finance are gone; the
  // page renders those tabs itself (spa/finance.js:293).
  // ---------------------------------------------------------------
  {
    featureKey: "finance",
    href: "/finance",
    icon: "fa-coins",
    label: "tile_finance_payments",
    aliases: "tile_finance_payments_aliases",
    moment: "tools",
    domain: "money",
    gate: { permission: "finance.view" },
  },
  {
    featureKey: "expenses",
    href: "/expenses",
    icon: "fa-wallet",
    label: "tile_expenses",
    aliases: "tile_expenses_aliases",
    moment: "tools",
    domain: "money",
    gate: { any: ["finance.manage", "finance.view"] },
  },
  {
    featureKey: "external_revenue",
    href: "/external-revenue",
    icon: "fa-hand-holding-dollar",
    label: "tile_external_revenue",
    aliases: "tile_external_revenue_aliases",
    moment: "tools",
    domain: "money",
    gate: { any: ["finance.manage", "finance.view"] },
  },
  {
    featureKey: "fundraisers",
    href: "/fundraisers",
    icon: "fa-hand-holding-heart",
    label: "tile_fundraisers",
    aliases: "tile_fundraisers_aliases",
    moment: "tools",
    domain: "money",
    gate: { permission: "fundraisers.view" },
  },
  {
    featureKey: "revenue_dashboard",
    href: "/revenue-dashboard",
    icon: "fa-chart-column",
    label: "tile_revenue_dashboard",
    aliases: "tile_revenue_dashboard_aliases",
    moment: "tools",
    domain: "money",
    gate: { any: ["finance.view", "fundraisers.view"] },
  },
  {
    featureKey: "budgets",
    href: "/budgets",
    icon: "fa-sack-dollar",
    label: "tile_budgets",
    aliases: "tile_budgets_aliases",
    moment: "tools",
    domain: "money",
    gate: { permission: "budget.view" },
  },

  // ---------------------------------------------------------------
  // ADMINISTRATION — unit settings first, district/system last.
  // ---------------------------------------------------------------
  {
    featureKey: "reports",
    href: "/reports",
    icon: "fa-chart-line",
    label: "tile_reports",
    aliases: "tile_reports_aliases",
    moment: "tools",
    domain: "admin",
    priority: 10,
    gate: { any: ["reports.view", "reports.export"] },
  },
  {
    href: "/unit-settings",
    icon: "fa-sliders",
    label: "tile_unit_settings",
    aliases: "tile_unit_settings_aliases",
    moment: "tools",
    domain: "admin",
    priority: 11,
    gate: { check: "adminPanel" },
  },
  {
    featureKey: "account_info",
    href: "/account-info",
    icon: "fa-circle-user",
    label: "tile_account_info",
    aliases: "tile_account_info_aliases",
    moment: "tools",
    domain: "admin",
    priority: 12,
  },
  {
    featureKey: "role_management",
    href: "/role-management",
    icon: "fa-user-tag",
    label: "tile_role_management",
    aliases: "tile_role_management_aliases",
    moment: "tools",
    domain: "admin",
    priority: 20,
    gate: { permission: "roles.view" },
  },
  {
    featureKey: "form_permissions",
    href: "/form-permissions",
    icon: "fa-clipboard-check",
    label: "tile_form_permissions",
    aliases: "tile_form_permissions_aliases",
    moment: "tools",
    domain: "admin",
    priority: 21,
    gate: { check: "manageForms" },
  },
  {
    featureKey: "district",
    // Merged destination: "Espace district" + "Unités du district".
    href: "/district",
    icon: "fa-sitemap",
    label: "tile_district",
    aliases: "tile_district_aliases",
    moment: "tools",
    domain: "admin",
    priority: 30,
    gate: { check: "adminPanel" },
    id: "admin-link",
  },
  {
    featureKey: "create_organization",
    href: "/create-organization",
    icon: "fa-building",
    label: "tile_create_organization",
    aliases: "tile_create_organization_aliases",
    moment: "tools",
    domain: "admin",
    priority: 32,
    gate: { check: "createOrganization" },
  },
];

/**
 * Order of the collapsible groups inside the "Tout le reste" section.
 * Domains absent from this list still render, appended at the end, so an
 * unlisted domain can never make a tile disappear.
 */
export const TOOL_GROUP_ORDER = [
  "people",
  "safety",
  "logistics",
  "money",
  "admin",
];

/**
 * Groups collapsed the first time a user opens the dashboard. Once they
 * expand or collapse anything the stored preference wins for good.
 */
export const DEFAULT_COLLAPSED_TOOL_GROUPS = ["logistics", "money", "admin"];

/**
 * Routes usable while offline, i.e. whose modules are pre-loaded during camp
 * mode preparation. Tiles pointing anywhere else are hidden when offline.
 */
export const OFFLINE_AVAILABLE_ROUTES = new Set([
  "/managePoints",
  "/manageHonors",
  "/attendance",
  "/upcoming-meeting",
  "/reunions",
  "/badge-tracker",
  "/badge-dashboard",
  "/program-progress",
  "/progression",
  "/activities",
  "/medication-dispensing",
  "/medication-planning",
  "/medication-reception",
  "/carpool",
  "/manage-participants",
  "/manage-groups",
  "/prepare-offline",
]);

/**
 * Tiles shown in the finance-focused workspace, alongside the money tiles.
 */
export const FINANCE_WORKSPACE_EXTRA_TILES = [
  {
    href: "/parent-dashboard",
    icon: "fa-users",
    label: "tile_parent_preview",
    domain: "people",
    parentOnly: true,
  },
  {
    href: "/account-info",
    icon: "fa-circle-user",
    label: "tile_account_info",
    domain: "admin",
  },
];

/**
 * Look up a tile's layout context by route.
 *
 * @param {string} href - Tile route.
 * @returns {{moment: string, domain: string, priority?: number}} Layout context.
 */
export function getTileContext(href) {
  const tile = DASHBOARD_TILES.find((t) => t.href === href);
  if (!tile) return { moment: "tools", domain: "neutral" };
  return { moment: tile.moment, domain: tile.domain, priority: tile.priority };
}
