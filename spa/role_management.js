/**
 * Role Management Page
 *
 * Allows district and unitadmin users to manage user roles within their organization
 */

import { app, translate } from './app.js';
import { getApiUrl } from './ajax-functions.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { hasPermission, hasRole, isDistrictAdmin } from './utils/PermissionUtils.js';
import { getStorage } from './utils/StorageUtils.js';

export class RoleManagement {
  constructor(appInstance) {
    this.app = appInstance;
    this.users = [];
    this.roles = [];
    this.permissions = {};
    this.selectedUserId = null;
  }

  async init() {
    debugLog('RoleManagement init started');

    // Check if user has permission to view roles
    if (!hasPermission('roles.view')) {
      this.renderAccessDenied();
      return;
    }

    try {
      // Fetch users, roles, and permissions in parallel
      await Promise.all([
        this.fetchUsers(),
        this.fetchRoles(),
        this.fetchPermissions()
      ]);

      this.render();
    } catch (error) {
      debugError('Error initializing role management:', error);
      this.renderError(error.message);
    }
  }

  async fetchUsers() {
    const response = await fetch(`${getApiUrl()}/users`, {
      headers: {
        'Authorization': `Bearer ${getStorage('jwtToken')}`,
        'X-Organization-Id': getStorage('currentOrganizationId')
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch users');
    }

    const result = await response.json();
    this.users = result.data || [];
    debugLog('Fetched users:', this.users.length);
  }

  async fetchRoles() {
    const response = await fetch(`${getApiUrl()}/roles`, {
      headers: {
        'Authorization': `Bearer ${getStorage('jwtToken')}`,
        'X-Organization-Id': getStorage('currentOrganizationId')
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch roles');
    }

    const result = await response.json();
    this.roles = result.data || [];
    debugLog('Fetched roles:', this.roles.length);
  }

  async fetchPermissions() {
    const response = await fetch(`${getApiUrl()}/permissions`, {
      headers: {
        'Authorization': `Bearer ${getStorage('jwtToken')}`,
        'X-Organization-Id': getStorage('currentOrganizationId')
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch permissions');
    }

    const result = await response.json();
    this.permissions = result.data || {};
    debugLog('Fetched permission categories:', Object.keys(this.permissions).length);
  }

  async fetchUserRoles(userId) {
    const response = await fetch(`${getApiUrl()}/users/${userId}/roles`, {
      headers: {
        'Authorization': `Bearer ${getStorage('jwtToken')}`,
        'X-Organization-Id': getStorage('currentOrganizationId')
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user roles');
    }

    const result = await response.json();
    return result.data || [];
  }

  async updateUserRoles(userId, roleIds) {
    const response = await fetch(`${getApiUrl()}/users/${userId}/roles`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getStorage('jwtToken')}`,
        'X-Organization-Id': getStorage('currentOrganizationId')
      },
      body: JSON.stringify({ roleIds })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update user roles');
    }

    return await response.json();
  }

  renderAccessDenied() {
    const appContainer = document.getElementById('app');
    appContainer.innerHTML = `
      <div class="role-management-container">
        <h1>${translate('access_denied') || 'Access Denied'}</h1>
        <p>${translate('no_permission_role_management') || 'You do not have permission to manage roles.'}</p>
        <a href="/dashboard" class="btn-primary">${translate('back_to_dashboard') || 'Back to Dashboard'}</a>
      </div>
    `;
  }

  renderError(message) {
    const appContainer = document.getElementById('app');
    appContainer.innerHTML = `
      <div class="role-management-container">
        <h1>${translate('error') || 'Error'}</h1>
        <p class="error-message">${message}</p>
        <a href="/dashboard" class="btn-primary">${translate('back_to_dashboard') || 'Back to Dashboard'}</a>
      </div>
    `;
  }

  render() {
    const canAssignRoles = hasPermission('users.assign_roles');
    const isDistrict = isDistrictAdmin();

    const content = `
      <div class="role-management-container">
        <div class="page-header">
          <h1>${translate('role_management') || 'Role Management'}</h1>
          <a href="/dashboard" class="back-link">${translate('back_to_dashboard') || 'Back to Dashboard'}</a>
        </div>

        <div class="role-management-layout">
          <!-- User List -->
          <div class="user-list-panel">
            <h2>${translate('users') || 'Users'}</h2>
            <div class="user-search">
              <input type="text" id="user-search-input" placeholder="${translate('search_users') || 'Search users...'}" />
            </div>
            <div id="user-list" class="user-list">
              ${this.renderUserList()}
            </div>
          </div>

          <!-- Role Assignment Panel -->
          <div class="role-assignment-panel">
            <div id="role-assignment-content">
              ${this.renderRoleAssignmentPlaceholder()}
            </div>
          </div>

          <!-- Role Information Panel -->
          <div class="role-info-panel">
            <h2>${translate('role_information') || 'Role Information'}</h2>
            <div id="role-info-content">
              ${this.renderRoleInfoList()}
            </div>
          </div>
        </div>
      </div>
    `;

    const appContainer = document.getElementById('app');
    appContainer.innerHTML = content;

    // Attach event listeners
    this.attachEventListeners();
  }

  renderUserList() {
    if (this.users.length === 0) {
      return `<p class="empty-state">${translate('no_users_found') || 'No users found'}</p>`;
    }

    return this.users.map(user => `
      <div class="user-item" data-user-id="${user.id}">
        <div class="user-info">
          <div class="user-name">${this.escapeHtml(user.full_name || user.email)}</div>
          <div class="user-email">${this.escapeHtml(user.email)}</div>
        </div>
        <div class="user-role-badge">
          ${user.role ? this.getRoleDisplayName(user.role) : ''}
        </div>
      </div>
    `).join('');
  }

  renderRoleAssignmentPlaceholder() {
    return `
      <div class="placeholder-state">
        <p>${translate('select_user_to_manage_roles') || 'Select a user to manage their roles'}</p>
      </div>
    `;
  }

  async renderRoleAssignment(userId) {
    const canAssignRoles = hasPermission('users.assign_roles');

    if (!canAssignRoles) {
      return `
        <div class="role-assignment">
          <h2>${translate('view_roles') || 'View Roles'}</h2>
          <p class="info-message">${translate('no_permission_assign_roles') || 'You can view roles but cannot assign them.'}</p>
          <div id="user-roles-display"></div>
        </div>
      `;
    }

    const user = this.users.find(u => u.id === userId);
    if (!user) return '';

    const userRoles = await this.fetchUserRoles(userId);
    const userRoleIds = userRoles.map(r => r.id);

    return `
      <div class="role-assignment">
        <h2>${translate('manage_roles_for') || 'Manage Roles for'}: ${this.escapeHtml(user.full_name || user.email)}</h2>

        <form id="role-assignment-form">
          <input type="hidden" id="selected-user-id" value="${userId}" />

          <div class="current-roles">
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

          <div class="available-roles">
            <h3>${translate('assign_roles') || 'Assign Roles'}</h3>
            <div class="role-checkboxes">
              ${this.roles.map(role => `
                <label class="role-checkbox">
                  <input
                    type="checkbox"
                    name="role_ids"
                    value="${role.id}"
                    ${userRoleIds.includes(role.id) ? 'checked' : ''}
                    ${role.role_name === 'parent' ? 'data-is-parent="true"' : ''}
                  />
                  <span class="role-label">
                    <strong>${this.escapeHtml(role.display_name)}</strong>
                    <small>${this.escapeHtml(role.description || '')}</small>
                  </span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn-primary">${translate('save_roles') || 'Save Roles'}</button>
            <button type="button" class="btn-secondary" id="cancel-role-assignment">${translate('cancel') || 'Cancel'}</button>
          </div>

          <div id="role-assignment-message" class="status-message"></div>
        </form>
      </div>
    `;
  }

  renderRoleInfoList() {
    return `
      <div class="role-info-list">
        ${this.roles.map(role => `
          <div class="role-info-item" data-role-id="${role.id}">
            <h3 class="role-name">${this.escapeHtml(role.display_name)}</h3>
            <p class="role-description">${this.escapeHtml(role.description || 'No description')}</p>
            <button class="btn-small view-permissions-btn" data-role-id="${role.id}">
              ${translate('view_permissions') || 'View Permissions'}
            </button>
            <div class="role-permissions" id="role-permissions-${role.id}" style="display: none;"></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  async showRolePermissions(roleId) {
    const permissionsDiv = document.getElementById(`role-permissions-${roleId}`);

    if (permissionsDiv.style.display === 'none') {
      // Fetch and show permissions
      try {
        const response = await fetch(`${getApiUrl()}/roles/${roleId}/permissions`, {
          headers: {
            'Authorization': `Bearer ${getStorage('jwtToken')}`,
            'X-Organization-Id': getStorage('currentOrganizationId')
          }
        });

        if (!response.ok) throw new Error('Failed to fetch role permissions');

        const result = await response.json();
        const permissions = result.data || [];

        // Group permissions by category
        const grouped = permissions.reduce((acc, perm) => {
          if (!acc[perm.category]) {
            acc[perm.category] = [];
          }
          acc[perm.category].push(perm);
          return acc;
        }, {});

        permissionsDiv.innerHTML = `
          <div class="permissions-list">
            ${Object.entries(grouped).map(([category, perms]) => `
              <div class="permission-category">
                <h4>${this.escapeHtml(category)}</h4>
                <ul>
                  ${perms.map(p => `
                    <li title="${this.escapeHtml(p.description || '')}">
                      ${this.escapeHtml(p.permission_name)}
                    </li>
                  `).join('')}
                </ul>
              </div>
            `).join('')}
          </div>
        `;
        permissionsDiv.style.display = 'block';
      } catch (error) {
        debugError('Error fetching role permissions:', error);
        permissionsDiv.innerHTML = `<p class="error-message">${error.message}</p>`;
        permissionsDiv.style.display = 'block';
      }
    } else {
      // Hide permissions
      permissionsDiv.style.display = 'none';
    }
  }

  attachEventListeners() {
    // User selection
    const userItems = document.querySelectorAll('.user-item');
    userItems.forEach(item => {
      item.addEventListener('click', async (e) => {
        const userId = e.currentTarget.dataset.userId;

        // Remove active class from all users
        userItems.forEach(u => u.classList.remove('active'));
        e.currentTarget.classList.add('active');

        // Show role assignment panel
        this.selectedUserId = userId;
        const assignmentContent = document.getElementById('role-assignment-content');
        assignmentContent.innerHTML = '<div class="loading">Loading...</div>';

        const html = await this.renderRoleAssignment(userId);
        assignmentContent.innerHTML = html;

        // Attach form listener
        this.attachRoleAssignmentFormListener();
      });
    });

    // User search
    const searchInput = document.getElementById('user-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterUsers(e.target.value);
      });
    }

    // View permissions buttons
    const viewPermissionsBtns = document.querySelectorAll('.view-permissions-btn');
    viewPermissionsBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const roleId = e.target.dataset.roleId;
        await this.showRolePermissions(roleId);
      });
    });
  }

  attachRoleAssignmentFormListener() {
    const form = document.getElementById('role-assignment-form');
    if (!form) return;

    const cancelBtn = document.getElementById('cancel-role-assignment');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        // Deselect user
        this.selectedUserId = null;
        document.querySelectorAll('.user-item').forEach(u => u.classList.remove('active'));
        document.getElementById('role-assignment-content').innerHTML = this.renderRoleAssignmentPlaceholder();
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const userId = document.getElementById('selected-user-id').value;
      const checkboxes = form.querySelectorAll('input[name="role_ids"]:checked');
      const roleIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

      if (roleIds.length === 0) {
        this.showMessage('Please select at least one role', 'error');
        return;
      }

      try {
        await this.updateUserRoles(userId, roleIds);
        this.showMessage(translate('roles_updated_successfully') || 'Roles updated successfully!', 'success');

        // Refresh user list to show updated role
        await this.fetchUsers();
        document.getElementById('user-list').innerHTML = this.renderUserList();
        this.attachEventListeners();
      } catch (error) {
        debugError('Error updating roles:', error);
        this.showMessage(error.message, 'error');
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

  showMessage(message, type = 'info') {
    const messageDiv = document.getElementById('role-assignment-message');
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

  getRoleDisplayName(roleName) {
    const role = this.roles.find(r => r.role_name === roleName);
    return role ? role.display_name : roleName;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
