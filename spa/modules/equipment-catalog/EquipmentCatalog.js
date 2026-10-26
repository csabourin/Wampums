/**
 * The unit's equipment catalogue: articles named once (name, category, unit
 * of measure, optionally the inventory item they are) and offered, with a
 * quantity, in the material of every schedule line of the unit.
 *
 * Articles are archived rather than deleted: a schedule line keeps naming one
 * the unit no longer offers, and an archived article can be restored.
 *
 * @module spa/modules/equipment-catalog/EquipmentCatalog
 */
import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { hasPermission, isDemoUser } from '../../utils/PermissionUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { equipmentCategoryLabel, equipmentCategoryOptions } from '../../utils/EquipmentCategoryUtils.js';
import { equipmentUnitLabel, equipmentUnitOptions } from '../../utils/EquipmentUnitUtils.js';
import {
  getEquipmentCatalog,
  createCatalogItem,
  updateCatalogItem,
  getLinkableEquipment,
} from '../../api/api-equipment-catalog.js';

/** Form fields, by the API field a server error names. */
const FORM_FIELDS = {
  name: 'catalog_name',
  category: 'catalog_category',
  unit_of_measure: 'catalog_unit',
  equipment_item_id: 'catalog_equipment',
};

export class EquipmentCatalog {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.readOnly = isDemoUser();
    this.canLinkInventory = hasPermission('inventory.view');
    this.showArchived = false;
    this.items = [];
    this.destroyed = false;
  }

  destroy() {
    this.destroyed = true;
  }

  /** @returns {HTMLElement|null} */
  root() {
    return document.getElementById('app');
  }

  /** Load the catalogue, showing it or the error. */
  async init() {
    this.renderState('loading');
    try {
      const response = await getEquipmentCatalog({ includeArchived: this.showArchived, forceRefresh: true });
      if (this.destroyed) {
        return;
      }
      this.items = Array.isArray(response?.data) ? response.data : [];
      this.render();
    } catch (error) {
      debugError('Failed to load the equipment catalogue:', error);
      this.renderState('error');
    }
  }

  /** @param {'loading'|'error'} state */
  renderState(state) {
    if (this.destroyed) {
      return;
    }
    setContent(this.root(), `<section class="page equipment-catalog" ${state === 'loading' ? 'aria-busy="true"' : ''}>
      ${renderBackLink()}
      <h1>${translate('equipment_catalog_title')}</h1>
      ${state === 'loading'
    ? `<p role="status">${translate('loading')}</p>`
    : `<p class="status-message error" role="alert">${translate('equipment_catalog_load_failed')}</p>
         <button type="button" class="button button--secondary" id="equipment-catalog-retry">${translate('retry')}</button>`}
    </section>`);
    document.getElementById('equipment-catalog-retry')?.addEventListener('click', () => this.init());
  }

  /** @param {Object} item @returns {string} One article */
  renderItem(item) {
    const id = Number(item.id);
    const count = Number(item.usage_count) || 0;
    let usage = translate('equipment_catalog_used_other').replace('{count}', String(count));
    if (count === 0) {
      usage = translate('equipment_catalog_used_none');
    } else if (count === 1) {
      usage = translate('equipment_catalog_used_one');
    }
    return `<li class="card equipment-catalog__item ${item.archived ? 'is-archived' : ''}">
      <h2>${escapeHTML(item.name)}</h2>
      ${item.archived ? `<p class="equipment-catalog__badge">${translate('equipment_catalog_archived')}</p>` : ''}
      <dl class="equipment-catalog__facts">
        <div><dt>${translate('equipment_catalog_category')}</dt><dd>${escapeHTML(equipmentCategoryLabel(item.category))}</dd></div>
        <div><dt>${translate('equipment_catalog_unit')}</dt><dd>${escapeHTML(equipmentUnitLabel(item.unit_of_measure))}</dd></div>
        ${item.equipment_name ? `<div><dt>${translate('equipment_catalog_inventory_item')}</dt><dd>${escapeHTML(item.equipment_name)}</dd></div>` : ''}
      </dl>
      <p>${escapeHTML(usage)}</p>
      ${this.readOnly ? '' : `<div class="equipment-catalog__actions">
        ${item.archived ? '' : `<button type="button" class="button button--small button--secondary" data-catalog-edit="${id}"
          aria-label="${escapeAttribute(translate('equipment_catalog_edit_named').replace('{name}', item.name))}">${translate('edit')}</button>`}
        <button type="button" class="button button--small button--ghost" data-catalog-archive="${id}"
          aria-label="${escapeAttribute(translate(item.archived ? 'equipment_catalog_restore_named' : 'equipment_catalog_archive_named').replace('{name}', item.name))}">
          ${translate(item.archived ? 'equipment_catalog_restore' : 'equipment_catalog_archive')}
        </button>
      </div>`}
    </li>`;
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const root = this.root();
    const list = this.items.map((item) => this.renderItem(item)).join('');
    setContent(root, `<section class="page equipment-catalog">
      ${renderBackLink()}
      <h1>${translate('equipment_catalog_title')}</h1>
      <p>${translate('equipment_catalog_intro')}</p>
      <div class="equipment-catalog__toolbar">
        <button type="button" class="button button--ghost" id="equipment-catalog-archived" data-archive-safe
                aria-pressed="${this.showArchived}">${translate('equipment_catalog_show_archived')}</button>
        ${this.readOnly ? '' : `<button type="button" class="button button--primary" id="equipment-catalog-create">${translate('equipment_catalog_create')}</button>`}
      </div>
      ${list
    ? `<ul class="equipment-catalog__list">${list}</ul>`
    : `<p class="empty-state">${translate('equipment_catalog_empty')}</p>`}
    </section>`);
    document.getElementById('equipment-catalog-archived')?.addEventListener('click', () => {
      this.showArchived = !this.showArchived;
      this.init();
    });
    document.getElementById('equipment-catalog-create')?.addEventListener('click', () => this.edit());
    root.querySelectorAll('[data-catalog-edit]').forEach((button) => {
      button.addEventListener('click', () =>
        this.edit(this.items.find((item) => item.id === Number(button.dataset.catalogEdit))));
    });
    root.querySelectorAll('[data-catalog-archive]').forEach((button) => {
      button.addEventListener('click', () =>
        this.toggleArchived(this.items.find((item) => item.id === Number(button.dataset.catalogArchive))));
    });
  }

  /**
   * Inventory items an article may be linked to; [] when the person cannot
   * read the inventory or it could not be loaded.
   *
   * @returns {Promise<Object[]>}
   */
  async linkableEquipment() {
    if (!this.canLinkInventory) {
      return [];
    }
    try {
      const response = await getLinkableEquipment();
      return response?.data?.equipment || [];
    } catch (error) {
      debugError('Failed to load inventory for the catalogue:', error);
      return [];
    }
  }

  /**
   * Open the article form. A failed save keeps what was typed and names the
   * field at fault.
   *
   * @param {Object|null} item - Article to edit, or null to create
   */
  async edit(item = null) {
    const equipment = await this.linkableEquipment();
    if (this.destroyed) {
      return;
    }
    const linked = item?.equipment_item_id ? Number(item.equipment_item_id) : null;
    if (linked && !equipment.some((entry) => Number(entry.id) === linked)) {
      equipment.push({ id: linked, name: item.equipment_name || translate('equipment_catalog_inventory_item') });
    }
    const equipmentField = equipment.length ? `
      <label for="equipment-catalog-equipment">${translate('equipment_catalog_inventory_item')}</label>
      <select id="equipment-catalog-equipment" name="catalog_equipment">
        <option value="">${translate('equipment_catalog_no_inventory_item')}</option>
        ${equipment.map((entry) => `<option value="${Number(entry.id)}" ${Number(entry.id) === linked ? 'selected' : ''}>${escapeHTML(entry.name)}</option>`).join('')}
      </select>` : '';
    const modal = openModal({
      id: 'equipment-catalog-editor',
      title: translate(item ? 'equipment_catalog_edit' : 'equipment_catalog_create'),
      closeOnBackdrop: false,
      canClose: () => document.getElementById('equipment-catalog-form')?.getAttribute('aria-busy') !== 'true',
      body: `<form id="equipment-catalog-form" class="equipment-catalog__form" novalidate>
        <label for="equipment-catalog-name">${translate('equipment_catalog_name')}</label>
        <input id="equipment-catalog-name" name="catalog_name" required aria-required="true"
               maxlength="${CONFIG.EQUIPMENT_CATALOG.NAME_MAX_LENGTH}" value="${escapeAttribute(item?.name || '')}">
        <label for="equipment-catalog-category">${translate('equipment_catalog_category')}</label>
        <select id="equipment-catalog-category" name="catalog_category">${equipmentCategoryOptions(item?.category || 'other')}</select>
        <label for="equipment-catalog-unit">${translate('equipment_catalog_unit')}</label>
        <select id="equipment-catalog-unit" name="catalog_unit">${equipmentUnitOptions(item?.unit_of_measure || 'each')}</select>
        ${equipmentField}
        <p id="equipment-catalog-form-error" class="field-error" role="alert" tabindex="-1" hidden></p>
      </form>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" class="button button--primary" form="equipment-catalog-form">${translate('save')}</button>`,
    });
    const form = document.getElementById('equipment-catalog-form');
    const problem = document.getElementById('equipment-catalog-form-error');
    const showProblem = (message, fields) => {
      problem.textContent = message;
      problem.hidden = false;
      fields.forEach((name) => {
        const control = form.elements.namedItem(name);
        control?.setAttribute('aria-invalid', 'true');
        control?.setAttribute('aria-describedby', problem.id);
      });
      (form.elements.namedItem(fields[0] || '') || problem).focus();
    };
    form.addEventListener('input', () => {
      form.querySelectorAll('[aria-invalid]').forEach((control) => {
        control.removeAttribute('aria-invalid');
        control.removeAttribute('aria-describedby');
      });
      problem.hidden = true;
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = form.elements.catalog_name.value.trim();
      if (!name) {
        showProblem(translate('equipment_catalog_name_required'), ['catalog_name']);
        return;
      }
      withFormBusy(form, async () => {
        const payload = {
          name,
          category: form.elements.catalog_category.value,
          unit_of_measure: form.elements.catalog_unit.value,
        };
        if (form.elements.namedItem('catalog_equipment')) {
          payload.equipment_item_id = form.elements.catalog_equipment.value ? Number(form.elements.catalog_equipment.value) : null;
        }
        try {
          await (item ? updateCatalogItem(item.id, payload) : createCatalogItem(payload));
        } catch (error) {
          debugError('Failed to save a catalogue article:', error);
          if (this.destroyed) {
            return;
          }
          const fields = (error.errors || []).map((entry) => FORM_FIELDS[entry.path]).filter(Boolean);
          showProblem(apiErrorMessage(error, 'equipment_catalog_save_failed'), fields);
          return;
        }
        // The save stands even if the reload fails.
        form.removeAttribute('aria-busy');
        modal.close();
        if (this.destroyed) {
          return;
        }
        this.app.showMessage(translate('equipment_catalog_saved'), 'success');
        await this.init();
        if (!this.destroyed) {
          const target = item
            ? document.querySelector(`[data-catalog-edit="${Number(item.id)}"]`)
            : document.getElementById('equipment-catalog-create');
          (target || document.getElementById('equipment-catalog-retry'))?.focus();
        }
      });
    });
  }

  /** @param {Object|undefined} item - Archive it, or restore it when archived */
  async toggleArchived(item) {
    if (!item) {
      return;
    }
    try {
      await updateCatalogItem(item.id, { archived: !item.archived });
    } catch (error) {
      debugError('Failed to archive a catalogue article:', error);
      if (!this.destroyed) {
        this.app.showMessage(apiErrorMessage(error, 'equipment_catalog_save_failed'), 'error');
      }
      return;
    }
    if (this.destroyed) {
      return;
    }
    this.app.showMessage(translate(item.archived ? 'equipment_catalog_restored' : 'equipment_catalog_archived_done'), 'success');
    await this.init();
    if (!this.destroyed) {
      (document.querySelector(`[data-catalog-archive="${Number(item.id)}"]`)
        || document.getElementById('equipment-catalog-create')
        || document.getElementById('equipment-catalog-retry'))?.focus();
    }
  }
}
