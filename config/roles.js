/**
 * Client-side role bundle catalog.
 *
 * Defines default metadata for each role bundle used by the SPA, including the
 * permissions each bundle is expected to grant, descriptive labels, and
 * eligibility for cross-organization scenarios (e.g., local group inventory
 * sharing).
 *
 * The server remains the source of truth for role-to-permission mappings; this
 * catalog mirrors those expectations so the UI can render safeguards and
 * validation hints without extra round-trips.
 */
const SHARED_ADMIN_PERMISSIONS = [
  "users.view",
  "users.edit",
  "users.delete",
  "users.assign_roles",
  "users.invite",
  "roles.view",
  "groups.view",
  "groups.create",
  "groups.edit",
  "groups.delete",
  "participants.view",
  "participants.edit",
  "participants.create",
  "participants.delete",
  "participants.transfer",
  "activities.view",
  "activities.create",
  "activities.edit",
  "activities.delete",
  "attendance.view",
  "attendance.manage",
  "finance.view",
  "finance.manage",
  "budget.view",
  "budget.manage",
  "fundraisers.view",
  "fundraisers.create",
  "fundraisers.edit",
  "fundraisers.delete",
  "communications.send",
  "reports.view",
  "inventory.view",
  "inventory.manage",
  "inventory.reserve",
  "inventory.value",
  "carpools.view",
  "carpools.manage",
  "points.manage",
  "points.view",
  "badges.view",
  "badges.approve",
  "badges.manage",
  "forms.view",
  "forms.create",
  "forms.edit",
  "forms.manage",
];

const DISTRICT_PERMISSIONS = [
  ...SHARED_ADMIN_PERMISSIONS,
  "roles.manage",
  "users.assign_district",
  "org.create",
  "org.edit",
  "org.view",
];

export const ROLE_BUNDLES = {
  district: {
    displayName: "District Admin",
    description:
      "Full administrative control across the organization with the ability to manage staff, data, and advanced settings.",
    permissions: DISTRICT_PERMISSIONS,
    level: 3,
    scope: "organization",
    conflictsWith: ["demoadmin", "demoparent"],
    tags: ["admin", "full_access"],
  },
  unitadmin: {
    displayName: "Unit Admin",
    description:
      "Organization administrator with broad access to members, activities, finances, and communications.",
    permissions: SHARED_ADMIN_PERMISSIONS,
    level: 2,
    scope: "organization",
    conflictsWith: ["demoadmin", "demoparent"],
    tags: ["admin"],
  },
  leader: {
    displayName: "Leader",
    description:
      "Program leader with permissions to manage participants, attendance, activities, and group logistics.",
    permissions: [
      "participants.view",
      "participants.edit",
      "participants.create",
      "participants.transfer",
      "activities.view",
      "activities.create",
      "activities.edit",
      "attendance.view",
      "attendance.manage",
      "groups.view",
      "communications.send",
      "reports.view",
      "badges.view",
      "permission_slips.sign",
    ],
    level: 1,
    scope: "organization",
    conflictsWith: ["demoadmin", "demoparent"],
    tags: ["program"],
  },
  finance: {
    displayName: "Finance",
    description:
      "Financial manager with access to budgets, fundraisers, payments, and inventory valuations.",
    permissions: [
      "finance.view",
      "finance.manage",
      "budget.view",
      "budget.manage",
      "fundraisers.view",
      "fundraisers.create",
      "fundraisers.edit",
      "fundraisers.delete",
      "reports.view",
      "inventory.value",
    ],
    level: 1,
    scope: "organization",
    conflictsWith: ["demoadmin", "demoparent"],
    tags: ["finance"],
  },
  equipment: {
    displayName: "Equipment",
    description:
      "Inventory steward with authority to manage and reserve equipment, including local group sharing.",
    permissions: [
      "inventory.view",
      "inventory.manage",
      "inventory.reserve",
      "inventory.value",
    ],
    level: 1,
    scope: "organization",
    crossOrgEligibleFor: ["local_group"],
    conflictsWith: ["demoadmin", "demoparent"],
    tags: ["inventory"],
    featureFlags: ["inventory_sharing"],
  },
  administration: {
    displayName: "Administration",
    description:
      "Administrative reporter with access to organization-wide reports and communications tools.",
    permissions: ["reports.view", "communications.send", "participants.view"],
    level: 1,
    scope: "organization",
    conflictsWith: ["demoadmin", "demoparent"],
    tags: ["reports"],
  },
  parent: {
    displayName: "Parent",
    description:
      "Guardian-level access scoped to linked participants and household communications.",
    permissions: ["participants.view", "permission_slips.sign"],
    level: 0,
    scope: "self",
    conflictsWith: ["demoparent"],
    tags: ["family"],
  },
  demoadmin: {
    displayName: "Demo Admin",
    description:
      "Read-only administrative access for demonstrations; cannot perform write actions.",
    permissions: ["reports.view", "users.view", "participants.view"],
    level: 2,
    scope: "organization",
    conflictsWith: ["district", "unitadmin", "leader", "finance", "equipment", "administration", "parent"],
    tags: ["demo"],
  },
  demoparent: {
    displayName: "Demo Parent",
    description:
      "Read-only parent experience for demonstrations without the ability to modify records.",
    permissions: ["participants.view"],
    level: 0,
    scope: "self",
    conflictsWith: ["district", "unitadmin", "leader", "finance", "equipment", "administration", "parent"],
    tags: ["demo", "family"],
  },
};

/**
 * Default role level lookup used as a fallback when no level is defined.
 */
export const ROLE_LEVELS = Object.entries(ROLE_BUNDLES).reduce((acc, [role, config]) => {
  acc[role] = typeof config.level === "number" ? config.level : 0;
  return acc;
}, {});

/**
 * Default scope applied when bundles omit explicit scope metadata.
 */
export const DEFAULT_ROLE_SCOPE = "organization";
