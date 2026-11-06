/**
 * Reuse an earlier camp: pick it, tick what to bring over (site, schedule,
 * personal packing list, equipment lots, tasks, written plan sections), and see what was copied. Dates follow
 * the new camp; nothing that belonged to the earlier stay or to a person comes
 * along (#1256). Each part is offered only when it can be copied, and says why
 * when it cannot.
 *
 * @module spa/modules/yearly-planner/CampDuplication
 */
import { translate } from '../../app.js';
import rules from '../../../config/camp_duplication.json';
import { setContent, withFormBusy, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { hasAllPermissions, hasOrganizationScope, hasPermission } from '../../utils/PermissionUtils.js';
import { getCampDuplication, duplicateCamp } from '../../api/api-yearly-planner.js';
import { getCampReviewHistory } from '../../api/api-camp-reviews.js';
import { lessonsListMarkup } from '../camp-review/CampLessons.js';
import lessonStyles from '../../../css/camp-lessons.css?url';

const FORM_ID = 'yp-camp-duplicate-form';

/** @returns {boolean} Whether the signed-in person holds the rights a part takes */
function canCopy(part) {
  return hasAllPermissions(rules.BASE_PERMISSION, ...(rules.PART_PERMISSIONS[part] || []))
    && (!rules.ORGANIZATION_SCOPE_PARTS.includes(part) || hasOrganizationScope());
}

/** @returns {string} A translated text with its {placeholders} filled */
function fill(key, values) {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    translate(key)
  );
}

export class CampDuplication {
  /**
   * @param {Object} app - Application instance
   * @param {{meetingId: number, lang: string, onDone?: Function}} options
   */
  constructor(app, { meetingId, lang, onDone = null }) {
    this.app = app;
    this.meetingId = Number(meetingId);
    this.lang = lang;
    this.onDone = onDone;
    this.data = null;
    this.sourceId = null;
    // What each earlier camp's closed review kept and fixed (#1257), by camp; null when it could not be read.
    this.lessons = new Map();
    this.lessonsFailed = false;
    this.modal = null;
    this.saving = false;
  }

  /** Open the dialog and load what can be reused. */
  async open() {
    this.modal = openModal({
      id: 'yp-camp-duplicate',
      title: escapeHTML(translate('camp_duplicate_title')),
      body: `<p role="status">${escapeHTML(translate('loading'))}</p>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('close'))}</button>`,
      closeOnBackdrop: false,
      canClose: () => !this.saving,
    });
    await this.load();
  }

  /** @returns {HTMLElement|null} The dialog body, while the dialog is open */
  body() {
    return this.modal?.overlay.isConnected ? this.modal.overlay.querySelector('.modal-body') : null;
  }

  /** @param {string} html - Footer markup */
  setFooter(html) {
    const footer = this.modal?.overlay.querySelector('.modal-footer');
    if (footer) {
      setContent(footer, html);
      // The dialog wired its own close buttons when it opened; these are new.
      footer.querySelectorAll('[data-modal-close]').forEach((button) => {
        button.addEventListener('click', () => this.modal.close());
      });
    }
  }

  /** Read the unit's closed reviews, so the camp chosen shows what its review kept and fixed. */
  async loadLessons() {
    if (!hasPermission('camp_reviews.view')) {
      return;
    }
    loadStylesheet(lessonStyles).catch((err) => debugError('Camp lessons stylesheet failed', err));
    try {
      const response = await getCampReviewHistory();
      this.lessons = new Map((response?.data?.reviews || []).map((review) => [Number(review.camp.id), review]));
      this.lessonsFailed = false;
    } catch (err) {
      debugError('Lessons of earlier camps could not be loaded', err);
      this.lessonsFailed = true;
    }
  }

  /** @returns {string} What the chosen camp's review kept and fixed, when it was closed */
  lessonsMarkup() {
    if (!hasPermission('camp_reviews.view')) {
      return '';
    }
    if (this.lessonsFailed) {
      return `<p class="status-message warning">${escapeHTML(translate('camp_lessons_load_failed'))}</p>`;
    }
    const review = this.lessons.get(Number(this.sourceId));
    if (!review || (!review.keep.length && !review.fix.length)) {
      return '';
    }
    return `<section class="camp-lessons" aria-labelledby="yp-camp-duplicate-lessons-title">
        <h3 id="yp-camp-duplicate-lessons-title">${escapeHTML(translate('camp_duplicate_lessons'))}</h3>
        ${lessonsListMarkup(review, 'h4')}
      </section>`;
  }

  async load() {
    try {
      const [response] = await Promise.all([getCampDuplication(this.meetingId), this.loadLessons()]);
      this.data = response?.data || null;
    } catch (err) {
      debugError('Failed to load earlier camps:', err);
      this.renderError(apiErrorMessage(err, 'camp_duplicate_load_failed'));
      return;
    }
    const sources = this.data?.sources || [];
    if (!sources.some((source) => source.id === this.sourceId)) {
      this.sourceId = sources[0]?.id ?? null;
    }
    this.render();
  }

  /** @param {string} message - Translated explanation */
  renderError(message) {
    const body = this.body();
    if (!body) {
      return;
    }
    setContent(body, `
      <p class="status-message error" role="alert">${escapeHTML(message)}</p>
      <button type="button" class="button button--secondary" id="yp-camp-duplicate-retry">${escapeHTML(translate('retry'))}</button>
    `);
    body.querySelector('#yp-camp-duplicate-retry')?.addEventListener('click', () => {
      setContent(body, `<p role="status">${escapeHTML(translate('loading'))}</p>`);
      this.load();
    });
  }

  /** @returns {Object|undefined} The earlier camp chosen */
  source() {
    return this.data?.sources?.find((source) => source.id === this.sourceId);
  }

  /**
   * Why a part cannot be copied from the chosen camp, or null when it can.
   * @param {string} part
   * @returns {string|null} Translation key
   */
  unavailableReason(part) {
    const source = this.source();
    if (!canCopy(part)) {
      return 'camp_duplicate_reason_permission';
    }
    if (this.data.target.counts[part] > 0) {
      return `camp_duplicate_reason_filled_${part}`;
    }
    if (!source || !(source.counts[part] > 0)) {
      return 'camp_duplicate_reason_source_empty';
    }
    if (part === 'schedule' && !source.fits_schedule) {
      return 'camp_duplicate_reason_too_long';
    }
    return null;
  }

  /** @returns {string} Option text naming an earlier camp */
  sourceLabel(source) {
    return fill('camp_duplicate_source_option', {
      name: source.theme || translate('yearly_planner_camp'),
      date: formatDate(source.meeting_date, this.lang),
      days: Number(source.span_days),
    });
  }

  render() {
    const body = this.body();
    if (!body) {
      return;
    }
    const sources = this.data?.sources || [];
    if (this.data?.target?.is_cancelled) {
      setContent(body, `<p class="empty-state">${escapeHTML(translate('camp_duplicate_cancelled'))}</p>`);
      return;
    }
    if (!sources.length) {
      setContent(body, `<p class="empty-state">${escapeHTML(translate('camp_duplicate_empty'))}</p>`);
      return;
    }
    const source = this.source();
    const parts = rules.PARTS.map((part) => {
      const reason = this.unavailableReason(part);
      const id = `yp-camp-duplicate-part-${part}`;
      const count = Number(source?.counts?.[part]) || 0;
      return `
        <div class="yp-duplicate-part">
          <div class="checkbox-option">
            <input type="checkbox" id="${id}" name="parts" value="${part}"
                   ${reason ? 'disabled' : 'checked'}
                   ${reason ? `aria-describedby="${id}-reason"` : ''}>
            <label for="${id}">
              ${escapeHTML(translate(`camp_duplicate_part_${part}`))}
              (${escapeHTML(fill(`camp_duplicate_count_${part}`, { count }))})
            </label>
          </div>
          ${reason ? `<p class="field-hint" id="${id}-reason">${escapeHTML(translate(reason))}</p>` : ''}
        </div>
      `;
    }).join('');
    const nothingAvailable = rules.PARTS.every((part) => this.unavailableReason(part));

    setContent(body, `
      <form id="${FORM_ID}" novalidate>
        <p>${escapeHTML(translate('camp_duplicate_intro'))}</p>
        <div class="form-group">
          <label for="yp-camp-duplicate-source">${escapeHTML(translate('camp_duplicate_source'))}</label>
          <select id="yp-camp-duplicate-source">
            ${sources.map((item) => `
              <option value="${Number(item.id)}" ${item.id === this.sourceId ? 'selected' : ''}>${escapeHTML(this.sourceLabel(item))}</option>
            `).join('')}
          </select>
        </div>
        ${this.lessonsMarkup()}
        <fieldset id="yp-camp-duplicate-parts" aria-describedby="yp-camp-duplicate-parts-error">
          <legend>${escapeHTML(translate('camp_duplicate_parts'))}</legend>
          ${parts}
        </fieldset>
        <p class="field-error" id="yp-camp-duplicate-parts-error" role="alert" hidden></p>
        <p class="field-hint">${escapeHTML(translate('camp_duplicate_not_copied'))}</p>
        <p class="status-message error" id="yp-camp-duplicate-error" role="alert" hidden></p>
      </form>
    `);
    this.setFooter(`
      <button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
      <button type="submit" form="${FORM_ID}" class="button button--primary" ${nothingAvailable ? 'disabled' : ''}>
        ${escapeHTML(translate('camp_duplicate_submit'))}
      </button>
    `);
    this.wire(body);
    // The footer that held focus was just replaced: keep focus in the dialog.
    if (!this.modal.overlay.contains(document.activeElement)) {
      body.querySelector('#yp-camp-duplicate-source')?.focus();
    }
  }

  /** @param {HTMLElement} body - The freshly rendered dialog body */
  wire(body) {
    const form = body.querySelector(`#${FORM_ID}`);
    const partsError = body.querySelector('#yp-camp-duplicate-parts-error');
    body.querySelector('#yp-camp-duplicate-source')?.addEventListener('change', (event) => {
      this.sourceId = Number(event.target.value);
      this.render();
      this.body()?.querySelector('#yp-camp-duplicate-source')?.focus();
    });
    body.querySelectorAll('input[name="parts"]').forEach((input) => {
      input.addEventListener('change', () => {
        partsError.hidden = true;
        partsError.textContent = '';
      });
    });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const parts = [...form.querySelectorAll('input[name="parts"]:checked')].map((input) => input.value);
      if (!parts.length) {
        partsError.textContent = translate('camp_duplicate_parts_required');
        partsError.hidden = false;
        form.querySelector('input[name="parts"]:not(:disabled)')?.focus();
        return;
      }
      withFormBusy(form, () => this.submit(form, parts));
    });
  }

  /**
   * @param {HTMLFormElement} form
   * @param {string[]} parts
   */
  async submit(form, parts) {
    const failure = form.querySelector('#yp-camp-duplicate-error');
    failure.hidden = true;
    this.saving = true;
    let result;
    try {
      result = (await duplicateCamp(this.meetingId, { source_meeting_id: this.sourceId, parts }))?.data;
    } catch (err) {
      debugError('Failed to duplicate the camp:', err);
      failure.textContent = apiErrorMessage(err, 'camp_duplicate_failed');
      failure.hidden = false;
      return;
    } finally {
      this.saving = false;
    }
    this.onDone?.();
    this.app.showMessage(translate('camp_duplicate_done'), 'success');
    this.renderResult(result || {});
  }

  /** Show what was copied, what was left out, and what came to the person. */
  renderResult(result) {
    const body = this.body();
    if (!body) {
      return;
    }
    const copied = result.copied || {};
    const lines = [];
    if ('site' in copied) {
      lines.push(translate(copied.site ? 'camp_duplicate_result_site' : 'camp_duplicate_result_site_none'));
    }
    if ('schedule_activities' in copied) {
      lines.push(fill('camp_duplicate_result_schedule', {
        count: Number(copied.schedule_activities) || 0,
        days: Number(copied.schedule_days) || 0,
      }));
    }
    if ('packing_items' in copied) {
      lines.push(fill('camp_duplicate_result_packing_list', { count: Number(copied.packing_items) || 0 }));
    }
    if ('lots' in copied) {
      lines.push(fill('camp_duplicate_result_lots', { count: Number(copied.lots) || 0 }));
    }
    if ('tasks' in copied) {
      lines.push(fill('camp_duplicate_result_tasks', { count: Number(copied.tasks) || 0 }));
    }
    if ('plan_sections' in copied) {
      lines.push(fill('camp_duplicate_result_plan', {
        count: Number(copied.plan_sections) || 0,
        games: Number(copied.rain_games) || 0,
      }));
    }
    const skipped = Array.isArray(result.skipped_lots) ? result.skipped_lots : [];
    const reassigned = Number(result.reassigned_tasks) || 0;
    setContent(body, `
      <h3 id="yp-camp-duplicate-result" tabindex="-1">${escapeHTML(translate('camp_duplicate_done'))}</h3>
      <ul>${lines.map((line) => `<li>${escapeHTML(line)}</li>`).join('')}</ul>
      ${'packing_items' in copied ? `<p>${escapeHTML(translate('camp_duplicate_packing_draft'))}</p>` : ''}
      ${'plan_sections' in copied ? `<p>${escapeHTML(translate('camp_duplicate_plan_draft'))}</p>` : ''}
      ${skipped.length ? `
        <div class="status-message warning">
          <p>${escapeHTML(translate('camp_duplicate_lots_skipped'))}</p>
          <ul>${skipped.map((name) => `<li>${escapeHTML(name)}</li>`).join('')}</ul>
        </div>` : ''}
      ${result.site_unavailable ? `<p class="status-message warning">${escapeHTML(translate('camp_duplicate_site_archived'))}</p>` : ''}
      ${reassigned ? `<p class="status-message warning">${escapeHTML(fill('camp_duplicate_reassigned', { count: reassigned }))}</p>` : ''}
    `);
    this.setFooter(`<button type="button" class="button button--primary" data-modal-close>${escapeHTML(translate('close'))}</button>`);
    body.querySelector('#yp-camp-duplicate-result')?.focus();
  }
}
