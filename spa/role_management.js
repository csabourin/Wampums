/**
 * Role Management Page (Refactored - Role-Centric)
 *
 * Allows district and unitadmin users to:
 * 1. View roles and their permissions
 * 2. Assign roles to users
 */

import roleManagementStylesheetUrl from '../css/role-management.css?url';
import { app, translate } from './app.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { hasPermission } from './utils/PermissionUtils.js';
import { roleDescription, roleLabel } from './utils/RoleLabelUtils.js';
import { escapeHTML } from './utils/SecurityUtils.js';
import { setContent, loadStylesheet } from "./utils/DOMUtils.js";
import { deleteCachedData } from './indexedDB.js';
import {
  getUsers,
  getRoleCatalog,
  getUserRoleAssignments,
  updateUserRolesV1,
  clearUserCaches
} from './api/api-endpoints.js';
import { setUserMembershipStatus } from './api/api-members.js';
import { confirmDestructive } from './utils/DialogUtils.js';
import { API } from './api/api-core.js';

import { apiErrorMessage } from './utils/ApiErrorUtils.js';
export class RoleManagement {
  constructor(appInstance) {
    this.app = appInstance;
    this.users = [];
    this.roles = [];
    this.permissions = {};
    this.selectedUserId = null;
    this.selectedRoleId = null;
    this.activeTab = 'roles'; // 'roles' or 'users'
  }

  async init() {
    debugLog('RoleManagement init started');

    // Load page-specific CSS
    await loadStylesheet(roleManagementStylesheetUrl);

    // Check if user has permission to view roles
    if (!hasPermission('roles.view')) {
      this.renderAccessDenied();
      return;
    }

    try {
      // Fetch roles first
      await this.fetchRoles();

      // Only fetch users if we're on the users tab
      if (this.activeTab === 'users') {
        await this.fetchUsers();
      }

      this.render();
    } catch (error) {
      debugError('Error initializing role management:', error);
      this.renderError(apiErrorMessage(error, 'error_loading_data'));
    }
  }

  async fetchUsers() {
    const result = await getUsers();
    this.users = result.users || result.data || [];
    debugLog('Fetched users:', this.users.length);
  }

  async fetchRoles() {
    // Which roles are assignable depends on the viewer's current permissions.
    const result = await getRoleCatalog({ forceRefresh: true });
    this.roles = result.data || [];
    debugLog('Fetched roles:', this.roles.length);
  }

  async fetchRolePermissions(roleId) {
    const result = await API.get(`roles/${roleId}/permissions`);
    return result.data || [];
  }

  async fetchUserRoles(userId) {
    const result = await getUserRoleAssignments(userId);
    return result.data || [];
  }

  async updateUserRoles(userId, roleIds) {
    const result = await updateUserRolesV1(userId, roleIds);

    // Clear relevant caches after role update
    await this.invalidateUserCaches(userId);

    return result;
  }

  async invalidateUserCaches(userId) {
    try {
      await deleteCachedData(`v1/users/${userId}/roles`);
      await clearUserCaches();

      debugLog('User caches invalidated after role update');
    } catch (error) {
      debugError('Error invalidating user caches:', error);
    }
  }

  renderAccessDenied() {
    const appContainer = document.getElementById('app');
    setContent(appContainer, `
      <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
      <div class="role-management-container">
        <h1>${translate('access_denied') || 'Access Denied'}</h1>
        <p>${translate('no_permission_role_management') || 'You do not have permission to manage roles.'}</p>
      </div>
    `);
  }

  renderError(message) {
    const appContainer = document.getElementById('app');
    setContent(appContainer, `
      <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
      <div class="role-management-container">
        <h1>${translate('error') || 'Error'}</h1>
        <p class="error-message">${message}</p>
      </div>
    `);
  }

  render() {
    const canAssignRoles = hasPermission('users.assign_roles');

    const content = `
      <a href="/dashboard" class="button button--ghost">← ${translate('back')}</a>
      <div class="role-management-container">
        <div class="page-header">
          <h1>${translate('role_management') || 'Role & Permission Management'}</h1>
        </div>

        <!-- Tab Navigation -->
        <div class="tab-navigation">
          <button
            class="tab-button ${this.activeTab === 'roles' ? 'active' : ''}"
            data-tab="roles"
          >
            ${translate('roles_and_permissions') || 'Roles & Permissions'}
          </button>
          <button
            class="tab-button ${this.activeTab === 'users' ? 'active' : ''}"
            data-tab="users"
            ${!canAssignRoles ? 'disabled' : ''}
          >
            ${translate('assign_roles_to_users') || 'Assign Roles to Users'}
          </button>
        </div>

        <!-- Tab Content -->
        <div class="tab-content">
          ${this.activeTab === 'roles' ? this.renderRolesTab() : this.renderUsersTab()}
        </div>
      </div>
    `;

    const appContainer = document.getElementById('app');
    setContent(appContainer, content);
    // Attach event listeners
    this.attachEventListeners();
  }

  renderRolesTab() {
    return `
      <div class="roles-tab">
        <div class="tab-description">
          <p>${translate('roles_tab_description') || 'View all available roles and their associated permissions. Each role grants specific access rights within the organization.'}</p>
        </div>

        <div class="roles-grid">
          ${this.roles.map(role => this.renderRoleCard(role)).join('')}
        </div>
      </div>
    `;
  }

  renderRoleCard(role) {
    const isExpanded = this.selectedRoleId === role.id;

    return `
      <div class="role-card ${isExpanded ? 'expanded' : ''}" data-role-id="${role.id}">
        <div class="role-card-header">
          <div class="role-info">
            <h3 class="role-name">${this.escapeHtml(roleLabel(role))}</h3>
          </div>
          <button class="toggle-permissions-btn" data-role-id="${role.id}">
            <span class="icon">${isExpanded ? '▼' : '▶'}</span>
            ${translate('view_permissions') || 'View Permissions'}
          </button>
        </div>

        <p class="role-description">${this.escapeHtml(roleDescription(role) || translate('district_management_generic_bundle_description'))}</p>

        <div class="role-permissions-container ${isExpanded ? 'visible' : 'hidden'}" id="role-permissions-${role.id}">
          ${isExpanded ? '<div class="loading-spinner">Loading permissions...</div>' : ''}
        </div>
      </div>
    `;
  }

  renderUsersTab() {
    if (!hasPermission('users.assign_roles')) {
      return `
        <div class="users-tab">
          <div class="access-denied-message">
            <p>${translate('no_permission_assign_roles') || 'You do not have permission to assign roles to users.'}</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="users-tab">
        <div class="tab-description">
          <p>${translate('users_tab_description') || 'Assign one or more roles to users in your organization. Users inherit all permissions from their assigned roles.'}</p>
        </div>

        <div class="users-layout">
          <!-- User List -->
          <div class="user-list-panel">
            <div class="panel-header">
              <h2>${translate('users') || 'Users'}</h2>
              <div class="user-search">
                <input
                  type="text"
                  id="user-search-input"
                  placeholder="${translate('search_users') || 'Search users...'}"
                />
              </div>
            </div>
            <div id="user-list" class="user-list">
              ${this.renderUserList()}
            </div>
          </div>

          <!-- User Role Assignment -->
          <div class="user-assignment-panel">
            <div id="user-assignment-content">
              ${this.renderUserAssignmentPlaceholder()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderUserList() {
    if (this.users.length === 0) {
      return `<p class="empty-state">${translate('no_users_found') || 'No users found'}</p>`;
    }

    return this.users.map(user => {
      const roleNames = (user.roles || []).map(r => roleLabel(r)).join(', ');
      const isSelected = this.selectedUserId === user.id;

      return `
        <div class="user-item ${isSelected ? 'selected' : ''}" data-user-id="${user.id}">
          <div class="user-info">
            <div class="user-name">
              ${this.escapeHtml(user.full_name || user.email)}
              ${user.status === 'inactive' ? `<span class="member-inactive-badge">${translate('member_access_inactive_badge')}</span>` : ''}
            </div>
            <div class="user-email">${this.escapeHtml(user.email)}</div>
            ${roleNames ? `<div class="user-roles-summary">${this.escapeHtml(roleNames)}</div>` : ''}
          </div>
          <div class="user-action">
            <button class="btn-small btn-manage-roles" data-user-id="${user.id}"${isSelected ? ' aria-current="true"' : ''}>
              ${translate('manage_roles') || 'Manage'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderUserAssignmentPlaceholder() {
    return `
      <div class="placeholder-state">
        <div class="placeholder-icon">👤</div>
        <p>${translate('select_user_to_manage_roles') || 'Select a user from the list to manage their roles'}</p>
      </div>
    `;
  }

  async renderUserAssignment(userId) {
    const user = this.users.find(u => u.id === userId);
    if (!user) return '';

    const userRoles = await this.fetchUserRoles(userId);
    const userRoleIds = userRoles.map(r => r.id);

    return `
      <div class="user-assignment">
        <div class="assignment-header">
          <h2 id="user-assignment-heading" tabindex="-1">${translate('manage_roles_for') || 'Manage Roles for'}:</h2>
          <div class="user-details">
            <div class="user-name-large">${this.escapeHtml(user.full_name || user.email)}</div>
            <div class="user-email-small">${this.escapeHtml(user.email)}</div>
          </div>
        </div>

        <form id="user-role-assignment-form">
          <input type="hidden" id="selected-user-id" value="${userId}" />

          <div class="current-roles-section">
            <h3>${translate('current_roles') || 'Current Roles'}</h3>
            <div class="role-badges">
              ${userRoles.length > 0
                ? userRoles.map(role => `
                    <span class="role-badge role-badge-${role.role_name}">
                      ${this.escapeHtml(roleLabel(role))}
                    </span>
                  `).join('')
                : `<span class="empty-badge">${translate('no_roles_assigned') || 'No roles assigned'}</span>`
              }
            </div>
          </div>

          <div class="available-roles-section">
            <h3>${translate('available_roles') || 'Available Roles'}</h3>
            <p class="help-text">${translate('select_roles_help') || 'Select one or more roles to assign to this user. Users will have all permissions from their assigned roles.'}</p>

            <div class="role-checkboxes">
              ${this.roles.map(role => {
                // Roles carrying permissions the viewer does not hold cannot be
                // granted or removed by them; they stay visible, keeping their
                // state, so saving sends them back unchanged.
                const locked = role.assignable === false;
                const noteId = `role-locked-note-${role.id}`;
                return `
                <div class="role-checkbox-option">
                  <label class="role-checkbox-item${locked ? ' role-checkbox-item--locked' : ''}">
                    <input
                      type="checkbox"
                      name="role_ids"
                      value="${role.id}"
                      ${userRoleIds.includes(role.id) ? 'checked' : ''}
                      ${locked ? `disabled aria-describedby="${noteId}"` : ''}
                    />
                    <div class="role-checkbox-content">
                      <div class="role-checkbox-header">
                        <strong>${this.escapeHtml(roleLabel(role))}</strong>
                      </div>
                      <small class="role-checkbox-description">${this.escapeHtml(roleDescription(role))}</small>
                    </div>
                  </label>
                  ${locked ? `<small class="role-locked-note" id="${noteId}">${translate('role_not_assignable')}</small>` : ''}
                </div>
              `;
              }).join('')}
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn-primary">
              ${translate('save_roles') || 'Save Roles'}
            </button>
            <button type="button" class="btn-secondary" id="cancel-assignment">
              ${translate('cancel') || 'Cancel'}
            </button>
          </div>

          <div id="assignment-message" class="status-message" role="status" aria-live="polite"></div>
        </form>
        ${this.renderMembershipSection(user)}
      </div>
    `;
  }

  /**
   * Access to the unit: deactivate someone who left (a leader who stepped
   * down), or bring them back. Their account, roles and history are kept.
   *
   * @param {Object} user - User row (status: 'active' | 'inactive' | 'alumni')
   * @returns {string} Section HTML, empty without users.delete
   */
  renderMembershipSection(user) {
    if (!hasPermission('users.delete')) {
      return '';
    }
    const inactive = user.status === 'inactive';
    return `
      <section class="membership-section" aria-labelledby="membership-heading">
        <h3 id="membership-heading">${translate('member_access_title')}</h3>
        <p>${translate(inactive ? 'member_access_inactive' : 'member_access_active')}</p>
        <button type="button" id="membership-toggle" class="${inactive ? 'btn-secondary' : 'btn-danger'}">
          ${translate(inactive ? 'member_access_reactivate' : 'member_access_deactivate')}
        </button>
        <div id="membership-message" class="status-message" role="status" aria-live="polite"></div>
      </section>
    `;
  }

  /**
   * Deactivate (after confirmation) or reactivate the member being edited.
   *
   * @param {string} userId - Member UUID
   */
  async toggleMembership(userId) {
    const user = this.users.find(u => u.id === userId);
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
        document.getElementById('membership-toggle')?.focus();
        return;
      }
    }

    let messageKey;
    let type = 'success';
    try {
      await setUserMembershipStatus(userId, deactivating ? 'inactive' : 'active');
      await this.invalidateUserCaches(userId);
      await this.fetchUsers();
      setContent(document.getElementById('user-list'), this.renderUserList());
      this.attachUserListListeners();
      setContent(document.getElementById('user-assignment-content'), await this.renderUserAssignment(userId));
      this.attachAssignmentFormListeners();
      this.markSelectedUser(userId);
      messageKey = deactivating ? 'member_access_deactivated' : 'member_access_reactivated';
    } catch (error) {
      debugError('Error changing membership:', error);
      const FORBIDDEN = 403;
      messageKey = error.status === FORBIDDEN ? 'member_access_forbidden' : 'member_access_error';
      type = 'error';
    }

    const message = document.getElementById('membership-message');
    if (message) {
      message.textContent = translate(messageKey);
      message.className = `status-message ${type}`;
    }
    document.getElementById('membership-toggle')?.focus();
  }

  attachEventListeners() {
    // Tab switching
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.addEventListener('click', async (e) => {
        const tab = e.currentTarget.dataset.tab;
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;

          // Fetch users if switching to users tab and not loaded yet
          if (tab === 'users' && this.users.length === 0) {
            await this.fetchUsers();
          }

          this.render();
        }
      });
    });

    if (this.activeTab === 'roles') {
      this.attachRolesTabListeners();
    } else {
      this.attachUsersTabListeners();
    }
  }

  attachRolesTabListeners() {
    // Toggle role permissions
    const toggleButtons = document.querySelectorAll('.toggle-permissions-btn');
    toggleButtons.forEach(button => {
      button.addEventListener('click', async (e) => {
        e.preventDefault();
        const roleId = parseInt(e.currentTarget.dataset.roleId);
        await this.toggleRolePermissions(roleId);
      });
    });
  }

  attachUsersTabListeners() {
    this.attachUserListListeners();

    // User search
    const searchInput = document.getElementById('user-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterUsers(e.target.value);
      });
    }

    // If a user is already selected, attach form listeners
    if (this.selectedUserId) {
      this.attachAssignmentFormListeners();
    }
  }

  /**
   * Bind the "manage roles" button of each user in the list. Kept apart from
   * the form listeners: re-rendering the list after a save must not bind the
   * form a second time, which made the next save send the request twice.
   */
  attachUserListListeners() {
    document.querySelectorAll('.btn-manage-roles').forEach(button => {
      button.addEventListener('click', async (e) => {
        e.preventDefault();
        const userId = e.currentTarget.dataset.userId;
        await this.showUserRoleAssignment(userId);
      });
    });
  }

  /**
   * Show which user is being edited: highlighted card, aria-current button.
   *
   * @param {?string} userId - Selected user's UUID, or null for none
   */
  markSelectedUser(userId) {
    document.querySelectorAll('.user-item').forEach(item => {
      const selected = item.dataset.userId === userId;
      item.classList.toggle('selected', selected);
      const button = item.querySelector('.btn-manage-roles');
      if (selected) {
        button?.setAttribute('aria-current', 'true');
      } else {
        button?.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Bring the role form into view and move focus to its heading.
   *
   * On a phone the form sits below the whole user list, so opening it showed
   * no change and seemed to do nothing; a screen reader heard nothing either.
   */
  revealUserAssignment() {
    const heading = document.getElementById('user-assignment-heading');
    if (!heading) {
      return;
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    heading.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    heading.focus({ preventScroll: true });
  }

  /**
   * Return to the user whose roles were being edited.
   *
   * @param {string} userId - That user's UUID
   */
  returnToUser(userId) {
    const button = Array.from(document.querySelectorAll('.btn-manage-roles'))
      .find(candidate => candidate.dataset.userId === userId);
    if (!button) {
      return;
    }
    button.scrollIntoView?.({ block: 'center' });
    button.focus({ preventScroll: true });
  }

  async toggleRolePermissions(roleId) {
    const wasExpanded = this.selectedRoleId === roleId;

    // Toggle selection
    this.selectedRoleId = wasExpanded ? null : roleId;

    // Re-render to update UI
    this.render();

    // If expanding, load permissions
    if (!wasExpanded) {
      const container = document.getElementById(`role-permissions-${roleId}`);
      if (container) {
        try {
          const permissions = await this.fetchRolePermissions(roleId);
          setContent(container, this.renderPermissionsList(permissions));
        } catch (error) {
          debugError('Error loading role permissions:', error);
          setContent(container, `<p class="error-message">${escapeHTML(apiErrorMessage(error, 'error_loading_data'))}</p>`);
        }
      }
    }
  }

  renderPermissionsList(permissions) {
    if (permissions.length === 0) {
      return `<p class="no-permissions">${translate('no_permissions') || 'No permissions assigned to this role'}</p>`;
    }

    // Group permissions by category
    const grouped = permissions.reduce((acc, perm) => {
      if (!acc[perm.category]) {
        acc[perm.category] = [];
      }
      acc[perm.category].push(perm);
      return acc;
    }, {});

    return `
      <div class="permissions-list">
        ${Object.entries(grouped).map(([category, perms]) => `
          <div class="permission-category">
            <h4 class="category-name">${this.escapeHtml(category)}</h4>
            <ul class="permission-items">
              ${perms.map(p => `
                <li class="permission-item" title="${this.escapeHtml(p.description || '')}">
                  <span class="permission-key">${this.escapeHtml(p.permission_key)}</span>
                  <span class="permission-name">${this.escapeHtml(p.permission_name)}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    `;
  }

  async showUserRoleAssignment(userId) {
    this.selectedUserId = userId;

    const assignmentContent = document.getElementById('user-assignment-content');
    setContent(assignmentContent, `<div class="loading-spinner" role="status">${translate('loading')}</div>`);
    const html = await this.renderUserAssignment(userId);
    setContent(assignmentContent, html);
    // Attach form listener
    this.attachAssignmentFormListeners();
    this.markSelectedUser(userId);
    this.revealUserAssignment();
  }

  attachAssignmentFormListeners() {
    const form = document.getElementById('user-role-assignment-form');
    if (!form) return;

    document.getElementById('membership-toggle')?.addEventListener('click', () => {
      this.toggleMembership(document.getElementById('selected-user-id').value);
    });

    const cancelBtn = document.getElementById('cancel-assignment');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        const userId = this.selectedUserId;
        this.selectedUserId = null;
        setContent(document.getElementById('user-assignment-content'), this.renderUserAssignmentPlaceholder());
        this.markSelectedUser(null);
        this.returnToUser(userId);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const userId = document.getElementById('selected-user-id').value;
      const checkboxes = form.querySelectorAll('input[name="role_ids"]:checked');
      const roleIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

      if (roleIds.length === 0) {
        this.showAssignmentMessage(translate('select_at_least_one_role') || 'Please select at least one role', 'error');
        return;
      }

      try {
        await this.updateUserRoles(userId, roleIds);
        this.showAssignmentMessage(translate('roles_updated_successfully') || 'Roles updated successfully!', 'success');

        // Refresh user list
        await this.fetchUsers();
        setContent(document.getElementById('user-list'), this.renderUserList());
        this.attachUserListListeners();
      } catch (error) {
        debugError('Error updating roles:', error);
        const FORBIDDEN = 403;
        this.showAssignmentMessage(
          translate(error.status === FORBIDDEN ? 'role_grant_forbidden' : 'error_updating_role'),
          'error'
        );
      }
    });
  }

  filterUsers(searchTerm) {
    const userItems = document.querySelectorAll('.user-item');
    const term = searchTerm.toLowerCase();

    userItems.forEach(item => {
      const name = item.querySelector('.user-name')?.textContent.toLowerCase() || '';
      const email = item.querySelector('.user-email')?.textContent.toLowerCase() || '';

      if (name.includes(term) || email.includes(term)) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  }

  showAssignmentMessage(message, type = 'info') {
    const messageDiv = document.getElementById('assignment-message');
    if (messageDiv) {
      messageDiv.textContent = message;
      messageDiv.className = `status-message ${type}`;

      // Clear message after 5 seconds
      setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.className = 'status-message';
      }, 5000);
    }
  }

  escapeHtml(text) {
    return escapeHTML(text);
  }
}
