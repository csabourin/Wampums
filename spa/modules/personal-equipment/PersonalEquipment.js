/**
 * Personal packing lists: the team prepares, translates and publishes a camp's list;
 * each family ticks what is packed, on their own device only.
 *
 * @module spa/modules/personal-equipment/PersonalEquipment
 */
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
import { formatDate, formatTimestamp } from '../../utils/DateUtils.js';
import {
  getPersonalEquipmentTasks, getPersonalEquipment, savePersonalEquipment,
  translatePersonalEquipment, editPersonalEquipmentTranslation,
} from '../../api/api-personal-equipment.js';
import { personalEquipmentTemplate, itemCategory, groupByCategory, PERSONAL_EQUIPMENT } from './templates.js';
import { packingKey, readPacking, writePacking, bulkPackingLines, bulkPackingItems } from './packingStorage.js';
import styles from '../../../css/personal-equipment.css?url';

export const PERSONAL_LABELS = {
  summer: 'personal_equipment_summer', winter: 'personal_equipment_winter', shoulder: 'personal_equipment_shoulder',
  day: 'personal_equipment_day', cabin: 'personal_equipment_cabin', tent: 'personal_equipment_tent',
};

/** Literal keys, so the translation coverage test sees every category label. */
const CATEGORY_LABELS = {
  clothing: () => translate('packing_category_clothing'),
  sleep: () => translate('packing_category_sleep'),
  hygiene: () => translate('packing_category_hygiene'),
  meals: () => translate('packing_category_meals'),
  gear: () => translate('packing_category_gear'),
  other: () => translate('packing_category_other'),
};

const AUTHORED_LANGUAGES = ['fr', 'en'];

/** A translation still missing an item or the instructions is retranslated, never shown to families. */
const isComplete = (content) => Boolean(content) && content.partial !== true;

const newItemKey = () => `custom_${crypto.randomUUID()}`;

/** Item keys are server-validated (`[a-z][a-z0-9_-]*`), so they are safe inside an attribute selector. */
const rowSelector = (key) => `[data-item-key="${key}"]`;

export class PersonalEquipment {
  /**
   * @param {Object} app - Application instance
   * @param {{meetingId: number|string|null, manage?: boolean}} options - A camp id, `activity-<id>`, or null for the family index
   */
  constructor(app, { meetingId, manage = false }) {
    this.app = app;
    this.meetingId = meetingId;
    this.manage = manage;
    this.readOnly = isDemoUser();
    this.destroyed = false;
    this.request = 0;
    this.busy = false;
    this.dirty = false;
    this.translationDirty = false;
    this.translations = new Map();
    this.sourceLocale = null;
    this.openPanel = null;
    this.scope = buildScopedCacheKey('');
    this.languageKey = buildScopedCacheKey('personal-equipment-language');
    this.hidePackedKey = buildScopedCacheKey('personal-equipment-hide-packed');
    this.targetLanguage = this.readPreference(this.languageKey, (value) => PERSONAL_EQUIPMENT.TRANSLATION_LANGUAGES.includes(value)) || app.lang || 'fr';
    this.hidePacked = this.readPreference(this.hidePackedKey, (value) => value === 'true') === 'true';
    this.unloadHandler = (event) => {
      if (this.dirty || this.translationDirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', this.unloadHandler);
  }

  /** A per-device preference; the list stays usable when storage is blocked. */
  readPreference(key, valid) {
    try {
      const value = localStorage.getItem(key);
      return valid(value) ? value : null;
    } catch {
      return null;
    }
  }

  writePreference(key, value) {
    try { localStorage.setItem(key, value); } catch { /* A preference never blocks packing. */ }
  }

  root() { return document.getElementById('app'); }

  destroy() {
    this.destroyed = true;
    this.request += 1;
    window.removeEventListener('beforeunload', this.unloadHandler);
    this.modal?.close(true);
  }

  beforeLeave({ refresh = false } = {}) {
    if (this.busy) { return false; }
    if (!this.dirty && !this.translationDirty) { return true; }
    if (refresh) { return false; }
    return confirm({ title: this.title(), message: translate('packing_unsaved') });
  }

  /** Whether an answer still belongs on screen: same screen, same request, same account and unit. */
  active(request = this.request) {
    return !this.destroyed && request === this.request && this.scope === buildScopedCacheKey('');
  }

  title() { return translate(this.manage ? 'packing_editor_title' : 'personal_equipment_title'); }

  backHref() { return this.manage ? '/activities' : '/parent-dashboard'; }

  async init() {
    const request = ++this.request;
    const options = { title: this.title(), backHref: this.backHref() };
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
      this.prepare();
      if (this.manage) { this.renderEditor(); } else { this.renderFamily(); }
    } catch (err) {
      if (!this.active(request)) { return; }
      debugError('Personal equipment loading failed', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'error_loading_data'), retryId: 'personal-equipment-retry' }));
      this.root().querySelector('#personal-equipment-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** Turn a loaded list into the editor draft and the family's local checks. */
  prepare() {
    this.translations = new Map(Object.entries(this.data.translations || {}));
    const nights = Math.max(0, Math.min(PERSONAL_EQUIPMENT.MAX_NIGHTS, this.data.camp.nights ?? PERSONAL_EQUIPMENT.DEFAULT_NIGHTS));
    const stay = nights === 0 ? 'day' : 'tent';
    this.draft = this.data.list || {
      season: 'shoulder', nights, stay_type: stay, notes_fr: '', notes_en: '', published: false, version: 0,
      items: personalEquipmentTemplate('shoulder', nights, stay),
    };
    this.sourceLocale ||= this.draft.items.some((item) => item.label_fr.trim()) ? 'fr' : 'en';
    this.dirty = false;
    if (!this.availableLanguages().includes(this.targetLanguage)) {
      this.targetLanguage = this.availableLanguages()[0] || this.sourceLocale;
    }
    if (!this.manage) {
      this.data.children.forEach((child) => {
        child.checked_keys = [...readPacking(this.packingKeyFor(child))];
      });
    }
  }

  packingKeyFor(child) { return packingKey(this.data?.packing_id || this.meetingId, child.id); }

  // --- Shared text helpers -------------------------------------------------------------

  /** An item's label or the list's notes in the language being read. */
  text(item, field = 'label') {
    const translated = this.translations.get(this.targetLanguage);
    if (isComplete(translated) && !AUTHORED_LANGUAGES.includes(this.targetLanguage)) {
      return field === 'notes' ? translated.notes : translated.items.find((entry) => entry.key === item.key)?.label || '';
    }
    const lang = AUTHORED_LANGUAGES.includes(this.targetLanguage) ? this.targetLanguage : 'fr';
    const authored = item[`${field}_${lang}`];
    if (authored) { return authored; }
    if (isComplete(translated)) {
      return field === 'notes' ? translated.notes : translated.items.find((entry) => entry.key === item.key)?.label || '';
    }
    return item[`${field}_fr`] || item[`${field}_en`] || '';
  }

  /** Languages a family may choose: those written by the team, then complete prepared translations. */
  availableLanguages() {
    const list = this.manage ? this.draft : this.data?.list;
    const hasNotes = [list?.notes_fr, list?.notes_en].some((value) => value?.trim());
    const authored = AUTHORED_LANGUAGES.filter((lang) => list?.items?.every((item) => item[`label_${lang}`]?.trim())
      && (list[`notes_${lang}`]?.trim() || !hasNotes));
    const prepared = [...this.translations].filter(([, content]) => isComplete(content)).map(([code]) => code);
    return [...new Set([...(authored.length ? authored : [this.sourceLocale || 'fr']), ...prepared])];
  }

  quantityText(item) {
    return Number(item.quantity) > 1 ? `${new Intl.NumberFormat(this.targetLanguage).format(Number(item.quantity))} × ` : '';
  }

  languageName(code) {
    try { return new Intl.DisplayNames([this.app.lang || 'fr'], { type: 'language' }).of(code); } catch { return code; }
  }

  categoryName(category) { return (CATEGORY_LABELS[category] || CATEGORY_LABELS.other)(); }

  header() {
    return `${renderBackLink(this.backHref())}<h1>${escapeHTML(this.title())}</h1>
      <p class="packing-activity-meta"><strong>${escapeHTML(this.data.camp.theme || translate('personal_equipment_camp'))}</strong>
        <span>${escapeHTML(formatDate(this.data.camp.meeting_date, this.app.lang))}</span></p>
      ${this.data.camp.is_cancelled ? `<p role="status">${escapeHTML(translate('personal_equipment_cancelled'))}</p>` : ''}`;
  }

  renderIndex(rows) {
    const camps = [...new Map(rows.map((row) => [row.meeting_id, row])).values()];
    const links = camps.map((camp) => `<li><a class="button button--secondary" href="/personal-equipment/${escapeAttribute(String(camp.meeting_id))}">
      ${escapeHTML(camp.title || translate('personal_equipment_camp'))} · ${escapeHTML(formatDate(camp.date, this.app.lang))}</a></li>`).join('');
    setContent(this.root(), `<section class="page personal-equipment">${renderBackLink('/parent-dashboard')}<h1>${escapeHTML(this.title())}</h1>
      ${links ? `<ul class="personal-equipment__camps">${links}</ul>` : `<p>${escapeHTML(translate('personal_equipment_no_lists'))}</p>`}</section>`);
  }

  // --- Editor: markup ---------------------------------------------------------------------

  /** What families have now, and whether this draft differs from it. */
  publicationStatus() {
    const publication = this.data.publication;
    if (!publication) { return translate('packing_status_never_published'); }
    const date = formatTimestamp(publication.published_at, this.app.lang);
    return translate(this.changesPending() ? 'packing_status_changes_pending' : 'packing_status_published').replace('{date}', date);
  }

  /** Whether families have an older version than this draft. */
  changesPending() {
    const publication = this.data.publication;
    return Boolean(publication) && !(this.draft.published && publication.version === this.draft.version);
  }

  settingsMarkup() {
    const list = this.draft;
    const unit = translate(list.nights === 1 ? 'packing_night' : 'packing_nights');
    const context = translate('packing_context').replace('{season}', translate(PERSONAL_LABELS[list.season]))
      .replace('{nights}', String(list.nights)).replace('{unit}', unit);
    const options = (values, current) => values.map((value) => `<option value="${value}" ${value === current ? 'selected' : ''}>
      ${escapeHTML(translate(PERSONAL_LABELS[value]))}</option>`).join('');
    // A list that was never saved opens on these choices: they decide the suggestions.
    return `<details class="packing-context" ${this.data.list ? '' : 'open'}><summary>${escapeHTML(context)}</summary>
      ${this.data.list ? '' : `<p>${escapeHTML(translate('personal_equipment_review_hint'))}</p>`}
      <div class="packing-settings">
        <label>${escapeHTML(translate('personal_equipment_season'))}<select name="personal_season">${options(PERSONAL_EQUIPMENT.SEASONS, list.season)}</select></label>
        <label>${escapeHTML(translate('personal_equipment_stay'))}<select name="personal_stay">${options(PERSONAL_EQUIPMENT.STAY_TYPES, list.stay_type)}</select></label>
        <label>${escapeHTML(translate('personal_equipment_nights'))}<input name="personal_nights" type="number" inputmode="numeric" value="${Number(list.nights)}" min="0" max="${PERSONAL_EQUIPMENT.MAX_NIGHTS}" step="1" required></label>
      </div>
      <div class="packing-suggestions">
        <button type="button" class="button button--secondary" id="personal-apply-template">${escapeHTML(translate('packing_add_suggestions'))}</button>
        <button type="button" class="button button--ghost" id="packing-replace-template">${escapeHTML(translate('packing_replace_suggestions'))}</button>
      </div></details>`;
  }

  /**
   * One item: quantity and label always visible; category, catalogue link, order and removal behind its options button.
   * @param {Object} item
   * @param {{first: boolean, last: boolean}} place - Its place within its category
   */
  itemEditor(item, { first, last }) {
    const lang = this.sourceLocale;
    const other = lang === 'fr' ? 'en' : 'fr';
    const id = `personal-item-${escapeAttribute(item.key)}`;
    const label = item[`label_${lang}`] || '';
    const open = this.openPanel === item.key;
    const category = itemCategory(item);
    const catalog = (this.data.catalog || []).map((entry) => `<option value="${Number(entry.id)}" ${entry.id === item.catalog_item_id ? 'selected' : ''}>
      ${escapeHTML(entry.name)}</option>`).join('');
    const categories = PERSONAL_EQUIPMENT.CATEGORIES.map((key) => `<option value="${key}" ${key === category ? 'selected' : ''}>${escapeHTML(this.categoryName(key))}</option>`).join('');
    return `<li class="packing-item" data-item-key="${escapeAttribute(item.key)}">
      <div class="packing-item__main">
        <label class="sr-only" for="${id}-quantity">${escapeHTML(translate('quantity'))}</label>
        <input id="${id}-quantity" class="packing-item__quantity" type="number" inputmode="numeric" data-field="quantity" value="${Number(item.quantity)}" min="1" max="${PERSONAL_EQUIPMENT.MAX_QUANTITY}" step="1" required>
        <label class="sr-only" for="${id}-label">${escapeHTML(translate('personal_equipment_item'))}</label>
        <textarea rows="1" id="${id}-label" class="packing-item__label" data-field="label_${lang}" maxlength="${PERSONAL_EQUIPMENT.LABEL_MAX}" aria-describedby="${id}-error">${escapeHTML(label)}</textarea>
        <input type="hidden" data-field="label_${other}" value="${escapeAttribute(item[`label_${other}`] || '')}">
        <button type="button" class="button button--ghost packing-item__more" data-toggle-panel aria-expanded="${open}" aria-controls="${id}-panel">
          <span aria-hidden="true">⋯</span><span class="sr-only">${escapeHTML(translate('packing_item_options').replace('{item}', label))}</span></button>
      </div>
      <p class="field-error" id="${id}-error" data-row-error role="alert" hidden></p>
      <div class="packing-item__panel" id="${id}-panel" ${open ? '' : 'hidden'}>
        <label for="${id}-category">${escapeHTML(translate('packing_category'))}</label>
        <select id="${id}-category" data-field="category">${categories}</select>
        <label for="${id}-catalog">${escapeHTML(translate('personal_equipment_catalog'))}</label>
        <select id="${id}-catalog" data-field="catalog_item_id"><option value="">${escapeHTML(translate('personal_equipment_custom'))}</option>${catalog}</select>
        <div class="packing-item__actions">
          <button type="button" class="button button--secondary button--small" data-move="-1" ${first ? 'disabled' : ''}>${escapeHTML(translate('packing_move_up'))}</button>
          <button type="button" class="button button--secondary button--small" data-move="1" ${last ? 'disabled' : ''}>${escapeHTML(translate('packing_move_down'))}</button>
          <button type="button" class="button button--danger button--small" data-remove-item>${escapeHTML(translate('remove'))}<span class="sr-only"> ${escapeHTML(label)}</span></button>
        </div>
      </div>
    </li>`;
  }

  itemsMarkup() {
    return groupByCategory(this.draft.items).map((group) => {
      const headingId = `packing-group-${group.category}`;
      const rows = group.items.map((item, index) => this.itemEditor(item, { first: index === 0, last: index === group.items.length - 1 })).join('');
      return `<section class="packing-group" aria-labelledby="${headingId}"><h3 id="${headingId}">${escapeHTML(this.categoryName(group.category))}</h3>
        <ol class="packing-items">${rows}</ol></section>`;
    }).join('');
  }

  bulkMarkup() {
    return `<div class="packing-add">
        <button type="button" class="button button--secondary" id="personal-add-item">${escapeHTML(translate('personal_equipment_add'))}</button>
        <button type="button" class="button button--secondary" id="packing-bulk-toggle" aria-expanded="false" aria-controls="packing-bulk-panel">${escapeHTML(translate('personal_equipment_bulk'))}</button>
      </div>
      <div class="packing-bulk" id="packing-bulk-panel" hidden>
        <label for="personal-bulk">${escapeHTML(translate('personal_equipment_bulk'))}</label>
        <textarea id="personal-bulk" rows="4" maxlength="${PERSONAL_EQUIPMENT.BULK_MAX_LENGTH}" aria-describedby="personal-bulk-help"></textarea>
        <p id="personal-bulk-help">${escapeHTML(translate('personal_equipment_bulk_help'))}</p>
        <p id="packing-bulk-count" role="status"></p><div id="packing-bulk-preview"></div>
        <button type="button" class="button button--secondary" id="personal-add-bulk">${escapeHTML(translate('personal_equipment_bulk_add'))}</button>
      </div>`;
  }

  /** One prepared language: reviewable when complete, otherwise what is left to translate. */
  translationSummary(code, content) {
    if (!isComplete(content)) {
      const missingItems = this.draft.items.filter((item) => !content.items.some((entry) => entry.key === item.key)).length;
      const left = missingItems + (typeof content.notes === 'string' ? 0 : 1);
      return `<p>${escapeHTML(translate('packing_translation_partial').replace('{language}', this.languageName(code)).replace('{count}', String(left)))}</p>`;
    }
    return `<details><summary>${escapeHTML(this.languageName(code))}</summary><p dir="auto">${escapeHTML(content.notes)}</p>
      <ul>${content.items.map((item) => `<li dir="auto">${escapeHTML(item.label)}</li>`).join('')}</ul>
      <button type="button" class="button button--secondary" data-edit-translation="${escapeAttribute(code)}">${escapeHTML(translate('packing_edit_translation'))}</button></details>`;
  }

  /**
   * Languages offered for translation. Checked by default: the other team language and the unit's
   * optional languages; the rest wait under "Other languages". The writing language is never offered.
   */
  languagesMarkup() {
    const unitLanguages = this.app.getUnitLanguages?.().optional || [];
    const suggested = (code) => (AUTHORED_LANGUAGES.includes(code) || unitLanguages.includes(code));
    const choice = (code) => `<label><input type="checkbox" data-language="${code}" ${suggested(code) ? 'checked' : ''}> ${escapeHTML(this.languageName(code))}</label>`;
    const offered = PERSONAL_EQUIPMENT.TRANSLATION_LANGUAGES.filter((code) => code !== this.sourceLocale);
    const others = offered.filter((code) => !suggested(code));
    return `<fieldset class="packing-languages"><legend>${escapeHTML(translate('packing_languages_to_prepare'))}</legend>
      <div class="packing-languages__grid">${offered.filter(suggested).map(choice).join('')}</div>
      ${others.length ? `<details class="packing-languages__more"><summary>${escapeHTML(translate('packing_other_languages'))}</summary>
        <div class="packing-languages__grid">${others.map(choice).join('')}</div></details>` : ''}</fieldset>`;
  }

  sidebarMarkup() {
    const lang = this.sourceLocale;
    const other = lang === 'fr' ? 'en' : 'fr';
    const ready = [...this.translations.values()].filter(isComplete).length;
    const status = this.translations.size ? translate('packing_translations_ready').replace('{count}', String(ready)) : translate('packing_no_translations');
    return `<aside class="packing-sidebar" aria-label="${escapeAttribute(translate('packing_instructions_translations'))}">
      <h2><label for="personal-notes">${escapeHTML(translate('packing_instructions'))}</label></h2>
      <textarea id="personal-notes" name="personal_notes_${lang}" rows="4" maxlength="${PERSONAL_EQUIPMENT.NOTES_MAX}">${escapeHTML(this.draft[`notes_${lang}`])}</textarea>
      <input type="hidden" name="personal_notes_${other}" value="${escapeAttribute(this.draft[`notes_${other}`])}">
      <h2>${escapeHTML(translate('packing_translations'))}</h2>
      <p>${escapeHTML(translate('packing_staff_translation_help'))}</p>
      <label for="packing-source">${escapeHTML(translate('packing_source_language'))}</label>
      <select id="packing-source">${AUTHORED_LANGUAGES.map((code) => `<option value="${code}" ${lang === code ? 'selected' : ''}>${escapeHTML(this.languageName(code))}</option>`).join('')}</select>
      ${this.languagesMarkup()}
      ${canUseAI() ? `<button type="button" id="packing-translate-all" class="button button--secondary">${aiActionLabel('packing_translate_all')}</button>` : ''}
      <p id="packing-translation-status" role="status">${escapeHTML(status)}</p>
      <div id="packing-translation-preview">${[...this.translations].map(([code, content]) => this.translationSummary(code, content)).join('')}</div>
    </aside>`;
  }

  renderEditor() {
    const disabled = this.readOnly || this.data.camp.is_cancelled;
    setContent(this.root(), `<section class="page personal-equipment personal-equipment--editor">${this.header()}
      <p role="status" id="packing-publication-status">${escapeHTML(this.publicationStatus())}</p>
      <form id="personal-equipment-form" novalidate><fieldset ${disabled ? 'disabled' : ''}><legend class="sr-only">${escapeHTML(this.title())}</legend>
      ${this.settingsMarkup()}
      <div class="packing-layout">
        <section class="packing-content" aria-labelledby="packing-items-heading">
          <h2 id="packing-items-heading">${escapeHTML(translate('packing_list_items'))} (<span id="packing-count">${this.draft.items.length}</span>)</h2>
          <div id="personal-equipment-items">${this.itemsMarkup()}</div>
          ${this.bulkMarkup()}
        </section>
        ${this.sidebarMarkup()}
      </div>
      <div class="packing-actions">
        <span id="packing-save-status" role="status">${escapeHTML(translate(this.dirty || !this.draft.version ? 'packing_unsaved_status' : 'packing_saved_status'))}</span>
        <p id="personal-equipment-validation" role="alert"></p>
        <button type="submit" class="button button--secondary" value="draft">${escapeHTML(translate('packing_save_draft'))}</button>
        <button type="button" class="button button--secondary" id="packing-preview">${escapeHTML(translate('packing_preview'))}</button>
        <button type="submit" class="button button--primary" value="publish">${escapeHTML(translate(this.changesPending() ? 'packing_publish_changes' : 'packing_publish'))}</button>
      </div></fieldset></form></section>`);
    this.bindEditor();
  }

  // --- Editor: behaviour ------------------------------------------------------------------

  bindEditor() {
    const root = this.root();
    const form = root.querySelector('#personal-equipment-form');
    form.addEventListener('input', (event) => this.onEditorInput(event));
    form.addEventListener('change', (event) => this.onEditorChange(event));
    form.addEventListener('click', (event) => this.onEditorClick(event));
    form.addEventListener('submit', (event) => { event.preventDefault(); this.save(event.submitter?.value === 'publish'); });
    root.querySelector('#packing-source').addEventListener('change', (event) => {
      if (this.pendingBulk()) { event.target.value = this.sourceLocale; return; }
      this.syncDraft();
      this.sourceLocale = event.target.value;
      this.rerender('#packing-source');
    });
    root.querySelector('#packing-bulk-toggle').addEventListener('click', (event) => {
      const panel = root.querySelector('#packing-bulk-panel');
      const open = panel.hidden;
      panel.hidden = !open;
      event.currentTarget.setAttribute('aria-expanded', String(open));
      if (open) { root.querySelector('#personal-bulk').focus(); }
    });
    root.querySelector('#personal-add-bulk').addEventListener('click', () => this.addBulk());
    root.querySelector('#personal-add-item').addEventListener('click', () => this.addItem());
    root.querySelector('#personal-apply-template').addEventListener('click', () => this.applyTemplate(false));
    root.querySelector('#packing-replace-template').addEventListener('click', () => this.applyTemplate(true));
    root.querySelector('#packing-preview').addEventListener('click', () => this.preview());
    root.querySelector('#packing-translate-all')?.addEventListener('click', () => this.translateAll());
  }

  onEditorInput(event) {
    const { target } = event;
    if (target.id === 'personal-bulk') {
      this.markDirty();
      this.showBulkPreview(target.value);
      return;
    }
    if (target.matches('[data-language], #packing-source')) { return; }
    const other = this.sourceLocale === 'fr' ? 'en' : 'fr';
    // The team's other language no longer matches this text; translating it again fills it in.
    if (target.matches('[data-field^="label_"]')) {
      target.closest('[data-item-key]').querySelector(`[data-field="label_${other}"]`).value = '';
      target.removeAttribute('aria-invalid');
      const error = target.closest('[data-item-key]').querySelector('[data-row-error]');
      error.hidden = true;
      error.textContent = '';
    }
    if (target.id === 'personal-notes') { target.form.elements.namedItem(`personal_notes_${other}`).value = ''; }
    if (target.matches('[data-field="quantity"]')) { target.removeAttribute('aria-invalid'); }
    this.markDirty(target.matches('[data-field^="label_"], #personal-notes'));
  }

  onEditorChange(event) {
    const { target } = event;
    if (target.matches('[data-field="catalog_item_id"]') && target.value) {
      const article = (this.data.catalog || []).find((item) => item.id === Number(target.value));
      if (article) {
        const row = target.closest('[data-item-key]');
        const other = this.sourceLocale === 'fr' ? 'en' : 'fr';
        row.querySelector(`[data-field="label_${this.sourceLocale}"]`).value = article.name;
        row.querySelector(`[data-field="label_${other}"]`).value = '';
        this.markDirty(true);
      }
    }
    if (target.matches('[data-field="category"]')) {
      // The item moves to its new group; its options stay open on it.
      const key = target.closest('[data-item-key]').dataset.itemKey;
      this.syncDraft();
      this.markDirty();
      this.rerender(`${rowSelector(key)} [data-field="category"]`);
    }
  }

  onEditorClick(event) {
    const translation = event.target.closest('[data-edit-translation]');
    if (translation) { this.editTranslation(translation.dataset.editTranslation); return; }
    const row = event.target.closest('[data-item-key]');
    if (!row) { return; }
    if (event.target.closest('[data-toggle-panel]')) { this.togglePanel(row); return; }
    const move = event.target.closest('[data-move]');
    if (move) { this.moveItem(row.dataset.itemKey, Number(move.dataset.move)); return; }
    if (event.target.closest('[data-remove-item]')) { this.removeItem(row); }
  }

  togglePanel(row) {
    const button = row.querySelector('[data-toggle-panel]');
    const panel = row.querySelector('.packing-item__panel');
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    this.openPanel = open ? row.dataset.itemKey : null;
  }

  /**
   * Move an item one place within its category (the keyboard alternative to dragging).
   * @param {string} key
   * @param {number} direction - -1 up, 1 down
   */
  moveItem(key, direction) {
    this.syncDraft();
    const items = this.draft.items;
    const index = items.findIndex((item) => item.key === key);
    const category = itemCategory(items[index]);
    const siblings = items.map((item, position) => ({ item, position })).filter(({ item }) => itemCategory(item) === category);
    const place = siblings.findIndex(({ item }) => item.key === key);
    const target = siblings[place + direction];
    if (!target) { return; }
    [items[index], items[target.position]] = [items[target.position], items[index]];
    this.markDirty();
    // Keep focus on the button just used; at the end of its group, on the other one.
    const row = rowSelector(key);
    this.rerender(`${row} [data-move="${direction}"]:not(:disabled)`, `${row} [data-move]:not(:disabled)`, `${row} [data-toggle-panel]`);
  }

  removeItem(row) {
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    this.updateItemCount();
    this.markDirty(true);
    (next?.querySelector('textarea') || this.root().querySelector('#personal-add-item')).focus();
  }

  /**
   * Re-render from the draft and put focus back on the control that was used.
   * @param {...string} focusSelectors - Tried in order; the first match receives focus
   */
  rerender(...focusSelectors) {
    this.renderEditor();
    const target = focusSelectors.map((selector) => this.root().querySelector(selector)).find(Boolean);
    target?.focus();
  }

  /** Read every field into the draft before a re-render. */
  syncDraft() { this.draft = { ...this.draft, ...this.readEditor() }; }

  readEditor() {
    const form = this.root().querySelector('#personal-equipment-form');
    const value = (name) => form.elements.namedItem(name).value;
    return {
      season: value('personal_season'), stay_type: value('personal_stay'), nights: Number(value('personal_nights')),
      notes_fr: value('personal_notes_fr'), notes_en: value('personal_notes_en'),
      published: false, reviewed: false, expected_version: this.draft.version,
      items: [...form.querySelectorAll('[data-item-key]')].map((row) => {
        const field = (key) => row.querySelector(`[data-field="${key}"]`).value;
        return {
          key: row.dataset.itemKey, label_fr: field('label_fr'), label_en: field('label_en'), quantity: Number(field('quantity')),
          category: field('category'), catalog_item_id: field('catalog_item_id') ? Number(field('catalog_item_id')) : null,
        };
      }),
    };
  }

  updateItemCount() {
    this.root().querySelector('#packing-count').textContent = String(this.root().querySelectorAll('[data-item-key]').length);
  }

  /** Prepared translations stay: saving keeps every unchanged item and leaves only edited text to translate again. */
  markDirty(textChanged = false) {
    this.dirty = true;
    this.root().querySelector('#packing-save-status').textContent = translate('packing_unsaved_status');
    if (textChanged && this.translations.size) {
      this.root().querySelector('#packing-translation-status').textContent = translate('packing_translations_stale');
    }
  }

  showBulkPreview(text) {
    const items = bulkPackingItems(text, PERSONAL_EQUIPMENT.MAX_QUANTITY);
    this.root().querySelector('#packing-bulk-count').textContent = translate('packing_bulk_count').replace('{count}', String(items.length));
    const preview = items.slice(0, PERSONAL_EQUIPMENT.BULK_PREVIEW_ITEMS)
      .map((item) => `<li>${Number(item.quantity)} × ${escapeHTML(item.label)}</li>`).join('');
    setContent(this.root().querySelector('#packing-bulk-preview'), `<ul>${preview}</ul>`);
  }

  /** Text waiting in the bulk area is never lost silently: say so and send focus there. */
  pendingBulk() {
    const input = this.root().querySelector('#personal-bulk');
    if (!input.value.trim()) { return false; }
    this.root().querySelector('#personal-equipment-validation').textContent = translate('packing_bulk_pending');
    const panel = this.root().querySelector('#packing-bulk-panel');
    panel.hidden = false;
    this.root().querySelector('#packing-bulk-toggle').setAttribute('aria-expanded', 'true');
    input.focus();
    return true;
  }

  addBulk() {
    const text = this.root().querySelector('#personal-bulk').value;
    const input = this.readEditor();
    const labels = bulkPackingLines(text);
    if (labels.some((label) => label.length > PERSONAL_EQUIPMENT.LABEL_MAX) || input.items.length + labels.length > PERSONAL_EQUIPMENT.MAX_ITEMS) {
      this.root().querySelector('#personal-equipment-validation').textContent = translate('personal_equipment_bulk_invalid');
      return;
    }
    if (!labels.length) { return; }
    const lang = this.sourceLocale;
    const additions = bulkPackingItems(text, PERSONAL_EQUIPMENT.MAX_QUANTITY).map(({ label, quantity }) => ({
      key: newItemKey(), label_fr: lang === 'fr' ? label : '', label_en: lang === 'en' ? label : '', quantity, category: 'other', catalog_item_id: null,
    }));
    this.draft = { ...this.draft, ...input, items: [...input.items, ...additions] };
    this.markDirty(true);
    this.rerender(`${rowSelector(additions[0].key)} textarea`);
  }

  addItem() {
    if (this.pendingBulk()) { return; }
    const input = this.readEditor();
    if (input.items.length >= PERSONAL_EQUIPMENT.MAX_ITEMS) { return; }
    const item = { key: newItemKey(), label_fr: '', label_en: '', quantity: 1, category: 'other', catalog_item_id: null };
    this.draft = { ...this.draft, ...input, items: [...input.items, item] };
    this.markDirty(true);
    this.rerender(`${rowSelector(item.key)} textarea`);
  }

  async applyTemplate(replace) {
    if (this.pendingBulk()) { return; }
    const input = this.readEditor();
    if (!Number.isInteger(input.nights) || input.nights < 0 || input.nights > PERSONAL_EQUIPMENT.MAX_NIGHTS) { return; }
    if (replace && !await confirm({ title: this.title(), message: translate('personal_equipment_replace_confirm') })) { return; }
    if (!this.active()) { return; }
    const suggestions = personalEquipmentTemplate(input.season, input.nights, input.stay_type);
    const keys = new Set(input.items.map((item) => item.key));
    this.draft = { ...this.draft, ...input, items: replace ? suggestions : [...input.items, ...suggestions.filter((item) => !keys.has(item.key))] };
    this.markDirty(true);
    this.rerender('#personal-apply-template');
  }

  /** Name and focus the first invalid row, or the settings, before anything is sent. */
  validateEditor(input) {
    const form = this.root().querySelector('#personal-equipment-form');
    let first = null;
    form.querySelectorAll('[data-item-key]').forEach((row, index) => {
      const item = input.items[index];
      const labelInvalid = !item[`label_${this.sourceLocale}`].trim();
      const quantityInvalid = !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > PERSONAL_EQUIPMENT.MAX_QUANTITY;
      const message = row.querySelector('[data-row-error]');
      row.querySelectorAll('[aria-invalid]').forEach((element) => element.removeAttribute('aria-invalid'));
      message.hidden = !labelInvalid && !quantityInvalid;
      message.textContent = message.hidden ? '' : translate(labelInvalid ? 'packing_label_required' : 'packing_quantity_invalid');
      if (labelInvalid || quantityInvalid) {
        const field = row.querySelector(labelInvalid ? 'textarea' : '[data-field="quantity"]');
        field.setAttribute('aria-invalid', 'true');
        first ||= field;
      }
    });
    if (first) { first.focus(); return false; }
    const nightsValid = Number.isInteger(input.nights) && input.nights >= 0 && input.nights <= PERSONAL_EQUIPMENT.MAX_NIGHTS
      && (input.stay_type === 'day' ? input.nights === 0 : input.nights >= 1);
    if (!input.items.length || !nightsValid) {
      this.root().querySelector('#personal-equipment-validation').textContent = translate('personal_equipment_invalid');
      const nights = form.elements.namedItem('personal_nights');
      nights.closest('details').open = true;
      nights.setAttribute('aria-invalid', 'true');
      nights.focus();
      return false;
    }
    return true;
  }

  async save(publish = false) {
    if (!this.active() || this.busy || this.pendingBulk()) { return false; }
    const input = this.readEditor();
    if (!this.validateEditor(input)) { return false; }
    if (publish && !await confirm({ title: translate('packing_publish'), message: translate('packing_publish_confirm') })) { return false; }
    if (!this.active()) { return false; }
    input.published = publish;
    input.reviewed = publish;
    this.busy = true;
    const form = this.root().querySelector('#personal-equipment-form');
    const fieldset = form.querySelector('fieldset');
    fieldset.disabled = true;
    try {
      const result = await withFormBusy(form, () => savePersonalEquipment(this.meetingId, input));
      if (!this.active()) { return false; }
      if (result?.queued) { throw new Error('Unconfirmed checklist'); }
      this.dirty = false;
      this.app.showMessage(translate(publish ? 'packing_published_status' : 'personal_equipment_saved'), 'success');
      await this.init();
      return Boolean(this.root()?.querySelector('#personal-equipment-form'));
    } catch (err) {
      if (this.active()) { this.app.showMessage(apiErrorMessage(err, 'personal_equipment_save_failed'), 'error'); }
      return false;
    } finally {
      this.busy = false;
      fieldset.disabled = false;
    }
  }

  /** Show exactly what a family will see: notes, categories and checkboxes, in the writing language. */
  preview() {
    if (this.pendingBulk()) { return; }
    const list = this.readEditor();
    const lang = this.sourceLocale;
    const groups = groupByCategory(list.items).map((group) => `<h3>${escapeHTML(this.categoryName(group.category))}</h3>
      <ul class="personal-equipment__list">${group.items.map((item) => `<li><label class="personal-equipment__check">
        <input type="checkbox"> <span dir="auto">${Number(item.quantity) > 1 ? `${Number(item.quantity)} × ` : ''}${escapeHTML(item[`label_${lang}`])}</span></label></li>`).join('')}</ul>`).join('');
    this.modal = openModal({
      title: translate('packing_preview'),
      body: `<div class="personal-equipment personal-equipment--preview"><p>${escapeHTML(translate('packing_preview_hint'))}</p>
        <p class="personal-equipment__notes" dir="auto">${escapeHTML(list[`notes_${lang}`])}</p>${groups}</div>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('close'))}</button>`,
    });
  }

  async translateAll() {
    if (!canUseAI() || this.busy || this.pendingBulk()) { return; }
    const languages = [...this.root().querySelectorAll('[data-language]:checked')].map((input) => input.dataset.language);
    if (!languages.length) {
      this.root().querySelector('#packing-translation-status').textContent = translate('packing_choose_languages');
      return;
    }
    if ((this.dirty || !this.draft.version) && !await this.save(false)) { return; }
    this.busy = true;
    const failures = [];
    const form = this.root().querySelector('#personal-equipment-form');
    form.querySelector('fieldset').disabled = true;
    await withFormBusy(form, async () => {
      // One language at a time, so progress names the language being prepared.
      await languages.reduce(async (previous, language) => {
        await previous;
        if (!this.active() || isComplete(this.translations.get(language))) { return; }
        this.root().querySelector('#packing-translation-status').textContent = translate('packing_translating_language').replace('{language}', this.languageName(language));
        try {
          const result = await translatePersonalEquipment(this.meetingId, language);
          if (this.active()) { this.translations.set(language, result.data); }
        } catch (err) {
          failures.push(language);
          if (this.active()) { this.app.showMessage(apiErrorMessage(err, 'personal_equipment_translation_failed'), 'error'); }
        }
      }, Promise.resolve());
    });
    this.draft.published = false;
    this.busy = false;
    form.querySelector('fieldset').disabled = false;
    if (!this.active()) { return; }
    this.rerender('#packing-translate-all');
    if (failures.length) {
      this.root().querySelector('#packing-translation-status').textContent = translate('packing_translation_failures')
        .replace('{languages}', failures.map((code) => this.languageName(code)).join(', '));
    }
  }

  async editTranslation(language) {
    if (this.dirty && !await this.save(false)) { return; }
    const content = this.translations.get(language);
    if (!isComplete(content) || this.busy || this.dirty) { return; }
    const expectedVersion = this.draft.version;
    let saving = false;
    let changed = false;
    let confirming = false;
    const fields = content.items.map((item, index) => {
      const source = this.draft.items.find((entry) => entry.key === item.key)?.[`label_${this.sourceLocale}`] || item.key;
      return `<label for="packing-translated-${index}">${escapeHTML(source)}</label>
        <input id="packing-translated-${index}" data-translated-key="${escapeAttribute(item.key)}" value="${escapeAttribute(item.label)}" maxlength="${PERSONAL_EQUIPMENT.LABEL_MAX}" required>`;
    }).join('');
    const modal = openModal({
      title: `${translate('packing_edit_translation')} — ${escapeHTML(this.languageName(language))}`,
      onClose: () => { this.translationDirty = false; },
      canClose: () => {
        if (saving || confirming) { return false; }
        if (!changed) { return true; }
        confirming = true;
        confirm({ title: this.title(), message: translate('packing_unsaved') }).then((approved) => {
          if (approved && this.active()) { changed = false; modal.close(true); }
        }).finally(() => { confirming = false; });
        return false;
      },
      body: `<form id="packing-translation-edit"><label for="packing-translation-notes">${escapeHTML(translate('packing_instructions'))}</label>
        <textarea id="packing-translation-notes" maxlength="${PERSONAL_EQUIPMENT.NOTES_MAX}">${escapeHTML(content.notes)}</textarea>${fields}</form>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="submit" class="button button--primary" form="packing-translation-edit">${escapeHTML(translate('save'))}</button>`,
    });
    this.modal = modal;
    const form = modal.overlay.querySelector('form');
    form.addEventListener('input', () => { changed = true; this.translationDirty = true; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) { return; }
      saving = true;
      const translated = {
        notes: form.querySelector('textarea').value,
        items: [...form.querySelectorAll('[data-translated-key]')].map((input) => ({ key: input.dataset.translatedKey, label: input.value.trim() })),
      };
      const controls = [...form.elements];
      controls.forEach((control) => { control.disabled = true; });
      this.busy = true;
      try {
        const result = await withFormBusy(form, () => editPersonalEquipmentTranslation(this.meetingId, language,
          { expected_version: expectedVersion, expected_content: content, content: translated }));
        if (this.active()) { this.translations.set(language, result.data || translated); this.draft.published = false; this.renderEditor(); }
        changed = false;
        modal.close(true);
      } catch (err) {
        this.app.showMessage(apiErrorMessage(err, 'personal_equipment_save_failed'), 'error');
      } finally {
        saving = false;
        this.busy = false;
        controls.forEach((control) => { control.disabled = false; });
      }
    });
  }

  // --- Family view -------------------------------------------------------------------------

  progressText(child) {
    const total = this.data.list.items.length;
    const packed = this.data.list.items.filter((item) => child.checked_keys.includes(item.key)).length;
    return translate('personal_equipment_progress').replace('{packed}', String(packed)).replace('{total}', String(total));
  }

  childMarkup(child) {
    const items = this.data.list.items;
    const packed = items.filter((item) => child.checked_keys.includes(item.key)).length;
    const headingId = `personal-child-${Number(child.id)}`;
    const groups = groupByCategory(items).map((group) => `<h3>${escapeHTML(this.categoryName(group.category))}</h3>
      <ul class="personal-equipment__list">${group.items.map((item) => {
    const checked = child.checked_keys.includes(item.key);
    const id = `personal-check-${Number(child.id)}-${escapeAttribute(item.key)}`;
    return `<li class="${checked ? 'is-packed' : ''}"><label class="personal-equipment__check" for="${id}">
          <input type="checkbox" id="${id}" data-child="${Number(child.id)}" data-key="${escapeAttribute(item.key)}" data-archive-safe ${checked ? 'checked' : ''}>
          <span dir="auto">${escapeHTML(this.quantityText(item))}${escapeHTML(this.text(item))}</span></label></li>`;
  }).join('')}</ul>`).join('');
    return `<section class="personal-equipment__child" aria-labelledby="${headingId}" data-child-section="${Number(child.id)}">
      <h2 id="${headingId}">${escapeHTML(`${child.first_name} ${child.last_name}`)}</h2>
      <p class="personal-equipment__progress"><span id="${headingId}-progress" data-progress-text>${escapeHTML(this.progressText(child))}</span>
        <progress max="${items.length}" value="${packed}" aria-labelledby="${headingId} ${headingId}-progress"></progress></p>
      <p class="personal-equipment__done" data-all-packed ${packed === items.length ? '' : 'hidden'}>${escapeHTML(translate('personal_equipment_all_packed'))}</p>
      ${groups}</section>`;
  }

  /** Render only locally saved checks; no child progress API exists. */
  renderFamily() {
    if (!this.active()) { return; }
    const { list, children } = this.data;
    const languages = this.availableLanguages().map((code) => `<option value="${code}" ${code === this.targetLanguage ? 'selected' : ''}>
      ${escapeHTML(this.languageName(code))}</option>`).join('');
    const translatedHint = this.translations.has(this.targetLanguage) ? 'personal_equipment_translated' : 'packing_parent_translation_hint';
    setContent(this.root(), `<section class="page personal-equipment ${this.hidePacked ? 'personal-equipment--hide-packed' : ''}">${this.header()}
      ${this.text(list, 'notes') ? `<p class="personal-equipment__notes" dir="auto">${escapeHTML(this.text(list, 'notes'))}</p>` : ''}
      <p class="personal-equipment__local">${escapeHTML(translate('personal_equipment_local_only'))}</p>
      <div class="personal-equipment__tools">
        <div><label for="personal-language">${escapeHTML(translate('personal_equipment_language'))}</label>
          <select id="personal-language" data-archive-safe>${languages}</select>
          <p id="personal-translation-status" class="personal-equipment__hint">${escapeHTML(translate(translatedHint))}</p></div>
        <label class="personal-equipment__check"><input type="checkbox" id="personal-hide-packed" data-archive-safe ${this.hidePacked ? 'checked' : ''}>
          ${escapeHTML(translate('personal_equipment_hide_packed'))}</label>
        <button type="button" id="personal-equipment-print" class="button button--secondary" data-archive-safe>${escapeHTML(translate('print'))}</button>
      </div>
      <p id="personal-equipment-storage-status" role="status"></p>
      ${children.length ? children.map((child) => this.childMarkup(child)).join('') : `<p>${escapeHTML(translate('personal_equipment_no_children'))}</p>`}</section>`);
    this.bindFamily();
  }

  bindFamily() {
    const root = this.root();
    root.querySelectorAll('[data-child]').forEach((checkbox) => checkbox.addEventListener('change', () => this.onCheck(checkbox)));
    root.querySelector('#personal-language').addEventListener('change', (event) => {
      if (!this.active()) { return; }
      this.targetLanguage = event.target.value;
      this.writePreference(this.languageKey, this.targetLanguage);
      this.renderFamily();
      this.root().querySelector('#personal-language').focus();
    });
    root.querySelector('#personal-hide-packed').addEventListener('change', (event) => {
      this.hidePacked = event.target.checked;
      this.writePreference(this.hidePackedKey, String(this.hidePacked));
      root.querySelector('.personal-equipment').classList.toggle('personal-equipment--hide-packed', this.hidePacked);
    });
    root.querySelector('#personal-equipment-print').addEventListener('click', () => this.print());
  }

  /** Save one tick on this device; a refused write puts the box back and says so once. */
  onCheck(checkbox) {
    if (!this.active()) { return; }
    const child = this.data.children.find((entry) => entry.id === Number(checkbox.dataset.child));
    const status = this.root().querySelector('#personal-equipment-storage-status');
    try {
      child.checked_keys = [...writePacking(this.packingKeyFor(child), checkbox.dataset.key, checkbox.checked)];
      status.textContent = '';
    } catch {
      checkbox.checked = child.checked_keys.includes(checkbox.dataset.key);
      status.textContent = translate('personal_equipment_local_failed');
    }
    checkbox.closest('li').classList.toggle('is-packed', checkbox.checked);
    const section = checkbox.closest('[data-child-section]');
    const packed = this.data.list.items.filter((item) => child.checked_keys.includes(item.key)).length;
    section.querySelector('[data-progress-text]').textContent = this.progressText(child);
    section.querySelector('progress').value = packed;
    section.querySelector('[data-all-packed]').hidden = packed !== this.data.list.items.length;
  }

  print() {
    const printWindow = openPrintWindow();
    const { list, children } = this.data;
    const childList = (child) => groupByCategory(list.items).map((group) => `<h3>${escapeHTML(this.categoryName(group.category))}</h3>
      <ul>${group.items.map((item) => `<li>${child.checked_keys.includes(item.key) ? '☑' : '☐'} ${escapeHTML(this.quantityText(item))}${escapeHTML(this.text(item))}</li>`).join('')}</ul>`).join('');
    const html = `<h1>${escapeHTML(this.title())}</h1><h2>${escapeHTML(this.data.camp.theme || '')}</h2><p>${escapeHTML(this.text(list, 'notes'))}</p>
      ${children.map((child) => `<h2>${escapeHTML(`${child.first_name} ${child.last_name}`)}</h2>${childList(child)}`).join('')}`;
    if (!setPrintContent(printWindow, html, this.title(), { styles: REPORT_PRINT_STYLES })) {
      this.app.showMessage(translate('personal_equipment_print_blocked'), 'error');
      return;
    }
    printWindow.print();
  }
}
