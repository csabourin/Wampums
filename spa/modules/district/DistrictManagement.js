import {
  CONFIG,
  clearUserCaches,
  getCurrentOrganizationId,
  getRoleAuditLog,
  getRoleBundles,
  getRolePermissions,
  getUserOrganizations,
  getUsers,
  getUserRoleAssignments,
  updateUserRoleBundles,
  updateUserRolesV1,
} from '../../ajax-functions.js';
import { setUserMembershipStatus } from '../../api/api-members.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { translate } from '../../app.js';
import { getCachedData, setCachedData } from '../../indexedDB.js';
import { debounce } from '../../utils/PerformanceUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { canAssignRoles, canViewRoles, hasPermission } from '../../utils/PermissionUtils.js';
import { roleDescription, roleLabel } from '../../utils/RoleLabelUtils.js';
import {
  escapeAttribute,
  escapeHTML,
  sanitizeHTML,
  sanitizeURL,
} from '../../utils/SecurityUtils.js';
import {
  buildRoleBundleIndex,
  calculatePermissionGaps,
  detectRoleConflicts,
  getLocalGroupEligibleRoles,
} from '../../utils/RoleValidationUtils.js';
import { switchActiveUnit } from '../session/UnitSwitch.js';
import { setContent } from '../../utils/DOMUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { getMountPoint, resolveMountOptions } from '../../utils/PageMount.js';

import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { youthDisplayName } from '../../utils/DisplayNameUtils.js';
const CACHE_KEY = 'district_management_state';
const CACHE_DURATION = CONFIG.CACHE_DURATION.SHORT;
const ADMIN_ROLES = ['district', 'unitadmin', 'demoadmin'];
const HIGH_RISK_ROLES = ['district', 'unitadmin'];
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
const INCIDENT_REPORT_URL = 'mailto:security@wampums.app?subject=Role%20change%20review';

/**
 * DistrictManagement view
 * Renders district-level role administration with mobile-first UX,
 * offline awareness, and optimistic role assignment.
 */
export class DistrictManagement {
  constructor(app, options = {}) {
    this.app = app;
    Object.assign(this, resolveMountOptions(options));
    this.users = [];
    this.roles = [];
    this.filteredUsers = [];
    this.searchTerm = '';
    this.activeRoleFilters = new Set();
    this.selectedUserId = null;
    this.selectedRoleIds = new Set();
    this.auditNote = '';
    this.lastSyncedAt = null;
    this.queuedChanges = [];
    this.isOffline = !navigator.onLine;
    this.syncing = false;
    this.userMeta = {};
    this.mfaAcknowledged = false;
    this.organizationId = getCurrentOrganizationId();
    // Bumped when the session moves to another unit: a response to a request
    // made before then belongs to the previous unit and is dropped.
    this.unitGeneration = 0;
    // The unit being switched to, while the switch is under way.
    this.switchingTo = null;
    // Role and membership changes sent and not yet answered. They act on the
    // unit they were sent in, so the unit cannot change until they settle.
    this.writesInFlight = 0;
    this.organizations = [];
    this.rolePermissions = {};
    this.roleBundleIndex = { list: [], byId: new Map(), byName: new Map() };
    this.auditLogByUser = {};
    this.auditPanelError = '';
    this.loadingAuditUserId = null;
    this.savingUserId = null;
    this.formStatus = { type: '', message: '' };
    // The deactivated accounts' section stays open or closed across renders.
    this.inactiveExpanded = false;
    this.debouncedSearch = debounce((event) => {
      this.searchTerm = event.target.value || '';
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
    if (this.destroyed) {
      return;
    }
    // Nothing cached yet: the list says it is loading, not that nobody matches.
    this.syncing = !this.lastSyncedAt;
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
        this.auditLogByUser = cached.auditLogByUser || {};
      }
    } catch (error) {
      debugError('district_management: failed to hydrate cache', error);
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
          auditLogByUser: this.auditLogByUser,
        },
        CACHE_DURATION,
      );
    } catch (error) {
      debugError('district_management: failed to persist cache', error);
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
      debugError('district_management: failed to load organizations', error);
    }
  }

  setupOfflineListeners() {
    // Keep references so destroy() can remove them; otherwise each visit
    // stacks another set of window listeners bound to a dead instance.
    this.offlineStatusChangedHandler = (event) => {
      this.isOffline = event.detail?.isOffline ?? !navigator.onLine;
      this.renderAndBind();
    };
    this.onlineHandler = () => {
      this.isOffline = false;
      this.renderAndBind();
    };
    this.offlineHandler = () => {
      this.isOffline = true;
      this.renderAndBind();
    };

    window.addEventListener('offlineStatusChanged', this.offlineStatusChangedHandler);
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
  }

  /**
   * Called by the router before navigating away.
   */
  destroy() {
    this.destroyed = true;
    if (this.offlineStatusChangedHandler) {
      window.removeEventListener('offlineStatusChanged', this.offlineStatusChangedHandler);
      this.offlineStatusChangedHandler = null;
    }
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
    if (this.offlineHandler) {
      window.removeEventListener('offline', this.offlineHandler);
      this.offlineHandler = null;
    }
  }

  /**
   * Fetch users and roles with caching and offline fallback.
   * @param {boolean} forceRefresh - When true, bypass caches.
   */
  async refreshData(forceRefresh = false) {
    // Mid-switch the token may still name the previous unit; the switch
    // loads the new unit itself once it ends.
    if (this.switchingTo) {
      return;
    }
    const generation = this.unitGeneration;
    this.syncing = true;
    this.loadFailed = false;
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
        this.app.showMessage('district_management_load_error', 'error');
        return;
      }

      const [roleResponse, usersResponse] = await Promise.all([
        getRoleBundles({ forceRefresh, organizationId }),
        getUsers(organizationId, { forceRefresh }),
      ]);
      if (generation !== this.unitGeneration) {
        return;
      }

      if (roleResponse?.success) {
        const roleCatalog = roleResponse.data || [];
        await this.hydrateRoleBundles(roleCatalog, forceRefresh);
        if (generation !== this.unitGeneration) {
          return;
        }
      }

      if (usersResponse?.success) {
        this.users = this.normalizeUsers(usersResponse.users || usersResponse.data || []);
        this.filteredUsers = this.getFilteredUsers();
        this.lastSyncedAt = Date.now();
        this.userMeta = this.buildUserMeta();
      } else {
        this.loadFailed = true;
      }

      await this.persistCache();
    } catch (error) {
      debugError('district_management: failed to refresh data', error);
      this.loadFailed = true;
    } finally {
      if (generation === this.unitGeneration) {
        this.syncing = false;
      }
    }
    if (this.destroyed || generation !== this.unitGeneration) {
      return;
    }
    // With members cached, they stay shown under "last synced"; without, the
    // list is an error with a retry instead of "no results".
    if (this.loadFailed) {
      this.app.showMessage('district_management_load_error', 'error');
    }
    this.renderAndBind();
  }

  async hydrateRoleBundles(roleCatalog = [], forceRefresh = false) {
    const generation = this.unitGeneration;
    const rolePermissions = await this.fetchRolePermissionsForCatalog(roleCatalog, forceRefresh);
    if (generation !== this.unitGeneration) {
      return;
    }
    this.rolePermissions = rolePermissions;
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
          debugError('district_management: failed to hydrate permissions', error);
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
              display_name: roleLabel(role),
            }));

      return {
        ...user,
        roles: resolvedRoles,
        role_ids: parsedRoleIds,
      };
    });
  }

  parseRoleIds(roleIds) {
    if (!roleIds) {return [];}
    if (Array.isArray(roleIds)) {
      return roleIds
        .map((value) => parseInt(value, 10))
        .filter((value) => Number.isFinite(value));
    }
    if (typeof roleIds === 'string') {
      try {
        const parsed = JSON.parse(roleIds);
        if (Array.isArray(parsed)) {
          return parsed
            .map((value) => parseInt(value, 10))
            .filter((value) => Number.isFinite(value));
        }
        return [];
      } catch (error) {
        debugError('district_management: unable to parse role_ids', error);
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
        <h1 id="district-management-title">${translate('access_denied')}</h1>
        <p>${translate('no_permission_role_management') || translate('no_permission')}</p>
        <a class="button button--primary" href="/dashboard">${translate('back_to_dashboard')}</a>
      </section>
    `;
    setContent(getMountPoint(this), content);
  }

  renderAndBind() {
    // Every change in the dialog rebuilds it; keep the reader where they were
    // (scroll position, focused control) instead of sending them to the top.
    const dialog = document.querySelector('.dm-modal .modal-body');
    const scrollTop = dialog ? dialog.scrollTop : null;
    const active = document.activeElement;
    const focusId = active?.id || null;
    const focusRoleId = active?.dataset?.roleId || null;

    this.render();
    this.attachEventListeners();

    const rebuilt = document.querySelector('.dm-modal .modal-body');
    if (rebuilt && scrollTop !== null) {
      rebuilt.scrollTop = scrollTop;
    }
    const target = focusId
      ? document.getElementById(focusId)
      : focusRoleId && document.querySelector(`.dm-bundle-checkbox[data-role-id="${focusRoleId}"]`);
    if (target && rebuilt?.contains(target)) {
      target.focus({ preventScroll: true });
    }
  }

  async handleOrganizationChange(newOrgId) {
    // One switch at a time. The selector stays focusable meanwhile, so a
    // keyboard change is possible: put back the unit being switched to.
    if (this.switchingTo) {
      const select = document.getElementById('dm-org-select');
      if (select) {
        select.value = String(this.switchingTo);
      }
      return;
    }
    if (!newOrgId || String(newOrgId) === String(this.organizationId || '')) {
      return;
    }
    if (this.writesInFlight > 0) {
      const select = document.getElementById('dm-org-select');
      if (select) {
        select.value = String(this.organizationId);
      }
      this.app.showMessage('district_management_switch_wait', 'info');
      return;
    }

    // The server reads the unit from the token. From the moment the switch
    // starts, nothing of the previous unit may stay on screen, where a save
    // would apply its roles to whichever unit the token names by then, and no
    // answer to a request made before may land here.
    const previous = this.unitState();
    this.unitGeneration += 1;
    this.switchingTo = newOrgId;
    this.resetUnitState();
    this.syncing = true;
    this.loadFailed = false;
    this.renderAndBind();
    this.focusOrganizationSelect();
    try {
      await switchActiveUnit(this.app, newOrgId);
    } catch (error) {
      debugError('district_management: unit switch failed', error);
      this.switchingTo = null;
      if (this.destroyed) {
        return;
      }
      // The session is still in the previous unit: show it again as it was.
      Object.assign(this, previous);
      this.syncing = false;
      this.app.showMessage(apiErrorMessage(error, 'district_management_switch_failed'), 'error');
      this.renderAndBind();
      this.focusOrganizationSelect();
      return;
    }
    if (this.destroyed) {
      return;
    }

    // Start from what this unit's own cache holds, if anything.
    await this.hydrateFromCache();
    if (this.destroyed) {
      return;
    }
    this.organizationId = newOrgId;
    this.switchingTo = null;

    if (!canViewRoles()) {
      this.app.router.navigate('/dashboard');
      return;
    }

    await clearUserCaches(newOrgId);
    await this.refreshData(true);
    if (!this.destroyed) {
      this.focusOrganizationSelect();
    }
  }

  /**
   * Everything on this screen that belongs to the active unit.
   *
   * @returns {Object} The unit's members, roles, history and waiting changes
   */
  unitState() {
    return {
      users: this.users,
      filteredUsers: this.filteredUsers,
      roles: this.roles,
      rolePermissions: this.rolePermissions,
      roleBundleIndex: this.roleBundleIndex,
      userMeta: this.userMeta,
      auditLogByUser: this.auditLogByUser,
      queuedChanges: this.queuedChanges,
      lastSyncedAt: this.lastSyncedAt,
      loadFailed: this.loadFailed,
      selectedUserId: this.selectedUserId,
      selectedRoleIds: this.selectedRoleIds,
    };
  }

  /**
   * Forget everything that belongs to the unit the session is leaving.
   */
  resetUnitState() {
    Object.assign(this, {
      users: [],
      filteredUsers: [],
      roles: [],
      rolePermissions: {},
      roleBundleIndex: buildRoleBundleIndex([], {}),
      userMeta: {},
      auditLogByUser: {},
      queuedChanges: [],
      lastSyncedAt: null,
      loadFailed: false,
      selectedUserId: null,
      selectedRoleIds: new Set(),
    });
  }

  /**
   * The selector was disabled and redrawn while the unit changed, which drops
   * keyboard focus; give it back so the person keeps their place.
   */
  focusOrganizationSelect() {
    document.getElementById('dm-org-select')?.focus();
  }

  render() {
    const lastSyncedLabel = this.formatTimestamp(this.lastSyncedAt);
    const queuedCount = this.queuedChanges.length;
    const queuedLabel = `${translate('district_management_queued_label')} (${queuedCount})`;
    const offlineBanner = this.isOffline
      ? `<div class="dm-offline-banner" role="status" aria-live="polite">
            <span aria-hidden="true">📡</span>
            <span>${translate('district_management_offline_banner')}</span>
         </div>`
      : '';
    const organizationSelector = this.renderOrganizationSelector();

    const queuedBadge =
      queuedCount > 0
        ? `<section class="dm-queued" aria-labelledby="dm-queue-title">
            <h2 id="dm-queue-title" class="dm-section-title" tabindex="-1">${escapeHTML(queuedLabel)}</h2>
            <ul class="dm-queue-list">${this.queuedChanges.map((change) => this.renderQueuedChange(change)).join('')}</ul>
            <button id="dm-retry" class="button button--secondary" ${this.isOffline ? 'disabled' : ''}>
              ${translate('district_management_retry_sync')}
            </button>
          </section>`
        : '';

    const actionBar = `
      <div class="dm-action-bar" role="region" aria-label="${translate('district_management_actions')}">
        <div class="dm-action-bar__left">
          <button id="dm-refresh" class="button button--secondary" aria-label="${translate('district_management_refresh')}">
            🔄 ${translate('district_management_refresh')}
          </button>
          <div class="dm-sync" id="dm-sync-status" aria-live="polite">
            ${translate('district_management_last_synced')}: <strong>${escapeHTML(lastSyncedLabel)}</strong>
          </div>
        </div>
        <div class="dm-action-bar__right">
          <button id="dm-bottom-retry" class="button button--secondary" ${this.isOffline ? 'disabled' : ''}>
            ${translate('district_management_retry_sync')}
          </button>
        </div>
      </div>
    `;

    const content = `
      <section class="district-management"${this.embedded ? '' : ' aria-labelledby="district-management-title"'}>
        <header class="dm-header">
          <div>
            ${this.embedded ? '' : `${renderBackLink()}
            <h1 id="district-management-title">${translate('tile_district_management')}</h1>`}
            <p class="dm-subtitle">${translate('district_management_subtitle')}</p>
          </div>
          ${offlineBanner}
        </header>

        <div class="dm-controls">
          <div class="dm-search">
            <label class="sr-only" for="dm-search-input">${translate('district_management_search_label')}</label>
            <input
              id="dm-search-input"
              type="search"
              inputmode="search"
              autocomplete="off"
              aria-label="${translate('district_management_search_label')}"
              placeholder="${translate('district_management_search_placeholder')}"
              value="${escapeHTML(this.searchTerm)}"
            />
          </div>
          <div class="dm-filters" role="group" aria-label="${translate('district_management_filter_label')}">
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
    `;

    setContent(getMountPoint(this), content);
    this.syncAssignmentModal();
  }

  /**
   * Show the assignment dialog for the selected member, or close it. The
   * dialog stays open across renders; only its contents are replaced, so
   * focus and scroll stay where the person was.
   */
  syncAssignmentModal() {
    const parts = this.renderAssignmentModal();
    if (!parts) {
      const modal = this.assignmentModal;
      this.assignmentModal = null;
      modal?.close(true);
      return;
    }
    if (!this.assignmentModal?.overlay.isConnected) {
      this.assignmentModal = openModal({
        id: 'dm-modal',
        title: parts.title,
        body: parts.body,
        footer: parts.footer,
        className: 'dm-modal',
        onClose: () => {
          // Closed by Escape, the backdrop, the close button or by leaving
          // the page: nothing else on the page depends on the selection.
          if (this.assignmentModal) {
            this.assignmentModal = null;
            this.clearSelection();
          }
        },
      });
      return;
    }
    const { dialog, body } = this.assignmentModal;
    setContent(dialog.querySelector('.modal-header h2'), parts.title);
    setContent(body, parts.body);
    setContent(dialog.querySelector('.modal-footer'), parts.footer);
  }

  getActiveOrganizationName() {
    const currentId = String(this.organizationId || getCurrentOrganizationId() || '');
    const organization = this.organizations.find(
      (org) => String(org.id) === currentId || String(org.organization_id) === currentId,
    );
    return organization?.name || organization?.organization_name || currentId || '';
  }

  renderOrganizationSelector() {
    if (!this.organizations.length) {return '';}
    const currentId = String(this.switchingTo || this.organizationId || getCurrentOrganizationId() || '');
    const hasMultiple = this.organizations.length > 1;
    const options = this.organizations
      .map((org) => {
        const orgId = String(org.id || org.organization_id);
        const name = escapeHTML(org.name || org.organization_name || orgId);
        const isSelected = orgId === currentId;
        return `<option value="${escapeHTML(orgId)}" ${isSelected ? 'selected' : ''}>${name}</option>`;
      })
      .join('');

    const label = translate('district_management_org_scope_label');
    const helper = translate('district_management_org_scope_help');
    const activeName = escapeHTML(this.getActiveOrganizationName());

    const selector = hasMultiple
      ? `<label class="dm-section-title" for="dm-org-select">${label}</label>
         <select id="dm-org-select" aria-label="${label}" ${this.switchingTo ? 'aria-disabled="true"' : ''}>${options}</select>`
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
      const roleName = escapeHTML(roleLabel(role));
      const isActive = this.activeRoleFilters.has(role.role_name);
      return `
        <button class="chip ${isActive ? 'chip--primary' : ''}" data-role-filter="${escapeHTML(role.role_name)}" aria-pressed="${isActive}">
          ${roleName}
        </button>
      `;
    });

    const clearFilter = `
      <button class="chip" data-role-filter="__clear" aria-pressed="${this.activeRoleFilters.size === 0}">
        ${translate('district_management_clear_filters')}
      </button>
    `;

    return clearFilter + chips.join('');
  }

  renderUserCards() {
    if (!this.lastSyncedAt && this.syncing) {
      return `<p role="status">${translate('loading')}</p>`;
    }
    if (!this.lastSyncedAt && this.loadFailed) {
      return `
        <p class="status-message error" role="alert">${translate('district_management_load_error')}</p>
        <button type="button" class="button button--primary" id="dm-load-retry">${translate('retry')}</button>`;
    }
    if (!this.filteredUsers.length) {
      return `<p class="muted-text">${translate('district_management_no_results')}</p>`;
    }

    // Deactivated accounts wait at the bottom, folded, so the people the unit
    // works with now are not lost among them.
    const active = this.filteredUsers.filter((user) => user.status !== 'inactive');
    const inactive = this.filteredUsers.filter((user) => user.status === 'inactive');
    const inactiveSection = inactive.length
      ? `<details class="dm-inactive-accounts" id="dm-inactive-accounts"${this.inactiveExpanded || this.searchTerm.trim() ? ' open' : ''}>
          <summary>${escapeHTML(translate('district_management_inactive_accounts').replace('{count}', String(inactive.length)))}</summary>
          <div class="dm-inactive-list">${inactive.map((user) => this.renderUserCard(user)).join('')}</div>
        </details>`
      : '';

    return `${active.map((user) => this.renderUserCard(user)).join('')}${inactiveSection}`;
  }

  /**
   * The names of the unit's children linked to a member, for telling parents apart.
   *
   * @param {Object} user - Member, with `children` from the API
   * @returns {string} Names joined with commas; empty without children
   */
  childNames(user) {
    const children = Array.isArray(user.children) ? user.children : [];
    return children.map((child) => youthDisplayName(child)).filter(Boolean).join(', ');
  }

  /**
   * One member, as a button opening their roles.
   *
   * @param {Object} user - Member
   * @returns {string} HTML
   */
  renderUserCard(user) {
    const roles = this.getUserRoles(user);
    const roleBadges =
      roles.length > 0
        ? roles
          .map(
            (role) => `
                <span class="chip dm-role-chip" role="listitem">
                  ${escapeHTML(roleLabel(role))}
                </span>
              `,
          )
          .join('')
        : `<span class="chip">${translate('no_roles_assigned')}</span>`;

    const inactive = user.status === 'inactive';
    const inactiveLabel = inactive
      ? `<span class="status-pill dm-inactive-pill">${translate('member_access_inactive_badge')}</span>`
      : '';
    const children = this.childNames(user);
    const childrenLine = children
      ? `<p class="dm-user-children">${escapeHTML(translate('district_management_children').replace('{names}', children))}</p>`
      : '';
    const cardName = [
      user.full_name || user.email,
      inactive ? translate('member_access_inactive_badge') : '',
      children ? translate('district_management_children').replace('{names}', children) : '',
    ].filter(Boolean).join(', ');

    const queued = this.queuedChanges.find((item) => item.userId === user.id);
    const queuedLabel = queued
      ? `<span class="status-pill status-pill--pending">${translate('district_management_pending_sync')}</span>`
      : '';

    return `
      <button class="dm-user-card${inactive ? ' dm-user-card--inactive' : ''}" data-user-id="${escapeAttribute(user.id)}" aria-label="${escapeAttribute(cardName)}">
        <div class="dm-card-header">
          <div>
            <p class="dm-user-name">${escapeHTML(user.full_name || user.email)}</p>
            <p class="dm-user-email">${escapeHTML(user.email || '')}</p>
            ${childrenLine}
          </div>
          ${inactiveLabel}${queuedLabel}
        </div>
        <div class="dm-role-stack" role="list" aria-label="${translate('district_management_assigned_roles')}">
          ${roleBadges}
        </div>
      </button>
    `;
  }

  /**
   * A change waiting to be sent, with the way to drop it.
   *
   * @param {Object} change - Queued change
   * @returns {string} HTML
   */
  renderQueuedChange(change) {
    const user = this.users.find((candidate) => candidate.id === change.userId);
    const name = user?.full_name || user?.email || translate('district_management_unknown_member');
    const roles = this.describeSelectedBundles(change.roleIds || []).join(', ')
      || translate('no_roles_assigned');
    const reasonKey = {
      stale: 'district_management_queue_reason_stale',
      organization_mismatch: 'district_management_queue_reason_other_unit',
    }[change.reason] || (change.reason ? 'district_management_queue_reason_failed' : '');
    const discardLabel = translate('district_management_queue_discard_for').replace('{name}', name);
    return `
      <li class="dm-queue-item">
        <div>
          <p class="dm-user-name">${escapeHTML(name)}</p>
          <p class="dm-helper">${escapeHTML(roles)}</p>
          ${reasonKey ? `<p class="dm-helper">${escapeHTML(translate(reasonKey))}</p>` : ''}
        </div>
        <button type="button" class="button button--small button--secondary" data-discard-queued="${escapeAttribute(change.userId)}"
          aria-label="${escapeAttribute(discardLabel)}">
          ${translate('district_management_queue_discard')}
        </button>
      </li>
    `;
  }

  /**
   * The assignment dialog's contents for the selected member.
   * @returns {{ title: string, body: string, footer: string }|null} Null when nobody is selected
   */
  renderAssignmentModal() {
    if (!this.selectedUserId) {return null;}
    const user = this.users.find((u) => u.id === this.selectedUserId);
    if (!user) {return null;}

    const bundles = this.getRoleBundles();
    const mfaRequired = this.isHighRiskChange(user);
    const incidentUrl = sanitizeURL(INCIDENT_REPORT_URL);
    const validationState = this.getValidationState(user);
    const isSaving = this.savingUserId === user.id;
    const statusMessage = this.formStatus?.message
      ? `<div class="dm-status dm-status--${escapeHTML(this.formStatus.type || 'info')}" role="status" aria-live="polite">
          ${escapeHTML(this.formStatus.message)}
        </div>`
      : '';

    const bundleList = bundles
      .map((bundle) => {
        const isChecked = this.selectedRoleIds.has(bundle.id);
        const localGroupBadge = (bundle.crossOrgEligibleFor || []).includes('local_group')
          ? `<span class="chip dm-bundle-chip">${translate('district_management_local_group_badge')}</span>`
          : '';
        return `
          <label class="dm-bundle" data-role-name="${escapeHTML(bundle.role_name)}">
            <div class="dm-bundle-header">
              <input
                type="checkbox"
                class="dm-bundle-checkbox"
                data-role-id="${bundle.id}"
                data-role-name="${escapeHTML(bundle.role_name)}"
                ${isChecked ? 'checked' : ''}
                ${this.isBlockedByRoleLevel(bundle.role_name) ? 'disabled' : ''}
              />
              <div>
                <p class="dm-bundle-title">${escapeHTML(roleLabel(bundle))}</p>
                ${localGroupBadge ? `<p class="dm-bundle-meta">${localGroupBadge}</p>` : ''}
              </div>
            </div>
            <p class="dm-bundle-description">
              ${sanitizeHTML(roleDescription(bundle) || translate('district_management_generic_bundle_description'), {
    stripAll: true,
  })}
            </p>
          </label>
        `;
      })
      .join('');

    const blockingMessage = validationState.blocking;
    const saveDisabled =
      Boolean(blockingMessage) || this.isOffline || (mfaRequired && !this.mfaAcknowledged) || isSaving;
    const warningContent =
      validationState.warnings && validationState.warnings.length
        ? `<div class="dm-warning" role="status" aria-live="polite">
            ${validationState.warnings.map((warning) => `<p class="dm-helper">${escapeHTML(warning)}</p>`).join('')}
          </div>`
        : '';
    const auditPanel = this.renderAuditPanel(user);

    return {
      title: `${translate('district_management_assignment_for')} ${escapeHTML(user.full_name || user.email)}`,
      body: `
            <p class="dm-modal-subtitle">${translate('district_management_role_instruction')}</p>
            ${isSaving ? `<p class="dm-helper" role="status" aria-live="polite">${translate('district_management_saving')}</p>` : ''}
            <div class="dm-modal-section">
              <p class="dm-section-title">${translate('district_management_bundles_title')}</p>
              <div class="dm-bundle-list">${bundleList}</div>
            </div>

            <div class="dm-modal-section">
              <label for="dm-audit-note" class="dm-section-title">
                ${translate('district_management_audit_label')}
                <span class="dm-optional">${translate('optional')}</span>
              </label>
              <textarea id="dm-audit-note" rows="3" placeholder="${translate('district_management_audit_placeholder')}">${escapeHTML(this.auditNote)}</textarea>
              <p class="dm-helper">${translate('district_management_audit_helper')}</p>
            </div>

            ${auditPanel}

            ${this.renderMembershipSection(user)}

            ${mfaRequired ? `
              <div class="dm-modal-section dm-high-risk" role="alert">
                <p class="dm-section-title">${translate('district_management_mfa_title')}</p>
                <p>${translate('district_management_mfa_placeholder')}</p>
                <div class="dm-mfa-actions">
                  <button type="button" id="dm-mfa-start" class="button button--secondary">${translate('district_management_trigger_mfa')}</button>
                  ${incidentUrl ? `<a class="text-link" href="${incidentUrl}" target="_blank" rel="noopener noreferrer">${translate('district_management_incident_link')}</a>` : ''}
                </div>
                <label class="dm-checkbox">
                  <input type="checkbox" id="dm-mfa-confirm" ${this.mfaAcknowledged ? 'checked' : ''}/>
                  <span>${translate('district_management_mfa_confirm')}</span>
                </label>
              </div>
            ` : ''}

            ${warningContent}
            ${blockingMessage ? `<p class="error-text" role="alert">${escapeHTML(blockingMessage)}</p>` : ''}
            ${statusMessage}
      `,
      footer: `
            <button type="button" id="dm-queue" class="button button--secondary" ${isSaving ? 'disabled' : ''}>
              ${translate('district_management_queue_change')}
            </button>
            <button type="button" id="dm-save" class="button button--primary" ${saveDisabled ? 'disabled' : ''}>
              ${
  this.isOffline
    ? translate('district_management_offline_disabled')
    : isSaving
      ? translate('district_management_saving')
      : translate('district_management_save')
}
            </button>
      `,
    };
  }

  /**
   * Access to the unit: deactivate someone who left (a leader who stepped
   * down), or bring them back. Their account, roles and history are kept.
   *
   * @param {Object} user - Member (status: 'active' | 'inactive' | 'alumni')
   * @returns {string} Section HTML, empty without users.delete
   */
  renderMembershipSection(user) {
    // Alumni are managed from the alumni list: switching them off here would
    // drop them from it despite their consent.
    if (!hasPermission('users.delete') || user.status === 'alumni') {
      return '';
    }
    const inactive = user.status === 'inactive';
    return `
      <section class="dm-modal-section dm-membership" aria-labelledby="dm-membership-title">
        <h3 id="dm-membership-title" class="dm-section-title">${translate('member_access_title')}</h3>
        <p class="dm-helper">${translate(inactive ? 'member_access_inactive' : 'member_access_active')}</p>
        <button type="button" id="dm-membership-toggle" class="button ${inactive ? 'button--secondary' : 'button--danger'}"
          ${this.isOffline || this.savingUserId === user.id ? 'disabled' : ''}>
          ${translate(inactive ? 'member_access_reactivate' : 'member_access_deactivate')}
        </button>
      </section>
    `;
  }

  /**
   * Deactivate (after confirmation) or reactivate the member in the dialog.
   */
  async toggleMembership() {
    const user = this.users.find((u) => u.id === this.selectedUserId);
    if (!user) {
      return;
    }
    const deactivating = user.status !== 'inactive';
    if (deactivating) {
      const confirmed = await confirmDestructive({
        title: translate('member_access_deactivate_title').replace('{name}', user.full_name || user.email),
        message: translate('member_access_deactivate_message'),
        confirmLabel: translate('member_access_deactivate'),
      });
      if (!confirmed) {
        document.getElementById('dm-membership-toggle')?.focus();
        return;
      }
    }

    this.writesInFlight += 1;
    try {
      await setUserMembershipStatus(user.id, deactivating ? 'inactive' : 'active', this.auditNote.trim() || undefined);
      user.status = deactivating ? 'inactive' : 'active';
      await clearUserCaches(this.organizationId);
      this.formStatus = {
        type: 'success',
        message: translate(deactivating ? 'member_access_deactivated' : 'member_access_reactivated'),
      };
    } catch (error) {
      debugError('district_management: membership change failed', error);
      const FORBIDDEN = 403;
      this.formStatus = {
        type: 'error',
        message: translate(error?.status === FORBIDDEN ? 'member_access_forbidden' : 'member_access_error'),
      };
    } finally {
      this.writesInFlight -= 1;
    }
    this.filteredUsers = this.getFilteredUsers();
    await this.persistCache();
    this.renderAndBind();
    document.getElementById('dm-membership-toggle')?.focus();
  }

  renderAuditPanel(user) {
    const entries = this.auditLogByUser[user.id] || [];
    const isLoading = this.loadingAuditUserId === user.id;
    const incidentUrl = sanitizeURL(INCIDENT_REPORT_URL);
    const incidentCta = incidentUrl
      ? `<a class="text-link" href="${incidentUrl}" target="_blank" rel="noopener noreferrer">
          ${translate('district_management_incident_report_cta')}
        </a>`
      : '';

    let content = '';
    if (this.auditPanelError) {
      content = `<p class="error-text" role="alert">${escapeHTML(this.auditPanelError)}</p>`;
    } else if (isLoading) {
      content = `<p class="dm-helper">${translate('district_management_audit_loading')}</p>`;
    } else if (!entries.length) {
      content = `<p class="dm-helper">${translate('district_management_audit_empty')}</p>`;
    } else {
      content = `<ul class="dm-audit-list">${entries.map((entry) => this.renderAuditEntry(entry)).join('')}</ul>`;
    }

    return `
      <div class="dm-modal-section">
        <div class="dm-section-header">
          <p class="dm-section-title">${translate('district_management_audit_panel_title')}</p>
          ${incidentCta}
        </div>
        ${content}
      </div>
    `;
  }

  /**
   * Describe a recorded role change in the interface language: the roles
   * added and removed, named with roleLabel(), then the note if any.
   *
   * @param {Object} entry - Server entry (previous_roles, new_roles, note)
   * @returns {string[]} Lines to show, unescaped; empty when not structured
   */
  describeAuditChange(entry) {
    if (!Array.isArray(entry.previous_roles) || !Array.isArray(entry.new_roles)) {
      return [];
    }
    const beforeIds = new Set(entry.previous_roles.map((role) => role.id));
    const afterIds = new Set(entry.new_roles.map((role) => role.id));
    const added = entry.new_roles.filter((role) => !beforeIds.has(role.id));
    const removed = entry.previous_roles.filter((role) => !afterIds.has(role.id));
    const names = (roles) => roles.map((role) => roleLabel(role)).join(', ');

    const lines = [];
    if (added.length) {
      lines.push(translate('district_management_audit_added').replace('{roles}', names(added)));
    }
    if (removed.length) {
      lines.push(translate('district_management_audit_removed').replace('{roles}', names(removed)));
    }
    if (entry.note) {
      lines.push(translate('district_management_audit_note').replace('{note}', entry.note));
    }
    return lines;
  }

  renderAuditEntry(entry) {
    const actor = escapeHTML(entry.actor_name || entry.actor || translate('district_management_unknown_actor'));
    const described = this.describeAuditChange(entry);
    const action = described.length
      ? described.map((line) => escapeHTML(line)).join('<br>')
      : escapeHTML(entry.summary || entry.action || translate('district_management_audit_unknown_change'));
    const createdAt = this.formatAuditTimestamp(entry.created_at || entry.timestamp);
    const statusBadge =
      entry.status === 'error'
        ? `<span class="status-pill status-pill--warning">${translate('district_management_audit_status_error')}</span>`
        : '';

    return `
      <li class="dm-audit-entry">
        <div class="dm-audit-meta">
          <span class="dm-audit-actor">${actor}</span>
          <span class="dm-audit-time">${createdAt}</span>
          ${statusBadge}
        </div>
        <p class="dm-audit-summary">${action}</p>
      </li>
    `;
  }

  formatAuditTimestamp(value) {
    if (!value) {return translate('district_management_audit_time_unknown');}
    try {
      const lang = this.app?.lang || 'en';
      return new Date(value).toLocaleString(lang, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch (error) {
      debugError('district_management: failed to format audit timestamp', error);
      return escapeHTML(String(value));
    }
  }

  attachEventListeners() {
    document.getElementById('dm-load-retry')?.addEventListener('click', () => this.refreshData(true));

    const searchInput = document.getElementById('dm-search-input');
    if (searchInput) {
      searchInput.removeEventListener('input', this.debouncedSearch);
      searchInput.addEventListener('input', this.debouncedSearch);
    }

    const organizationSelect = document.getElementById('dm-org-select');
    if (organizationSelect) {
      organizationSelect.addEventListener('change', async (event) => {
        const newOrgId = event.target.value;
        await this.handleOrganizationChange(newOrgId);
      });
    }

    document.querySelectorAll('[data-role-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const role = chip.getAttribute('data-role-filter');
        if (role === '__clear') {
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

    document.querySelectorAll('.dm-user-card').forEach((card) => {
      card.addEventListener('click', () => {
        const userId = card.getAttribute('data-user-id');
        this.openModal(userId);
      });
    });

    const refreshButton = document.getElementById('dm-refresh');
    refreshButton?.addEventListener('click', () => this.refreshData(true));

    const bottomRetry = document.getElementById('dm-bottom-retry');
    bottomRetry?.addEventListener('click', () => this.retryQueuedChanges());

    const retryButton = document.getElementById('dm-retry');
    retryButton?.addEventListener('click', () => this.retryQueuedChanges());

    document.querySelectorAll('[data-discard-queued]').forEach((button) => {
      button.addEventListener('click', () => this.discardQueuedChange(button.dataset.discardQueued));
    });

    document.getElementById('dm-inactive-accounts')?.addEventListener('toggle', (event) => {
      this.inactiveExpanded = event.target.open;
    });

    document.querySelectorAll('.dm-bundle-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const roleId = parseInt(event.target.getAttribute('data-role-id'), 10);
        if (event.target.checked) {
          this.selectedRoleIds.add(roleId);
        } else {
          this.selectedRoleIds.delete(roleId);
        }
        this.renderAndBind();
      });
    });

    const saveButton = document.getElementById('dm-save');
    saveButton?.addEventListener('click', () => this.handleSaveRoles());

    document.getElementById('dm-membership-toggle')?.addEventListener('click', () => this.toggleMembership());

    const queueButton = document.getElementById('dm-queue');
    queueButton?.addEventListener('click', () => this.queuePendingChange());

    const auditInput = document.getElementById('dm-audit-note');
    if (auditInput) {
      auditInput.addEventListener('input', (event) => {
        this.auditNote = event.target.value || '';
      });
    }

    const mfaCheckbox = document.getElementById('dm-mfa-confirm');
    mfaCheckbox?.addEventListener('change', (event) => {
      this.mfaAcknowledged = event.target.checked;
      this.renderAndBind();
    });

    const mfaButton = document.getElementById('dm-mfa-start');
    mfaButton?.addEventListener('click', () => {
      this.app.showMessage('district_management_mfa_placeholder', 'info');
    });
  }

  renderSyncBadge() {
    const node = document.getElementById('dm-sync-status');
    if (!node) {return;}
    node.textContent = this.syncing
      ? translate('district_management_refreshing')
      : `${translate('district_management_last_synced')}: ${this.formatTimestamp(this.lastSyncedAt)}`;
  }

  formatTimestamp(timestamp) {
    if (!timestamp) {return translate('district_management_not_synced');}
    const lang = this.app?.lang || 'en';
    return new Date(timestamp).toLocaleString(lang, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  getFilteredUsers() {
    const term = this.searchTerm.trim().toLowerCase();
    return this.users.filter((user) => {
      const matchesSearch =
        !term ||
        (user.full_name || '').toLowerCase().includes(term) ||
        (user.email || '').toLowerCase().includes(term) ||
        this.childNames(user).toLowerCase().includes(term);

      const matchesFilter =
        this.activeRoleFilters.size === 0 ||
        (Array.isArray(user.roles) &&
          user.roles.some((role) => this.activeRoleFilters.has(role.role_name)));

      return matchesSearch && matchesFilter;
    });
  }

  getUserRoles(user) {
    if (!Array.isArray(user.roles) || !user.roles.length) {return [];}
    return user.roles.map((role) => ({
      ...role,
      display_name: roleLabel(role),
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

  async loadAuditLog(userId, forceRefresh = false) {
    const generation = this.unitGeneration;
    this.loadingAuditUserId = userId;
    this.auditPanelError = '';
    this.renderAndBind();

    try {
      const response = await getRoleAuditLog(userId, {
        limit: 15,
        organizationId: this.organizationId,
        forceRefresh,
      });
      // The previous unit's history has no place in this one.
      if (generation !== this.unitGeneration) {
        return;
      }
      if (response?.success) {
        this.auditLogByUser[userId] = response.data || response.audit || [];
      } else {
        this.auditPanelError = translate('district_management_audit_error');
        this.auditLogByUser[userId] = [];
      }
    } catch (error) {
      if (generation !== this.unitGeneration) {
        return;
      }
      debugError('district_management: failed to load audit log', error);
      this.auditPanelError = apiErrorMessage(error, 'district_management_audit_error');
    } finally {
      if (generation === this.unitGeneration) {
        this.loadingAuditUserId = null;
        this.renderAndBind();
      }
    }
  }

  async openModal(userId) {
    this.selectedUserId = userId;
    const user = this.users.find((u) => u.id === userId);
    const roleIds = (user?.roles || []).map((role) => role.id || role.role_id || role.role_name);
    this.selectedRoleIds = new Set(roleIds);
    this.auditNote = '';
    this.mfaAcknowledged = false;
    this.formStatus = { type: '', message: '' };
    this.auditPanelError = '';
    this.renderAndBind();
    this.loadAuditLog(userId, true);
  }

  closeModal() {
    this.clearSelection();
    this.renderAndBind();
  }

  /** Forget the member whose roles were being edited. */
  clearSelection() {
    this.selectedUserId = null;
    this.selectedRoleIds = new Set();
    this.auditNote = '';
    this.mfaAcknowledged = false;
    this.loadingAuditUserId = null;
    this.auditPanelError = '';
    this.formStatus = { type: '', message: '' };
  }

  getRoleBundles() {
    return this.roleBundleIndex.list.map((role) => ({
      ...role,
      display_name: roleLabel(role),
      description:
        role.description ||
        translate(`district_management_bundle_${role.role_name}`) ||
        translate('district_management_generic_bundle_description'),
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
      return translate('district_management_admin_safeguard');
    }

    const selectedHighLevel = Array.from(this.selectedRoleIds).some((id) => {
      const role = this.getRoleById(id);
      return role && this.isBlockedByRoleLevel(role.role_name);
    });

    if (selectedHighLevel) {
      return translate('district_management_level_block');
    }

    return '';
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
        translate('district_management_conflict_roles');
      return {
        blocking: messageTemplate.replace('{roles}', conflictResult.conflicts.join(', ')),
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
        translate('district_management_permission_gap');
      const missingList = permissionGaps.missing.join(', ');
      return { blocking: template.replace('{permissions}', missingList), warnings: [] };
    }

    const warnings = [];
    const localGroupRoles = getLocalGroupEligibleRoles(selectedRoleNames, this.roleBundleIndex);
    if (localGroupRoles.length) {
      const template =
        translate('district_management_local_group_notice');
      const bundleLabels = localGroupRoles
        .map((roleName) => roleLabel(this.getRoleByName(roleName) || roleName))
        .filter(Boolean)
        .join(', ');
      warnings.push(bundleLabels ? `${template} (${bundleLabels})` : template);
    }

    return { blocking: '', warnings };
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

  async reconcileUserRoles(userId) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) {return;}

    try {
      const response = await getUserRoleAssignments(userId, {
        organizationId: this.organizationId,
        forceRefresh: true,
      });
      if (response?.success) {
        const roles = response.data || [];
        const roleIds = roles.map((role) => role.id);
        this.applyOptimisticRoles(user, roleIds);
        this.selectedRoleIds = new Set(roleIds);
        this.filteredUsers = this.getFilteredUsers();
      }
    } catch (error) {
      debugError('district_management: failed to reconcile user roles', error);
    }
  }

  /**
   * Persist selected bundle choices for the active user.
   * Optimistically updates the UI, rolls back on error, and clears caches on success.
   */
  async handleSaveRoles() {
    const user = this.users.find((u) => u.id === this.selectedUserId);
    if (!user) {return;}

    const validation = this.getValidationState(user);
    if (validation.blocking) {
      this.app.showMessage(validation.blocking, 'error');
      return;
    }

    if (this.isOffline) {
      this.app.showMessage('district_management_offline_disabled', 'info');
      return;
    }

    if (!canAssignRoles()) {
      this.app.showMessage('no_permission', 'error');
      return;
    }

    const previousRoleIds = [...(user.role_ids || [])];
    const selectedRoleIds = Array.from(this.selectedRoleIds);
    this.applyOptimisticRoles(user, selectedRoleIds);
    this.filteredUsers = this.getFilteredUsers();
    this.savingUserId = user.id;
    this.writesInFlight += 1;
    this.formStatus = { type: 'info', message: translate('district_management_saving') };
    this.renderAndBind();

    try {
      await updateUserRoleBundles(
        user.id,
        {
          roleIds: selectedRoleIds,
          bundleIds: selectedRoleIds,
          bundles: this.describeSelectedBundles(selectedRoleIds),
          audit_note: this.auditNote.trim(),
        },
        {
          organizationId: this.organizationId,
          audit_note: this.auditNote.trim(),
          bundles: this.describeSelectedBundles(selectedRoleIds),
          roleIds: selectedRoleIds,
        },
      );
      await this.reconcileUserRoles(user.id);
      await this.loadAuditLog(user.id, true);
      this.userMeta[user.id] = { lastSyncedAt: Date.now(), roleCount: selectedRoleIds.length };
      this.lastSyncedAt = Date.now();
      await clearUserCaches(this.organizationId);
      this.formStatus = { type: 'success', message: translate('district_management_assignment_saved') };
      this.app.showMessage('district_management_assignment_saved', 'success');
      this.closeModal();
    } catch (error) {
      debugError('district_management: save failed', error);
      this.rollbackRoles(user, previousRoleIds);
      this.queueChange(user.id, selectedRoleIds, 'error', previousRoleIds);
      this.formStatus = { type: 'error', message: apiErrorMessage(error, 'district_management_assignment_failed') };
      this.recordLocalAuditEntry(user.id, selectedRoleIds, 'error');
      this.userMeta[user.id] = {
        lastSyncedAt: this.userMeta[user.id]?.lastSyncedAt || Date.now(),
        roleCount: previousRoleIds.length,
      };
      this.app.showMessage('district_management_assignment_failed', 'error');
      this.renderAndBind();
    } finally {
      this.savingUserId = null;
      this.writesInFlight -= 1;
      await this.persistCache();
      this.renderAndBind();
    }
  }

  /**
   * Queue the current selection for later synchronization.
   * Used when offline to avoid destructive operations while still capturing intent.
   */
  async queuePendingChange() {
    const user = this.users.find((u) => u.id === this.selectedUserId);
    if (!user) {return;}
    const validation = this.getValidationState(user);
    if (validation.blocking) {
      this.app.showMessage(validation.blocking, 'error');
      return;
    }
    const selectedRoleIds = Array.from(this.selectedRoleIds);
    this.queueChange(user.id, selectedRoleIds, null, user.role_ids || []);
    this.applyOptimisticRoles(user, selectedRoleIds);
    this.filteredUsers = this.getFilteredUsers();
    await this.persistCache();
    this.app.showMessage('district_management_assignment_queued', 'info');
    this.closeModal();
  }

  /**
   * Keep a role change to send later.
   *
   * @param {string} userId - Member
   * @param {number[]} roleIds - Roles to give them
   * @param {string|null} reason - Why it waits: null, 'error', 'stale', 'organization_mismatch'
   * @param {number[]} baseRoleIds - Their roles when the change was made, so a
   *   retry can tell whether someone changed them since
   */
  queueChange(userId, roleIds, reason = null, baseRoleIds = []) {
    // A change made over one still waiting, while the screen shows that first
    // change rather than the server, starts from the first one's roles. Made
    // after a refresh brought the server's roles back, it starts from those.
    const waiting = this.queuedChanges.find((item) => item.userId === userId);
    const overWaiting = waiting && this.hasSameRoles(waiting.roleIds, baseRoleIds)
      && Array.isArray(waiting.baseRoleIds);
    const change = {
      userId,
      roleIds,
      baseRoleIds: [...(overWaiting ? waiting.baseRoleIds : baseRoleIds)],
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
      .map((role) => roleLabel(role));
  }

  recordLocalAuditEntry(userId, roleIds, status = 'success') {
    const actorName =
      this.app?.userFullName ||
      localStorage.getItem('userFullName') ||
      translate('district_management_unknown_actor');
    const summary = this.describeSelectedBundles(roleIds).join(', ');
    const entry = {
      actor_name: actorName,
      summary,
      status,
      created_at: new Date().toISOString(),
    };

    const existing = this.auditLogByUser[userId] || [];
    this.auditLogByUser[userId] = [entry, ...existing].slice(0, 15);
  }

  /**
   * Whether two sets of role ids are the same. A change queued before the
   * roles it started from were recorded has nothing to compare: it counts as
   * stale, to be sent again or dropped by a person.
   *
   * @param {number[]|undefined} before - Roles when the change was queued
   * @param {number[]} now - Roles now
   * @returns {boolean} True when they match
   */
  hasSameRoles(before, now = []) {
    if (!Array.isArray(before)) {
      return false;
    }
    const current = new Set(now);
    return before.length === current.size && before.every((id) => current.has(id));
  }

  /**
   * Drop a waiting change. The member gets back the roles it started from,
   * then their roles are reloaded from the server.
   *
   * @param {string} userId - Member whose change to drop
   * @returns {Promise<void>}
   */
  async discardQueuedChange(userId) {
    const user = this.users.find((candidate) => candidate.id === userId);
    const dropped = this.queuedChanges.find((change) => change.userId === userId);
    // While the member still shows the dropped change, put back the roles it
    // started from now, so the screen is right even when the reload below
    // cannot reach the server. Roles a refresh already brought back stay.
    if (user && Array.isArray(dropped?.baseRoleIds) && this.hasSameRoles(dropped.roleIds, user.role_ids)) {
      this.applyOptimisticRoles(user, dropped.baseRoleIds);
      this.filteredUsers = this.getFilteredUsers();
    }
    this.queuedChanges = this.queuedChanges.filter((change) => change.userId !== userId);
    await this.persistCache();
    this.app.showMessage(
      translate('district_management_queue_discarded')
        .replace('{name}', user?.full_name || user?.email || translate('district_management_unknown_member')),
      'success',
    );
    await this.refreshData(true);
    if (this.destroyed) {
      return;
    }
    const next = document.getElementById(this.queuedChanges.length ? 'dm-queue-title' : 'dm-refresh');
    next?.focus();
  }

  /**
   * Attempt to reapply queued updates, unless the member's roles changed since.
   */
  async retryQueuedChanges() {
    if (!this.queuedChanges.length) {
      this.app.showMessage('district_management_no_queue', 'info');
      return;
    }

    if (this.isOffline) {
      this.app.showMessage('district_management_offline_disabled', 'info');
      return;
    }

    const generation = this.unitGeneration;
    await this.refreshData(true);
    const remaining = [];
    let staleCount = 0;
    let errorCount = 0;

    for (const change of this.queuedChanges) {
      // The session moved to another unit: the rest would be sent there.
      if (generation !== this.unitGeneration) {
        return;
      }
      if (change.organizationId && String(change.organizationId) !== String(this.organizationId)) {
        remaining.push({ ...change, reason: 'organization_mismatch' });
        continue;
      }

      const user = this.users.find((u) => u.id === change.userId);
      if (!user) {
        continue;
      }

      // Stale only when the member's roles changed since the change was made.
      // Comparing sync times made every change stale: the refresh above
      // marks every member as just synced, so none could ever be sent.
      if (!this.hasSameRoles(change.baseRoleIds, user.role_ids)) {
        remaining.push({ ...change, reason: 'stale' });
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
        this.app.showMessage('district_management_assignment_saved', 'success');
      } catch (error) {
        debugError('district_management: queued change failed', error);
        remaining.push({ ...change, reason: error?.message || 'error' });
        errorCount += 1;
      }
    }

    this.queuedChanges = remaining;
    this.filteredUsers = this.getFilteredUsers();
    await this.persistCache();
    this.renderAndBind();

    if (staleCount > 0) {
      this.app.showMessage('district_management_stale_queue', 'info');
    }
    if (errorCount > 0) {
      this.app.showMessage('district_management_assignment_failed', 'error');
    }
  }
}
