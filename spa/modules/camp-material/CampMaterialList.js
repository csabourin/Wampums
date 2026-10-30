/**
 * The collective material list of a camp: what every activity of its schedule
 * needs, added up once per article, to print or export before packing.
 *
 * With the inventory right, each article that is an inventory item says what
 * this camp has reserved, what is still free over its dates and what is
 * missing; equipment reserved for the camp that no activity lists is pointed
 * out. Free-text material is not added up: it is listed apart, activity by
 * activity, marked as not consolidated.
 *
 * Someone who may also reserve equipment can reserve, in one step, what the
 * list still lacks and is free; the server recounts and refuses a stale count.
 *
 * @module spa/modules/camp-material/CampMaterialList
 */
import { translate } from '../../app.js';
import { setContent, loadStylesheet, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { hasAllPermissions, isDemoUser } from '../../utils/PermissionUtils.js';
import { CONFIG } from '../../config.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { equipmentCategoryLabel } from '../../utils/EquipmentCategoryUtils.js';
import { formatEquipmentQuantity, equipmentUnitLabel } from '../../utils/EquipmentUnitUtils.js';
import { exportToCSV } from '../../utils/ExportUtils.js';
import { openPrintWindow, setPrintContent, REPORT_PRINT_STYLES } from '../../utils/PrintUtils.js';
import { getCampMaterialList, reserveCampMaterial } from '../../api/api-camp-material.js';
import { getMeetingSchedule, updateMeetingActivity } from '../../api/api-yearly-planner.js';
import { getMaterialOptions, createCatalogItem } from '../../api/api-equipment-catalog.js';
import { MaterialItemsField } from '../equipment-catalog/MaterialItemsField.js';
import { EQUIPMENT_CATALOG_LIMITS } from '../../config/equipment-catalog.js';
import { equipmentCategoryOptions } from '../../utils/EquipmentCategoryUtils.js';
import { equipmentUnitOptions } from '../../utils/EquipmentUnitUtils.js';
import campMaterialStylesheetUrl from '../../../css/camp-material.css?url';

const BACK_HREF = '/yearly-planner';
const DAY_LABEL = { weekday: 'short', day: 'numeric', month: 'short' };
const RANGE_LABEL = { day: 'numeric', month: 'long', year: 'numeric' };
const ISO_DATE_LENGTH = 10;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
/** A schedule line's free-text material, as the planner route accepts it. */
const LINE_MATERIAL_MAX = 10000;

/** Standings where the camp still needs someone to bring, borrow or buy the article. */
const NEEDS_SOMEONE = ['missing', 'unavailable', 'not_in_inventory'];

/** What each inventory standing reads as. Literal keys, so the translation test sees them. */
const STATUS_LABELS = {
  reserved: () => translate('camp_material_status_reserved'),
  available: () => translate('camp_material_status_available'),
  missing: () => translate('camp_material_status_missing'),
  unavailable: () => translate('camp_material_status_unavailable'),
  not_in_inventory: () => translate('camp_material_status_not_in_inventory'),
};

/**
 * @param {string} isoDate - YYYY-MM-DD
 * @param {number} days
 * @returns {string} The date that many days later, YYYY-MM-DD
 */
function addDays(isoDate, days) {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, ISO_DATE_LENGTH);
}

export class CampMaterialList {
  /**
   * @param {Object} app - Application instance
   * @param {{meetingId: number}} options - The camp (year_plan_meetings.id)
   */
  constructor(app, { meetingId }) {
    this.app = app;
    this.meetingId = meetingId;
    this.list = null;
    this.destroyed = false;
    this.reserving = false;
    // The reservation endpoint requires these, as well as meetings.view (the page's guard).
    this.canReserve = hasAllPermissions('inventory.view', 'inventory.reserve') && !isDemoUser();
    // Creating a task requires these on the tasks routes.
    this.canAssign = hasAllPermissions('tasks.view', 'tasks.manage') && !isDemoUser();
    // Editing a schedule line's material requires meetings.manage; naming a new article, the catalogue right.
    this.canConvert = hasAllPermissions('meetings.manage') && !isDemoUser();
    this.canCreateArticle = this.canConvert && hasAllPermissions('equipment_catalog.manage');
  }

  /** @returns {string} Back to this camp's year plan, where its schedule opens */
  backHref() {
    const planId = Number(this.list?.camp?.year_plan_id);
    return Number.isInteger(planId) && planId > 0 ? `/yearly-planner/${planId}` : BACK_HREF;
  }

  /** @param {Object} item @returns {boolean} Whether the camp still needs someone to bring it */
  needsSomeone(item) {
    return !this.list.inventory_compared || NEEDS_SOMEONE.includes(item.inventory?.status);
  }

  /**
   * A link to the task form, filled with this material for this camp.
   * @param {string} name - Article name or free-text material
   * @param {string} materials - What the reminder will list
   * @returns {string} HTML
   */
  assignLink(name, materials) {
    const params = new URLSearchParams({
      meeting_id: String(this.meetingId),
      material: name.slice(0, CONFIG.TASKS.TITLE_MAX_LENGTH),
      materials: materials.slice(0, CONFIG.EQUIPMENT_REMINDERS.MATERIALS_MAX_LENGTH),
    });
    return `<a class="button button--secondary button--small" href="/tasks?${escapeHTML(params.toString())}">
      ${escapeHTML(translate('camp_material_assign'))}<span class="sr-only"> : ${escapeHTML(name)}</span></a>`;
  }

  destroy() {
    this.destroyed = true;
  }

  /** @returns {HTMLElement|null} */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} The reader's language */
  lang() {
    return this.app.lang || 'fr';
  }

  /** Load the camp's list, showing it or the error. */
  async init() {
    loadStylesheet(campMaterialStylesheetUrl).catch((error) => {
      debugError('Failed to load camp material styles:', error);
    });
    this.renderState('loading');
    if (!Number.isInteger(this.meetingId) || this.meetingId <= 0) {
      this.renderState('error');
      return;
    }
    try {
      await this.load();
    } catch (error) {
      debugError('Failed to load the camp material list:', error);
      this.renderState(error?.status === HTTP_NOT_FOUND ? 'missing' : 'error');
    }
  }

  /** Fetch the list fresh and show it. Throws when it cannot be loaded. */
  async load() {
    const response = await getCampMaterialList(this.meetingId, { forceRefresh: true });
    if (this.destroyed) {
      return;
    }
    this.list = response?.data || null;
    if (!this.list) {
      throw new Error('Empty camp material list response');
    }
    this.render();
  }

  /** @param {'loading'|'error'|'missing'} state */
  renderState(state) {
    if (this.destroyed) {
      return;
    }
    const title = translate('camp_material_title');
    const options = { title, className: 'camp-material', backHref: BACK_HREF };
    if (state === 'loading') {
      setContent(this.root(), pageLoadingMarkup(options));
      return;
    }
    if (state === 'missing') {
      setContent(this.root(), pageErrorMarkup({ ...options, message: translate('camp_material_not_found') }));
      return;
    }
    setContent(this.root(), pageErrorMarkup({ ...options, retryId: 'camp-material-retry' }));
    document.getElementById('camp-material-retry')?.addEventListener('click', () => this.init());
  }

  /** @param {number} dayOffset @returns {string} The camp day, as the reader writes it */
  dayLabel(dayOffset) {
    return formatDate(addDays(this.list.camp.date_from, dayOffset), this.lang(), DAY_LABEL);
  }

  /** @returns {string} The camp's name and dates, plain text */
  campLabel() {
    const { camp } = this.list;
    const from = formatDate(camp.date_from, this.lang(), RANGE_LABEL);
    const to = formatDate(camp.date_to, this.lang(), RANGE_LABEL);
    const dates = camp.date_from === camp.date_to ? from : `${from} – ${to}`;
    return camp.theme ? `${camp.theme} · ${dates}` : dates;
  }

  /** @param {Object} entry @returns {string} Plain text */
  quantityLabel(entry) {
    return formatEquipmentQuantity(entry.quantity, entry.unit_of_measure, this.lang());
  }

  /** @param {Object} entry @returns {string} Where each activity uses it, plain text per use */
  usesLabels(entry) {
    return entry.uses.map((use) => translate('camp_material_use')
      .replace('{day}', this.dayLabel(use.day_offset))
      .replace('{activity}', use.name)
      .replace('{quantity}', formatEquipmentQuantity(use.quantity, entry.unit_of_measure, this.lang())));
  }

  /** @param {Object} inventory - The entry's standing @returns {string} Plain text */
  statusLabel(inventory) {
    const label = (STATUS_LABELS[inventory.status] || STATUS_LABELS.not_in_inventory)();
    return inventory.missing > 0 && inventory.status === 'missing'
      ? `${label} (${translate('camp_material_missing_count').replace('{count}', String(inventory.missing))})`
      : label;
  }

  /** @returns {Array<{category: string, items: Object[]}>} Entries by category, in the server's order */
  groups() {
    const groups = [];
    for (const item of this.list.items) {
      const last = groups[groups.length - 1];
      if (last && last.category === item.category) {
        last.items.push(item);
      } else {
        groups.push({ category: item.category, items: [item] });
      }
    }
    return groups;
  }

  /** @returns {string} HTML: how many entries need a reservation, or are missing */
  summaryMarkup() {
    if (!this.list.inventory_compared || !this.list.items.length) {
      return '';
    }
    const count = (status) => this.list.items.filter((item) => item.inventory?.status === status).length;
    const lines = [
      ['reserved', 'camp_material_summary_reserved'],
      ['available', 'camp_material_summary_available'],
      ['missing', 'camp_material_summary_missing'],
      ['unavailable', 'camp_material_summary_unavailable'],
    ].map(([status, key]) => [count(status), key])
      .filter(([total]) => total > 0)
      .map(([total, key]) => `<li>${escapeHTML(translate(key).replace('{count}', String(total)))}</li>`);
    return lines.length
      ? `<ul class="camp-material__summary" aria-label="${escapeHTML(translate('camp_material_summary_label'))}">${lines.join('')}</ul>`
      : '';
  }

  /**
   * @param {{category: string, items: Object[]}} group
   * @param {number} index
   * @returns {string} HTML
   */
  groupMarkup(group, index) {
    const inventory = this.list.inventory_compared;
    const headingId = `camp-material-group-${index}`;
    const rows = group.items.map((item) => `
      <tr>
        <td data-label="${escapeHTML(translate('camp_material_article'))}">
          <strong>${escapeHTML(item.name)}</strong>
          ${item.archived ? `<span class="camp-material__archived">${escapeHTML(translate('camp_material_archived'))}</span>` : ''}
        </td>
        <td data-label="${escapeHTML(translate('camp_material_total'))}">${escapeHTML(this.quantityLabel(item))}</td>
        <td data-label="${escapeHTML(translate('camp_material_used_by'))}">
          <ul class="camp-material__uses">${this.usesLabels(item).map((label) => `<li>${escapeHTML(label)}</li>`).join('')}</ul>
        </td>
        ${inventory ? `
          <td data-label="${escapeHTML(translate('camp_material_reserved'))}">${item.inventory.status === 'not_in_inventory' ? '—' : Number(item.inventory.reserved)}</td>
          <td data-label="${escapeHTML(translate('camp_material_free'))}">${item.inventory.status === 'not_in_inventory' ? '—' : Number(item.inventory.free)}</td>
          <td data-label="${escapeHTML(translate('camp_material_status'))}">
            <span class="camp-material__status camp-material__status--${escapeHTML(item.inventory.status)}">${escapeHTML(this.statusLabel(item.inventory))}</span>
          </td>` : ''}
        ${this.canAssign ? `<td data-label="${escapeHTML(translate('camp_material_who'))}">
          ${this.needsSomeone(item) ? this.assignLink(item.name, `${this.quantityLabel(item)} — ${item.name}`) : '—'}</td>` : ''}
      </tr>`).join('');
    return `
      <section class="camp-material__group" aria-labelledby="${headingId}">
        <h3 id="${headingId}">${escapeHTML(equipmentCategoryLabel(group.category))}</h3>
        <div class="table-container" role="region" tabindex="0" aria-labelledby="${headingId}">
          <table class="mobile-labeled-table camp-material__table">
            <thead>
              <tr>
                <th scope="col">${escapeHTML(translate('camp_material_article'))}</th>
                <th scope="col">${escapeHTML(translate('camp_material_total'))}</th>
                <th scope="col">${escapeHTML(translate('camp_material_used_by'))}</th>
                ${inventory ? `
                  <th scope="col">${escapeHTML(translate('camp_material_reserved'))}</th>
                  <th scope="col">${escapeHTML(translate('camp_material_free'))}</th>
                  <th scope="col">${escapeHTML(translate('camp_material_status'))}</th>` : ''}
                ${this.canAssign ? `<th scope="col">${escapeHTML(translate('camp_material_who'))}</th>` : ''}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  /** @returns {string} HTML: free-text material, activity by activity */
  freeTextMarkup({ actions = true } = {}) {
    if (!this.list.free_text.length) {
      return '';
    }
    return `
      <section class="camp-material__free-text" aria-labelledby="camp-material-free-text-title">
        <h2 id="camp-material-free-text-title">${escapeHTML(translate('camp_material_free_text_title'))}</h2>
        <p>${escapeHTML(translate('camp_material_free_text_hint'))}</p>
        <ul class="camp-material__free-list">
          ${this.list.free_text.map((entry) => `
            <li>
              <strong>${escapeHTML(this.dayLabel(entry.day_offset))} · ${escapeHTML(entry.name)}</strong>
              <span class="camp-material__free-material">${escapeHTML(entry.material)}</span>
              ${actions && (this.canConvert || this.canAssign) ? `<span class="camp-material__free-actions">
                ${this.canConvert ? `<button type="button" class="button button--secondary button--small" data-convert-line="${Number(entry.activity_id)}">
                  ${escapeHTML(translate('camp_material_convert'))}<span class="sr-only"> : ${escapeHTML(entry.material)}</span></button>` : ''}
                ${this.canAssign ? this.assignLink(entry.material, entry.material) : ''}</span>` : ''}
            </li>`).join('')}
        </ul>
      </section>`;
  }

  /** @returns {string} HTML: reservations for the camp that no activity lists */
  unlistedMarkup() {
    const unlisted = this.list.unlisted_reservations || [];
    if (!unlisted.length) {
      return '';
    }
    return `
      <section class="camp-material__unlisted" aria-labelledby="camp-material-unlisted-title">
        <h2 id="camp-material-unlisted-title">${escapeHTML(translate('camp_material_unlisted_title'))}</h2>
        <p>${escapeHTML(translate('camp_material_unlisted_hint'))}</p>
        <ul>
          ${unlisted.map((item) => `<li>${escapeHTML(translate('camp_material_unlisted_item')
    .replace('{name}', item.name).replace('{count}', String(item.reserved)))}</li>`).join('')}
        </ul>
      </section>`;
  }

  /** @returns {boolean} Whether the schedule lists any material */
  hasScheduledMaterial() {
    return this.list.items.length > 0 || this.list.free_text.length > 0;
  }

  /** @returns {boolean} Whether there is anything to print or export, reservations included */
  hasContent() {
    return this.hasScheduledMaterial() || (this.list.unlisted_reservations || []).length > 0;
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const groups = this.groups();
    const listMarkup = groups.length ? `
      <section class="camp-material__items" aria-labelledby="camp-material-items-title">
        <h2 id="camp-material-items-title">${escapeHTML(translate('camp_material_items_title'))}</h2>
        ${this.summaryMarkup()}
        ${groups.map((group, index) => this.groupMarkup(group, index)).join('')}
      </section>` : '';
    setContent(this.root(), `
      <section class="page camp-material">
        ${renderBackLink(this.backHref())}
        <h1>${escapeHTML(translate('camp_material_title'))}</h1>
        <p class="camp-material__camp">${escapeHTML(this.campLabel())}</p>
        ${this.hasContent() ? `
          <div class="camp-material__actions">
            ${hasAllPermissions('camp_lots.view') ? `<a class="button button--secondary" href="/camp-lots/${Number(this.meetingId)}">${translate('camp_lots_open')}</a>` : ''}
            <button type="button" class="button button--secondary" id="camp-material-print">
              ${escapeHTML(translate('print'))}
            </button>
            <button type="button" class="button button--secondary" id="camp-material-export">
              ${escapeHTML(translate('export_csv'))}
            </button>
            ${this.toReserve().length ? `
              <button type="button" class="button button--primary" id="camp-material-reserve">
                ${escapeHTML(translate('camp_material_reserve'))}
              </button>` : ''}
          </div>` : ''}
        ${this.hasScheduledMaterial() ? '' : `<p class="empty-state">${escapeHTML(translate('camp_material_empty'))}</p>`}
        ${listMarkup}
        ${this.freeTextMarkup()}
        ${this.unlistedMarkup()}
      </section>
    `);
    document.getElementById('camp-material-print')?.addEventListener('click', () => this.print());
    document.getElementById('camp-material-export')?.addEventListener('click', () => this.exportCsv());
    document.getElementById('camp-material-reserve')?.addEventListener('click', () => this.openReserve());
    this.root().querySelectorAll('[data-convert-line]').forEach((button) => button.addEventListener('click', () => {
      this.openConvert(this.list.free_text.find((entry) => entry.activity_id === Number(button.dataset.convertLine)), button);
    }));
  }

  /**
   * Turn a line's free-text material into catalogue articles: pick or create the
   * articles with their quantities, and keep only the text they do not replace.
   * One PATCH of the line saves both, so the list never counts it twice.
   *
   * @param {Object} entry - A free_text entry (activity_id is the schedule line)
   * @param {HTMLElement} opener - Receives focus if the dialog cannot open
   */
  async openConvert(entry, opener) {
    if (!entry || this.converting) {
      return;
    }
    this.converting = true;
    opener.disabled = true;
    let line;
    let choices;
    try {
      const [schedule, options] = await Promise.all([
        getMeetingSchedule(this.meetingId, { forceRefresh: true }),
        getMaterialOptions(),
      ]);
      line = (schedule?.data?.days || []).flatMap((day) => day.activities || []).find((item) => item.id === entry.activity_id);
      choices = options?.data || null;
    } catch (error) {
      debugError('Failed to prepare the material conversion:', error);
    } finally {
      this.converting = false;
      opener.disabled = false;
    }
    if (this.destroyed) {
      return;
    }
    if (!line || !choices) {
      this.app.showMessage(translate('camp_material_convert_unavailable'), 'error');
      opener.focus();
      return;
    }
    this.showConvertDialog(entry, line, choices);
  }

  /** @returns {string} HTML: a small form naming a new catalogue article */
  newArticleMarkup(entry) {
    return `<details class="camp-material__new-article">
      <summary>${escapeHTML(translate('camp_material_new_article'))}</summary>
      <label for="camp-material-new-name">${escapeHTML(translate('equipment_catalog_name'))}</label>
      <input id="camp-material-new-name" maxlength="${EQUIPMENT_CATALOG_LIMITS.NAME_MAX_LENGTH}" value="${escapeAttribute(entry.material.split(/[,;\n]/)[0].trim().slice(0, EQUIPMENT_CATALOG_LIMITS.NAME_MAX_LENGTH))}">
      <label for="camp-material-new-category">${escapeHTML(translate('equipment_catalog_category'))}</label>
      <select id="camp-material-new-category">${equipmentCategoryOptions()}</select>
      <label for="camp-material-new-unit">${escapeHTML(translate('equipment_catalog_unit'))}</label>
      <select id="camp-material-new-unit">${equipmentUnitOptions()}</select>
      <button type="button" class="button button--secondary button--small" id="camp-material-new-create">${escapeHTML(translate('camp_material_create_article'))}</button>
    </details>`;
  }

  showConvertDialog(entry, line, choices) {
    const field = new MaterialItemsField({
      choices, items: line.material_items || [], idPrefix: 'camp-material-convert-items', lang: this.lang(),
    });
    const original = line.material || '';
    let saving = false;
    const modal = openModal({
      id: 'camp-material-convert-dialog',
      title: escapeHTML(translate('camp_material_convert_title')),
      closeOnBackdrop: false,
      canClose: () => !saving,
      body: `
        <form id="camp-material-convert-form" class="camp-material__convert" novalidate>
          <p><strong>${escapeHTML(this.dayLabel(entry.day_offset))} · ${escapeHTML(entry.name)}</strong></p>
          <p>${escapeHTML(translate('camp_material_convert_intro'))}</p>
          <blockquote class="camp-material__original">${escapeHTML(original)}</blockquote>
          ${field.markup()}
          ${this.canCreateArticle ? this.newArticleMarkup(entry) : ''}
          <label for="camp-material-remaining">${escapeHTML(translate('camp_material_remaining'))}</label>
          <textarea id="camp-material-remaining" rows="3" maxlength="${LINE_MATERIAL_MAX}" aria-describedby="camp-material-remaining-hint">${escapeHTML(original)}</textarea>
          <p id="camp-material-remaining-hint">${escapeHTML(translate('camp_material_remaining_hint'))}</p>
          <p id="camp-material-convert-error" class="field-error" role="alert" tabindex="-1" hidden></p>
        </form>`,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="submit" class="button button--primary" form="camp-material-convert-form">${escapeHTML(translate('save'))}</button>`,
    });
    const form = modal.overlay.querySelector('#camp-material-convert-form');
    field.attach(form);
    const problem = form.querySelector('#camp-material-convert-error');
    const say = (message, focusTarget = problem) => {
      problem.textContent = message;
      problem.hidden = false;
      focusTarget.focus();
    };
    form.querySelector('#camp-material-new-create')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const name = form.querySelector('#camp-material-new-name');
      if (!name.value.trim()) {
        name.setAttribute('aria-invalid', 'true');
        name.setAttribute('aria-describedby', problem.id);
        say(translate('equipment_catalog_name_required'), name);
        return;
      }
      name.removeAttribute('aria-invalid');
      button.disabled = true;
      try {
        const created = (await createCatalogItem({
          name: name.value.trim(), category: form.querySelector('#camp-material-new-category').value,
          unit_of_measure: form.querySelector('#camp-material-new-unit').value, equipment_item_id: null,
        }))?.data;
        if (!created?.id) {
          throw new Error('No article returned');
        }
        // The new article joins the choices and the line; its quantity takes focus.
        field.choices.articles.push(created);
        field.syncTyped();
        field.items.push({ key: `a${Number(created.id)}`, catalog_item_id: Number(created.id), equipment_item_id: null, name: created.name,
          category: created.category, unit_of_measure: created.unit_of_measure, archived: false, typed: '1' });
        field.redraw();
        form.querySelector('.camp-material__new-article').open = false;
        problem.hidden = true;
        form.querySelector(`[data-quantity-for="a${Number(created.id)}"]`)?.focus();
      } catch (error) {
        debugError('Failed to create a catalogue article:', error);
        say(apiErrorMessage(error, 'equipment_catalog_save_failed'));
      } finally {
        button.disabled = false;
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, async () => {
        const items = field.value();
        if (items === null) {
          return;
        }
        const remaining = form.querySelector('#camp-material-remaining').value.trim();
        const before = (line.material_items || []).map((item) => `${item.catalog_item_id || ''}:${item.equipment_item_id || ''}:${Number(item.quantity)}`).sort().join('|');
        const after = items.map((item) => `${item.catalog_item_id || ''}:${item.equipment_item_id || ''}:${Number(item.quantity)}`).sort().join('|');
        if (remaining === original.trim() && before === after) {
          say(translate('camp_material_convert_nothing'));
          return;
        }
        saving = true;
        try {
          await updateMeetingActivity(line.id, { material: remaining, material_items: items });
        } catch (error) {
          debugError('Failed to convert free-text material:', error);
          saving = false;
          say(apiErrorMessage(error, 'camp_material_convert_failed'));
          return;
        }
        saving = false;
        modal.close();
        this.app.showMessage(translate('camp_material_converted'), 'success');
        await this.reload();
        (this.root().querySelector('#camp-material-items-title') || this.root().querySelector('h1'))?.setAttribute('tabindex', '-1');
        (this.root().querySelector('#camp-material-items-title') || this.root().querySelector('h1'))?.focus();
      });
    });
  }

  /** @returns {Object[]} Entries with something still to reserve, when this person may reserve */
  toReserve() {
    if (!this.canReserve || !this.list?.inventory_compared) {
      return [];
    }
    return this.list.items.filter((item) => Number(item.inventory?.to_reserve) > 0);
  }

  /** Ask before reserving: what will be reserved, and what will still be missing. */
  openReserve() {
    const entries = this.toReserve();
    if (!entries.length) {
      return;
    }
    const partial = entries.some((item) => item.inventory.status === 'missing');
    const modal = openModal({
      id: 'camp-material-reserve-dialog',
      title: escapeHTML(translate('camp_material_reserve_title')),
      body: `
        <form id="camp-material-reserve-form" novalidate>
          <p>${escapeHTML(translate('camp_material_reserve_intro').replace('{dates}', this.campLabel()))}</p>
          <ul class="camp-material__reserve-list">
            ${entries.map((item) => `<li>${escapeHTML(translate('camp_material_reserve_item')
    .replace('{name}', item.name).replace('{count}', String(item.inventory.to_reserve)))}</li>`).join('')}
          </ul>
          ${partial ? `<p>${escapeHTML(translate('camp_material_reserve_partial'))}</p>` : ''}
        </form>`,
      footer: `
        <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="submit" class="button button--primary" form="camp-material-reserve-form">${escapeHTML(translate('camp_material_reserve_confirm'))}</button>`,
      canClose: () => !this.reserving,
    });
    const form = modal.overlay.querySelector('#camp-material-reserve-form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, () => this.reserve(modal, entries));
    });
  }

  /**
   * Reserve what the dialog listed, then reload the list.
   *
   * @param {{close: Function}} modal - The confirmation dialog
   * @param {Object[]} entries - From toReserve()
   * @returns {Promise<void>}
   */
  async reserve(modal, entries) {
    this.reserving = true;
    let result;
    try {
      result = await reserveCampMaterial(this.meetingId, entries.map((item) => ({
        equipment_item_id: Number(item.equipment_item_id),
        quantity: Number(item.inventory.to_reserve),
      })));
    } catch (error) {
      debugError('Failed to reserve camp material:', error);
      this.reserving = false;
      this.app.showMessage(apiErrorMessage(error, 'camp_material_reserve_failed'), 'error');
      // The count changed elsewhere: show the list as it now is.
      if (error?.status === HTTP_CONFLICT) {
        modal.close();
        await this.reload();
      }
      return;
    }
    this.reserving = false;
    modal.close();
    const count = Number(result?.data?.count) || entries.length;
    this.app.showMessage(translate('camp_material_reserve_done').replace('{count}', String(count)), 'success');
    await this.reload();
  }

  /** Reload after a write; the write stands even if this fails. */
  async reload() {
    try {
      await this.load();
    } catch (error) {
      debugError('Failed to reload the camp material list:', error);
      this.renderState('error');
    }
  }

  /** Print the list from its own window, on paper styles. */
  print() {
    const printWindow = openPrintWindow();
    if (!printWindow) {
      this.app.showMessage(translate('popup_blocked'), 'error');
      return;
    }
    const inventory = this.list.inventory_compared;
    const rows = this.list.items.map((item) => `
      <tr>
        <td>${escapeHTML(equipmentCategoryLabel(item.category))}</td>
        <td>${escapeHTML(item.name)}</td>
        <td>${escapeHTML(this.quantityLabel(item))}</td>
        <td>${this.usesLabels(item).map((label) => escapeHTML(label)).join('<br>')}</td>
        ${inventory ? `<td>${escapeHTML(this.statusLabel(item.inventory))}</td>` : ''}
      </tr>`).join('');
    const title = `${translate('camp_material_title')} — ${this.campLabel()}`;
    setPrintContent(printWindow, `
      <h1>${escapeHTML(translate('camp_material_title'))}</h1>
      <p class="report-meta">${escapeHTML(this.campLabel())}</p>
      ${rows ? `
        <table>
          <thead>
            <tr>
              <th scope="col">${escapeHTML(translate('camp_material_category'))}</th>
              <th scope="col">${escapeHTML(translate('camp_material_article'))}</th>
              <th scope="col">${escapeHTML(translate('camp_material_total'))}</th>
              <th scope="col">${escapeHTML(translate('camp_material_used_by'))}</th>
              ${inventory ? `<th scope="col">${escapeHTML(translate('camp_material_status'))}</th>` : ''}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>` : ''}
      ${this.freeTextMarkup({ actions: false })}
      ${this.unlistedMarkup()}
    `, title, { styles: REPORT_PRINT_STYLES });
    printWindow.focus();
    printWindow.print();
  }

  /** Download the list as CSV: the articles, the free-text material, then what is reserved but listed nowhere. */
  exportCsv() {
    const inventory = this.list.inventory_compared;
    const rows = [
      ...this.list.items.map((item) => ({
        category: equipmentCategoryLabel(item.category),
        name: item.name,
        quantity: item.quantity,
        unit: equipmentUnitLabel(item.unit_of_measure),
        uses: this.usesLabels(item).join(' ; '),
        status: inventory ? this.statusLabel(item.inventory) : '',
      })),
      ...this.list.free_text.map((entry) => ({
        category: translate('camp_material_free_text_title'),
        name: entry.material,
        quantity: '',
        unit: '',
        uses: `${this.dayLabel(entry.day_offset)} · ${entry.name}`,
        status: '',
      })),
      // Reserved for the camp although no activity lists it: still to pack.
      ...(this.list.unlisted_reservations || []).map((item) => ({
        category: translate('camp_material_unlisted_title'),
        name: item.name,
        quantity: item.reserved,
        unit: equipmentUnitLabel('each'),
        uses: '',
        status: translate('camp_material_status_reserved'),
      })),
    ];
    const columns = [
      { key: 'category', label: translate('camp_material_category') },
      { key: 'name', label: translate('camp_material_article') },
      { key: 'quantity', label: translate('camp_material_quantity') },
      { key: 'unit', label: translate('camp_material_unit') },
      { key: 'uses', label: translate('camp_material_used_by') },
      ...(inventory ? [{ key: 'status', label: translate('camp_material_status') }] : []),
    ];
    exportToCSV(rows, columns, `${translate('camp_material_file_name')}-${this.list.camp.date_from}`);
  }
}
