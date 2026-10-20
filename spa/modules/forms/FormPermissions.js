/**
 * Form Permissions Management Module
 *
 * Allows district and unit administrators to manage which roles can
 * view, submit, edit, and approve different form types. It is the
 * "Accès aux formulaires" tab of the "Rôles et permissions" page and follows
 * the spa/utils/PageMount.js contract.
 *
 * Built-in roles the unit replaced and hid (services/roleVisibility.js) are
 * folded away: their holders keep these rights, so they can be shown again.
 *
 * @module form_permissions
 */

import { API } from '../../api/api-core.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';
import { translate } from '../../app.js';
import { formTypeLabel } from '../../utils/FormLabelUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { roleLabel } from '../../utils/RoleLabelUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';
import { getMountPoint, resolveMountOptions } from '../../utils/PageMount.js';

/** The rights a role may hold on a form, in column order. */
const FORM_RIGHTS = ['can_view', 'can_submit', 'can_edit', 'can_approve'];

export class FormPermissionsManager {
  /**
   * @param {Object} app - Application instance
   * @param {{containerId?: string, embedded?: boolean}} [options]
   */
  constructor(app, options = {}) {
    this.app = app;
    Object.assign(this, resolveMountOptions(options));
    this.permissions = [];
    this.formTypes = new Set();
    this.roles = new Set();
    this.hiddenRoles = new Set();
    this.showHiddenRoles = false;
    this.destroyed = false;
  }

  /**
   * Initialize the form permissions manager
   */
  async init() {
    debugLog('Initializing FormPermissionsManager');

    if (!hasPermission('forms.manage')) {
      this.app.renderError(translate('access_denied'));
      return;
    }

    const pageOptions = { title: translate('form_permissions_management'), className: 'form-permissions-page', embedded: this.embedded };
    showPageLoading(getMountPoint(this), pageOptions);
    try {
      await this.loadPermissions();
    } catch (error) {
      debugError('Error initializing form permissions manager:', error);
      if (!this.destroyed) {
        showPageError(getMountPoint(this), {
          ...pageOptions,
          message: translate('error_loading_form_permissions'),
        }, () => this.init());
      }
      return;
    }
    if (this.destroyed) {
      return;
    }
    this.render();
    this.attachEventListeners();
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
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
        this.hiddenRoles.clear();

        // Extract unique form types and roles
        this.permissions.forEach(perm => {
          this.formTypes.add(perm.form_type);
          this.roles.add(perm.role_name);
          if (perm.role_hidden) {
            this.hiddenRoles.add(perm.role_name);
          }
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
      ${this.embedded ? '' : renderBackLink('/roles')}
      <div class="form-permissions-manager">
        <header class="page-header">
          ${this.embedded ? '' : `<h1>${translate('form_permissions_management')}</h1>`}
          <p class="page-subtitle">${translate('form_permissions_description')}</p>
        </header>
        ${this.renderHiddenRolesToggle()}
        <div class="permissions-container">
          ${this.renderPermissionsMatrix()}
        </div>
      </div>
    `;

    setContent(getMountPoint(this), content);
  }

  /**
   * The switch that shows the built-in roles the unit hid, when it hid any.
   *
   * @returns {string} HTML
   */
  renderHiddenRolesToggle() {
    if (this.hiddenRoles.size === 0) {
      return '';
    }
    return `
      <label class="form-permissions-hidden-toggle">
        <input type="checkbox" id="form-permissions-show-hidden" ${this.showHiddenRoles ? 'checked' : ''} />
        <span>${escapeHTML(translate('form_permissions_show_hidden_roles').replace('{count}', String(this.hiddenRoles.size)))}</span>
      </label>
    `;
  }

  /**
   * Render the permissions matrix table
   */
  renderPermissionsMatrix() {
    const formTypesArray = Array.from(this.formTypes).sort();
    const rolesArray = Array.from(this.roles)
      .filter((roleName) => this.showHiddenRoles || !this.hiddenRoles.has(roleName))
      .sort((a, b) => {
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
        <h2 class="form-section__title">${formTypeLabel(formType, formDisplayName)}</h2>

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
                <th scope="col">${translate('role')}</th>
                ${FORM_RIGHTS.map((right) => `<th scope="col">${translate(right)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rolesArray.map(roleName => {
    const perm = formPerms.find(p => p.role_name === roleName);
    if (!perm) {return '';}
    const name = roleLabel({ role_name: roleName, display_name: perm.role_display_name });

    return `
                  <tr>
                    <th scope="row" class="role-name">
                      ${escapeHTML(name)}
                      ${perm.role_hidden ? `<span class="role-hidden-note">${translate('role_hidden_badge')}</span>` : ''}
                    </th>
                    ${FORM_RIGHTS.map((right) => `
                    <td>
                      <input
                        type="checkbox"
                        class="permission-checkbox"
                        data-form-format-id="${perm.form_format_id}"
                        data-role-id="${perm.role_id}"
                        data-permission="${right}"
                        aria-label="${escapeAttribute(`${translate(right)} — ${name}`)}"
                        ${perm[right] ? 'checked' : ''}
                      />
                    </td>`).join('')}
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
    const root = getMountPoint(this);
    root.querySelector('#form-permissions-show-hidden')?.addEventListener('change', (event) => {
      this.showHiddenRoles = event.target.checked;
      this.render();
      this.attachEventListeners();
      getMountPoint(this).querySelector('#form-permissions-show-hidden')?.focus();
    });

    // Listen for permission checkbox changes
    root.querySelectorAll('.permission-checkbox').forEach(checkbox => {
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
    root.querySelectorAll('.context-checkbox').forEach(checkbox => {
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
/**
 * @param {Object} app - Application instance
 * @returns {Promise<FormPermissionsManager>} The screen, for the router to tear down
 */
export async function initFormPermissions(app, options = {}) {
  const manager = new FormPermissionsManager(app, options);
  await manager.init();
  return manager;
}
