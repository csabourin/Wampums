/** Editable unit role definitions, shared by the unit and district screens. */
import stylesheetUrl from '../../../css/role-permission-matrix.css?url';
import { translate } from '../../app.js';
import { setContent, loadStylesheet, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { roleLabel, roleDescription } from '../../utils/RoleLabelUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { confirm, confirmDestructive } from '../../utils/DialogUtils.js';
import { getMountPoint, resolveMountOptions } from '../../utils/PageMount.js';
import { hasPermission, isDemoUser } from '../../utils/PermissionUtils.js';
import { getRoleMatrix, replaceRolePermissions, createUnitRole, updateUnitRole, deleteUnitRole } from '../../api/api-roles.js';
import { getUserOrganizations, switchOrganization } from '../../api/api-endpoints.js';
import { setStorageMultiple } from '../../utils/StorageUtils.js';
import { decodeJWT } from '../../jwt-helper.js';
import { refreshAccess } from '../session/AccessRefresh.js';

/** Keys are translated rather than displaying the catalog's English names. */
function permissionLabel(permission) {
  const key = `role_permission_${permission.permission_key.replaceAll('.', '_')}`;
  const label = translate(key);
  return label === key ? translate('role_matrix_other_permission') : label;
}
function categoryLabel(category) {
  const key = `role_category_${category}`;
  const label = translate(key);
  return label === key ? translate('role_matrix_other_category') : label;
}

export class RolePermissionMatrix {
  constructor(app, options = {}) {
    this.app = app;
    Object.assign(this, resolveMountOptions(options));
    this.district = !!options.district;
    this.roles = [];
    this.permissions = [];
    this.organizations = [];
    this.pending = new Map();
    this.selectedRoleId = null;
    this.destroyed = false;
    this.saving = false;
    this.unloadHandler = (event) => {
      if (this.pending.size) { event.preventDefault(); event.returnValue = ''; }
    };
  }

  async init() {
    await loadStylesheet(stylesheetUrl);
    if (this.destroyed) { return; }
    window.addEventListener('beforeunload', this.unloadHandler);
    this.renderStatus('loading');
    try {
      if (this.district) {
        const response = await getUserOrganizations({ forceRefresh: true });
        this.organizations = response.data || [];
      }
      await this.load();
      this.render();
    } catch (error) { this.renderError(error); }
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('beforeunload', this.unloadHandler);
    this.modal?.close(true);
  }

  /** Navigation and tab changes must not silently drop unsaved edits. */
  beforeLeave({ refresh = false } = {}) {
    if (this.saving) { return false; }
    if (!this.pending.size) { return true; }
    if (refresh) { return false; }
    return confirm({ title: translate('role_matrix_unsaved_title'), message: translate('role_matrix_unsaved_confirm') });
  }

  root() { return getMountPoint(this); }
  heading() {
    return this.embedded ? '' : `${renderBackLink()}<h1>${translate('role_matrix_title')}</h1>`;
  }
  renderStatus(key) {
    if (this.destroyed) { return; }
    setContent(this.root(), `<section class="page role-matrix" aria-busy="true">${this.heading()}<p role="status">${translate(key)}</p></section>`);
  }
  renderError(error) {
    debugError('Role matrix load failed:', error);
    if (this.destroyed) { return; }
    setContent(this.root(), `<section class="page role-matrix">${this.heading()}
      <p role="alert">${escapeHTML(apiErrorMessage(error, 'role_matrix_load_failed'))}</p>
      <button class="button" type="button" id="role-matrix-retry">${translate('retry')}</button></section>`);
    this.root().querySelector('#role-matrix-retry').addEventListener('click', () => this.reload());
  }
  async reload() {
    this.renderStatus('loading');
    try { await this.load(); this.render(); } catch (error) { this.renderError(error); }
  }
  async load() {
    const response = await getRoleMatrix();
    if (this.destroyed) { return; }
    this.roles = response.data.roles;
    this.permissions = response.data.permissions;
    this.organizationId = response.data.organization_id;
    if (!this.roles.some((r) => Number(r.id) === Number(this.selectedRoleId))) {
      this.selectedRoleId = this.roles[0]?.id ?? null;
    }
  }
  ids(role) { return this.pending.get(role.id) || new Set(role.permission_ids.map(Number)); }
  changes() {
    let count = 0;
    for (const role of this.roles) {
      const ids = this.ids(role);
      count += this.permissions.filter((p) => ids.has(Number(p.id)) !== role.permission_ids.map(Number).includes(Number(p.id))).length;
    }
    return count;
  }
  /** Static authority locks come from the server; View dependency follows local edits. */
  reason(role, permission) {
    if (isDemoUser()) { return 'demo'; }
    const cell = role.cells.find((c) => Number(c.permission_id) === Number(permission.id));
    const locked = cell && Object.hasOwn(cell, 'base_reason') ? cell.base_reason : cell?.reason;
    if (locked) { return locked; }
    if (permission.permission_key.endsWith('.view')) {
      const manage = this.permissions.find((p) => p.permission_key === permission.permission_key.replace(/\.view$/, '.manage'));
      if (manage && this.ids(role).has(Number(manage.id))) { return 'view_required'; }
    }
    return null;
  }
  checkbox(role, permission, prefix) {
    const reason = this.reason(role, permission);
    const id = `role-matrix-${prefix}-${Number(role.id)}-${Number(permission.id)}`;
    return `<div class="role-matrix-cell">
      <label for="${id}" class="role-matrix-check-label">
        <input type="checkbox" id="${id}" data-role="${Number(role.id)}" data-permission="${Number(permission.id)}"
          ${this.ids(role).has(Number(permission.id)) ? 'checked' : ''} ${reason || this.saving ? 'disabled' : ''}
          ${reason ? `aria-describedby="${id}-reason"` : ''}>
        <span class="${prefix === 'table' ? 'sr-only' : ''}">${escapeHTML(permissionLabel(permission))}<span class="sr-only"> — ${escapeHTML(roleLabel(role))}</span></span>
      </label>
      <span id="${id}-reason" class="role-matrix-reason" ${reason ? '' : 'hidden'}>${reason ? `<span class="fa-solid fa-lock" aria-hidden="true"></span> ${escapeHTML(translate(`role_matrix_lock_${reason}`))}` : ''}</span>
    </div>`;
  }
  roleActions(role) {
    if (isDemoUser()) { return ''; }
    return `<div class="role-matrix-actions">
      <button class="button button--secondary" type="button" data-copy="${Number(role.id)}" ${role.can_copy ? '' : 'disabled'}>${translate(role.is_system_role ? 'role_matrix_customize' : 'role_matrix_copy')}</button>
      ${role.is_system_role ? '' : `<button class="button button--secondary" type="button" data-edit="${Number(role.id)}">${translate('edit')}</button>
      <button class="button button--danger" type="button" data-delete="${Number(role.id)}" ${(role.can_delete ?? role.can_copy) ? '' : 'disabled'}>${translate('delete')}</button>`}
      ${!role.can_copy ? `<p class="role-matrix-reason">${translate('role_matrix_cannot_copy')}</p>` : ''}
    </div>`;
  }
  render() {
    if (this.destroyed) { return; }
    const selected = this.roles.find((r) => Number(r.id) === Number(this.selectedRoleId));
    const categories = [...new Set(this.permissions.map((p) => p.category))];
    setContent(this.root(), `<section class="page role-matrix">${this.heading()}
      <p>${translate('role_matrix_intro')}</p>
      ${this.district ? `<label for="role-matrix-unit">${translate('role_matrix_unit')}</label><select id="role-matrix-unit">
        ${this.organizations.map((o) => `<option value="${Number(o.id)}" ${Number(o.id) === Number(this.organizationId) ? 'selected' : ''}>${escapeHTML(o.name)}</option>`).join('')}</select>
        <p>${translate('role_matrix_district_help')}</p>` : ''}
      <p>${translate('role_matrix_builtin_help')}</p>
      <div class="role-matrix-actions"><button type="button" id="role-matrix-create" class="button button--primary" ${isDemoUser() ? 'disabled' : ''}>${translate('role_matrix_create')}</button></div>
      ${this.roles.length ? `
      <div class="role-matrix-mobile"><label for="role-matrix-role">${translate('role_matrix_role')}</label>
        <select id="role-matrix-role">${this.roles.map((r) => `<option value="${Number(r.id)}" ${r.id === selected?.id ? 'selected' : ''}>${escapeHTML(roleLabel(r))}</option>`).join('')}</select>
        ${selected ? `<p>${escapeHTML(roleDescription(selected))}</p><p>${translate(selected.data_scope === 'linked' ? 'role_matrix_scope_linked' : 'role_matrix_scope_organization')}</p>${this.roleActions(selected)}
        ${categories.map((category) => `<details open><summary>${escapeHTML(categoryLabel(category))}</summary><fieldset><legend class="sr-only">${escapeHTML(categoryLabel(category))}</legend>
          ${this.permissions.filter((p) => p.category === category).map((p) => this.checkbox(selected, p, 'mobile')).join('')}</fieldset></details>`).join('')}` : ''}
      </div>
      <div class="role-matrix-desktop"><div class="role-matrix-scroll" role="region" tabindex="0" aria-label="${escapeAttribute(translate('role_matrix_title'))}">
        <table><caption>${translate('role_matrix_title')}</caption><thead><tr><th scope="col">${translate('permissions')}</th>
          ${this.roles.map((r) => `<th scope="col">${escapeHTML(roleLabel(r))}<p class="role-matrix-scope">${translate(r.data_scope === 'linked' ? 'role_matrix_scope_linked' : 'role_matrix_scope_organization')}</p>${this.roleActions(r)}</th>`).join('')}
        </tr></thead><tbody>${categories.map((category) => `<tr><th scope="rowgroup" colspan="${this.roles.length + 1}">${escapeHTML(categoryLabel(category))}</th></tr>
          ${this.permissions.filter((p) => p.category === category).map((p) => `<tr><th scope="row">${escapeHTML(permissionLabel(p))}</th>${this.roles.map((r) => `<td>${this.checkbox(r, p, 'table')}</td>`).join('')}</tr>`).join('')}`).join('')}</tbody></table>
      </div></div>` : `<p>${translate('role_matrix_empty')}</p>`}
      <form id="role-matrix-save-form" class="role-matrix-save"><p id="role-matrix-changes" role="status">${escapeHTML(translate('role_matrix_changes').replace('{count}', this.changes()))}</p>
        <button class="button button--primary" type="submit" ${!this.pending.size || isDemoUser() ? 'disabled' : ''}>${translate('save')}</button>
        <button class="button button--secondary" id="role-matrix-discard" type="button" ${!this.pending.size ? 'disabled' : ''}>${translate('role_matrix_discard')}</button>
      </form><p id="role-matrix-live" class="sr-only" aria-live="polite"></p>
    </section>`);
    this.bind();
  }
  bind() {
    const root = this.root();
    root.querySelector('#role-matrix-role')?.addEventListener('change', (event) => { this.selectedRoleId = Number(event.target.value); this.render(); this.root().querySelector('#role-matrix-role')?.focus(); });
    root.querySelectorAll('input[data-permission]').forEach((box) => box.addEventListener('change', () => this.toggle(box)));
    root.querySelector('#role-matrix-create').addEventListener('click', () => this.editRole());
    for (const action of ['copy', 'edit', 'delete']) {
      root.querySelectorAll(`[data-${action}]`).forEach((button) => button.addEventListener('click', () => {
        const role = this.roles.find((r) => r.id === Number(button.dataset[action]));
        if (action === 'delete') { this.removeRole(role); } else { this.editRole(role, action === 'copy'); }
      }));
    }
    root.querySelector('#role-matrix-save-form').addEventListener('submit', (event) => { event.preventDefault(); this.save(event.target); });
    root.querySelector('#role-matrix-discard').addEventListener('click', async () => {
      if (await this.beforeLeave()) { this.pending.clear(); await this.reload(); }
    });
    root.querySelector('#role-matrix-unit')?.addEventListener('change', (event) => this.changeUnit(Number(event.target.value)));
  }
  toggle(box) {
    const role = this.roles.find((r) => r.id === Number(box.dataset.role));
    const permission = this.permissions.find((p) => Number(p.id) === Number(box.dataset.permission));
    const requested = new Set(this.ids(role));
    if (box.checked) { requested.add(Number(permission.id)); } else { requested.delete(Number(permission.id)); }
    const view = role.cells.find((c) => Number(c.permission_id) === Number(permission.id))?.required_view;
    if (box.checked && view) {
      const paired = this.permissions.find((p) => p.permission_key === view);
      requested.add(Number(paired.id));
    }
    const original = role.permission_ids.map(Number);
    if (requested.size === original.length && original.every((id) => requested.has(id))) { this.pending.delete(role.id); }
    else { this.pending.set(role.id, requested); }
    // Keep the DOM and focus intact while synchronizing the hidden and visible views.
    this.root().querySelectorAll('input[data-permission]').forEach((input) => {
      const r = this.roles.find((item) => item.id === Number(input.dataset.role));
      const p = this.permissions.find((item) => Number(item.id) === Number(input.dataset.permission));
      const reason = this.reason(r, p);
      input.checked = this.ids(r).has(Number(p.id));
      input.disabled = !!reason;
      const hint = this.root().querySelector(`#${input.id}-reason`);
      hint.hidden = !reason;
      setContent(hint, reason ? `<span class="fa-solid fa-lock" aria-hidden="true"></span> ${escapeHTML(translate(`role_matrix_lock_${reason}`))}` : '');
      if (reason) { input.setAttribute('aria-describedby', hint.id); } else { input.removeAttribute('aria-describedby'); }
    });
    this.root().querySelector('#role-matrix-changes').textContent = translate('role_matrix_changes').replace('{count}', this.changes());
    this.root().querySelector('#role-matrix-save-form button[type="submit"]').disabled = !this.pending.size;
    this.root().querySelector('#role-matrix-discard').disabled = !this.pending.size;
    if (box.checked && view) { this.root().querySelector('#role-matrix-live').textContent = translate('role_matrix_view_added'); }
  }
  /** Save serially; successful roles are removed even if a later save fails. */
  async save(form) {
    if (this.saving || !this.pending.size) { return; }
    this.saving = true;
    this.root().querySelectorAll('input, select, button').forEach((input) => { input.disabled = true; });
    try {
      await withFormBusy(form, async () => {
        for (const [roleId, ids] of [...this.pending]) {
          const role = this.roles.find((r) => r.id === roleId);
          // eslint-disable-next-line no-await-in-loop -- preserve partial successes and stop at the first refused role
          await replaceRolePermissions(roleId, [...ids].sort((a, b) => a - b), role.permission_ids);
          role.permission_ids = [...ids];
          this.pending.delete(roleId);
        }
      });
      this.app.showMessage(translate('role_matrix_saved'), 'success');
    } catch (error) { this.app.showMessage(apiErrorMessage(error, 'role_matrix_save_failed'), 'error'); }
    finally { this.saving = false; if (!this.destroyed) { this.render(); } }
  }
  /** Creation, copying and metadata edits use the shared accessible modal. */
  async editRole(role = null, copy = false) {
    if (!(await this.beforeLeave())) { return; }
    const editing = !!role && !copy;
    const titleKey = editing ? 'role_matrix_edit' : copy ? 'role_matrix_copy' : 'role_matrix_create';
    let busy = false;
    const modal = openModal({
      id: 'role-matrix-modal', title: translate(titleKey), closeOnBackdrop: false, canClose: () => !busy,
      body: `<form id="role-matrix-definition">
        <label for="role-matrix-name">${translate('role_matrix_name')}</label><input id="role-matrix-name" name="display_name" required maxlength="100" value="${escapeAttribute(role ? roleLabel(role) + (copy ? translate('role_matrix_copy_suffix') : '') : '')}">
        <label for="role-matrix-description">${translate('description')}</label><textarea id="role-matrix-description" name="description" maxlength="2000">${escapeHTML(role ? roleDescription(role) : '')}</textarea>
        <label for="role-matrix-scope">${translate('role_matrix_scope')}</label><select id="role-matrix-scope" name="data_scope" ${copy ? 'disabled' : ''}>
          <option value="organization" ${role?.data_scope !== 'linked' ? 'selected' : ''}>${translate('role_matrix_scope_organization')}</option>
          <option value="linked" ${role?.data_scope === 'linked' ? 'selected' : ''}>${translate('role_matrix_scope_linked')}</option></select>
        ${copy ? `<label class="role-matrix-check-label"><input type="checkbox" name="reassign_members">${translate('role_matrix_reassign')}</label>` : ''}
        <p id="role-matrix-definition-error" role="alert"></p></form>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button><button type="submit" form="role-matrix-definition" class="button button--primary">${translate('save')}</button>`,
    });
    this.modal = modal;
    const form = modal.dialog.querySelector('form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !form.reportValidity()) { return; }
      busy = true;
      await withFormBusy(form, async () => {
        try {
          const values = new FormData(form);
          const definition = { display_name: values.get('display_name').trim(), description: values.get('description'), data_scope: copy ? role.data_scope : values.get('data_scope') };
          if (copy) { definition.base_role_id = role.id; definition.reassign_members = values.get('reassign_members') === 'on'; }
          if (editing) { await updateUnitRole(role.id, definition); }
          else { const response = await createUnitRole(definition); this.selectedRoleId = response.data.id; }
          this.pending.clear();
          busy = false;
          modal.close();
          this.app.showMessage(translate('role_matrix_saved'), 'success');
          await this.reload();
        } catch (error) {
          const message = apiErrorMessage(error, 'role_matrix_save_failed');
          const errorNode = form.querySelector('#role-matrix-definition-error');
          errorNode.textContent = message;
          form.querySelector('#role-matrix-name').setAttribute('aria-describedby', errorNode.id);
        }
      });
      busy = false;
    });
    form.addEventListener('input', () => { form.querySelector('#role-matrix-definition-error').textContent = ''; });
  }
  async removeRole(role) {
    if (!(await this.beforeLeave()) || !(await confirmDestructive({ title: translate('role_matrix_delete_title'), message: translate('role_matrix_delete_confirm').replace('{name}', roleLabel(role)) }))) { return; }
    this.saving = true;
    try {
      await deleteUnitRole(role.id);
    } catch (error) {
      this.app.showMessage(apiErrorMessage(error, 'role_matrix_save_failed'), 'error');
      return;
    } finally { this.saving = false; }
    // The deletion is done: the reloaded matrix must draw its cells editable.
    this.pending.clear();
    this.app.showMessage(translate('role_matrix_saved'), 'success');
    await this.reload();
  }
  /** Change authenticated context via a new token; never pass a tenant ID to the matrix. */
  async changeUnit(unitId) {
    if (!(await this.beforeLeave())) { this.root().querySelector('#role-matrix-unit').value = this.organizationId; return; }
    this.saving = true;
    this.root().querySelectorAll('input, select, button').forEach((control) => { control.disabled = true; });
    try {
      const response = await switchOrganization(unitId);
      const token = response.data?.token || response.token;
      if (!token) { throw new Error('Missing switch result'); }
      const claims = decodeJWT(token);
      setStorageMultiple({ jwtToken: token, currentOrganizationId: unitId, organizationId: unitId,
        userPermissions: claims.permissions, userRoles: claims.roleNames, userRoleIds: claims.roleIds });
      this.pending.clear();
      this.app.userPermissions = claims.permissions;
      this.app.userRoles = claims.roleNames;
      await refreshAccess(this.app);
      // Later screens read the unit's id and settings from the app.
      await this.app.useOrganization(unitId);
      if (!hasPermission('roles.manage_district') || !hasPermission('roles.manage')) {
        this.saving = false;
        this.app.router.navigate('/dashboard');
        return;
      }
      await this.reload();
    } catch (error) { this.app.showMessage(apiErrorMessage(error, 'role_matrix_load_failed'), 'error'); }
    finally {
      this.saving = false;
      // Restore the old selector after a failed switch, and unlock the new
      // unit after a successful one. A failed load keeps its retry state.
      if (!this.destroyed && this.root()?.querySelector('#role-matrix-unit')) { this.render(); }
    }
  }
}
