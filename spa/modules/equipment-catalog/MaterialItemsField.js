/**
 * What a schedule line needs, with a quantity each: the unit's catalogue
 * articles and the inventory items it has or may borrow. The free-text
 * material stays beside it.
 *
 * The field keeps its own state: re-drawing its list keeps what was typed.
 * Without the list of choices (it could not be loaded), what the line already
 * lists is shown, and `value()` returns undefined so a save leaves it as is.
 *
 * @module spa/modules/equipment-catalog/MaterialItemsField
 */
import { translate } from '../../app.js';
import { EQUIPMENT_CATALOG_LIMITS } from '../../config/equipment-catalog.js';
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
  return quantity > 0 && quantity <= EQUIPMENT_CATALOG_LIMITS.QUANTITY_MAX ? quantity : null;
}

/**
 * One key per catalogue article or inventory item: a3 is article 3, e7 item 7.
 *
 * @param {{catalog_item_id?: number|null, equipment_item_id?: number|null}} item
 * @returns {string}
 */
export function materialKey(item) {
  return item.catalog_item_id ? `a${Number(item.catalog_item_id)}` : `e${Number(item.equipment_item_id)}`;
}

/**
 * What a schedule line lists, for reading.
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
   * @param {{articles: Object[], equipment: Object[]}|null} options.choices - What the unit has or may
   *   use (GET v1/equipment-catalog/options); null when it could not be loaded
   * @param {Object[]} [options.items] - What the line lists (material_items)
   * @param {string} options.idPrefix - Unique prefix for element ids
   * @param {string} options.lang - Reader's language
   * @param {boolean} [options.canManageCatalog] - Offer a link to the catalogue when there is nothing to choose
   */
  constructor({ choices, items = [], idPrefix, lang, canManageCatalog = false }) {
    this.choices = choices && Array.isArray(choices.articles) && Array.isArray(choices.equipment) ? choices : null;
    this.items = items.map((item) => ({ ...item, key: materialKey(item), typed: String(item.quantity) }));
    this.idPrefix = idPrefix;
    this.lang = lang;
    this.canManageCatalog = canManageCatalog;
    this.root = null;
  }

  /** @returns {Array<Object>} Every choice, each with its key */
  allChoices() {
    if (!this.choices) {
      return [];
    }
    return [
      ...this.choices.articles.map((item) => ({ ...item, key: `a${Number(item.id)}`, catalog_item_id: Number(item.id) })),
      ...this.choices.equipment.map((item) => ({ ...item, key: `e${Number(item.id)}`, equipment_item_id: Number(item.id) })),
    ];
  }

  /** @returns {string} The fieldset, to place in a form */
  markup() {
    return `<fieldset class="material-items" id="${escapeAttribute(this.idPrefix)}">
      <legend>${escapeHTML(translate('equipment_catalog_items_legend'))}</legend>
      <div class="material-items__body">${this.bodyMarkup()}</div>
    </fieldset>`;
  }

  /**
   * @param {Object} item - A listed entry
   * @returns {string} Its row: name, quantity, remove
   */
  rowMarkup(item) {
    const inputId = `${this.idPrefix}-qty-${item.key}`;
    const name = item.archived ? translate('equipment_catalog_archived_name').replace('{name}', item.name) : item.name;
    const unit = equipmentUnitLabel(item.unit_of_measure);
    return `<li class="material-items__row">
      <span class="material-items__name">${escapeHTML(name)}</span>
      <span class="material-items__quantity">
        <label for="${escapeAttribute(inputId)}">${escapeHTML(translate('equipment_quantity'))}</label>
        <input type="text" inputmode="decimal" id="${escapeAttribute(inputId)}"
               data-quantity-for="${escapeAttribute(item.key)}" value="${escapeAttribute(item.typed)}" required
               aria-label="${escapeAttribute(translate('equipment_quantity_of').replace('{name}', item.name).replace('{unit}', unit))}">
        <span class="material-items__unit">${escapeHTML(unit)}</span>
      </span>
      <button type="button" class="button button--small button--ghost" data-remove-item="${escapeAttribute(item.key)}"
              aria-label="${escapeAttribute(translate('equipment_catalog_remove_item').replace('{name}', item.name))}">
        ${escapeHTML(translate('remove'))}
      </button>
    </li>`;
  }

  /**
   * @param {string} labelKey - Group label
   * @param {Object[]} entries - Choices of that group
   * @returns {string} An <optgroup>, or '' when empty
   */
  optionGroup(labelKey, entries) {
    if (!entries.length) {
      return '';
    }
    return `<optgroup label="${escapeAttribute(translate(labelKey))}">
      ${entries.map((item) => `<option value="${escapeAttribute(item.key)}">${escapeHTML(item.name)} (${escapeHTML(equipmentUnitLabel(item.unit_of_measure))})</option>`).join('')}
    </optgroup>`;
  }

  /** @returns {string} Everything inside the fieldset */
  bodyMarkup() {
    const errorId = `${this.idPrefix}-error`;
    if (!this.choices) {
      return `${renderMaterialItemsList(this.items, this.lang)}
        <p class="material-items__note">${escapeHTML(translate('equipment_catalog_unavailable'))}</p>`;
    }
    const list = this.items.length
      ? `<ul class="material-items__list">${this.items.map((item) => this.rowMarkup(item)).join('')}</ul>` : '';
    const chosen = new Set(this.items.map((item) => item.key));
    const offered = this.allChoices().filter((item) => !chosen.has(item.key));
    let adder = '';
    if (offered.length && this.items.length < EQUIPMENT_CATALOG_LIMITS.ITEMS_MAX) {
      adder = `<div class="material-items__add">
        <label for="${escapeAttribute(`${this.idPrefix}-select`)}">${escapeHTML(translate('equipment_catalog_add_item'))}</label>
        <select id="${escapeAttribute(`${this.idPrefix}-select`)}" data-item-select>
          ${this.optionGroup('equipment_catalog_group_articles', offered.filter((item) => item.catalog_item_id))}
          ${this.optionGroup('equipment_catalog_group_inventory', offered.filter((item) => item.equipment_item_id))}
        </select>
        <button type="button" class="button button--small button--secondary" data-add-item>${escapeHTML(translate('add'))}</button>
      </div>`;
    } else if (this.allChoices().length === 0) {
      adder = `<p class="material-items__note">${escapeHTML(translate('equipment_catalog_empty_short'))}
        ${this.canManageCatalog ? `<a href="/material?tab=articles">${escapeHTML(translate('equipment_catalog_open'))}</a>` : ''}</p>`;
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
    if (!this.root || !this.choices) {
      return;
    }
    this.root.addEventListener('click', (event) => {
      const add = event.target.closest('[data-add-item]');
      const remove = event.target.closest('[data-remove-item]');
      if (add) {
        this.add();
      } else if (remove) {
        this.remove(remove.dataset.removeItem);
      }
    });
    this.root.addEventListener('input', (event) => {
      if (event.target.closest('[data-quantity-for]')) {
        this.clearError();
      }
    });
  }

  /** Keep what was typed before the body is drawn again. */
  syncTyped() {
    this.root?.querySelectorAll('[data-quantity-for]').forEach((input) => {
      const item = this.items.find((entry) => entry.key === input.dataset.quantityFor);
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
    const choice = this.allChoices().find((item) => item.key === select?.value);
    if (!choice) {
      return;
    }
    this.syncTyped();
    this.items.push({
      key: choice.key,
      catalog_item_id: choice.catalog_item_id || null,
      equipment_item_id: choice.equipment_item_id || null,
      name: choice.name,
      category: choice.category,
      unit_of_measure: choice.unit_of_measure,
      archived: false,
      typed: '1',
    });
    this.redraw();
    this.root.querySelector(`[data-quantity-for="${choice.key}"]`)?.focus();
  }

  /** @param {string} key - Entry to remove */
  remove(key) {
    this.syncTyped();
    this.items = this.items.filter((item) => item.key !== key);
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
   * What to send. Explains a quantity that cannot be read next to it.
   *
   * @returns {Array<Object>|null|undefined} Entries naming catalog_item_id or
   *   equipment_item_id with a quantity; null when a quantity is invalid (the
   *   error is shown and the field focused); undefined without choices, so
   *   nothing is sent
   */
  value() {
    const entries = this.entries();
    if (!entries) {
      return entries;
    }
    return entries.map((item) => (item.catalog_item_id
      ? { catalog_item_id: item.catalog_item_id, quantity: item.quantity }
      : { equipment_item_id: item.equipment_item_id, quantity: item.quantity }));
  }

  /**
   * The listed entries with their names, as a line keeps them for display.
   *
   * @returns {Array<Object>|null|undefined} As value(), each entry also with
   *   name, category, unit_of_measure and archived
   */
  entries() {
    if (!this.choices || !this.root) {
      return undefined;
    }
    this.syncTyped();
    this.clearError();
    const entries = [];
    for (const item of this.items) {
      const quantity = readQuantity(item.typed);
      if (quantity === null) {
        const input = this.root.querySelector(`[data-quantity-for="${item.key}"]`);
        const error = this.root.querySelector('.field-error');
        error.textContent = translate('equipment_quantity_invalid').replace('{name}', item.name);
        error.hidden = false;
        input?.setAttribute('aria-invalid', 'true');
        input?.setAttribute('aria-describedby', error.id);
        input?.focus();
        return null;
      }
      entries.push({
        catalog_item_id: item.catalog_item_id || null,
        equipment_item_id: item.equipment_item_id || null,
        quantity,
        name: item.name,
        category: item.category,
        unit_of_measure: item.unit_of_measure,
        archived: Boolean(item.archived),
      });
    }
    return entries;
  }
}
