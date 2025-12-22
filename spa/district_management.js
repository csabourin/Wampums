import {
  CONFIG,
  clearUserCaches,
  getCurrentOrganizationId,
  getRoleCatalog,
  getRolePermissions,
  getUserOrganizations,
  getUsers,
  updateUserRolesV1,
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { getCachedData, setCachedData } from "./indexedDB.js";
import { debounce } from "./utils/PerformanceUtils.js";
import { debugError } from "./utils/DebugUtils.js";
import { canAssignRoles, canViewRoles } from "./utils/PermissionUtils.js";
import {
  escapeHTML,
  sanitizeHTML,
  sanitizeURL,
} from "./utils/SecurityUtils.js";
import {
  buildRoleBundleIndex,
  calculatePermissionGaps,
  detectRoleConflicts,
  getLocalGroupEligibleRoles,
} from "./utils/RoleValidationUtils.js";
import { setStorageMultiple } from "./utils/StorageUtils.js";

const CACHE_KEY = "district_management_state";
const CACHE_DURATION = CONFIG.CACHE_DURATION.SHORT;
const ADMIN_ROLES = ["district", "unitadmin", "demoadmin"];
const HIGH_RISK_ROLES = ["district", "unitadmin"];
const ROLE_LEVELS = {
  district: 3,
  unitadmin: 2,
  demoadmin: 2,
  leader: 1,
  finance: 1,
  equipment: 1,
  administration: 1,
  parent: 0,
  demoparent: 0,
};
const INCIDENT_REPORT_URL = "mailto:security@wampums.app?subject=Role%20change%20review";

/**
 * DistrictManagement view
 * Renders district-level role administration with mobile-first UX,
 * offline awareness, and optimistic role assignment.
 */
export class DistrictManagement {
  constructor(app) {
    this.app = app;
    this.users = [];
    this.roles = [];
    this.filteredUsers = [];
    this.searchTerm = "";
    this.activeRoleFilters = new Set();
    this.selectedUserId = null;
    this.selectedRoleIds = new Set();
    this.auditNote = "";
    this.lastSyncedAt = null;
    this.queuedChanges = [];
    this.isOffline = !navigator.onLine;
    this.syncing = false;
    this.userMeta = {};
    this.mfaAcknowledged = false;
    this.organizationId = getCurrentOrganizationId();
    this.organizations = [];
    this.rolePermissions = {};
    this.roleBundleIndex = { list: [], byId: new Map(), byName: new Map() };
    this.debouncedSearch = debounce((event) => {
      this.searchTerm = event.target.value || "";
      this.renderAndBind();
    }, 250);
  }

  /**
   * Initialize the view and hydrate cached data.
   */
  async init() {
    if (!canViewRoles()) {
      this.renderAccessDenied();
      return;
    }

    await this.hydrateFromCache();
    await this.fetchOrganizations();
    this.renderAndBind();
    this.setupOfflineListeners();
    await this.refreshData();
  }

  /**
   * Load cached state for instant rendering while waiting on network.
   */
  async hydrateFromCache() {
    try {
      const cached = await getCachedData(CACHE_KEY);
      if (cached) {
        this.users = cached.users || [];
        this.roles = cached.roles || [];
        this.rolePermissions = cached.rolePermissions || {};
        this.organizationId = cached.organizationId || this.organizationId;
        this.organizations = cached.organizations || this.organizations;
        this.roleBundleIndex = buildRoleBundleIndex(this.roles, this.rolePermissions);
        this.filteredUsers = this.getFilteredUsers();
        this.lastSyncedAt = cached.lastSyncedAt || null;
        this.queuedChanges = cached.queuedChanges || [];
        this.userMeta = cached.userMeta || {};
      }
    } catch (error) {
      debugError("district_management: failed to hydrate cache", error);
    }
  }

  /**
   * Persist view state to IndexedDB for offline reuse.
   */
  async persistCache() {
    try {
      await setCachedData(
        CACHE_KEY,
        {
          users: this.users,
          roles: this.roles,
          rolePermissions: this.rolePermissions,
          lastSyncedAt: this.lastSyncedAt,
          queuedChanges: this.queuedChanges,
          userMeta: this.userMeta,
          organizationId: this.organizationId,
          organizations: this.organizations,
        },
        CACHE_DURATION,
      );
    } catch (error) {
      debugError("district_management: failed to persist cache", error);
    }
  }

  async fetchOrganizations(forceRefresh = false) {
    try {
      const response = await getUserOrganizations({ forceRefresh });
      if (response?.success) {
        this.organizations = response.data || response.organizations || [];
        if (!this.organizationId && this.organizations.length > 0) {
          this.organizationId = this.organizations[0].id;
        }
      }
    } catch (error) {
      debugError("district_management: failed to load organizations", error);
    }
  }

  setupOfflineListeners() {
    window.addEventListener("offlineStatusChanged", (event) => {
      this.isOffline = event.detail?.isOffline ?? !navigator.onLine;
      this.renderAndBind();
    });

    window.addEventListener("online", () => {
      this.isOffline = false;
      this.renderAndBind();
    });

    window.addEventListener("offline", () => {
      this.isOffline = true;
      this.renderAndBind();
    });
  }

  /**
   * Fetch users and roles with caching and offline fallback.
   * @param {boolean} forceRefresh - When true, bypass caches.
   */
  async refreshData(forceRefresh = false) {
    this.syncing = true;
    this.renderSyncBadge();

    try {
      let organizationId = this.organizationId || getCurrentOrganizationId();
      if (!this.organizations.length) {
        await this.fetchOrganizations(forceRefresh);
      }
      if (!organizationId && this.organizations.length) {
        const fallbackOrg = this.organizations[0];
        organizationId = fallbackOrg?.id || fallbackOrg?.organization_id;
        this.organizationId = organizationId;
      }
      if (!organizationId) {
        this.app.showMessage("district_management_load_error", "error");
        return;
      }

      const [roleResponse, usersResponse] = await Promise.all([
        getRoleCatalog({ forceRefresh, organizationId }),
        getUsers(organizationId, { forceRefresh }),
      ]);

      if (roleResponse?.success) {
        const roleCatalog = roleResponse.data || [];
        await this.hydrateRoleBundles(roleCatalog, forceRefresh);
      }

      if (usersResponse?.success) {
        this.users = this.normalizeUsers(usersResponse.users || usersResponse.data || []);
        this.filteredUsers = this.getFilteredUsers();
        this.lastSyncedAt = Date.now();
        this.userMeta = this.buildUserMeta();
      }

      await this.persistCache();
      this.renderAndBind();
    } catch (error) {
      debugError("district_management: failed to refresh data", error);
      this.app.showMessage("district_management_load_error", "error");
    } finally {
      this.syncing = false;
      this.renderSyncBadge();
    }
  }

  async hydrateRoleBundles(roleCatalog = [], forceRefresh = false) {
    this.rolePermissions = await this.fetchRolePermissionsForCatalog(roleCatalog, forceRefresh);
    this.roleBundleIndex = buildRoleBundleIndex(roleCatalog, this.rolePermissions);
    this.roles = this.roleBundleIndex.list;
  }

  async fetchRolePermissionsForCatalog(roleCatalog = [], forceRefresh = false) {
    const permissions = {};

    await Promise.all(
      roleCatalog.map(async (role) => {
        try {
          const response = await getRolePermissions(role.id, {
            organizationId: this.organizationId,
            forceRefresh,
          });
          permissions[role.id] =
            (response?.data || []).map((permission) => permission.permission_key) || [];
        } catch (error) {
          debugError("district_management: failed to hydrate permissions", error);
          permissions[role.id] = role.permissions || [];
        }
      }),
    );

    return permissions;
  }

  /**
   * Normalize incoming users to ensure consistent structure.
   * @param {Array} users
   * @returns {Array}
   */
  normalizeUsers(users = []) {
    const roleLookup = new Map(this.roles.map((role) => [role.id, role]));

    return users.map((user) => {
      const parsedRoleIds = this.parseRoleIds(user.role_ids);
      const resolvedRoles =
        Array.isArray(user.roles) && user.roles.length
          ? user.roles
          : parsedRoleIds
              .map((id) => roleLookup.get(id))
              .filter(Boolean)
              .map((role) => ({
                ...role,
                display_name: role.display_name || role.role_name,
              }));

      return {
        ...user,
        roles: resolvedRoles,
        role_ids: parsedRoleIds,
      };
    });
  }

  parseRoleIds(roleIds) {
    if (!roleIds) return [];
    if (Array.isArray(roleIds)) {
      return roleIds
        .map((value) => parseInt(value, 10))
        .filter((value) => Number.isFinite(value));
    }
    if (typeof roleIds === "string") {
      try {
        const parsed = JSON.parse(roleIds);
        if (Array.isArray(parsed)) {
          return parsed
            .map((value) => parseInt(value, 10))
            .filter((value) => Number.isFinite(value));
        }
        return [];
      } catch (error) {
        debugError("district_management: unable to parse role_ids", error);
        return [];
      }
    }
    return [];
  }

  buildUserMeta() {
    const now = Date.now();
    return this.users.reduce((acc, user) => {
      acc[user.id] = {
        lastSyncedAt: now,
        roleCount: user.roles?.length || 0,
      };
      return acc;
    }, {});
  }

  renderAccessDenied() {
    const content = `
      <section class="district-management" aria-labelledby="district-management-title">
        <h1 id="district-management-title">${translate("access_denied")}</h1>
        <p>${translate("no_permission_role_management") || translate("no_permission")}</p>
        <a class="btn btn--primary" href="/dashboard">${translate("back_to_dashboard")}</a>
      </section>
    `;
    document.getElementById("app").innerHTML = content;
  }

  renderAndBind() {
    this.render();
    this.attachEventListeners();
  }

  async handleOrganizationChange(newOrgId) {
    if (!newOrgId || String(newOrgId) === String(this.organizationId || "")) {
      return;
    }

    this.organizationId = newOrgId;
    this.selectedUserId = null;
    this.selectedRoleIds = new Set();

    setStorageMultiple({
      currentOrganizationId: newOrgId,
      organizationId: newOrgId,
    });

    await clearUserCaches(newOrgId);
    await this.refreshData(true);
  }

  render() {
    const lastSyncedLabel = this.formatTimestamp(this.lastSyncedAt);
    const queuedCount = this.queuedChanges.length;
    const queuedLabel = `${translate("district_management_queued_label")} (${queuedCount})`;
    const offlineBanner = this.isOffline
      ? `<div class="dm-offline-banner" role="status" aria-live="polite">
            <span aria-hidden="true">📡</span>
            <span>${translate("district_management_offline_banner")}</span>
         </div>`
      : "";
    const organizationSelector = this.renderOrganizationSelector();

    const queuedBadge =
      queuedCount > 0
        ? `<div class="dm-queued" role="status">
            <span class="chip chip--primary">${escapeHTML(queuedLabel)}</span>
            <button id="dm-retry" class="btn btn--secondary" ${this.isOffline ? "disabled" : ""}>
              ${translate("district_management_retry_sync")}
            </button>
          </div>`
        : "";

    const actionBar = `
      <div class="dm-action-bar" role="region" aria-label="${translate("district_management_actions")}">
        <div class="dm-action-bar__left">
          <button id="dm-refresh" class="ghost-button" aria-label="${translate("district_management_refresh")}">
            🔄 ${translate("district_management_refresh")}
          </button>
          <div class="dm-sync" id="dm-sync-status" aria-live="polite">
            ${translate("district_management_last_synced")}: <strong>${escapeHTML(lastSyncedLabel)}</strong>
          </div>
        </div>
        <div class="dm-action-bar__right">
          <button id="dm-bottom-retry" class="btn btn--secondary" ${this.isOffline ? "disabled" : ""}>
            ${translate("district_management_retry_sync")}
          </button>
        </div>
      </div>
    `;

    const content = `
      <section class="district-management" aria-labelledby="district-management-title">
        <header class="dm-header">
          <div>
            <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
            <h1 id="district-management-title">${translate("district_management_title")}</h1>
            <p class="dm-subtitle">${translate("district_management_subtitle")}</p>
          </div>
          ${offlineBanner}
        </header>

        <div class="dm-controls">
          <div class="dm-search">
            <label class="sr-only" for="dm-search-input">${translate("district_management_search_label")}</label>
            <input
              id="dm-search-input"
              type="search"
              inputmode="search"
              autocomplete="off"
              aria-label="${translate("district_management_search_label")}"
              placeholder="${translate("district_management_search_placeholder")}"
              value="${escapeHTML(this.searchTerm)}"
            />
          </div>
          <div class="dm-filters" role="listbox" aria-label="${translate("district_management_filter_label")}">
            ${this.renderRoleFilters()}
          </div>
        </div>
        ${organizationSelector}

        ${queuedBadge}

        <div class="dm-user-list" id="dm-user-list">
          ${this.renderUserCards()}
        </div>
      </section>
      ${actionBar}
      ${this.renderAssignmentModal()}
    `;

    document.getElementById("app").innerHTML = content;
  }

  getActiveOrganizationName() {
    const currentId = String(this.organizationId || getCurrentOrganizationId() || "");
    const organization = this.organizations.find(
      (org) => String(org.id) === currentId || String(org.organization_id) === currentId,
    );
    return organization?.name || organization?.organization_name || currentId || "";
  }

  renderOrganizationSelector() {
    if (!this.organizations.length) return "";
    const currentId = String(this.organizationId || getCurrentOrganizationId() || "");
    const hasMultiple = this.organizations.length > 1;
    const options = this.organizations
      .map((org) => {
        const orgId = String(org.id || org.organization_id);
        const name = escapeHTML(org.name || org.organization_name || orgId);
        const isSelected = orgId === currentId;
        return `<option value="${escapeHTML(orgId)}" ${isSelected ? "selected" : ""}>${name}</option>`;
      })
      .join("");

    const label = translate("district_management_org_scope_label");
    const helper = translate("district_management_org_scope_help");
    const activeName = escapeHTML(this.getActiveOrganizationName());

    const selector = hasMultiple
      ? `<label class="dm-section-title" for="dm-org-select">${label}</label>
         <select id="dm-org-select" aria-label="${label}">${options}</select>`
      : `<p class="dm-section-title">${label}</p><p class="dm-helper">${activeName}</p>`;

    return `
      <div class="dm-org-context" role="group" aria-label="${label}">
        ${selector}
        <p class="dm-helper">${helper}</p>
      </div>
    `;
  }

  renderRoleFilters() {
    const chips = this.roles.map((role) => {
      const roleName = escapeHTML(role.display_name || role.role_name);
      const isActive = this.activeRoleFilters.has(role.role_name);
      return `
        <button class="chip ${isActive ? "chip--primary" : ""}" data-role-filter="${escapeHTML(role.role_name)}" aria-pressed="${isActive}">
          ${roleName}
        </button>
      `;
    });

    const clearFilter = `
      <button class="chip" data-role-filter="__clear" aria-pressed="${this.activeRoleFilters.size === 0}">
        ${translate("district_management_clear_filters")}
      </button>
    `;

    return clearFilter + chips.join("");
  }

  renderUserCards() {
    if (!this.filteredUsers.length) {
      return `<p class="muted-text">${translate("district_management_no_results")}</p>`;
    }

    return this.filteredUsers
      .map((user) => {
        const roles = this.getUserRoles(user);
        const roleBadges =
          roles.length > 0
            ? roles
                .map(
                  (role) => `
                    <span class="chip dm-role-chip" role="listitem">
                      ${escapeHTML(role.display_name || role.role_name)}
                    </span>
                  `,
                )
                .join("")
            : `<span class="chip">${translate("no_roles_assigned")}</span>`;

        const queued = this.queuedChanges.find((item) => item.userId === user.id);
        const queuedLabel = queued
          ? `<span class="status-pill status-pill--pending">${translate("district_management_pending_sync")}</span>`
          : "";

        return `
          <button class="dm-user-card" data-user-id="${user.id}" aria-label="${escapeHTML(user.full_name || user.email)}">
            <div class="dm-card-header">
              <div>
                <p class="dm-user-name">${escapeHTML(user.full_name || user.email)}</p>
                <p class="dm-user-email">${escapeHTML(user.email || "")}</p>
              </div>
              ${queuedLabel}
            </div>
            <div class="dm-role-stack" role="list" aria-label="${translate("district_management_assigned_roles")}">
              ${roleBadges}
            </div>
          </button>
        `;
      })
      .join("");
  }

  renderAssignmentModal() {
    if (!this.selectedUserId) return "";
    const user = this.users.find((u) => u.id === this.selectedUserId);
    if (!user) return "";

    const bundles = this.getRoleBundles();
    const mfaRequired = this.isHighRiskChange(user);
    const incidentUrl = sanitizeURL(INCIDENT_REPORT_URL);
    const validationState = this.getValidationState(user);

    const bundleList = bundles
      .map((bundle) => {
        const isChecked = this.selectedRoleIds.has(bundle.id);
        const localGroupBadge = (bundle.crossOrgEligibleFor || []).includes("local_group")
          ? `<span class="chip dm-bundle-chip">${translate("district_management_local_group_badge")}</span>`
          : "";
        return `
          <label class="dm-bundle" data-role-name="${escapeHTML(bundle.role_name)}">
            <div class="dm-bundle-header">
              <input
                type="checkbox"
                class="dm-bundle-checkbox"
                data-role-id="${bundle.id}"
                data-role-name="${escapeHTML(bundle.role_name)}"
                ${isChecked ? "checked" : ""}
                ${this.isBlockedByRoleLevel(bundle.role_name) ? "disabled" : ""}
              />
              <div>
                <p class="dm-bundle-title">${escapeHTML(bundle.display_name)}</p>
                <p class="dm-bundle-meta">${escapeHTML(bundle.role_name)} ${localGroupBadge}</p>
              </div>
            </div>
            <p class="dm-bundle-description">
              ${sanitizeHTML(bundle.description || translate("district_management_generic_bundle_description"), {
                stripAll: true,
              })}
            </p>
          </label>
        `;
      })
      .join("");

    const blockingMessage = validationState.blocking;
    const saveDisabled = Boolean(blockingMessage) || this.isOffline || (mfaRequired && !this.mfaAcknowledged);
    const warningContent =
      validationState.warnings && validationState.warnings.length
        ? `<div class="dm-warning" role="status" aria-live="polite">
            ${validationState.warnings.map((warning) => `<p class="dm-helper">${escapeHTML(warning)}</p>`).join("")}
          </div>`
        : "";

    return `
      <div class="modal-overlay show" role="dialog" aria-modal="true" aria-labelledby="dm-modal-title">
        <div class="modal-content dm-modal">
          <header class="dm-modal-header">
            <div>
              <p class="dm-modal-kicker">${translate("district_management_assignment_for")}</p>
              <h2 id="dm-modal-title">${escapeHTML(user.full_name || user.email)}</h2>
              <p class="dm-modal-subtitle">${translate("district_management_role_instruction")}</p>
            </div>
            <button id="dm-close" class="ghost-button" aria-label="${translate("close")}">✕</button>
          </header>

          <div class="dm-modal-body">
            <div class="dm-modal-section">
              <p class="dm-section-title">${translate("district_management_bundles_title")}</p>
              <div class="dm-bundle-list">${bundleList}</div>
            </div>

            <div class="dm-modal-section">
              <label for="dm-audit-note" class="dm-section-title">
                ${translate("district_management_audit_label")}
                <span class="dm-optional">${translate("optional")}</span>
              </label>
              <textarea id="dm-audit-note" rows="3" placeholder="${translate("district_management_audit_placeholder")}">${escapeHTML(this.auditNote)}</textarea>
              <p class="dm-helper">${translate("district_management_audit_helper")}</p>
            </div>

            ${mfaRequired ? `
              <div class="dm-modal-section dm-high-risk" role="alert">
                <p class="dm-section-title">${translate("district_management_mfa_title")}</p>
                <p>${translate("district_management_mfa_placeholder")}</p>
                <div class="dm-mfa-actions">
                  <button id="dm-mfa-start" class="btn btn--secondary">${translate("district_management_trigger_mfa")}</button>
                  ${incidentUrl ? `<a class="text-link" href="${incidentUrl}" target="_blank" rel="noopener noreferrer">${translate("district_management_incident_link")}</a>` : ""}
                </div>
                <label class="dm-checkbox">
                  <input type="checkbox" id="dm-mfa-confirm" ${this.mfaAcknowledged ? "checked" : ""}/>
                  <span>${translate("district_management_mfa_confirm")}</span>
                </label>
              </div>
            ` : ""}

            ${warningContent}
            ${blockingMessage ? `<p class="error-text" role="alert">${escapeHTML(blockingMessage)}</p>` : ""}
          </div>

          <div class="dm-modal-actions">
            <button id="dm-queue" class="btn btn--secondary">
              ${translate("district_management_queue_change")}
            </button>
            <button id="dm-save" class="btn btn--primary" ${saveDisabled ? "disabled" : ""}>
              ${this.isOffline ? translate("district_management_offline_disabled") : translate("district_management_save")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    const searchInput = document.getElementById("dm-search-input");
    if (searchInput) {
      searchInput.removeEventListener("input", this.debouncedSearch);
      searchInput.addEventListener("input", this.debouncedSearch);
    }

    const organizationSelect = document.getElementById("dm-org-select");
    if (organizationSelect) {
      organizationSelect.addEventListener("change", async (event) => {
        const newOrgId = event.target.value;
        await this.handleOrganizationChange(newOrgId);
      });
    }

    document.querySelectorAll("[data-role-filter]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const role = chip.getAttribute("data-role-filter");
        if (role === "__clear") {
          this.activeRoleFilters.clear();
        } else if (this.activeRoleFilters.has(role)) {
          this.activeRoleFilters.delete(role);
        } else {
          this.activeRoleFilters.add(role);
        }
        this.filteredUsers = this.getFilteredUsers();
        this.renderAndBind();
      });
    });

    document.querySelectorAll(".dm-user-card").forEach((card) => {
      card.addEventListener("click", () => {
        const userId = parseInt(card.getAttribute("data-user-id"), 10);
        this.openModal(userId);
      });
    });

    const refreshButton = document.getElementById("dm-refresh");
    refreshButton?.addEventListener("click", () => this.refreshData(true));

    const bottomRetry = document.getElementById("dm-bottom-retry");
    bottomRetry?.addEventListener("click", () => this.retryQueuedChanges());

    const retryButton = document.getElementById("dm-retry");
    retryButton?.addEventListener("click", () => this.retryQueuedChanges());

    const closeButton = document.getElementById("dm-close");
    closeButton?.addEventListener("click", () => this.closeModal());

    document.querySelectorAll(".dm-bundle-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", (event) => {
        const roleId = parseInt(event.target.getAttribute("data-role-id"), 10);
        if (event.target.checked) {
          this.selectedRoleIds.add(roleId);
        } else {
          this.selectedRoleIds.delete(roleId);
        }
        this.renderAndBind();
      });
    });

    const saveButton = document.getElementById("dm-save");
    saveButton?.addEventListener("click", () => this.handleSaveRoles());

    const queueButton = document.getElementById("dm-queue");
    queueButton?.addEventListener("click", () => this.queuePendingChange());

    const auditInput = document.getElementById("dm-audit-note");
    if (auditInput) {
      auditInput.addEventListener("input", (event) => {
        this.auditNote = event.target.value || "";
      });
    }

    const mfaCheckbox = document.getElementById("dm-mfa-confirm");
    mfaCheckbox?.addEventListener("change", (event) => {
      this.mfaAcknowledged = event.target.checked;
      this.renderAndBind();
    });

    const mfaButton = document.getElementById("dm-mfa-start");
    mfaButton?.addEventListener("click", () => {
      this.app.showMessage("district_management_mfa_placeholder", "info");
    });
  }

  renderSyncBadge() {
    const node = document.getElementById("dm-sync-status");
    if (!node) return;
    node.textContent = this.syncing
      ? translate("district_management_refreshing")
      : `${translate("district_management_last_synced")}: ${this.formatTimestamp(this.lastSyncedAt)}`;
  }

  formatTimestamp(timestamp) {
    if (!timestamp) return translate("district_management_not_synced");
    const lang = this.app?.lang || "en";
    return new Date(timestamp).toLocaleString(lang, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  getFilteredUsers() {
    const term = this.searchTerm.trim().toLowerCase();
    return this.users.filter((user) => {
      const matchesSearch =
        !term ||
        (user.full_name || "").toLowerCase().includes(term) ||
        (user.email || "").toLowerCase().includes(term);

      const matchesFilter =
        this.activeRoleFilters.size === 0 ||
        (Array.isArray(user.roles) &&
          user.roles.some((role) => this.activeRoleFilters.has(role.role_name)));

      return matchesSearch && matchesFilter;
    });
  }

  getUserRoles(user) {
    if (!Array.isArray(user.roles) || !user.roles.length) return [];
    return user.roles.map((role) => ({
      ...role,
      display_name: role.display_name || role.role_name,
    }));
  }

  getRoleById(roleId) {
    return this.roleBundleIndex.byId.get(roleId);
  }

  getRoleByName(roleName) {
    return this.roleBundleIndex.byName.get(roleName);
  }

  getSelectedRoleNames() {
    return Array.from(this.selectedRoleIds)
      .map((id) => this.getRoleById(id)?.role_name)
      .filter(Boolean);
  }

  openModal(userId) {
    this.selectedUserId = userId;
    const user = this.users.find((u) => u.id === userId);
    const roleIds = (user?.roles || []).map((role) => role.id || role.role_id || role.role_name);
    this.selectedRoleIds = new Set(roleIds);
    this.auditNote = "";
    this.mfaAcknowledged = false;
    this.renderAndBind();
  }

  closeModal() {
    this.selectedUserId = null;
    this.selectedRoleIds = new Set();
    this.auditNote = "";
    this.mfaAcknowledged = false;
    this.renderAndBind();
  }

  getRoleBundles() {
    return this.roleBundleIndex.list.map((role) => ({
      ...role,
      display_name: role.display_name || role.role_name,
      description:
        role.description ||
        translate(`district_management_bundle_${role.role_name}`) ||
        translate("district_management_generic_bundle_description"),
    }));
  }

  isBlockedByRoleLevel(roleName) {
    const bundle = this.getRoleByName(roleName);
    const targetLevel = bundle?.level ?? ROLE_LEVELS[roleName] ?? 0;
    return targetLevel > this.getCurrentUserLevel();
  }

  getCurrentUserLevel() {
    const roles = this.app?.userRoles || [];
    const levels = roles.map((role) => {
      const bundle = this.getRoleByName(role);
      return bundle?.level ?? ROLE_LEVELS[role] ?? 0;
    });
    return levels.length ? Math.max(...levels) : 0;
  }

  getBlockingMessage(user) {
    const hasAdminRole = (user.roles || []).some((role) => ADMIN_ROLES.includes(role.role_name));
    const selectedHasAdmin = Array.from(this.selectedRoleIds).some((id) => {
      const role = this.getRoleById(id);
      return role && ADMIN_ROLES.includes(role.role_name);
    });

    if (hasAdminRole && !selectedHasAdmin) {
      return translate("district_management_admin_safeguard");
    }

    const selectedHighLevel = Array.from(this.selectedRoleIds).some((id) => {
      const role = this.getRoleById(id);
      return role && this.isBlockedByRoleLevel(role.role_name);
    });

    if (selectedHighLevel) {
      return translate("district_management_level_block");
    }

    return "";
  }

  getValidationState(user) {
    const baseBlocking = this.getBlockingMessage(user);
    if (baseBlocking) {
      return { blocking: baseBlocking, warnings: [] };
    }

    const selectedRoleNames = this.getSelectedRoleNames();
    const conflictResult = detectRoleConflicts(selectedRoleNames, this.roleBundleIndex);
    if (conflictResult.hasConflict) {
      const messageTemplate =
        translate("district_management_conflict_roles") ||
        "The selected roles cannot be combined: {roles}";
      return {
        blocking: messageTemplate.replace("{roles}", conflictResult.conflicts.join(", ")),
        warnings: [],
      };
    }

    const permissionGaps = calculatePermissionGaps(
      selectedRoleNames,
      this.roleBundleIndex,
      this.app?.userPermissions || [],
    );

    if (permissionGaps.missing.length) {
      const template =
        translate("district_management_permission_gap") ||
        "You cannot assign roles that include permissions you do not have: {permissions}";
      const missingList = permissionGaps.missing.join(", ");
      return { blocking: template.replace("{permissions}", missingList), warnings: [] };
    }

    const warnings = [];
    const localGroupRoles = getLocalGroupEligibleRoles(selectedRoleNames, this.roleBundleIndex);
    if (localGroupRoles.length) {
      const template =
        translate("district_management_local_group_notice") ||
        "Inventory bundles can extend to organizations within your local group.";
      const bundleLabels = localGroupRoles
        .map((roleName) => this.getRoleByName(roleName)?.display_name || roleName)
        .filter(Boolean)
        .join(", ");
      warnings.push(bundleLabels ? `${template} (${bundleLabels})` : template);
    }

    return { blocking: "", warnings };
  }

  /**
   * Determine if the current selection modifies high-risk roles,
   * which triggers MFA confirmation and incident guidance.
   */
  isHighRiskChange(user) {
    const currentRoles = new Set((user.roles || []).map((role) => role.role_name));
    const selectedRoles = new Set(
      Array.from(this.selectedRoleIds)
        .map((id) => this.roles.find((role) => role.id === id))
        .filter(Boolean)
        .map((role) => role.role_name),
    );

    const added = Array.from(selectedRoles).filter(
      (roleName) => !currentRoles.has(roleName) && HIGH_RISK_ROLES.includes(roleName),
    );

    const removed = Array.from(currentRoles).filter(
      (roleName) => !selectedRoles.has(roleName) && HIGH_RISK_ROLES.includes(roleName),
    );

    return added.length > 0 || removed.length > 0;
  }

  applyOptimisticRoles(user, roleIds) {
    const roleLookup = new Map(this.roles.map((role) => [role.id, role]));
    user.role_ids = [...roleIds];
    user.roles = roleIds
      .map((id) => roleLookup.get(id))
      .filter(Boolean)
      .map((role) => ({
        ...role,
      }));
  }

  rollbackRoles(user, previousRoleIds) {
    this.applyOptimisticRoles(user, previousRoleIds);
  }

  /**
   * Persist selected bundle choices for the active user.
   * Optimistically updates the UI, rolls back on error, and clears caches on success.
   */
  async handleSaveRoles() {
    const user = this.users.find((u) => u.id === this.selectedUserId);
    if (!user) return;

    const validation = this.getValidationState(user);
    if (validation.blocking) {
      this.app.showMessage(validation.blocking, "error");
      return;
    }

    if (this.isOffline) {
      this.app.showMessage("district_management_offline_disabled", "info");
      return;
    }

    if (!canAssignRoles()) {
      this.app.showMessage("no_permission", "error");
      return;
    }

    const previousRoleIds = [...(user.role_ids || [])];
    const selectedRoleIds = Array.from(this.selectedRoleIds);
    this.applyOptimisticRoles(user, selectedRoleIds);
    this.filteredUsers = this.getFilteredUsers();
    this.renderAndBind();

    try {
      await updateUserRolesV1(user.id, selectedRoleIds, {
        audit_note: this.auditNote.trim(),
        bundles: this.describeSelectedBundles(selectedRoleIds),
        organizationId: this.organizationId,
      });
      this.userMeta[user.id] = { lastSyncedAt: Date.now(), roleCount: selectedRoleIds.length };
      this.lastSyncedAt = Date.now();
      await clearUserCaches(this.organizationId);
      await this.persistCache();
      this.app.showMessage("district_management_assignment_saved", "success");
      this.closeModal();
    } catch (error) {
      debugError("district_management: save failed", error);
      this.rollbackRoles(user, previousRoleIds);
      this.queueChange(user.id, selectedRoleIds, error?.message);
      this.app.showMessage("district_management_assignment_failed", "error");
      this.renderAndBind();
    }
  }

  /**
   * Queue the current selection for later synchronization.
   * Used when offline to avoid destructive operations while still capturing intent.
   */
  async queuePendingChange() {
    const user = this.users.find((u) => u.id === this.selectedUserId);
    if (!user) return;
    const validation = this.getValidationState(user);
    if (validation.blocking) {
      this.app.showMessage(validation.blocking, "error");
      return;
    }
    const selectedRoleIds = Array.from(this.selectedRoleIds);
    this.queueChange(user.id, selectedRoleIds, null);
    this.applyOptimisticRoles(user, selectedRoleIds);
    this.filteredUsers = this.getFilteredUsers();
    await this.persistCache();
    this.app.showMessage("district_management_assignment_queued", "info");
    this.closeModal();
  }

  queueChange(userId, roleIds, reason = null) {
    const change = {
      userId,
      roleIds,
      auditNote: this.auditNote.trim(),
      createdAt: Date.now(),
      lastSyncedAt: this.lastSyncedAt,
      reason,
      organizationId: this.organizationId,
    };
    const existingIndex = this.queuedChanges.findIndex((item) => item.userId === userId);
    if (existingIndex >= 0) {
      this.queuedChanges[existingIndex] = change;
    } else {
      this.queuedChanges.push(change);
    }
  }

  describeSelectedBundles(roleIds) {
    const roleLookup = new Map(this.roles.map((role) => [role.id, role]));
    return roleIds
      .map((id) => roleLookup.get(id))
      .filter(Boolean)
      .map((role) => role.display_name || role.role_name);
  }

  /**
   * Attempt to reapply queued updates, respecting newer sync timestamps to avoid overwriting fresh data.
   */
  async retryQueuedChanges() {
    if (!this.queuedChanges.length) {
      this.app.showMessage("district_management_no_queue", "info");
      return;
    }

    if (this.isOffline) {
      this.app.showMessage("district_management_offline_disabled", "info");
      return;
    }

    await this.refreshData(true);
    const remaining = [];
    let staleCount = 0;
    let errorCount = 0;

    for (const change of this.queuedChanges) {
      if (change.organizationId && String(change.organizationId) !== String(this.organizationId)) {
        remaining.push({ ...change, reason: "organization_mismatch" });
        continue;
      }

      const user = this.users.find((u) => u.id === change.userId);
      if (!user) {
        continue;
      }

      const lastSynced = this.userMeta[user.id]?.lastSyncedAt || 0;
      if (lastSynced > change.createdAt) {
        remaining.push({ ...change, reason: "stale" });
        staleCount += 1;
        continue;
      }

      try {
        await updateUserRolesV1(user.id, change.roleIds, {
          audit_note: change.auditNote,
          bundles: this.describeSelectedBundles(change.roleIds),
          organizationId: change.organizationId || this.organizationId,
        });
        this.applyOptimisticRoles(user, change.roleIds);
        this.userMeta[user.id] = { lastSyncedAt: Date.now(), roleCount: change.roleIds.length };
        this.app.showMessage("district_management_assignment_saved", "success");
      } catch (error) {
        debugError("district_management: queued change failed", error);
        remaining.push({ ...change, reason: error?.message || "error" });
        errorCount += 1;
      }
    }

    this.queuedChanges = remaining;
    this.filteredUsers = this.getFilteredUsers();
    await this.persistCache();
    this.renderAndBind();

    if (staleCount > 0) {
      this.app.showMessage("district_management_stale_queue", "info");
    }
    if (errorCount > 0) {
      this.app.showMessage("district_management_assignment_failed", "error");
    }
  }
}
