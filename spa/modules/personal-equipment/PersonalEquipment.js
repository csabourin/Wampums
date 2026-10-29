/** Team-reviewed personal camp lists and each family's device-only packing checkmarks. */
import { translate } from '../../app.js';
import { setContent, loadStylesheet, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { isDemoUser } from '../../utils/PermissionUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { confirm } from '../../utils/DialogUtils.js';
import { openPrintWindow, setPrintContent, REPORT_PRINT_STYLES } from '../../utils/PrintUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { getPersonalEquipmentTasks, getPersonalEquipment, savePersonalEquipment, translatePersonalEquipment } from '../../api/api-personal-equipment.js';
import { personalEquipmentTemplate, PERSONAL_EQUIPMENT } from './templates.js';
import { packingKey, readPacking, writePacking, bulkPackingLines } from './packingStorage.js';
import styles from '../../../css/personal-equipment.css?url';
export const PERSONAL_LABELS = {
  summer: 'personal_equipment_summer', winter: 'personal_equipment_winter', shoulder: 'personal_equipment_shoulder',
  day: 'personal_equipment_day', cabin: 'personal_equipment_cabin', tent: 'personal_equipment_tent',
};
export class PersonalEquipment {
  constructor(app, { meetingId, manage = false }) {
    this.app = app; this.meetingId = meetingId; this.manage = manage; this.destroyed = false; this.request = 0;
    this.translations = new Map(); this.targetLanguage = app.lang || 'fr'; this.translationBusy = false;
    this.scope = buildScopedCacheKey('');
    this.languageKey = buildScopedCacheKey('personal-equipment-language');
    try {
      const preferred = localStorage.getItem(this.languageKey);
      if (PERSONAL_EQUIPMENT.TRANSLATION_LANGUAGES.includes(preferred)) { this.targetLanguage = preferred; }
    } catch { /* The list remains usable without persistent preferences. */ }
    this.readOnly = isDemoUser(); this.busy = false;
  }
  root() { return document.getElementById('app'); }
  destroy() { this.destroyed = true; this.request += 1; }
  active(request = this.request) { return !this.destroyed && request === this.request && this.scope === buildScopedCacheKey(''); }
  title() { return translate(this.manage ? 'personal_equipment_manage' : 'personal_equipment_title'); }
  text(item, field = 'label') {
    const translated = this.translations.get(this.targetLanguage);
    if (field === 'notes' && translated) { return translated.notes; }
    if (field === 'label' && translated) { return translated.items.find((entry) => entry.key === item.key)?.label || ''; }
    return item[`${field}_${['fr', 'en'].includes(this.targetLanguage) ? this.targetLanguage : 'fr'}`] || item[`${field}_fr`] || item[`${field}_en`] || '';
  }
  async init() {
    const request = ++this.request;
    const options = { title: this.title(), backHref: this.manage ? '/activities' : '/parent-dashboard' };
    loadStylesheet(styles).catch((err) => debugError('Personal equipment stylesheet failed', err));
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      if (!this.meetingId) {
        const rows = (await getPersonalEquipmentTasks()).data;
        if (this.active(request)) { this.renderIndex(rows); }
        return;
      }
      this.data = (await getPersonalEquipment(this.meetingId, this.manage)).data;
      if (!this.active(request)) { return; }
      if (this.data.list?.version !== this.loadedVersion) { this.translations.clear(); }
      this.loadedVersion = this.data.list?.version;
      if (!this.manage && this.data.list) {
        try {
          const cached = JSON.parse(localStorage.getItem(this.translationKey(this.targetLanguage)) || 'null');
          const keys = new Set(this.data.list.items.map((item) => item.key));
          if (cached && typeof cached.notes === 'string' && Array.isArray(cached.items)
            && cached.items.length === keys.size && new Set(cached.items.map((item) => item.key)).size === keys.size
            && cached.items.every((item) => keys.has(item.key) && typeof item.label === 'string')) {
            this.translations.set(this.targetLanguage, cached);
          }
        } catch { /* Missing or damaged cached text falls back to the team’s original. */ }
      }
      if (!this.active(request)) { return; }
      this.draft = this.data.list || { season: 'shoulder', nights: PERSONAL_EQUIPMENT.DEFAULT_NIGHTS, stay_type: 'tent', notes_fr: '', notes_en: '', published: false,
        version: 0, items: personalEquipmentTemplate('shoulder', PERSONAL_EQUIPMENT.DEFAULT_NIGHTS, 'tent') };
      if (!this.manage) {
        this.data.children.forEach((child) => { child.checked_keys = [...readPacking(packingKey(this.data?.packing_id || this.meetingId, child.id))]; });
      }
      if (this.manage) { this.renderEditor(); } else { this.renderFamily(); }
    } catch (err) {
      if (!this.active(request)) { return; }
      debugError('Personal equipment loading failed', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'error_loading_data'), retryId: 'personal-equipment-retry' }));
      this.root().querySelector('#personal-equipment-retry')?.addEventListener('click', () => this.init());
    }
  }
  renderIndex(rows) {
    const camps = [...new Map(rows.map((row) => [row.meeting_id, row])).values()];
    setContent(this.root(), `<section class="page personal-equipment">${renderBackLink('/parent-dashboard')}<h1>${escapeHTML(this.title())}</h1>
      ${camps.length ? `<ul>${camps.map((camp) => `<li><a class="button button--secondary" href="/personal-equipment/${escapeHTML(String(camp.meeting_id))}">${escapeHTML(camp.title || translate('personal_equipment_camp'))} · ${escapeHTML(formatDate(camp.date, this.app.lang))}</a></li>`).join('')}</ul>` : `<p>${escapeHTML(translate('personal_equipment_no_lists'))}</p>`}</section>`);
  }
  header() {
    return `${renderBackLink(this.manage ? '/activities' : '/parent-dashboard')}<h1>${escapeHTML(this.title())}</h1>
      <h2>${escapeHTML(this.data.camp.theme || translate('personal_equipment_camp'))}</h2>
      <p>${escapeHTML(formatDate(this.data.camp.meeting_date, this.app.lang))}</p>
      ${this.data.camp.is_cancelled ? `<p role="status">${escapeHTML(translate('personal_equipment_cancelled'))}</p>` : ''}`;
  }
  /** Keep the collapsed editor count in step with individual row changes. */
  updateItemCount() {
    const summary = this.root().querySelector('#personal-item-editor > summary');
    summary.textContent = translate('personal_equipment_review_items').replace('{count}', String(this.root().querySelectorAll('[data-item-key]').length));
  }
  /** A pasted quantity stays readable without a redundant leading “1 ×”. */
  quantityText(item) { return Number(item.quantity) > 1 ? `${new Intl.NumberFormat(this.targetLanguage).format(Number(item.quantity))} × ` : ''; }
  itemEditor(item, index) {
    const prefix = `personal-item-${index}`;
    return `<fieldset class="personal-equipment__item" data-item-key="${escapeAttribute(item.key)}"><legend>${escapeHTML(translate('personal_equipment_item'))}</legend>
      <label for="${prefix}-fr">${escapeHTML(translate('personal_equipment_label_fr'))}</label><input id="${prefix}-fr" data-field="label_fr" value="${escapeAttribute(item.label_fr)}" maxlength="${PERSONAL_EQUIPMENT.LABEL_MAX}">
      <label for="${prefix}-en">${escapeHTML(translate('personal_equipment_label_en'))}</label><input id="${prefix}-en" data-field="label_en" value="${escapeAttribute(item.label_en)}" maxlength="${PERSONAL_EQUIPMENT.LABEL_MAX}">
      <label for="${prefix}-quantity">${escapeHTML(translate('quantity'))}</label><input id="${prefix}-quantity" type="number" data-field="quantity" value="${Number(item.quantity)}" min="1" max="${PERSONAL_EQUIPMENT.MAX_QUANTITY}" step="1" required>
      <label for="${prefix}-catalog">${escapeHTML(translate('personal_equipment_catalog'))}</label><select id="${prefix}-catalog" data-field="catalog_item_id"><option value="">${escapeHTML(translate('personal_equipment_custom'))}</option>
        ${(this.data.catalog || []).map((entry) => `<option value="${Number(entry.id)}" ${entry.id === item.catalog_item_id ? 'selected' : ''}>${escapeHTML(entry.name)}</option>`).join('')}</select>
      <button type="button" class="button button--secondary" data-remove-item>${escapeHTML(translate('remove'))}<span class="sr-only"> ${escapeHTML(this.text(item))}</span></button></fieldset>`;
  }
  /** Extract stable keys from the rows, retaining checked progress when labels change. */
  readEditor() {
    const form = this.root().querySelector('#personal-equipment-form');
    const value = (name) => form.elements.namedItem(name).value;
    return { season: value('personal_season'), stay_type: value('personal_stay'), nights: Number(value('personal_nights')),
      notes_fr: value('personal_notes_fr'), notes_en: value('personal_notes_en'), published: form.elements.namedItem('personal_published').checked,
      reviewed: form.elements.namedItem('personal_reviewed').checked, expected_version: this.draft.version,
      items: [...form.querySelectorAll('[data-item-key]')].map((row) => {
        const field = (key) => row.querySelector(`[data-field="${key}"]`).value;
        return { key: row.dataset.itemKey, label_fr: field('label_fr'), label_en: field('label_en'), quantity: Number(field('quantity')),
          catalog_item_id: field('catalog_item_id') ? Number(field('catalog_item_id')) : null };
      }) };
  }
  renderEditor() {
    const list = this.draft;
    const options = (values, current) => values.map((value) => `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHTML(translate(PERSONAL_LABELS[value]))}</option>`).join('');
    setContent(this.root(), `<section class="page personal-equipment">${this.header()}
      <p>${escapeHTML(translate('personal_equipment_review_hint'))}</p>
      <form id="personal-equipment-form"><fieldset ${this.readOnly || this.data.camp.is_cancelled ? 'disabled' : ''}>
      <legend>${escapeHTML(translate('personal_equipment_settings'))}</legend>
      <label for="personal-season">${escapeHTML(translate('personal_equipment_season'))}</label><select id="personal-season" name="personal_season">${options(PERSONAL_EQUIPMENT.SEASONS, list.season)}</select>
      <label for="personal-stay">${escapeHTML(translate('personal_equipment_stay'))}</label><select id="personal-stay" name="personal_stay">${options(PERSONAL_EQUIPMENT.STAY_TYPES, list.stay_type)}</select>
      <label for="personal-nights">${escapeHTML(translate('personal_equipment_nights'))}</label><input id="personal-nights" name="personal_nights" type="number" value="${list.nights}" min="0" max="${PERSONAL_EQUIPMENT.MAX_NIGHTS}" step="1" required>
      <button type="button" class="button button--secondary" id="personal-apply-template">${escapeHTML(translate('personal_equipment_apply_template'))}</button>
      <label for="personal-notes-fr">${escapeHTML(translate('personal_equipment_notes_fr'))}</label><textarea id="personal-notes-fr" name="personal_notes_fr" maxlength="${PERSONAL_EQUIPMENT.NOTES_MAX}">${escapeHTML(list.notes_fr)}</textarea>
      <label for="personal-notes-en">${escapeHTML(translate('personal_equipment_notes_en'))}</label><textarea id="personal-notes-en" name="personal_notes_en" maxlength="${PERSONAL_EQUIPMENT.NOTES_MAX}">${escapeHTML(list.notes_en)}</textarea>
      <label for="personal-bulk">${escapeHTML(translate('personal_equipment_bulk'))}</label>
      <textarea id="personal-bulk" rows="6" maxlength="${PERSONAL_EQUIPMENT.BULK_MAX_LENGTH}" aria-describedby="personal-bulk-help"></textarea>
      <p id="personal-bulk-help">${escapeHTML(translate('personal_equipment_bulk_help'))}</p>
      <button type="button" class="button button--secondary" id="personal-add-bulk">${escapeHTML(translate('personal_equipment_bulk_add'))}</button>
      <button type="button" class="button button--secondary" id="personal-add-item">${escapeHTML(translate('personal_equipment_add'))}</button>
      <details id="personal-item-editor"><summary>${escapeHTML(translate('personal_equipment_review_items').replace('{count}', String(list.items.length)))}</summary>
        <div id="personal-equipment-items">${list.items.map((item, index) => this.itemEditor(item, index)).join('')}</div>
      </details>
      <label class="personal-equipment__check"><input type="checkbox" name="personal_published" ${list.published ? 'checked' : ''}>${escapeHTML(translate('personal_equipment_published'))}</label>
      <label class="personal-equipment__check"><input type="checkbox" name="personal_reviewed" ${list.reviewed ? 'checked' : ''}>${escapeHTML(translate('personal_equipment_reviewed'))}</label>
      <p id="personal-equipment-validation" role="alert" hidden></p>
      <button type="submit" class="button button--primary">${escapeHTML(translate('save'))}</button></fieldset></form></section>`);
    const form = this.root().querySelector('form');
    form.addEventListener('change', (event) => {
      if (!event.target.matches('[data-field="catalog_item_id"]') || !event.target.value) { return; }
      const article = this.data.catalog.find((item) => item.id === Number(event.target.value));
      if (article) { event.target.closest('[data-item-key]').querySelector(`[data-field="label_${this.app.lang === 'en' ? 'en' : 'fr'}"]`).value = article.name; }
    });
    form.addEventListener('click', (event) => {
      if (event.target.closest('[data-remove-item]')) { event.target.closest('[data-item-key]').remove(); this.updateItemCount(); }
    });
    this.root().querySelector('#personal-add-bulk').addEventListener('click', () => {
      const input = this.readEditor(); const textarea = this.root().querySelector('#personal-bulk');
      const labels = bulkPackingLines(textarea.value);
      const problem = this.root().querySelector('#personal-equipment-validation');
      if (labels.some((label) => label.length > PERSONAL_EQUIPMENT.LABEL_MAX) || input.items.length + labels.length > PERSONAL_EQUIPMENT.MAX_ITEMS) {
        problem.textContent = translate('personal_equipment_bulk_invalid'); problem.hidden = false; return;
      }
      if (!labels.length) { return; }
      this.draft = { ...this.draft, ...input, reviewed: false, items: [...input.items, ...labels.map((label) => ({
        key: `custom_${crypto.randomUUID()}`, label_fr: this.app.lang === 'en' ? '' : label,
        label_en: this.app.lang === 'en' ? label : '', quantity: 1, catalog_item_id: null,
      }))] };
      this.renderEditor(); this.root().querySelector('#personal-bulk').focus();
    });
    this.root().querySelector('#personal-add-item').addEventListener('click', () => {
      const container = this.root().querySelector('#personal-equipment-items');
      if (container.children.length >= PERSONAL_EQUIPMENT.MAX_ITEMS) { return; }
      const row = document.createElement('div');
      setContent(row, this.itemEditor({ key: `custom_${crypto.randomUUID()}`, label_fr: '', label_en: '', quantity: 1 }, crypto.randomUUID()));
      container.append(row.firstElementChild); this.updateItemCount(); this.root().querySelector('#personal-item-editor').open = true; container.lastElementChild.querySelector('input').focus();
    });
    this.root().querySelector('#personal-apply-template').addEventListener('click', async () => {
      const input = this.readEditor();
      if (!Number.isInteger(input.nights) || input.nights < 0 || input.nights > PERSONAL_EQUIPMENT.MAX_NIGHTS) { return; }
      const approved = await confirm({ title: this.title(), message: translate('personal_equipment_replace_confirm') });
      if (!approved || !this.active()) { return; }
      this.draft = { ...this.draft, ...input, reviewed: false, items: personalEquipmentTemplate(input.season, input.nights, input.stay_type) };
      this.renderEditor(); this.root().querySelector('#personal-apply-template').focus();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, async () => {
        if (!this.active()) { return; }
        const input = this.readEditor(); const error = this.root().querySelector('#personal-equipment-validation');
        if (!input.items.length || input.items.some((item) => !item.label_fr.trim() && !item.label_en.trim()) || (input.published && !input.reviewed) || (input.stay_type === 'day' ? input.nights !== 0 : input.nights < 1)) {
          error.textContent = translate('personal_equipment_invalid'); error.hidden = false; return;
        }
        try {
          const result = await savePersonalEquipment(this.meetingId, input);
          if (!this.active()) { return; }
          if (result?.queued) { throw new Error('Unconfirmed checklist'); }
        } catch (err) {
          if (this.active()) { this.app.showMessage(apiErrorMessage(err, 'personal_equipment_save_failed'), 'error'); }
          return;
        }
        this.app.showMessage(translate('personal_equipment_saved'), 'success');
        await this.init();
      });
    });
  }
  /** Render only locally saved checks; no child progress API exists. */
  renderFamily() {
    if (!this.active()) { return; }
    const { list, children } = this.data;
    let languages;
    try { languages = new Intl.DisplayNames([this.app.lang || 'fr'], { type: 'language' }); } catch { languages = null; }
    setContent(this.root(), `<section class="page personal-equipment">${this.header()}
      <label for="personal-language">${escapeHTML(translate('personal_equipment_language'))}</label>
      <select id="personal-language" data-archive-safe>${PERSONAL_EQUIPMENT.TRANSLATION_LANGUAGES.map((code) => `<option value="${code}" ${code === this.targetLanguage ? 'selected' : ''}>${escapeHTML(languages?.of(code) || code)}</option>`).join('')}</select>
      <button type="button" id="personal-translate" class="button button--secondary" ${this.translationBusy || this.readOnly ? 'disabled' : ''}>${escapeHTML(translate(this.translationBusy ? 'personal_equipment_translating' : 'personal_equipment_translate'))}</button>
      <p class="personal-equipment__notes" dir="auto">${escapeHTML(this.text(list, 'notes'))}</p>
      <p id="personal-translation-status" role="status">${escapeHTML(translate(this.translations.has(this.targetLanguage) ? 'personal_equipment_translated' : 'personal_equipment_translation_hint'))}</p>
      <button type="button" id="personal-equipment-print" class="button button--secondary" data-archive-safe>${escapeHTML(translate('print'))}</button>
      <p>${escapeHTML(translate('personal_equipment_local_only'))}</p>
      ${children.length ? children.map((child) => `<section><h2>${escapeHTML(`${child.first_name} ${child.last_name}`)}</h2><ul class="personal-equipment__list">
        ${list.items.map((item) => `<li><label class="personal-equipment__check" for="personal-check-${child.id}-${item.key}">
          <input type="checkbox" id="personal-check-${child.id}-${item.key}" data-child="${child.id}" data-key="${escapeAttribute(item.key)}" data-archive-safe ${child.checked_keys.includes(item.key) ? 'checked' : ''}>
          <span dir="auto">${escapeHTML(this.quantityText(item))}${escapeHTML(this.text(item))}</span></label><span role="status" class="personal-equipment__feedback"></span></li>`).join('')}</ul></section>`).join('') : `<p>${escapeHTML(translate('personal_equipment_no_children'))}</p>`}</section>`);
    this.root().querySelectorAll('[data-child]').forEach((checkbox) => checkbox.addEventListener('change', () => {
      if (!this.active()) { return; }
      const child = children.find((entry) => entry.id === Number(checkbox.dataset.child));
      const feedback = checkbox.closest('li').querySelector('[role="status"]');
      try {
        child.checked_keys = [...writePacking(packingKey(this.data?.packing_id || this.meetingId, child.id), checkbox.dataset.key, checkbox.checked)];
        feedback.textContent = translate('personal_equipment_local_saved');
      } catch {
        // Keep an honest visible result when the browser refuses persistent storage.
        checkbox.checked = child.checked_keys.includes(checkbox.dataset.key);
        feedback.textContent = translate('personal_equipment_local_failed');
      }
    }));
    this.root().querySelector('#personal-language').addEventListener('change', (event) => {
      if (!this.active()) { return; }
      this.targetLanguage = event.target.value;
      try { localStorage.setItem(this.languageKey, this.targetLanguage); } catch { /* A preference never blocks packing. */ }
      this.renderFamily();
      this.root().querySelector('#personal-language').focus();
    });
    this.root().querySelector('#personal-translate').addEventListener('click', () => this.translateList());
    this.root().querySelector('#personal-equipment-print').addEventListener('click', () => this.print());
  }

  /** Shared translated content is versioned; local checkmarks intentionally are not. */
  translationKey(language) { return buildScopedCacheKey(`personal-equipment-text:${this.meetingId}:${this.loadedVersion}:${language}`); }

  /** Changing the chosen language or leaving the screen discards late translated output. */
  async translateList() {
    if (!this.active() || this.translationBusy) { return; }
    const language = this.targetLanguage;
    if (this.translations.has(language)) { this.renderFamily(); return; }
    this.translationBusy = true; this.renderFamily();
    try {
      const result = await translatePersonalEquipment(this.meetingId, language);
      if (!this.active()) { return; }
      this.translations.set(language, result.data);
      try { localStorage.setItem(this.translationKey(language), JSON.stringify(result.data)); } catch { /* Current text remains usable. */ }
    } catch (err) {
      if (this.active()) { this.app.showMessage(apiErrorMessage(err, 'personal_equipment_translation_failed'), 'error'); }
    } finally {
      this.translationBusy = false;
      if (this.active()) { this.renderFamily(); this.root().querySelector('#personal-translate').focus(); }
    }
  }
  print() {
    const printWindow = openPrintWindow();
    const html = `<h1>${escapeHTML(this.title())}</h1><h2>${escapeHTML(this.data.camp.theme)}</h2><p>${escapeHTML(this.text(this.data.list, 'notes'))}</p>
      ${this.data.children.map((child) => `<h2>${escapeHTML(`${child.first_name} ${child.last_name}`)}</h2><ul>${this.data.list.items.map((item) =>
    `<li>${child.checked_keys.includes(item.key) ? '☑' : '☐'} ${escapeHTML(this.quantityText(item))}${escapeHTML(this.text(item))}</li>`).join('')}</ul>`).join('')}`;
    if (!setPrintContent(printWindow, html, this.title(), { styles: REPORT_PRINT_STYLES })) { this.app.showMessage(translate('personal_equipment_print_blocked'), 'error'); return; }
    printWindow.print();
  }
}
