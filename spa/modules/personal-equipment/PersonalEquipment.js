/** Team-reviewed personal camp lists and each family's device-only packing checkmarks. */
import { translate } from '../../app.js';
import { setContent, loadStylesheet, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { canUseAI, aiActionLabel } from '../../utils/AIUtils.js';
import { isDemoUser } from '../../utils/PermissionUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { confirm } from '../../utils/DialogUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { openPrintWindow, setPrintContent, REPORT_PRINT_STYLES } from '../../utils/PrintUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { getPersonalEquipmentTasks, getPersonalEquipment, savePersonalEquipment, translatePersonalEquipment, editPersonalEquipmentTranslation } from '../../api/api-personal-equipment.js';
import { personalEquipmentTemplate, PERSONAL_EQUIPMENT } from './templates.js';
import { packingKey, readPacking, writePacking, bulkPackingLines, bulkPackingItems } from './packingStorage.js';
import styles from '../../../css/personal-equipment.css?url';
export const PERSONAL_LABELS = {
  summer: 'personal_equipment_summer', winter: 'personal_equipment_winter', shoulder: 'personal_equipment_shoulder',
  day: 'personal_equipment_day', cabin: 'personal_equipment_cabin', tent: 'personal_equipment_tent',
};
export class PersonalEquipment {
  constructor(app, { meetingId, manage = false }) {
    this.app = app; this.meetingId = meetingId; this.manage = manage; this.destroyed = false; this.request = 0;
    this.translations = new Map(); this.targetLanguage = app.lang || 'fr'; this.translationBusy = false;
    this.scope = buildScopedCacheKey(''); this.dirty = false; this.sourceLocale = null;
    this.unloadHandler = (event) => { if (this.dirty || this.translationDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', this.unloadHandler);
    this.languageKey = buildScopedCacheKey('personal-equipment-language');
    try {
      const preferred = localStorage.getItem(this.languageKey);
      if (PERSONAL_EQUIPMENT.TRANSLATION_LANGUAGES.includes(preferred)) { this.targetLanguage = preferred; }
    } catch { /* The list remains usable without persistent preferences. */ }
    this.readOnly = isDemoUser(); this.busy = false;
  }
  root() { return document.getElementById('app'); }
  destroy() { this.destroyed = true; this.request += 1; window.removeEventListener('beforeunload', this.unloadHandler); this.modal?.close(true); }
  beforeLeave({ refresh = false } = {}) {
    if (this.busy) { return false; }
    if (!this.dirty && !this.translationDirty) { return true; }
    if (refresh) { return false; }
    return confirm({ title: this.title(), message: translate('packing_unsaved') });
  }
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
      this.translations = new Map(Object.entries(this.data.translations || {}));
      this.loadedVersion = this.data.list?.version;
      if (!this.active(request)) { return; }
      const nights = Math.max(0, Math.min(PERSONAL_EQUIPMENT.MAX_NIGHTS, this.data.camp.nights ?? PERSONAL_EQUIPMENT.DEFAULT_NIGHTS));
      const stay = nights === 0 ? 'day' : 'tent';
      this.draft = this.data.list || { season: 'shoulder', nights, stay_type: stay, notes_fr: '', notes_en: '', published: false,
        version: 0, items: personalEquipmentTemplate('shoulder', nights, stay) };
      this.sourceLocale ||= this.draft.items.some((item) => item.label_fr.trim()) ? 'fr' : 'en';
      this.dirty = false;
      if (!this.availableLanguages().includes(this.targetLanguage)) { this.targetLanguage = this.availableLanguages()[0] || this.sourceLocale; }

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
  availableLanguages() {
    const list = this.manage ? this.draft : this.data?.list;
    const authored = ['fr', 'en'].filter((lang) => list?.items?.every((item) => item[`label_${lang}`]?.trim())
      && (list[`notes_${lang}`]?.trim() || ![list.notes_fr, list.notes_en].some((value) => value?.trim())));
    return [...new Set([...(authored.length ? authored : [this.sourceLocale || 'fr']), ...this.translations.keys()])];
  }
  quantityText(item) { return Number(item.quantity) > 1 ? `${new Intl.NumberFormat(this.targetLanguage).format(Number(item.quantity))} × ` : ''; }
  languageName(code) {
    try { return new Intl.DisplayNames([this.app.lang || 'fr'], { type: 'language' }).of(code); } catch { return code; }
  }
  itemEditor(item, index) {
    const prefix = `personal-item-${index}`;
    const lang = this.sourceLocale; const other = lang === 'fr' ? 'en' : 'fr';
    return `<tr class="personal-equipment__item" data-item-key="${escapeAttribute(item.key)}">
      <td><label class="sr-only" for="${prefix}-quantity">${escapeHTML(translate('quantity'))}</label><input id="${prefix}-quantity" type="number" data-field="quantity" value="${Number(item.quantity)}" min="1" max="${PERSONAL_EQUIPMENT.MAX_QUANTITY}" step="1" required></td>
      <td><label class="sr-only" for="${prefix}-label">${escapeHTML(translate('personal_equipment_item'))}</label><textarea rows="1" id="${prefix}-label" data-field="label_${lang}" maxlength="${PERSONAL_EQUIPMENT.LABEL_MAX}">${escapeHTML(item[`label_${lang}`])}</textarea>
        <input type="hidden" data-field="label_${other}" value="${escapeAttribute(item[`label_${other}`])}"><p class="field-error" data-row-error role="alert" hidden></p></td>
      <td class="packing-row-actions"><div class="packing-row-buttons"><details><summary>${escapeHTML(translate('packing_options'))}</summary>
        <label for="${prefix}-catalog">${escapeHTML(translate('personal_equipment_catalog'))}</label><select id="${prefix}-catalog" data-field="catalog_item_id"><option value="">${escapeHTML(translate('personal_equipment_custom'))}</option>${(this.data.catalog || []).map((entry) => `<option value="${Number(entry.id)}" ${entry.id === item.catalog_item_id ? 'selected' : ''}>${escapeHTML(entry.name)}</option>`).join('')}</select>
        </details><button type="button" class="button button--secondary" data-remove-item>${escapeHTML(translate('remove'))}<span class="sr-only"> ${escapeHTML(item[`label_${lang}`])}</span></button></div></td></tr>`;
  }
  readEditor() {
    const form = this.root().querySelector('#personal-equipment-form');
    const value = (name) => form.elements.namedItem(name).value;
    return { season: value('personal_season'), stay_type: value('personal_stay'), nights: Number(value('personal_nights')),
      notes_fr: value('personal_notes_fr'), notes_en: value('personal_notes_en'), published: false, reviewed: false, expected_version: this.draft.version,
      items: [...form.querySelectorAll('[data-item-key]')].map((row) => {
        const field = (key) => row.querySelector(`[data-field="${key}"]`).value;
        return { key: row.dataset.itemKey, label_fr: field('label_fr'), label_en: field('label_en'), quantity: Number(field('quantity')),
          catalog_item_id: field('catalog_item_id') ? Number(field('catalog_item_id')) : null };
      }) };
  }
  updateItemCount() {
    this.root().querySelector('#packing-count').textContent = String(this.root().querySelectorAll('[data-item-key]').length);
  }
  markDirty(textChanged = false) {
    this.dirty = true;
    if (textChanged) { this.translations.clear(); setContent(this.root().querySelector('#packing-translation-preview'), ''); }
    this.root().querySelector('#packing-save-status').textContent = translate('packing_unsaved_status');
    if (textChanged) { this.root().querySelector('#packing-translation-status').textContent = translate('packing_translations_stale'); }
  }
  pendingBulk() {
    const input = this.root().querySelector('#personal-bulk');
    if (!input.value.trim()) { return false; }
    this.root().querySelector('#personal-equipment-validation').textContent = translate('packing_bulk_pending');
    input.closest('details').open = true; input.focus(); return true;
  }
  renderEditor() {
    const list = this.draft; const lang = this.sourceLocale; const other = lang === 'fr' ? 'en' : 'fr';
    const options = (values, current) => values.map((value) => `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHTML(translate(PERSONAL_LABELS[value]))}</option>`).join('');
    setContent(this.root(), `<section class="page personal-equipment personal-equipment--editor">${this.header()}
      <p role="status">${escapeHTML(translate(list.published ? 'packing_published_status' : 'packing_draft_status'))}</p>
      <form id="personal-equipment-form" novalidate><fieldset ${this.readOnly || this.data.camp.is_cancelled ? 'disabled' : ''}><legend class="sr-only">${escapeHTML(this.title())}</legend>
      <details class="packing-context"><summary>${escapeHTML(translate('personal_equipment_settings'))} · ${escapeHTML(translate(PERSONAL_LABELS[list.season]))} · ${Number(list.nights)} ${escapeHTML(translate('personal_equipment_nights'))}</summary><div class="packing-settings">
        <label>${escapeHTML(translate('personal_equipment_season'))}<select name="personal_season">${options(PERSONAL_EQUIPMENT.SEASONS, list.season)}</select></label>
        <label>${escapeHTML(translate('personal_equipment_stay'))}<select name="personal_stay">${options(PERSONAL_EQUIPMENT.STAY_TYPES, list.stay_type)}</select></label>
        <label>${escapeHTML(translate('personal_equipment_nights'))}<input name="personal_nights" type="number" value="${list.nights}" min="0" max="${PERSONAL_EQUIPMENT.MAX_NIGHTS}" step="1" required></label>
      </div>
      <div class="packing-suggestions"><button type="button" class="button button--secondary" id="personal-apply-template">${escapeHTML(translate('packing_add_suggestions'))}</button>
        <button type="button" class="button button--ghost" id="packing-replace-template">${escapeHTML(translate('packing_replace_suggestions'))}</button></div></details>
      <div class="packing-layout"><section class="packing-content" aria-labelledby="packing-items-heading"><h2 id="packing-items-heading">${escapeHTML(translate('personal_equipment_title'))} (<span id="packing-count">${list.items.length}</span>)</h2>
        <label for="packing-source">${escapeHTML(translate('packing_source_language'))}</label><select id="packing-source">${['fr','en'].map((code) => `<option value="${code}" ${lang === code ? 'selected' : ''}>${escapeHTML(this.languageName(code))}</option>`).join('')}</select>
        <details class="packing-bulk"><summary>${escapeHTML(translate('personal_equipment_bulk'))}</summary><label class="sr-only" for="personal-bulk">${escapeHTML(translate('personal_equipment_bulk'))}</label>
        <textarea id="personal-bulk" rows="4" maxlength="${PERSONAL_EQUIPMENT.BULK_MAX_LENGTH}" aria-describedby="personal-bulk-help"></textarea><p id="personal-bulk-help">${escapeHTML(translate('personal_equipment_bulk_help'))}</p>
        <p id="packing-bulk-count" role="status"></p><div id="packing-bulk-preview"></div><button type="button" class="button button--secondary" id="personal-add-bulk">${escapeHTML(translate('personal_equipment_bulk_add'))}</button></details>
        <div id="personal-item-editor"><table class="packing-items-table"><caption class="sr-only">${escapeHTML(translate('personal_equipment_title'))}</caption><thead><tr><th scope="col">${escapeHTML(translate('quantity'))}</th><th scope="col">${escapeHTML(translate('personal_equipment_item'))}</th><th scope="col">${escapeHTML(translate('packing_options'))}</th></tr></thead><tbody id="personal-equipment-items">${list.items.map((item, index) => this.itemEditor(item, index)).join('')}</tbody></table></div>
        <button type="button" class="button button--secondary" id="personal-add-item">${escapeHTML(translate('personal_equipment_add'))}</button>
      </section><aside class="packing-sidebar" aria-label="${escapeHTML(translate('packing_instructions_translations'))}">
        <h2>${escapeHTML(translate('packing_instructions'))}</h2><label class="sr-only" for="personal-notes">${escapeHTML(translate('packing_instructions'))}</label><textarea id="personal-notes" name="personal_notes_${lang}" maxlength="${PERSONAL_EQUIPMENT.NOTES_MAX}">${escapeHTML(list[`notes_${lang}`])}</textarea><input type="hidden" name="personal_notes_${other}" value="${escapeAttribute(list[`notes_${other}`])}">
        <h2>${escapeHTML(translate('packing_translations'))}</h2><p>${escapeHTML(translate('packing_staff_translation_help'))}</p>
        <fieldset class="packing-languages"><legend>${escapeHTML(translate('packing_languages_to_prepare'))}</legend>${PERSONAL_EQUIPMENT.TRANSLATION_LANGUAGES.map((code) => `<label><input type="checkbox" data-language="${code}" ${['fr','en'].includes(code) ? 'checked' : ''}> ${escapeHTML(this.languageName(code))}</label>`).join('')}</fieldset>
        ${canUseAI() ? `<button type="button" id="packing-translate-all" class="button button--secondary">${aiActionLabel('packing_translate_all')}</button>` : ''}
        <p id="packing-translation-status" role="status">${escapeHTML(this.translations.size ? translate('packing_translations_ready').replace('{count}', String(this.translations.size)) : translate('packing_no_translations'))}</p>
        <div id="packing-translation-preview">${[...this.translations].map(([code, content]) => `<details><summary>${escapeHTML(this.languageName(code))}</summary><p dir="auto">${escapeHTML(content.notes)}</p><ul>${content.items.map((item) => `<li dir="auto">${escapeHTML(item.label)}</li>`).join('')}</ul><button type="button" class="button button--secondary" data-edit-translation="${code}">${escapeHTML(translate('packing_edit_translation'))}</button></details>`).join('')}</div>
      </aside></div>
      <div class="packing-actions"><span id="packing-save-status" role="status">${escapeHTML(translate(this.dirty ? 'packing_unsaved_status' : 'packing_saved_status'))}</span><p id="personal-equipment-validation" role="alert"></p>
        <button type="submit" class="button button--secondary" value="draft">${escapeHTML(translate('packing_save_draft'))}</button>
        <button type="button" class="button button--secondary" id="packing-preview">${escapeHTML(translate('packing_preview'))}</button>
        <button type="submit" class="button button--primary" value="publish">${escapeHTML(translate('packing_publish'))}</button>
      </div></fieldset></form></section>`);
    const form = this.root().querySelector('form');
    form.addEventListener('input', (event) => {
      if (event.target.id === 'personal-bulk') {
        this.markDirty();
        const items = bulkPackingItems(event.target.value, PERSONAL_EQUIPMENT.MAX_QUANTITY);
        this.root().querySelector('#packing-bulk-count').textContent = translate('packing_bulk_count').replace('{count}', String(items.length));
        setContent(this.root().querySelector('#packing-bulk-preview'), `<ul>${items.slice(0, PERSONAL_EQUIPMENT.BULK_PREVIEW_ITEMS).map((item) => `<li>${item.quantity} × ${escapeHTML(item.label)}</li>`).join('')}</ul>`); return;
      }
      if (event.target.matches('[data-language], #packing-source')) { return; }
      const textChanged = event.target.matches('[data-field^="label_"], #personal-notes');
      if (event.target.matches('[data-field^="label_"]')) { event.target.closest('[data-item-key]').querySelector(`[data-field="label_${other}"]`).value = ''; }
      if (event.target.id === 'personal-notes') { form.elements.namedItem(`personal_notes_${other}`).value = ''; }
      this.markDirty(textChanged);
    });
    form.addEventListener('change', (event) => {
      if (event.target.matches('[data-field="catalog_item_id"]') && event.target.value) {
        const article = this.data.catalog.find((item) => item.id === Number(event.target.value));
        if (article) { const row = event.target.closest('[data-item-key]'); row.querySelector(`[data-field="label_${lang}"]`).value = article.name; row.querySelector(`[data-field="label_${other}"]`).value = ''; this.markDirty(true); }
      }
    });
    form.addEventListener('click', (event) => {
      const translation = event.target.closest('[data-edit-translation]');
      if (translation) { this.editTranslation(translation.dataset.editTranslation); return; }
      const button = event.target.closest('[data-remove-item]');
      if (button) { const row = button.closest('[data-item-key]'); const next = row.nextElementSibling || row.previousElementSibling; row.remove(); this.updateItemCount(); this.markDirty(true); (next?.querySelector('textarea') || this.root().querySelector('#personal-add-item')).focus(); }
    });
    this.root().querySelector('#packing-source').addEventListener('change', (event) => {
      if (this.pendingBulk()) { event.target.value = this.sourceLocale; return; }
      this.draft = { ...this.draft, ...this.readEditor() }; this.sourceLocale = event.target.value; this.renderEditor(); this.root().querySelector('#packing-source').focus();
    });
    this.root().querySelector('#personal-add-bulk').addEventListener('click', () => {
      const input = this.readEditor(); const labels = bulkPackingLines(this.root().querySelector('#personal-bulk').value);
      if (labels.some((label) => label.length > PERSONAL_EQUIPMENT.LABEL_MAX) || input.items.length + labels.length > PERSONAL_EQUIPMENT.MAX_ITEMS) {
        this.root().querySelector('#personal-equipment-validation').textContent = translate('personal_equipment_bulk_invalid'); return;
      }
      if (!labels.length) { return; }
      const additions = bulkPackingItems(this.root().querySelector('#personal-bulk').value, PERSONAL_EQUIPMENT.MAX_QUANTITY);
      this.draft = { ...this.draft, ...input, items: [...input.items, ...additions.map(({ label, quantity }) => ({
        key: `custom_${crypto.randomUUID()}`, label_fr: lang === 'fr' ? label : '', label_en: lang === 'en' ? label : '', quantity, catalog_item_id: null,
      }))] };
      this.markDirty(true); this.renderEditor();
      this.root().querySelectorAll('[data-item-key]')[input.items.length].querySelector('textarea').focus();
    });
    this.root().querySelector('#personal-add-item').addEventListener('click', () => {
      if (this.pendingBulk()) { return; }
      const input = this.readEditor();
      if (input.items.length >= PERSONAL_EQUIPMENT.MAX_ITEMS) { return; }
      this.draft = { ...this.draft, ...input, items: [...input.items, { key: `custom_${crypto.randomUUID()}`, label_fr: '', label_en: '', quantity: 1, catalog_item_id: null }] };
      this.markDirty(true); this.renderEditor(); this.root().querySelector('#personal-equipment-items tr:last-child textarea').focus();
    });
    const apply = async (replace) => {
      if (this.pendingBulk()) { return; }
      const input = this.readEditor();
      if (!Number.isInteger(input.nights) || input.nights < 0 || input.nights > PERSONAL_EQUIPMENT.MAX_NIGHTS) { return; }
      if (replace && !await confirm({ title: this.title(), message: translate('personal_equipment_replace_confirm') })) { return; }
      if (!this.active()) { return; }
      const suggestions = personalEquipmentTemplate(input.season, input.nights, input.stay_type);
      const keys = new Set(input.items.map((item) => item.key));
      this.draft = { ...this.draft, ...input, items: replace ? suggestions : [...input.items, ...suggestions.filter((item) => !keys.has(item.key))] };
      this.markDirty(true); this.renderEditor(); this.root().querySelector('#personal-apply-template').focus();
    };
    this.root().querySelector('#personal-apply-template').addEventListener('click', () => apply(false));
    this.root().querySelector('#packing-replace-template').addEventListener('click', () => apply(true));
    this.root().querySelector('#packing-preview').addEventListener('click', () => this.preview());
    this.root().querySelector('#packing-translate-all')?.addEventListener('click', () => this.translateAll());
    form.addEventListener('submit', (event) => { event.preventDefault(); this.save(event.submitter?.value === 'publish'); });
  }
  validateEditor(input) {
    const form = this.root().querySelector('form'); let first = null;
    form.querySelectorAll('[data-item-key]').forEach((row, index) => {
      const item = input.items[index]; const invalid = !item[`label_${this.sourceLocale}`].trim();
      const quantityInvalid = !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > PERSONAL_EQUIPMENT.MAX_QUANTITY;
      const field = row.querySelector(invalid ? 'textarea' : '[data-field="quantity"]');
      const message = row.querySelector('[data-row-error]'); message.hidden = !invalid && !quantityInvalid;
      message.textContent = translate(invalid ? 'packing_label_required' : 'packing_quantity_invalid');
      row.querySelectorAll('[aria-invalid]').forEach((element) => element.removeAttribute('aria-invalid'));
      if (invalid || quantityInvalid) { field.setAttribute('aria-invalid', 'true'); first ||= field; }
    });
    if (first) { first.focus(); return false; }
    if (!input.items.length || !Number.isInteger(input.nights) || input.nights < 0 || input.nights > PERSONAL_EQUIPMENT.MAX_NIGHTS || (input.stay_type === 'day' ? input.nights !== 0 : input.nights < 1)) {
      this.root().querySelector('#personal-equipment-validation').textContent = translate('personal_equipment_invalid');
      const nights = form.elements.namedItem('personal_nights'); nights.closest('details').open = true; nights.setAttribute('aria-invalid', 'true'); nights.focus(); return false;
    }
    return true;
  }
  async save(publish = false) {
    if (!this.active() || this.busy || this.pendingBulk()) { return false; }
    const input = this.readEditor(); if (!this.validateEditor(input)) { return false; }
    if (publish && !await confirm({ title: translate('packing_publish'), message: translate('packing_publish_confirm') })) { return false; }
    if (!this.active()) { return false; }
    input.published = publish; input.reviewed = publish;
    this.busy = true;
    const fieldset = this.root().querySelector('form > fieldset'); fieldset.disabled = true;
    try {
      const result = await withFormBusy(this.root().querySelector('form'), () => savePersonalEquipment(this.meetingId, input));
      if (!this.active()) { return false; }
      if (result?.queued) { throw new Error('Unconfirmed checklist'); }
      this.dirty = false; this.app.showMessage(translate(publish ? 'packing_published_status' : 'personal_equipment_saved'), 'success');
      await this.init(); return !!this.root()?.querySelector('#personal-equipment-form');
    } catch (err) { if (this.active()) { this.app.showMessage(apiErrorMessage(err, 'personal_equipment_save_failed'), 'error'); } return false; }
    finally { this.busy = false; fieldset.disabled = false; }
  }
  preview() {
    if (this.pendingBulk()) { return; }
    const list = this.readEditor();
    this.modal = openModal({ title: translate('packing_preview'), body: `<p class="personal-equipment__notes">${escapeHTML(list[`notes_${this.sourceLocale}`])}</p><ul>${list.items.map((item) => `<li>${Number(item.quantity)} × ${escapeHTML(item[`label_${this.sourceLocale}`])}</li>`).join('')}</ul>`, footer: `<button type="button" class="button" data-modal-close>${escapeHTML(translate('close'))}</button>` });
  }
  async translateAll() {
    if (!canUseAI() || this.busy || this.pendingBulk()) { return; }
    const languages = [...this.root().querySelectorAll('[data-language]:checked')].map((input) => input.dataset.language);
    if (!languages.length) { this.root().querySelector('#packing-translation-status').textContent = translate('packing_choose_languages'); return; }
    if (this.dirty || !this.draft.version) { if (!await this.save(false)) { return; } }
    this.busy = true; this.translationFailures = [];
    const form = this.root().querySelector('form');
    form.querySelector('fieldset').disabled = true;
    await withFormBusy(form, async () => {
      await languages.reduce(async (previous, language) => {
        await previous;
        if (!this.active() || this.translations.has(language)) { return; }
        this.root().querySelector('#packing-translation-status').textContent = translate('packing_translating_language').replace('{language}', this.languageName(language));
        try { const result = await translatePersonalEquipment(this.meetingId, language); if (this.active()) { this.translations.set(language, result.data); } }
        catch (err) { this.translationFailures.push(language); if (this.active()) { this.app.showMessage(apiErrorMessage(err, 'personal_equipment_translation_failed'), 'error'); } }
      }, Promise.resolve());
    });
    this.draft.published = false;
    this.busy = false; form.querySelector('fieldset').disabled = false;
    if (this.active()) { this.renderEditor(); this.root().querySelector('#packing-translate-all')?.focus();
      if (this.translationFailures.length) { this.root().querySelector('#packing-translation-status').textContent = translate('packing_translation_failures').replace('{languages}', this.translationFailures.map((code) => this.languageName(code)).join(', ')); }
    }
  }
  async editTranslation(language) {
    if (this.dirty && !await this.save(false)) { return; }
    const content = this.translations.get(language);
    if (!content || this.busy || this.dirty) { return; }
    const expectedVersion = this.draft.version;
    let saving = false; let changed = false;
    const modal = openModal({ title: `${translate('packing_edit_translation')} — ${this.languageName(language)}`,
      onClose: () => { this.translationDirty = false; },
      canClose: () => saving ? false : !changed || confirm({ title: this.title(), message: translate('packing_unsaved') }),
      body: `<form id="packing-translation-edit"><label for="packing-translation-notes">${escapeHTML(translate('packing_instructions'))}</label><textarea id="packing-translation-notes" maxlength="${PERSONAL_EQUIPMENT.NOTES_MAX}">${escapeHTML(content.notes)}</textarea>${content.items.map((item, index) => `<label for="packing-translated-${index}">${escapeHTML(this.draft.items.find((source) => source.key === item.key)?.[`label_${this.sourceLocale}`] || item.key)}</label><input id="packing-translated-${index}" data-translated-key="${escapeAttribute(item.key)}" value="${escapeAttribute(item.label)}" maxlength="${PERSONAL_EQUIPMENT.LABEL_MAX}" required>`).join('')}</form>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button><button type="submit" class="button button--primary" form="packing-translation-edit">${escapeHTML(translate('save'))}</button>` });
    this.modal = modal;
    const form = modal.overlay.querySelector('form'); form.addEventListener('input', () => { changed = true; this.translationDirty = true; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (saving) { return; } saving = true;
      const translated = { notes: form.querySelector('textarea').value, items: [...form.querySelectorAll('[data-translated-key]')].map((input) => ({ key: input.dataset.translatedKey, label: input.value.trim() })) };
      const controls = [...form.elements]; controls.forEach((control) => { control.disabled = true; }); this.busy = true;
      try {
        const result = await withFormBusy(form, () => editPersonalEquipmentTranslation(this.meetingId, language, { expected_version: expectedVersion, expected_content: content, content: translated }));
        if (this.active()) { this.translations.set(language, result.data || translated); this.draft.published = false; this.renderEditor(); }
        changed = false; modal.close(true);
      } catch (err) { this.app.showMessage(apiErrorMessage(err, 'personal_equipment_save_failed'), 'error'); }
      finally { saving = false; this.busy = false; controls.forEach((control) => { control.disabled = false; }); }
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
      <select id="personal-language" data-archive-safe>${this.availableLanguages().map((code) => `<option value="${code}" ${code === this.targetLanguage ? 'selected' : ''}>${escapeHTML(languages?.of(code) || code)}</option>`).join('')}</select>
      <p class="personal-equipment__notes" dir="auto">${escapeHTML(this.text(list, 'notes'))}</p>
      <p id="personal-translation-status" role="status">${escapeHTML(translate(this.translations.has(this.targetLanguage) ? 'personal_equipment_translated' : 'packing_parent_translation_hint'))}</p>
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
    this.root().querySelector('#personal-equipment-print').addEventListener('click', () => this.print());
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
