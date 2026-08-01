/**
 * Form Permissions Management Module
 *
 * Allows district and unit administrators to manage which roles can
 * view, submit, edit, and approve different form types
 *
 * @module form_permissions
 */

import { API } from './api/api-core.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { translate } from './app.js';
import { isAdmin } from './utils/PermissionUtils.js';
import { setContent } from './utils/DOMUtils.js';

export class FormPermissionsManager {
  constructor(app) {
    this.app = app;
    this.permissions = [];
    this.formTypes = new Set();
    this.roles = new Set();
  }

  /**
   * Initialize the form permissions manager
   */
  async init() {
    debugLog('Initializing FormPermissionsManager');

    // Check if user has permission to manage form permissions
    if (!isAdmin()) {
      this.app.renderError(translate('access_denied'));
      return;
    }

    try {
      await this.loadPermissions();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('Error initializing form permissions manager:', error);
      this.app.renderError(translate('error_loading_form_permissions'));
    }
  }

  /**
   * Load form permissions from the server
   */
  async loadPermissions() {
    try {
      // This matrix contains mutable authorization state and database IDs. A
      // cached response can both hide a successful save and submit an ID for a
      // form format that has since been deleted or recreated.
      const response = await API.get(
        'v1/forms/form-permissions',
        {},
        { forceRefresh: true }
      );

      if (response.success) {
        this.permissions = response.data;
        this.formTypes.clear();
        this.roles.clear();

        // Extract unique form types and roles
        this.permissions.forEach(perm => {
          this.formTypes.add(perm.form_type);
          this.roles.add(perm.role_name);
        });

        debugLog('Loaded form permissions:', this.permissions);
      } else {
        throw new Error(response.message || 'Failed to load form permissions');
      }
    } catch (error) {
      debugError('Error loading form permissions:', error);
      throw error;
    }
  }

  /**
   * Update a specific permission
   */
  async updatePermission(formFormatId, roleId, permissions) {
    try {
      const response = await API.put('v1/forms/form-permissions', {
        form_format_id: formFormatId,
        role_id: roleId,
        ...permissions
      });

      if (response.success) {
        if (response.queued) {
          this.app.showMessage(translate('offline.savedLocally'), 'info');
          return true;
        }

        const savedPermissions = this.permissions.find(perm =>
          Number(perm.form_format_id) === formFormatId && Number(perm.role_id) === roleId
        );
        if (savedPermissions) {
          Object.assign(savedPermissions, permissions);
        }

        this.app.showMessage(translate('permissions_updated'), 'success');
        return true;
      } else {
        throw new Error(response.message || 'Failed to update permissions');
      }
    } catch (error) {
      debugError('Error updating permission:', error);
      await this.handleStaleForm(error, 'error_updating_permissions');
      return false;
    }
  }

  /**
   * Update display context for a form
   */
  async updateDisplayContext(formFormatId, displayContext) {
    try {
      const response = await API.put('v1/forms/form-display-context', {
        form_format_id: formFormatId,
        display_context: displayContext
      });

      if (response.success) {
        if (response.queued) {
          this.app.showMessage(translate('offline.savedLocally'), 'info');
          return true;
        }

        this.permissions
          .filter(perm => Number(perm.form_format_id) === formFormatId)
          .forEach(perm => {
            perm.display_context = [...displayContext];
          });

        this.app.showMessage(translate('display_context_updated'), 'success');
        return true;
      } else {
        throw new Error(response.message || 'Failed to update display context');
      }
    } catch (error) {
      debugError('Error updating display context:', error);
      await this.handleStaleForm(error, 'error_updating_display_context');
      return false;
    }
  }

  /**
   * Recover when a form format changed after this page was loaded.
   *
   * @param {Error} error - API error raised by the failed update
   * @param {string} fallbackMessageKey - Localized message for other failures
   * @returns {Promise<void>}
   */
  async handleStaleForm(error, fallbackMessageKey) {
    if (error?.status !== 404) {
      this.app.showMessage(translate(fallbackMessageKey), 'error');
      return;
    }

    this.app.showMessage(translate('form_not_found'), 'error');

    try {
      await this.loadPermissions();
      this.render();
      this.attachEventListeners();
    } catch (refreshError) {
      debugError('Error refreshing stale form permissions:', refreshError);
    }
  }

  /**
   * Render the form permissions management UI
   */
  render() {
    const content = `
      <div class="form-permissions-manager">
        <header class="page-header">
          <h1>${translate('form_permissions_management')}</h1>
          <p class="page-subtitle">${translate('form_permissions_description')}</p>
          <a href="/dashboard" class="back-link">${translate('back_to_dashboard')}</a>
        </header>

        <div class="permissions-container">
          ${this.renderPermissionsMatrix()}
        </div>
      </div>
    `;

    setContent(document.getElementById('app'), content);
  }

  /**
   * Render the permissions matrix table
   */
  renderPermissionsMatrix() {
    const formTypesArray = Array.from(this.formTypes).sort();
    const rolesArray = Array.from(this.roles).sort((a, b) => {
      // Sort roles in a logical order
      const order = ['district', 'unitadmin', 'leader', 'parent', 'finance', 'equipment', 'administration', 'demoadmin', 'demoparent'];
      return order.indexOf(a) - order.indexOf(b);
    });

    return `
      <div class="permissions-matrix">
        ${formTypesArray.map(formType => this.renderFormSection(formType, rolesArray)).join('')}
      </div>
    `;
  }

  /**
   * Render a section for a single form type
   */
  renderFormSection(formType, rolesArray) {
    const formPerms = this.permissions.filter(p => p.form_type === formType);
    const formDisplayName = formPerms[0]?.display_name || formType;
    const formFormatId = formPerms[0]?.form_format_id;
    const displayContext = formPerms[0]?.display_context || [];

    return `
      <div class="form-section">
        <h2 class="form-section__title">${translate(formType) || formDisplayName}</h2>

        <!-- Display Context Section -->
        <div class="display-context-section">
          <h3 class="display-context-title">${translate('display_contexts')}</h3>
          <p class="display-context-description">${translate('display_contexts_description')}</p>
          <div class="context-checkboxes">
            ${['participant', 'organization', 'admin_panel', 'public', 'form_builder'].map(ctx => `
              <label class="context-checkbox-label">
                <input
                  type="checkbox"
                  class="context-checkbox"
                  data-form-format-id="${formFormatId}"
                  data-context="${ctx}"
                  ${displayContext.includes(ctx) ? 'checked' : ''}
                />
                <span>${translate(`context_${ctx}`)}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Role Permissions Section -->
        <h3 class="permissions-subtitle">${translate('role_permissions')}</h3>
        <div class="permissions-table-wrapper">
          <table class="permissions-table">
            <thead>
              <tr>
                <th>${translate('role')}</th>
                <th>${translate('can_view')}</th>
                <th>${translate('can_submit')}</th>
                <th>${translate('can_edit')}</th>
                <th>${translate('can_approve')}</th>
              </tr>
            </thead>
            <tbody>
              ${rolesArray.map(roleName => {
      const perm = formPerms.find(p => p.role_name === roleName);
      if (!perm) return '';

      return `
                  <tr>
                    <td class="role-name">${translate(roleName) || perm.role_display_name}</td>
                    <td>
                      <input
                        type="checkbox"
                        class="permission-checkbox"
                        data-form-format-id="${perm.form_format_id}"
                        data-role-id="${perm.role_id}"
                        data-permission="can_view"
                        ${perm.can_view ? 'checked' : ''}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        class="permission-checkbox"
                        data-form-format-id="${perm.form_format_id}"
                        data-role-id="${perm.role_id}"
                        data-permission="can_submit"
                        ${perm.can_submit ? 'checked' : ''}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        class="permission-checkbox"
                        data-form-format-id="${perm.form_format_id}"
                        data-role-id="${perm.role_id}"
                        data-permission="can_edit"
                        ${perm.can_edit ? 'checked' : ''}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        class="permission-checkbox"
                        data-form-format-id="${perm.form_format_id}"
                        data-role-id="${perm.role_id}"
                        data-permission="can_approve"
                        ${perm.can_approve ? 'checked' : ''}
                      />
                    </td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Listen for permission checkbox changes
    document.querySelectorAll('.permission-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', async (event) => {
        const formFormatId = parseInt(event.target.dataset.formFormatId, 10);
        const roleId = parseInt(event.target.dataset.roleId, 10);
        const isChecked = event.target.checked;

        // Get all current permissions for this form/role combination
        const row = event.target.closest('tr');
        const checkboxes = row.querySelectorAll('.permission-checkbox');
        const permissions = {
          can_view: false,
          can_submit: false,
          can_edit: false,
          can_approve: false
        };

        checkboxes.forEach(cb => {
          permissions[cb.dataset.permission] = cb.checked;
          cb.disabled = true;
        });
        row.setAttribute('aria-busy', 'true');

        try {
          // Update on the server. Locking the row keeps two snapshots from
          // racing and overwriting one another when several boxes are tapped.
          const success = await this.updatePermission(formFormatId, roleId, permissions);

          // If update failed, revert the checkbox
          if (!success) {
            event.target.checked = !isChecked;
          }
        } finally {
          checkboxes.forEach(cb => {
            cb.disabled = false;
          });
          row.removeAttribute('aria-busy');
        }
      });
    });

    // Listen for display context checkbox changes
    document.querySelectorAll('.context-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', async (event) => {
        const formFormatId = parseInt(event.target.dataset.formFormatId, 10);
        const isChecked = event.target.checked;

        // Get all current display contexts for this form
        const section = event.target.closest('.form-section');
        const contextCheckboxes = section.querySelectorAll('.context-checkbox');
        const displayContext = [];

        contextCheckboxes.forEach(cb => {
          if (cb.checked) {
            displayContext.push(cb.dataset.context);
          }
          cb.disabled = true;
        });
        section.setAttribute('aria-busy', 'true');

        try {
          // Update on the server
          const success = await this.updateDisplayContext(formFormatId, displayContext);

          // If update failed, revert the checkbox
          if (!success) {
            event.target.checked = !isChecked;
          }
        } finally {
          contextCheckboxes.forEach(cb => {
            cb.disabled = false;
          });
          section.removeAttribute('aria-busy');
        }
      });
    });
  }
}

/**
 * Initialize the form permissions manager
 * Called by the router
 */
export async function initFormPermissions(app) {
  const manager = new FormPermissionsManager(app);
  await manager.init();
}
