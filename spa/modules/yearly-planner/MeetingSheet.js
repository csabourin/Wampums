// MeetingSheet.js
// The zoomed-in view of a single date: what is pertinent to that night only.
//
// Deliberately light. Full preparation (participants, animateurs, badge
// templates, honors history, the AI helper) lives in MeetingPrep and is reached
// by deep link, so opening a date from the year view stays instant and there is
// only ever one writer of the meeting row on screen.
import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { openModal } from '../../utils/ModalUtils.js';

/**
 * Open the sheet for one date.
 *
 * @param {Object} options - Sheet options
 * @param {Object} options.chip - Chip descriptor from the model
 * @param {Object} options.plan - The current plan (for period choices and the back link)
 * @param {string} options.lang - Language code
 * @param {boolean} options.canManage - Whether write controls are shown
 * @param {Function} options.onSave - async ({ theme, location, period_id, is_cancelled }) => void
 * @param {Function} options.onDelete - async () => void
 * @param {Function} options.onOpenPrep - (date) => void
 * @param {Function} [options.onUnlinkActivity] - async () => void
 * @param {Function} [options.onRemoveSeries] - async (series) => void
 * @param {Function} [options.onEditSeries] - (series) => void
 * @param {Function} [options.onOpenSchedule] - (chip) => void
 * @returns {{overlay: HTMLElement, close: Function}} Modal handle
 */
export function openMeetingSheet(options) {
  const { chip, plan, lang, canManage } = options;

  const modal = openModal({
    id: 'yp-meeting-sheet',
    title: escapeHTML(sheetTitle(chip, lang)),
    body: renderSheetBody(chip, plan, lang, canManage),
    footer: renderSheetFooter(chip, canManage)
  });

  wireSheet(modal, options);
  return modal;
}

/**
 * @param {Object} chip - Chip descriptor
 * @param {string} lang - Language code
 * @returns {string} Human title for the sheet
 */
function sheetTitle(chip, lang) {
  if (chip.spanDays > 1 && chip.spanEndDate) {
    return `${formatDate(chip.date, lang)} — ${formatDate(chip.spanEndDate, lang)}`;
  }
  return formatDate(chip.date, lang);
}

/**
 * @param {Object} chip - Chip descriptor
 * @param {Object} plan - Current plan
 * @param {string} lang - Language code
 * @param {boolean} canManage - Whether inputs are editable
 * @returns {string} Body HTML
 */
function renderSheetBody(chip, plan, lang, canManage) {
  const periods = Array.isArray(plan?.periods) ? plan.periods : [];
  const disabled = canManage ? '' : 'disabled';

  return `
    <div class="yp-sheet">
      ${chip.spanDays > 1 ? `
        <p class="yp-sheet__span">
          <i class="fas fa-tents" aria-hidden="true"></i>
          ${chip.spanDays} ${escapeHTML(translate('days'))}
        </p>
      ` : ''}

      <label class="form-group">
        <span>${escapeHTML(translate('yearly_planner_theme'))}</span>
        <input type="text" id="yp-sheet-theme" maxlength="255"
               value="${escapeHTML(chip.theme || '')}" ${disabled}>
      </label>

      <label class="form-group">
        <span>${escapeHTML(translate('yearly_planner_location'))}</span>
        <input type="text" id="yp-sheet-location" maxlength="500"
               value="${escapeHTML(chip.location || '')}" ${disabled}>
      </label>

      ${periods.length > 0 ? `
        <label class="form-group">
          <span>${escapeHTML(translate('yearly_planner_period'))}</span>
          <select id="yp-sheet-period" ${disabled}>
            <option value="">${escapeHTML(translate('yearly_planner_no_period'))}</option>
            ${periods.map(period => `
              <option value="${period.id}" ${String(chip.periodId) === String(period.id) ? 'selected' : ''}>
                ${escapeHTML(period.title)}
              </option>
            `).join('')}
          </select>
        </label>
      ` : ''}

      <label class="yp-sheet__toggle">
        <input type="checkbox" id="yp-sheet-cancelled" ${chip.isCancelled ? 'checked' : ''} ${disabled}>
        <span>${escapeHTML(translate('yearly_planner_cancelled'))}</span>
      </label>

      ${renderSeries(chip, canManage)}
      ${renderSheetStatus(chip)}
    </div>
  `;
}

/**
 * Render every series occurrence placed on this date.
 * @param {Object} chip - Chip descriptor
 * @param {boolean} canManage - Whether removal controls are shown
 * @returns {string} HTML
 */
function renderSeries(chip, canManage) {
  if (!Array.isArray(chip.series) || chip.series.length === 0) {
    return '';
  }

  return `
    <section class="yp-sheet__series">
      <h4>${escapeHTML(translate('yearly_planner_series'))}</h4>
      <ul>
        ${chip.series.map(series => `
          <li>
            <span>
              ${escapeHTML(series.label || translate('yearly_planner_series'))}
              <strong>${Number(series.occurrence) || 1} / ${Number(series.total) || 1}</strong>
            </span>
            ${canManage ? `
              <span>
                <button type="button" class="button button--small button--secondary yp-sheet-series-edit"
                        data-series-id="${escapeHTML(series.id)}">${escapeHTML(translate('edit'))}</button>
                <button type="button" class="button button--small button--danger yp-sheet-series-remove"
                        data-series-id="${escapeHTML(series.id)}">${escapeHTML(translate('remove'))}</button>
              </span>
            ` : ''}
          </li>
        `).join('')}
      </ul>
    </section>
  `;
}

/**
 * Consent and transport status, with links out to the pages that own them.
 * @param {Object} chip - Chip descriptor
 * @returns {string} HTML
 */
function renderSheetStatus(chip) {
  if (!chip.activityId) {
    return '';
  }

  const rows = [];
  if (chip.consent) {
    rows.push(`
      <li>
        <i class="fas fa-file-signature" aria-hidden="true"></i>
        ${escapeHTML(translate('yearly_planner_consent_signed'))}:
        <strong>${chip.consent.signed}/${chip.consent.total}</strong>
        <a href="/permission-slips">${escapeHTML(translate('view'))}</a>
      </li>
    `);
  }
  if (chip.carpool) {
    rows.push(`
      <li>
        <i class="fas fa-car" aria-hidden="true"></i>
        ${escapeHTML(translate('yearly_planner_transport_offers'))}:
        <strong>${chip.carpool.offers}</strong>
        <a href="/carpool/${chip.activityId}">${escapeHTML(translate('view'))}</a>
      </li>
    `);
  }
  if (rows.length === 0) {
    rows.push(`<li>${escapeHTML(translate('yearly_planner_activity_linked'))}</li>`);
  }

  return `
    <div class="yp-sheet__status">
      <h4>${escapeHTML(translate('yearly_planner_logistics'))}</h4>
      <ul>${rows.join('')}</ul>
    </div>
  `;
}

/**
 * @param {Object} chip - Chip descriptor
 * @param {boolean} canManage - Whether write actions are offered
 * @returns {string} Footer HTML
 */
function renderSheetFooter(chip, canManage) {
  const buttons = [];

  if (chip.meetingId) {
    buttons.push(`
      <button type="button" class="button button--primary" id="yp-sheet-prep">
        <i class="fas fa-clipboard-list" aria-hidden="true"></i>
        ${escapeHTML(translate('yearly_planner_open_prep'))}
      </button>
    `);
  }
  if (chip.meetingId && chip.spanDays > 1) {
    buttons.push(`
      <button type="button" class="button button--secondary" id="yp-sheet-schedule">
        <i class="fas fa-calendar-days" aria-hidden="true"></i>
        ${escapeHTML(translate('yearly_planner_camp_schedule'))}
      </button>
    `);
  }
  if (canManage && chip.meetingId) {
    buttons.push(`
      <button type="button" class="button button--secondary" id="yp-sheet-save">
        ${escapeHTML(translate('save'))}
      </button>
    `);
    if (chip.activityId) {
      buttons.push(`
        <button type="button" class="button button--ghost" id="yp-sheet-unlink">
          ${escapeHTML(translate('yearly_planner_unlink_activity'))}
        </button>
      `);
    }
    buttons.push(`
      <button type="button" class="button button--danger" id="yp-sheet-delete">
        ${escapeHTML(translate('delete'))}
      </button>
    `);
  }

  return buttons.join('');
}

/**
 * Attach the sheet's own handlers.
 * @param {Object} modal - openModal() handle
 * @param {Object} options - Sheet options
 * @returns {void}
 */
function wireSheet(modal, options) {
  const {
    chip, onSave, onDelete, onOpenPrep, onUnlinkActivity,
    onRemoveSeries, onEditSeries, onOpenSchedule
  } = options;
  const root = modal.overlay;

  root.querySelector('#yp-sheet-prep')?.addEventListener('click', () => {
    modal.close();
    onOpenPrep?.(chip.date);
  });

  root.querySelector('#yp-sheet-schedule')?.addEventListener('click', () => {
    modal.close();
    onOpenSchedule?.(chip);
  });

  root.querySelectorAll('.yp-sheet-series-remove').forEach((button) => {
    button.addEventListener('click', async () => {
      const series = chip.series.find(item => item.id === button.dataset.seriesId);
      if (!series) {
        return;
      }
      modal.close();
      await onRemoveSeries?.(series);
    });
  });
  root.querySelectorAll('.yp-sheet-series-edit').forEach((button) => {
    button.addEventListener('click', () => {
      const series = chip.series.find(item => item.id === button.dataset.seriesId);
      if (!series) {
        return;
      }
      modal.close();
      onEditSeries?.(series);
    });
  });

  root.querySelector('#yp-sheet-save')?.addEventListener('click', async () => {
    const periodSelect = root.querySelector('#yp-sheet-period');
    // An absent key means "leave alone" server-side, so only send what the
    // sheet actually shows.
    const payload = {
      theme: root.querySelector('#yp-sheet-theme')?.value ?? '',
      location: root.querySelector('#yp-sheet-location')?.value ?? '',
      is_cancelled: root.querySelector('#yp-sheet-cancelled')?.checked === true
    };
    if (periodSelect) {
      payload.period_id = periodSelect.value ? parseInt(periodSelect.value, 10) : null;
    }
    modal.close();
    await onSave?.(payload);
  });

  root.querySelector('#yp-sheet-unlink')?.addEventListener('click', async () => {
    modal.close();
    await onUnlinkActivity?.();
  });

  root.querySelector('#yp-sheet-delete')?.addEventListener('click', async () => {
    modal.close();
    await onDelete?.();
  });
}
