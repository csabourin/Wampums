/**
 * Dashboard Tiles Configuration
 * Centralized definition of all dashboard tiles, organized by section.
 * Each tile includes: href, icon, label (translation key), optional permission check, optional id
 */

export const DASHBOARD_TILES = {
  // Top row (fixed order, not sorted)
  top: [
    { href: "/managePoints", icon: "fa-coins", label: "manage_points" },
    { href: "/manageHonors", icon: "fa-award", label: "manage_honors" },
    { href: "/attendance", icon: "fa-clipboard-check", label: "attendance" },
    { href: "/upcoming-meeting", icon: "fa-calendar-day", label: "upcoming_meeting" },
  ],

  // Day-to-Day (sorted alphabetically)
  dayToDay: [
    { href: "/badge-tracker", icon: "fa-chart-bar", label: "badge_tracker_title" },
    { href: "/program-progress", icon: "fa-timeline", label: "program_progress_nav" },
    { href: "/parent-contact-list", icon: "fa-address-book", label: "parent_contact_list" },
    { href: "/medication-dispensing", icon: "fa-pills", label: "medication_dispensing_link" },
    { href: "/parent-dashboard", icon: "fa-users", label: "vue_parents" },
  ],

  // Planning & Activities (sorted alphabetically)
  planning: [
    { href: "/activities", icon: "fa-calendar-days", label: "activities_calendar" },
    {
      href: "/carpool",
      icon: "fa-car",
      label: "carpool_coordination",
      id: "carpool-quick-access",
    },
    { href: "/preparation-reunions", icon: "fa-clipboard-list", label: "preparation_reunions" },
    { href: "/yearly-planner", icon: "fa-calendar-alt", label: "yearly_planner_nav" },
    { href: "/view-participant-documents", icon: "fa-file-lines", label: "view_participant_documents" },
    { href: "/inventory", icon: "fa-warehouse", label: "inventory_link" },
    { href: "/material-management", icon: "fa-calendar-check", label: "material_management_link" },
    { href: "/medication-planning", icon: "fa-pills", label: "medication_planning_link" },
    { href: "/permission-slips", icon: "fa-file-signature", label: "manage_permission_slips" },
  ],

  // Unit Management (sorted alphabetically, permission-gated)
  unitManagement: [
    { href: "/manage-participants", icon: "fa-id-card", label: "manage_names", permission: "participants.view" },
    { href: "/manage-groups", icon: "fa-people-group", label: "manage_groups", permission: "groups.view" },
    { href: "/manage-users-participants", icon: "fa-user-gear", label: "manage_users_participants", permission: "users.view" },
    { href: "/reports", icon: "fa-chart-line", label: "reports", permission: "reports.view" },
    { href: "/group-participant-report", icon: "fa-table-list", label: "feuille_participants", permission: "reports.view" },
  ],

  // District & System Management (sorted alphabetically, permission-gated)
  districtSystem: [
    { href: "/role-management", icon: "fa-user-tag", label: "role_management", permission: "roles.view" },
    { href: "/district-management", icon: "fa-sitemap", label: "district_management_title", permission: "roles.view" },
    { href: "/form-permissions", icon: "fa-clipboard-check", label: "form_permissions", permission: "forms.manage" },
    { href: "/create-organization", icon: "fa-building", label: "create_unit", permission: "organizations.create" },
    { href: "/admin", icon: "fa-user-shield", label: "administration", permission: "admin.access", id: "admin-link" },
  ],

  // Finance & Fundraising (sorted alphabetically, permission-gated)
  finance: [
    { href: "/finance", icon: "fa-coins", label: "finance_memberships_tab", permission: "finance.view" },
    { href: "/finance?tab=definitions", icon: "fa-file-invoice-dollar", label: "finance_definitions_tab", permission: "finance.view" },
    { href: "/finance?tab=reports", icon: "fa-chart-pie", label: "financial_report", permission: "finance.view" },
    { href: "/expenses", icon: "fa-wallet", label: "expense_tracking", permission: "finance.manage" },
    { href: "/external-revenue", icon: "fa-hand-holding-dollar", label: "external_revenue", permission: "finance.manage" },
    { href: "/revenue-dashboard", icon: "fa-chart-column", label: "revenue_dashboard", permission: "finance.view" },
    { href: "/fundraisers", icon: "fa-hand-holding-heart", label: "fundraisers", permission: "fundraisers.view" },
    { href: "/budgets", icon: "fa-sack-dollar", label: "budget_management", permission: "budget.view" },
  ],

  // News & Communications (sorted alphabetically, permission-gated)
  newsComms: [
    { href: "/communications", icon: "fa-comments", label: "communications_title", permission: "communications.send" },
    { href: "/mailing-list", icon: "fa-envelope-open-text", label: "mailing_list", permission: "communications.send" },
  ],
};

/**
 * Map section keys to translation keys for headings
 */
export const SECTION_HEADINGS = {
  dayToDay: "dashboard_day_to_day_section",
  planning: "dashboard_planning_section",
  unitManagement: "dashboard_unit_management_section",
  districtSystem: "dashboard_district_system_section",
  finance: "dashboard_finance_section",
  newsComms: "dashboard_news_communications_section",
};

/**
 * Order of sections as they appear on the dashboard
 */
export const SECTION_ORDER = [
  "dayToDay",
  "planning",
  "unitManagement",
  "districtSystem",
  "finance",
  "newsComms",
];
