// PrintSheetView.js
// Renders the printable action plan: one table row per regular meeting,
// grouped under month bands, with weekend outings and camps listed beside the
// meeting of the same week — the layout units already use on paper.
//
// Pure string builder. The sheet is hidden on screen and replaces the year
// grid when printing (see css/yearly-planner.css).
import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';

const MS_PER_DAY = 86400000;

/** An outing within this many days after a meeting is listed on that meeting's row. */
const SAME_WEEK_MAX_DAYS = 6;

/**
 * Whole days from one ISO date to another.
 * @param {string} from - YYYY-MM-DD
 * @param {string} to - YYYY-MM-DD
 * @returns {number} Day difference
 */
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * Format a date or date range compactly: "24 – 25 octobre", "30 juin – 2 juillet".
 * @param {string} start - YYYY-MM-DD
 * @param {?string} end - YYYY-MM-DD (optional)
 * @param {string} lang - Language code
 * @param {boolean} withMonth - Include the month name
 * @returns {string} Formatted range
 */
function formatRange(start, end, lang, withMonth) {
  const dayOnly = { day: 'numeric' };
  const dayMonth = { day: 'numeric', month: 'long' };
  if (!end || end === start) {
    return formatDate(start, lang, withMonth ? dayMonth : dayOnly);
  }
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const startText = formatDate(start, lang, sameMonth ? dayOnly : dayMonth);
  const endText = formatDate(end, lang, withMonth || !sameMonth ? dayMonth : dayOnly);
  return `${startText} – ${endText}`;
}

/**
 * Escape text and keep its line breaks.
 * @param {?string} text - Raw text
 * @returns {string} HTML
 */
function multiline(text) {
  return escapeHTML(text || '').replace(/\r?\n/g, '<br>');
}

/**
 * Every dated entry of the plan, in date order: planned dates plus outings
 * that exist only in the activities table.
 * @param {Object} plan - Plan detail from the API
 * @returns {Array<Object>} Normalized entries
 */
function collectEntries(plan) {
  const meetings = (plan.meetings || []).map(meeting => ({
    date: String(meeting.meeting_date).slice(0, 10),
    endDate: meeting.span_end_date ? String(meeting.span_end_date).slice(0, 10) : null,
    kind: meeting.meeting_kind || 'regular',
    theme: meeting.theme || '',
    notes: meeting.notes || '',
    cancelled: meeting.is_cancelled === true,
    periodId: meeting.period_id || null
  }));
  const outings = (plan.activity_events || [])
    .filter(event => !event.linked_meeting_id)
    .map(event => ({
      date: String(event.start_date).slice(0, 10),
      endDate: event.end_date ? String(event.end_date).slice(0, 10) : null,
      kind: 'weekend',
      theme: event.name || '',
      notes: '',
      cancelled: false,
      periodId: null
    }));
  return [...meetings, ...outings].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Build table rows: each regular meeting is a row; other entries join the
 * previous meeting's row when they fall in the same week, or stand alone.
 * @param {Array<Object>} entries - collectEntries() result
 * @returns {Array<Object>} Rows with a `weekend` list
 */
function buildRows(entries) {
  const rows = [];
  entries.forEach(entry => {
    const previous = rows[rows.length - 1];
    if (entry.kind !== 'regular'
      && previous
      && previous.entry.kind === 'regular'
      && daysBetween(previous.entry.date, entry.date) <= SAME_WEEK_MAX_DAYS) {
      previous.weekend.push(entry);
      return;
    }
    rows.push({ entry, weekend: [] });
  });
  return rows;
}

/**
 * Render the printable action plan.
 * @param {Object} plan - Plan detail from the API
 * @param {Object} options - { lang, organizationName }
 * @returns {string} HTML
 */
export function renderPrintSheet(plan, options = {}) {
  const lang = options.lang || 'fr';
  const periods = [...(plan.periods || [])]
    .sort((a, b) => (a.sort_order - b.sort_order) || String(a.start_date).localeCompare(String(b.start_date)));
  // French typography puts a space before the colon.
  const labelSeparator = lang === 'fr' ? ' : ' : ': ';
  const periodNumber = new Map(periods.map((period, index) => [period.id, index + 1]));

  const monthGroups = [];
  buildRows(collectEntries(plan)).forEach(row => {
    const monthKey = row.entry.date.slice(0, 7);
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.key === monthKey) {
      last.rows.push(row);
    } else {
      monthGroups.push({ key: monthKey, rows: [row] });
    }
  });

  const renderRow = ({ entry, weekend }) => {
    const activity = entry.theme || (entry.cancelled ? translate('yearly_planner_cancelled') : '');
    const period = entry.periodId ? periodNumber.get(entry.periodId) || '' : '';
    const weekendHtml = weekend.map(item => `
      <div>${escapeHTML(formatRange(item.date, item.endDate, lang, true))}${labelSeparator}${escapeHTML(item.theme)}</div>
    `).join('');
    return `
      <tr class="${entry.cancelled ? 'yp-print-sheet__row--cancelled' : ''}">
        <td class="yp-print-sheet__date">${escapeHTML(formatRange(entry.date, entry.endDate, lang, false))}</td>
        <td class="yp-print-sheet__period">${period}</td>
        <td>${escapeHTML(activity)}</td>
        <td>${multiline(entry.notes)}</td>
        <td>${weekendHtml}</td>
      </tr>
    `;
  };

  const monthLabel = key => {
    const label = formatDate(`${key}-01`, lang, { month: 'long', year: 'numeric' });
    return label.charAt(0).toLocaleUpperCase(lang) + label.slice(1);
  };

  return `
    <div class="yp-print-sheet" aria-hidden="true">
      <header class="yp-print-sheet__header">
        ${options.organizationName ? `<h2>${escapeHTML(options.organizationName)}</h2>` : ''}
        <p class="yp-print-sheet__title">${escapeHTML(translate('yearly_planner_action_plan'))} ${escapeHTML(plan.title || '')}</p>
        ${periods.length > 0 ? `
          <p class="yp-print-sheet__legend">
            ${periods.map((period, index) => `${index + 1} = ${escapeHTML(period.title)}`).join(' · ')}
          </p>
        ` : ''}
      </header>
      <table class="yp-print-sheet__table">
        <thead>
          <tr>
            <th class="yp-print-sheet__date">${escapeHTML(translate('date'))}</th>
            <th class="yp-print-sheet__period">${escapeHTML(translate('yearly_planner_period'))}</th>
            <th>${escapeHTML(translate('activity'))}</th>
            <th>${escapeHTML(translate('description'))}</th>
            <th>${escapeHTML(translate('yearly_planner_print_weekend'))}</th>
          </tr>
        </thead>
        ${monthGroups.map(group => `
          <tbody>
            <tr class="yp-print-sheet__month"><th colspan="5">${escapeHTML(monthLabel(group.key))}</th></tr>
            ${group.rows.map(renderRow).join('')}
          </tbody>
        `).join('')}
      </table>
    </div>
  `;
}
