/**
 * Catalogue articles, with a quantity each, in the material of a schedule
 * line. The free-text material stays beside it.
 *
 * The field keeps its own state: re-drawing its list keeps what was typed.
 * Without a catalogue (it could not be loaded), the articles already listed
 * are shown, and `value()` returns undefined so a save leaves them unchanged.
 *
 * @module spa/modules/equipment-catalog/MaterialItemsField
 */
import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { equipmentUnitLabel, formatEquipmentQuantity } from '../../utils/EquipmentUnitUtils.js';

const QUANTITY_PATTERN = /^\d{1,5}(?:[.,]\d{1,2})?$/;

/**
 * Read a typed quantity: above zero, within the server's limit, two decimals
 * at most; a comma is read as the decimal mark.
 *
 * @param {string} text
 * @returns {number|null}
 */
export function readQuantity(text) {
  const value = String(text ?? '').trim();
  if (!QUANTITY_PATTERN.test(value)) {
    return null;
  }
  const quantity = Number(value.replace(',', '.'));
  return quantity > 0 && quantity <= CONFIG.EQUIPMENT_CATALOG.QUANTITY_MAX ? quantity : null;
}

/**
 * The articles of a schedule line, for reading.
 *
 * @param {Object[]} items - material_items from the server
 * @param {string} lang
 * @returns {string} HTML list, or '' when there are none
 */
export function renderMaterialItemsList(items, lang) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  return `<ul class="material-items__summary">${items.map((item) => `<li>
    ${escapeHTML(formatEquipmentQuantity(item.quantity, item.unit_of_measure, lang))} · ${escapeHTML(item.name)}
  </li>`).join('')}</ul>`;
}

export class MaterialItemsField {
  /**
   * @param {Object} options
   * @param {Object[]|null} options.catalog - The unit's active articles; null when unavailable
   * @param {Object[]} [options.items] - The line's articles (material_items)
   * @param {string} options.idPrefix - Unique prefix for element ids
   * @param {string} options.lang - Reader's language
   * @param {boolean} [options.canManageCatalog] - Offer a link to the catalogue when it is empty
   */
  constructor({ catalog, items = [], idPrefix, lang, canManageCatalog = false }) {
    this.catalog = Array.isArray(catalog) ? catalog : null;
    this.items = items.map((item) => ({ ...item, typed: String(item.quantity) }));
    this.idPrefix = idPrefix;
    this.lang = lang;
    this.canManageCatalog = canManageCatalog;
    this.root = null;
  }

  /** @returns {string} The fieldset, to place in a form */
  markup() {
    return `<fieldset class="material-items" id="${escapeAttribute(this.idPrefix)}">
      <legend>${escapeHTML(translate('equipment_catalog_items_legend'))}</legend>
      <div class="material-items__body">${this.bodyMarkup()}</div>
    </fieldset>`;
  }

  /** @returns {string} Everything inside the fieldset */
  bodyMarkup() {
    const errorId = `${this.idPrefix}-error`;
    if (!this.catalog) {
      return `${renderMaterialItemsList(this.items, this.lang)}
        <p class="material-items__note">${escapeHTML(translate('equipment_catalog_unavailable'))}</p>`;
    }
    const list = this.items.length ? `<ul class="material-items__list">${this.items.map((item) => {
      const id = Number(item.catalog_item_id);
      const name = item.archived ? translate('equipment_catalog_archived_name').replace('{name}', item.name) : item.name;
      return `<li class="material-items__row">
        <span class="material-items__name">${escapeHTML(name)}</span>
        <span class="material-items__quantity">
          <label for="${escapeAttribute(`${this.idPrefix}-qty-${id}`)}">${escapeHTML(translate('equipment_quantity'))}</label>
          <input type="text" inputmode="decimal" id="${escapeAttribute(`${this.idPrefix}-qty-${id}`)}"
                 data-quantity-for="${id}" value="${escapeAttribute(item.typed)}" required
                 aria-label="${escapeAttribute(translate('equipment_quantity_of').replace('{name}', item.name).replace('{unit}', equipmentUnitLabel(item.unit_of_measure)))}">
          <span class="material-items__unit">${escapeHTML(equipmentUnitLabel(item.unit_of_measure))}</span>
        </span>
        <button type="button" class="button button--small button--ghost" data-remove-item="${id}"
                aria-label="${escapeAttribute(translate('equipment_catalog_remove_item').replace('{name}', item.name))}">
          ${escapeHTML(translate('remove'))}
        </button>
      </li>`;
    }).join('')}</ul>` : '';
    const chosen = new Set(this.items.map((item) => Number(item.catalog_item_id)));
    const offered = this.catalog.filter((item) => !item.archived && !chosen.has(Number(item.id)));
    let adder = '';
    if (offered.length && this.items.length < CONFIG.EQUIPMENT_CATALOG.ITEMS_MAX) {
      adder = `<div class="material-items__add">
        <label for="${escapeAttribute(`${this.idPrefix}-select`)}">${escapeHTML(translate('equipment_catalog_add_item'))}</label>
        <select id="${escapeAttribute(`${this.idPrefix}-select`)}" data-item-select>
          ${offered.map((item) => `<option value="${Number(item.id)}">${escapeHTML(item.name)} (${escapeHTML(equipmentUnitLabel(item.unit_of_measure))})</option>`).join('')}
        </select>
        <button type="button" class="button button--small button--secondary" data-add-item>${escapeHTML(translate('add'))}</button>
      </div>`;
    } else if (this.catalog.length === 0) {
      adder = `<p class="material-items__note">${escapeHTML(translate('equipment_catalog_empty_short'))}
        ${this.canManageCatalog ? `<a href="/equipment-catalog">${escapeHTML(translate('equipment_catalog_open'))}</a>` : ''}</p>`;
    }
    return `${list}${adder}
      <p class="field-error" id="${escapeAttribute(errorId)}" role="alert" hidden></p>`;
  }

  /**
   * Wire the field once it is in the document. One listener on the fieldset,
   * so re-drawing its body never stacks handlers.
   *
   * @param {ParentNode} container - Holds the fieldset
   */
  attach(container) {
    this.root = container.querySelector(`fieldset[id="${this.idPrefix}"]`);
    if (!this.root || !this.catalog) {
      return;
    }
    this.root.addEventListener('click', (event) => {
      const add = event.target.closest('[data-add-item]');
      const remove = event.target.closest('[data-remove-item]');
      if (add) {
        this.add();
      } else if (remove) {
        this.remove(Number(remove.dataset.removeItem));
      }
    });
    this.root.addEventListener('input', (event) => {
      const input = event.target.closest('[data-quantity-for]');
      if (input) {
        this.clearError();
      }
    });
  }

  /** Keep what was typed before the body is drawn again. */
  syncTyped() {
    this.root?.querySelectorAll('[data-quantity-for]').forEach((input) => {
      const item = this.items.find((entry) => Number(entry.catalog_item_id) === Number(input.dataset.quantityFor));
      if (item) {
        item.typed = input.value;
      }
    });
  }

  redraw() {
    this.syncTyped();
    setContent(this.root.querySelector('.material-items__body'), this.bodyMarkup());
  }

  add() {
    const select = this.root.querySelector('[data-item-select]');
    const article = this.catalog.find((item) => Number(item.id) === Number(select?.value));
    if (!article) {
      return;
    }
    this.syncTyped();
    this.items.push({
      catalog_item_id: Number(article.id),
      name: article.name,
      unit_of_measure: article.unit_of_measure,
      archived: false,
      typed: '1',
    });
    this.redraw();
    this.root.querySelector(`[data-quantity-for="${Number(article.id)}"]`)?.focus();
  }

  /** @param {number} catalogItemId */
  remove(catalogItemId) {
    this.syncTyped();
    this.items = this.items.filter((item) => Number(item.catalog_item_id) !== catalogItemId);
    this.redraw();
    (this.root.querySelector('[data-item-select]') || this.root.querySelector('[data-quantity-for]'))?.focus();
  }

  clearError() {
    const error = this.root?.querySelector('.field-error');
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    this.root?.querySelectorAll('[aria-invalid]').forEach((input) => {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    });
  }

  /**
   * The articles to send. Explains a quantity that cannot be read next to it.
   *
   * @returns {Array<{catalog_item_id: number, quantity: number}>|null|undefined}
   *   The list; null when a quantity is invalid (the error is shown and the
   *   field focused); undefined when there is no catalogue, so nothing is sent
   */
  value() {
    if (!this.catalog || !this.root) {
      return undefined;
    }
    this.syncTyped();
    this.clearError();
    const items = [];
    for (const item of this.items) {
      const quantity = readQuantity(item.typed);
      if (quantity === null) {
        const input = this.root.querySelector(`[data-quantity-for="${Number(item.catalog_item_id)}"]`);
        const error = this.root.querySelector('.field-error');
        error.textContent = translate('equipment_quantity_invalid').replace('{name}', item.name);
        error.hidden = false;
        input?.setAttribute('aria-invalid', 'true');
        input?.setAttribute('aria-describedby', error.id);
        input?.focus();
        return null;
      }
      items.push({ catalog_item_id: Number(item.catalog_item_id), quantity });
    }
    return items;
  }
}
