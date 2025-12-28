/**
 * Role Management Page (Refactored - Role-Centric)
 *
 * Allows district and unitadmin users to:
 * 1. View roles and their permissions
 * 2. Assign roles to users
 */

import { app, translate } from './app.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { hasPermission, isDistrictAdmin } from './utils/PermissionUtils.js';
import { escapeHTML } from './utils/SecurityUtils.js';
import { setContent } from "./utils/DOMUtils.js";
import {
  clearActivityRelatedCaches,
  deleteCachedData
} from './indexedDB.js';
import {
  getUsers,
  getRoleCatalog,
  getUserRoles,
  updateUserRolesV1
} from './api/api-endpoints.js';
import { API } from './api/api-core.js';

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
      this.renderError(error.message);
    }
  }

  async fetchUsers() {
    const result = await getUsers();
    this.users = result.users || result.data || [];
    debugLog('Fetched users:', this.users.length);
  }

  async fetchRoles() {
    const result = await getRoleCatalog();
    this.roles = result.data || [];
    debugLog('Fetched roles:', this.roles.length);
  }

  async fetchRolePermissions(roleId) {
    const result = await API.get(`roles/${roleId}/permissions`);
    return result.data || [];
  }

  async fetchUserRoles(userId) {
    const result = await getUserRoles(userId);
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
      // Clear user-specific caches
      await deleteCachedData(`v1/users/${userId}/roles`);
      await deleteCachedData('v1/users');

      // Clear activity caches as permissions may have changed
      await clearActivityRelatedCaches();

      debugLog('User caches invalidated after role update');
    } catch (error) {
      debugError('Error invalidating user caches:', error);
    }
  }

  renderAccessDenied() {
    const appContainer = document.getElementById('app');
    setContent(appContainer, `
      <div class="role-management-container">
        <h1>${translate('access_denied') || 'Access Denied'}</h1>
        <p>${translate('no_permission_role_management') || 'You do not have permission to manage roles.'}</p>
        <a href="/dashboard" class="btn-primary">${translate('back_to_dashboard') || 'Back to Dashboard'}</a>
      </div>
    `);
  }

  renderError(message) {
    const appContainer = document.getElementById('app');
    setContent(appContainer, `
      <div class="role-management-container">
        <h1>${translate('error') || 'Error'}</h1>
        <p class="error-message">${message}</p>
        <a href="/dashboard" class="btn-primary">${translate('back_to_dashboard') || 'Back to Dashboard'}</a>
      </div>
    `);
  }

  render() {
    const canAssignRoles = hasPermission('users.assign_roles');
    const isDistrict = isDistrictAdmin();

    const content = `
      <div class="role-management-container">
        <div class="page-header">
          <h1>${translate('role_management') || 'Role & Permission Management'}</h1>
          <a href="/dashboard" class="back-link">${translate('back_to_dashboard') || 'Back to Dashboard'}</a>
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
            <h3 class="role-name">${this.escapeHtml(role.display_name)}</h3>
            <span class="role-badge role-badge-${role.role_name}">${this.escapeHtml(role.role_name)}</span>
          </div>
          <button class="toggle-permissions-btn" data-role-id="${role.id}">
            <span class="icon">${isExpanded ? '▼' : '▶'}</span>
            ${translate('view_permissions') || 'View Permissions'}
          </button>
        </div>

        <p class="role-description">${this.escapeHtml(role.description || 'No description available')}</p>

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
      const roleNames = (user.roles || []).map(r => r.display_name || r.role_name).join(', ');
      const isSelected = this.selectedUserId === user.id;

      return `
        <div class="user-item ${isSelected ? 'selected' : ''}" data-user-id="${user.id}">
          <div class="user-info">
            <div class="user-name">${this.escapeHtml(user.full_name || user.email)}</div>
            <div class="user-email">${this.escapeHtml(user.email)}</div>
            ${roleNames ? `<div class="user-roles-summary">${this.escapeHtml(roleNames)}</div>` : ''}
          </div>
          <div class="user-action">
            <button class="btn-small btn-manage-roles" data-user-id="${user.id}">
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
          <h2>${translate('manage_roles_for') || 'Manage Roles for'}:</h2>
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
                      ${this.escapeHtml(role.display_name)}
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
              ${this.roles.map(role => `
                <label class="role-checkbox-item">
                  <input
                    type="checkbox"
                    name="role_ids"
                    value="${role.id}"
                    ${userRoleIds.includes(role.id) ? 'checked' : ''}
                  />
                  <div class="role-checkbox-content">
                    <div class="role-checkbox-header">
                      <strong>${this.escapeHtml(role.display_name)}</strong>
                      <span class="role-badge-small role-badge-${role.role_name}">${role.role_name}</span>
                    </div>
                    <small class="role-checkbox-description">${this.escapeHtml(role.description || '')}</small>
                  </div>
                </label>
              `).join('')}
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

          <div id="assignment-message" class="status-message"></div>
        </form>
      </div>
    `;
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
    // User selection
    const manageButtons = document.querySelectorAll('.btn-manage-roles');
    manageButtons.forEach(button => {
      button.addEventListener('click', async (e) => {
        e.preventDefault();
        const userId = e.currentTarget.dataset.userId;
        await this.showUserRoleAssignment(userId);
      });
    });

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
          setContent(container, `<p class="error-message">${escapeHTML(error.message)}</p>`);
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
    setContent(assignmentContent, '<div class="loading-spinner">Loading...</div>');
    const html = await this.renderUserAssignment(userId);
    setContent(assignmentContent, html);
    // Attach form listener
    this.attachAssignmentFormListeners();
  }

  attachAssignmentFormListeners() {
    const form = document.getElementById('user-role-assignment-form');
    if (!form) return;

    const cancelBtn = document.getElementById('cancel-assignment');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.selectedUserId = null;
        setContent(document.getElementById('user-assignment-content'), this.renderUserAssignmentPlaceholder());
        // Remove selected state from users
        document.querySelectorAll('.user-item').forEach(item => {
          item.classList.remove('selected');
        });
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
        this.attachUsersTabListeners();
      } catch (error) {
        debugError('Error updating roles:', error);
        this.showAssignmentMessage(error.message, 'error');
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
