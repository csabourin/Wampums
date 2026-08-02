// YearGridView.js
// Renders the year at a glance: one row per month showing only the dates that
// matter, with period themes as a colour band behind a run of chips.
//
// Every function here is a pure string builder. Interaction lives in
// YearlyPlanner.js, which attaches a single delegated listener to the root.
import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';

/** Icon per kind. Chips are never distinguished by colour alone. */
const KIND_ICONS = {
  regular: 'fa-campground',
  weekend: 'fa-person-hiking',
  camp: 'fa-tents',
  special: 'fa-star'
};

/**
 * Render the whole year.
 * @param {Object} model - buildYearModel() result
 * @param {Object} options - { lang, canManage }
 * @returns {string} HTML
 */
export function renderYearGrid(model, options = {}) {
  if (!model || model.months.length === 0) {
    return `
      <div class="empty-state">
        <i class="fas fa-calendar-alt empty-state__icon"></i>
        <p>${translate('yearly_planner_no_dates')}</p>
      </div>
    `;
  }

  return `
    <div class="yp-year">
      ${model.months.map(month => renderMonthRow(month, {
        ...options,
        periodsById: model.periodsById
      })).join('')}
    </div>
  `;
}

/**
 * Render one month: a band layer and a chip list sharing one grid track.
 * @param {Object} month - Month row from the model
 * @param {Object} options - { lang, canManage }
 * @returns {string} HTML
 */
export function renderMonthRow(month, options = {}) {
  const lang = options.lang || 'fr';
  const labelId = `yp-m-${month.key}`;
  // Month names come from the locale, never from translation keys.
  const label = formatDate(month.date, lang, { month: 'long', year: 'numeric' });
  const bandRows = month.bands.reduce((max, band) => Math.max(max, band.row + 1), 0);

  return `
    <section class="yp-month" data-month="${escapeHTML(month.key)}" aria-labelledby="${labelId}">
      <h3 class="yp-month__label" id="${labelId}">${escapeHTML(label)}</h3>
      <div class="yp-month__track" style="--chip-count:${month.chips.length};--band-rows:${bandRows}">
        ${renderPeriodBands(month.bands)}
        <ul class="yp-month__chips" role="list">
          ${month.chips.map(chip => renderDateChip(chip, options)).join('')}
        </ul>
      </div>
    </section>
  `;
}

/**
 * Render the band layer.
 *
 * Decorative: the period name reaches assistive technology through each chip's
 * description instead, which is per-date and therefore more useful than a band
 * announcement.
 *
 * @param {Array} bands - Band descriptors
 * @returns {string} HTML
 */
export function renderPeriodBands(bands) {
  if (!bands || bands.length === 0) {
    return '';
  }

  return `
    <div class="yp-month__bands" aria-hidden="true">
      ${bands.map(band => `
        <span class="yp-band"
              style="--band-start:${band.startIndex + 1};--band-span:${band.span};--band-row:${band.row + 1};--band-color:${escapeHTML(band.color)}">
          <span class="yp-band__title">${escapeHTML(band.title || '')}</span>
        </span>
      `).join('')}
    </div>
  `;
}

/**
 * Render one date as a real button.
 *
 * Buttons, not divs with handlers: this replaces drag and drop, so keyboard and
 * screen-reader users must get the same affordance as everyone else. aria-pressed
 * is added only while armed mode is active, because a permanent
 * aria-pressed="false" would misdescribe a navigation control.
 *
 * @param {Object} chip - Chip descriptor
 * @param {Object} options - { lang, canManage, armed }
 * @returns {string} HTML
 */
export function renderDateChip(chip, options = {}) {
  const lang = options.lang || 'fr';
  const metaId = `yp-chip-${chip.meetingId || `a${chip.activityId}`}-meta`;
  const icon = KIND_ICONS[chip.kind] || KIND_ICONS.regular;

  const classes = ['yp-chip', `yp-chip--${chip.kind}`];
  if (chip.isPrepared) { classes.push('is-prepared'); }
  if (chip.isCancelled) { classes.push('is-cancelled'); }
  if (chip.isPast) { classes.push('is-past'); }
  if (chip.isToday) { classes.push('is-today'); }
  if (chip.isEvent) { classes.push('yp-chip--event'); }

  // aria-pressed exists only while a placement is armed. Outside that, these are
  // navigation buttons, and a permanent aria-pressed="false" would misdescribe them.
  const placement = options.placement;
  const armed = placement?.isArmed === true && Boolean(chip.meetingId);
  const selected = armed && placement.isSelected(chip.meetingId);
  if (selected) { classes.push('is-selected'); }

  const weekday = chip.date
    ? formatDate(chip.date, lang, { weekday: 'short' })
    : '';

  const dayLabel = chip.spanDays > 1 && chip.spanEndDate
    ? `${chip.dayNum}–${Number(String(chip.spanEndDate).slice(8, 10))}`
    : String(chip.dayNum ?? '');
  const periodColor = options.periodsById?.[chip.periodId]?.color;
  const chipStyles = [
    chip.spanDays > 1 ? '--span-cols:2' : '',
    periodColor ? `--chip-band-color:${escapeHTML(periodColor)}` : ''
  ].filter(Boolean).join(';');

  return `
    <li class="yp-chip-slot${chip.spanDays > 1 ? ' yp-chip-slot--span' : ''}"
        style="${chipStyles}">
      <button type="button" class="${classes.join(' ')}"
              data-meeting-id="${chip.meetingId ?? ''}"
              data-activity-id="${chip.activityId ?? ''}"
              data-date="${escapeHTML(chip.date)}"
              ${armed ? `aria-pressed="${selected}"` : ''}
              aria-describedby="${metaId}">
        <span class="yp-chip__head">
          <i class="fas ${icon}" aria-hidden="true"></i>
          <span class="yp-chip__dow">${escapeHTML(weekday)}</span>
          <span class="yp-chip__day">${escapeHTML(dayLabel)}</span>
        </span>
        ${chip.theme ? `<span class="yp-chip__theme">${escapeHTML(chip.theme)}</span>` : ''}
        ${renderChipBadges(chip)}
      </button>
      <span id="${metaId}" class="visually-hidden">${escapeHTML(describeChip(chip, lang))}</span>
    </li>
  `;
}

/**
 * Visible status badges. Always icon plus text alternative, never colour alone.
 * @param {Object} chip - Chip descriptor
 * @returns {string} HTML
 */
function renderChipBadges(chip) {
  const badges = [];

  if (chip.spanDays > 1) {
    badges.push(`<span class="yp-badge yp-badge--days">${chip.spanDays}&nbsp;j</span>`);
  }
  if (chip.consent) {
    const complete = chip.consent.pending === 0;
    badges.push(`<span class="yp-badge yp-badge--consent${complete ? ' is-complete' : ''}">
      <i class="fas fa-file-signature" aria-hidden="true"></i>${chip.consent.signed}/${chip.consent.total}
    </span>`);
  }
  if (chip.carpool) {
    badges.push(`<span class="yp-badge yp-badge--carpool">
      <i class="fas fa-car" aria-hidden="true"></i>${chip.carpool.offers}
    </span>`);
  }
  if (chip.seriesIds.length > 0) {
    badges.push(`<span class="yp-badge yp-badge--series"><i class="fas fa-link" aria-hidden="true"></i></span>`);
  }
  if (chip.objectiveIds?.length > 0) {
    badges.push(`<span class="yp-badge yp-badge--objectives">
      <i class="fas fa-bullseye" aria-hidden="true"></i>${chip.objectiveIds.length}
    </span>`);
  }
  if (chip.isPrepared) {
    badges.push(`<span class="yp-badge yp-badge--prepared"><i class="fas fa-check" aria-hidden="true"></i></span>`);
  }

  if (badges.length === 0) {
    return '';
  }
  return `<span class="yp-chip__badges">${badges.join('')}</span>`;
}

/**
 * One sentence describing a chip for assistive technology.
 *
 * This is where period, consent and transport status actually reach a screen
 * reader: per date, rather than as a decorative band nobody can hear.
 *
 * @param {Object} chip - Chip descriptor
 * @param {string} lang - Language code
 * @returns {string} Plain text
 */
export function describeChip(chip, lang = 'fr') {
  const parts = [formatDate(chip.date, lang)];

  if (chip.spanDays > 1) {
    parts.push(`${translate('yearly_planner_kind_camp')} — ${chip.spanDays} ${translate('days')}`);
  }
  if (chip.isCancelled) {
    parts.push(translate('yearly_planner_cancelled'));
  }
  if (chip.theme) {
    parts.push(chip.theme);
  }
  if (chip.consent) {
    parts.push(`${translate('yearly_planner_consent_signed')}: ${chip.consent.signed}/${chip.consent.total}`);
  }
  if (chip.carpool) {
    parts.push(`${translate('yearly_planner_transport_offers')}: ${chip.carpool.offers}`);
  }
  if (chip.isPrepared) {
    parts.push(translate('yearly_planner_prepared'));
  } else if (!chip.isEvent) {
    parts.push(translate('yearly_planner_not_prepared'));
  }

  return parts.join('. ');
}

/**
 * The sticky bar shown while a placement is armed.
 *
 * Carries the only affordance for finishing or abandoning the placement, so it
 * is a labelled region rather than a decorative strip.
 *
 * @param {Object} placement - ArmedPlacement instance
 * @returns {string} HTML
 */
export function renderArmBar(placement) {
  if (!placement?.isArmed) {
    return '';
  }

  const busy = placement.state === 'committing';

  return `
    <div class="yp-armbar" role="region" aria-label="${escapeHTML(translate('yearly_planner_series_mode'))}">
      <div class="yp-armbar__what">
        <i class="fas fa-crosshairs" aria-hidden="true"></i>
        <strong>${escapeHTML(placement.activity?.name || '')}</strong>
        <span class="yp-armbar__count">${placement.count}</span>
      </div>
      <label class="yp-armbar__series">
        <input type="checkbox" id="yp-arm-series" ${placement.asSeries ? 'checked' : ''} ${busy ? 'disabled' : ''}>
        <span>${escapeHTML(translate('yearly_planner_numbered_series'))}</span>
      </label>
      <div class="yp-armbar__actions">
        <button type="button" class="button button--ghost" id="yp-arm-cancel" ${busy ? 'disabled' : ''}>
          ${escapeHTML(translate('cancel'))}
        </button>
        <button type="button" class="button button--primary" id="yp-arm-confirm"
                ${placement.count === 0 || busy ? 'disabled' : ''}>
          ${escapeHTML(translate('yearly_planner_place_here'))} (${placement.count})
        </button>
      </div>
    </div>
  `;
}

/**
 * The polite live region the module announces placement changes through.
 * @returns {string} HTML
 */
export function renderLiveRegion() {
  return '<p id="yp-live" class="visually-hidden" role="status" aria-live="polite"></p>';
}

/**
 * Summary strip above the grid.
 * @param {Object} model - buildYearModel() result
 * @returns {string} HTML
 */
export function renderYearSummary(model) {
  const counts = model?.counts || {};
  const items = [
    { icon: 'fa-calendar-check', value: counts.meetings || 0, label: translate('yearly_planner_meetings') },
    { icon: 'fa-clipboard-check', value: counts.prepared || 0, label: translate('yearly_planner_prepared') },
    { icon: 'fa-tents', value: counts.camps || 0, label: translate('yearly_planner_kind_camp') }
  ];

  return `
    <div class="yp-summary">
      ${items.map(item => `
        <span class="yp-summary__item">
          <i class="fas ${item.icon}" aria-hidden="true"></i>
          <strong>${item.value}</strong> ${escapeHTML(item.label)}
        </span>
      `).join('')}
    </div>
  `;
}
