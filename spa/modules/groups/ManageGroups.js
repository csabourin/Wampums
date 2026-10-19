import {
  getGroups,
  addGroup,
  removeGroup,
} from '../../ajax-functions.js';
import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { canViewGroups } from '../../utils/PermissionUtils.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';

export class ManageGroups {
  constructor(app) {
    this.app = app;
    this.groups = [];
    this.destroyed = false;
  }

  async init() {
    // Check permission
    if (!canViewGroups()) {
      this.app.router.navigate('/dashboard');
      return;
    }

    showPageLoading(document.getElementById('app'), this.pageOptions());
    try {
      await this.fetchGroups();
    } catch (error) {
      debugError('Error initializing manage groups:', error);
      this.renderError();
      return;
    }
    if (this.destroyed) {
      return;
    }
    this.render();
    this.attachEventListeners();
  }

  /** @returns {Object} Shared page-state options */
  pageOptions() {
    return { title: translate('manage_groups'), className: 'manage-groups-page' };
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  async fetchGroups() {
    const fetchedGroup = await getGroups();
    // A refused or failed answer is an error, never an empty list of groups.
    if (!fetchedGroup?.success) {
      throw new Error('groups_unavailable');
    }
    this.groups = fetchedGroup.data || fetchedGroup.groups || [];
  }


  render() {
    if (this.destroyed) {
      return;
    }
    const content = `
      <section class="page manage-groups-page">
        ${renderBackLink()}
        <h1>${translate('manage_groups')}</h1>
        <form id="add-group-form" novalidate>
          <h2>${translate('add_group')}</h2>
          <label for="group_name">${translate('group_name')}</label>
          <input type="text" id="group_name" name="group_name" required aria-describedby="group-name-error">
          <p class="status-message error" role="alert" id="group-name-error"></p>
          <button type="submit" class="button button--primary">${translate('add_group')}</button>
        </form>
        <h2>${translate('existing_groups')}</h2>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">${translate('group_name')}</th>
                <th scope="col">${translate('group_member_count')}</th>
                <th scope="col">${translate('action')}</th>
              </tr>
            </thead>
            <tbody>
              ${this.renderGroupRows()}
            </tbody>
          </table>
        </div>
      </section>
    `;
    setContent(document.getElementById('app'), content);
  }

  renderGroupRows() {
    if (this.groups.length === 0) {
      return `
            <tr>
                <td colspan="3">${translate('no_groups_found')}</td>
            </tr>
        `;
    }

    return this.groups
      .map((group) => {
        const memberCount = Number(group.member_count) || 0;
        const formattedCount = new Intl.NumberFormat(this.app.lang || CONFIG.DEFAULT_LANG).format(memberCount);
        return `
            <tr data-group-row="${Number(group.id)}">
                <td>${escapeHTML(group.name || '')}</td>
                <td class="${memberCount > 0 ? 'group-members group-members--occupied' : 'group-members'}">${formattedCount}</td>
                <td>
                    <button type="button" class="button button--small button--danger remove-group"
                            data-group-id="${Number(group.id)}"
                            data-member-count="${memberCount}">
                        ${translate('remove_group')}
                    </button>
                </td>
            </tr>
        `;
      })
      .join('');
  }

  attachEventListeners() {
    const addGroupForm = document.getElementById('add-group-form');
    if (addGroupForm) {
      addGroupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        withFormBusy(addGroupForm, () => this.handleAddGroup());
      });
      // The message goes as soon as the name changes.
      addGroupForm.elements.namedItem('group_name')?.addEventListener('input', () => this.setNameError(''));
    }

    document.querySelectorAll('.remove-group').forEach((button) => {
      button.addEventListener('click', (e) => this.handleRemoveGroup(e));
    });
  }

  /**
   * Show (or clear) the error tied to the name field.
   *
   * @param {string} message - Translated message; empty clears it
   * @returns {void}
   */
  setNameError(message) {
    const input = document.getElementById('group_name');
    const errorElement = document.getElementById('group-name-error');
    if (errorElement) {
      errorElement.textContent = message;
    }
    if (input) {
      if (message) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    }
  }

  async handleAddGroup() {
    const groupName = document.getElementById('group_name').value.trim();

    if (!groupName) {
      this.setNameError(translate('group_name_required'));
      document.getElementById('group_name')?.focus();
      return;
    }

    let result;
    try {
      result = await addGroup(groupName);
      if (!result?.success && !result?.queued) {
        throw Object.assign(new Error('group_not_added'), { status: result?.status });
      }
    } catch (error) {
      debugError('Error adding group:', error);
      this.app.showMessage(apiErrorMessage(error, 'error_adding_group'), 'error');
      return;
    }
    this.app.showMessage(result.queued ? 'offline.savedLocally' : 'group_added_successfully', result.queued ? 'info' : 'success');
    await this.reloadAfterWrite();
  }

  async handleRemoveGroup(e) {
    const button = e.currentTarget;
    const groupId = button.getAttribute('data-group-id');
    const memberCount = Number(button.getAttribute('data-member-count')) || 0;
    const formattedCount = new Intl.NumberFormat(this.app.lang || CONFIG.DEFAULT_LANG).format(memberCount);

    // Say how many youth are in it before deleting. The issue asked for the
    // count precisely so a den that still has youth in it is not deleted by
    // mistake; the assignments are for the selected year, and removing the row
    // strands every year's assignments, not just this one.
    const warning = memberCount > 0
      ? ` ${translate('group_has_members_warning').replace('{{count}}', formattedCount)}`
      : '';

    if (!await confirmDestructive(`${translate('confirm_delete_group')}${warning}`)) {
      return;
    }
    let result;
    try {
      result = await removeGroup(groupId);
      if (!result?.success && !result?.queued) {
        throw Object.assign(new Error('group_not_removed'), { status: result?.status });
      }
    } catch (error) {
      debugError('Error removing group:', error);
      this.app.showMessage(apiErrorMessage(error, 'error_removing_group'), 'error');
      return;
    }
    this.app.showMessage(result.queued ? 'offline.savedLocally' : 'group_removed_successfully', result.queued ? 'info' : 'success');
    await this.reloadAfterWrite();
  }

  /**
   * Redraw the list after a write. The write stands even if the reload fails:
   * the page then shows the error state with its retry, not "not saved".
   *
   * @returns {Promise<void>}
   */
  async reloadAfterWrite() {
    try {
      await this.fetchGroups();
    } catch (error) {
      debugError('Error reloading groups:', error);
      this.renderError();
      return;
    }
    this.render();
    this.attachEventListeners();
  }

  renderError() {
    if (this.destroyed) {
      return;
    }
    showPageError(document.getElementById('app'), {
      ...this.pageOptions(),
      message: translate('error_loading_manage_groups'),
    }, () => this.init());
  }
}
