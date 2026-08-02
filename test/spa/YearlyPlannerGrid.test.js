/**
 * @jest-environment jsdom
 *
 * Tests for the year-at-a-glance renderer.
 *
 * The chips replace drag and drop, so the accessibility assertions here are
 * load-bearing, not decoration: if a chip stops being a real button, keyboard
 * and screen-reader users lose the only way to open a date.
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

// SecurityUtils pulls in DOMPurify, which jest does not transform. Substitute a
// real escaper rather than an identity stub, so the escaping assertions below
// still prove something.
jest.mock('../../spa/utils/SecurityUtils.js', () => ({
  escapeHTML: (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}));

jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: (date, lang, options) => {
    if (options?.month === 'long') { return `MONTH(${date})`; }
    if (options?.weekday === 'short') { return `DOW(${date})`; }
    return `DATE(${date})`;
  }
}));

import { buildYearModel } from '../../spa/modules/yearly-planner/PlannerModel.js';
import {
  renderYearGrid,
  renderDateChip,
  renderPeriodBands,
  describeChip,
  renderYearSummary
} from '../../spa/modules/yearly-planner/YearGridView.js';

/** Render HTML into a detached element for querying. */
function mount(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

/**
 * @param {Object} overrides - Chip overrides
 * @returns {Object} Chip descriptor
 */
function chip(overrides = {}) {
  return {
    meetingId: 1,
    activityId: null,
    date: '2025-09-10',
    isEvent: false,
    dayNum: 10,
    weekday: 3,
    kind: 'regular',
    theme: null,
    periodId: null,
    isCancelled: false,
    isPrepared: false,
    activityCount: 0,
    seriesIds: [],
    spanDays: 1,
    spanEndDate: null,
    location: null,
    isPast: false,
    isToday: false,
    consent: null,
    carpool: null,
    ...overrides
  };
}

describe('renderDateChip - accessibility', () => {
  test('a chip is a real button, not a div with a handler', () => {
    const host = mount(renderDateChip(chip()));
    const button = host.querySelector('.yp-chip');

    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });

  test('aria-pressed is absent outside armed mode', () => {
    // A permanent aria-pressed="false" would misdescribe a navigation control.
    const host = mount(renderDateChip(chip()));
    expect(host.querySelector('.yp-chip').hasAttribute('aria-pressed')).toBe(false);
  });

  test('a chip carries the data the delegated listener needs', () => {
    const host = mount(renderDateChip(chip({ meetingId: 42, date: '2025-10-17' })));
    const button = host.querySelector('.yp-chip');

    expect(button.dataset.meetingId).toBe('42');
    expect(button.dataset.date).toBe('2025-10-17');
  });

  test('status reaches assistive technology through a described-by sentence', () => {
    const host = mount(renderDateChip(chip({
      meetingId: 7,
      isPrepared: true,
      consent: { pending: 6, signed: 12, declined: 0, total: 18 }
    })));

    const button = host.querySelector('.yp-chip');
    const meta = host.querySelector(`#${button.getAttribute('aria-describedby')}`);

    expect(meta).not.toBeNull();
    expect(meta.className).toBe('visually-hidden');
    expect(meta.textContent).toContain('yearly_planner_consent_signed');
    expect(meta.textContent).toContain('12/18');
  });

  test('decorative icons are hidden from assistive technology', () => {
    const host = mount(renderDateChip(chip({ isPrepared: true, carpool: { offers: 2, assigned: 5 } })));
    host.querySelectorAll('i').forEach((icon) => {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    });
  });
});

describe('renderDateChip - content', () => {
  test('escapes a theme rather than injecting it', () => {
    const host = mount(renderDateChip(chip({ theme: '<img src=x onerror=alert(1)>' })));

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.yp-chip__theme').textContent).toContain('<img');
  });

  test('a camp shows a day range and a day count', () => {
    const host = mount(renderDateChip(chip({
      date: '2026-07-11',
      dayNum: 11,
      kind: 'camp',
      spanDays: 8,
      spanEndDate: '2026-07-18'
    })));

    expect(host.querySelector('.yp-chip__day').textContent).toBe('11–18');
    expect(host.querySelector('.yp-badge--days').textContent).toContain('8');
    expect(host.querySelector('.yp-chip-slot--span')).not.toBeNull();
  });

  test('a single date has no span slot', () => {
    const host = mount(renderDateChip(chip()));
    expect(host.querySelector('.yp-chip-slot--span')).toBeNull();
    expect(host.querySelector('.yp-badge--days')).toBeNull();
  });

  test('state is expressed by class, not colour alone', () => {
    const cancelled = mount(renderDateChip(chip({ isCancelled: true })));
    expect(cancelled.querySelector('.yp-chip').classList.contains('is-cancelled')).toBe(true);

    const today = mount(renderDateChip(chip({ isToday: true })));
    expect(today.querySelector('.yp-chip').classList.contains('is-today')).toBe(true);
  });

  test('kind drives a distinct icon', () => {
    const camp = mount(renderDateChip(chip({ kind: 'camp' })));
    const regular = mount(renderDateChip(chip({ kind: 'regular' })));

    expect(camp.querySelector('.yp-chip__head i').className)
      .not.toBe(regular.querySelector('.yp-chip__head i').className);
  });
});

describe('renderPeriodBands', () => {
  test('bands are decorative and positioned on the chip track', () => {
    const host = mount(renderPeriodBands([
      { periodId: 1, title: 'Explorateurs', color: '#0f7a5a', startIndex: 1, span: 3, row: 0 }
    ]));

    const layer = host.querySelector('.yp-month__bands');
    expect(layer.getAttribute('aria-hidden')).toBe('true');

    const band = host.querySelector('.yp-band');
    // CSS grid columns are 1-based, chip indices are 0-based.
    expect(band.style.getPropertyValue('--band-start')).toBe('2');
    expect(band.style.getPropertyValue('--band-span')).toBe('3');
    expect(band.style.getPropertyValue('--band-color')).toBe('#0f7a5a');
  });

  test('renders nothing when there are no periods', () => {
    expect(renderPeriodBands([])).toBe('');
    expect(renderPeriodBands(null)).toBe('');
  });

  test('escapes a period title', () => {
    const host = mount(renderPeriodBands([
      { periodId: 1, title: '<script>x</script>', color: '#000000', startIndex: 0, span: 1, row: 0 }
    ]));

    expect(host.querySelector('script')).toBeNull();
  });
});

describe('renderYearGrid', () => {
  test('renders one section per month with a matching chip count', () => {
    const model = buildYearModel({
      meetings: [
        { id: 1, meeting_date: '2025-09-10', meeting_kind: 'regular' },
        { id: 2, meeting_date: '2025-09-17', meeting_kind: 'regular' },
        { id: 3, meeting_date: '2025-10-01', meeting_kind: 'regular' }
      ]
    });

    const host = mount(renderYearGrid(model, { lang: 'fr' }));
    const months = host.querySelectorAll('.yp-month');

    expect(months).toHaveLength(2);
    expect(months[0].dataset.month).toBe('2025-09');
    expect(months[0].querySelectorAll('.yp-chip')).toHaveLength(2);
    // The grid track is sized from the chip count, so they must agree.
    expect(months[0].querySelector('.yp-month__track').style.getPropertyValue('--chip-count')).toBe('2');
  });

  test('each month is labelled for assistive technology', () => {
    const model = buildYearModel({ meetings: [{ id: 1, meeting_date: '2025-09-10' }] });
    const host = mount(renderYearGrid(model, { lang: 'fr' }));

    const section = host.querySelector('.yp-month');
    const labelId = section.getAttribute('aria-labelledby');
    expect(host.querySelector(`#${labelId}`)).not.toBeNull();
  });

  test('shows an empty state rather than a blank page', () => {
    const host = mount(renderYearGrid(buildYearModel({ meetings: [] }), {}));
    expect(host.querySelector('.empty-state')).not.toBeNull();
    expect(host.querySelector('.yp-month')).toBeNull();
  });

  test('bands and chips sit on the same track in the same month', () => {
    const model = buildYearModel({
      periods: [{ id: 1, title: 'Decouverte', settings: { color: '#123456' } }],
      meetings: [
        { id: 1, meeting_date: '2025-09-03', period_id: null },
        { id: 2, meeting_date: '2025-09-10', period_id: 1 },
        { id: 3, meeting_date: '2025-09-17', period_id: 1 }
      ]
    });

    const host = mount(renderYearGrid(model, { lang: 'fr' }));
    const month = host.querySelector('.yp-month');

    expect(month.querySelectorAll('.yp-chip')).toHaveLength(3);
    const band = month.querySelector('.yp-band');
    expect(band.style.getPropertyValue('--band-start')).toBe('2');
    expect(band.style.getPropertyValue('--band-span')).toBe('2');
  });
});

describe('renderYearSummary', () => {
  test('uses singular labels only for a count of one', () => {
    const host = mount(renderYearSummary({
      counts: { meetings: 1, prepared: 1, camps: 1 }
    }));

    expect(host.textContent).toContain('yearly_planner_meeting_count_one');
    expect(host.textContent).toContain('yearly_planner_prepared_count_one');
    expect(host.textContent).toContain('yearly_planner_camp_count_one');
  });

  test('uses plural labels for zero and larger counts', () => {
    const host = mount(renderYearSummary({
      counts: { meetings: 40, prepared: 0, camps: 2 }
    }));

    expect(host.textContent).toContain('yearly_planner_meeting_count_other');
    expect(host.textContent).toContain('yearly_planner_prepared_count_other');
    expect(host.textContent).toContain('yearly_planner_camp_count_other');
  });
});

describe('a real multi-day camp', () => {
  // Modelled on an actual 8-day summer camp: one meeting row, one multi-day
  // activity, consent and transport already in progress.
  const model = buildYearModel({
    meetings: [{
      id: 100,
      meeting_date: '2026-07-11',
      meeting_kind: 'camp',
      theme: 'La Symphonie des echos noirs',
      span_days: 8,
      span_end_date: '2026-07-18',
      activity_id: 500,
      is_prepared: true,
      activity_count: 120
    }],
    activity_events: [{
      id: 500,
      name: 'Camp ete louveteaux 2026',
      linked_meeting_id: 100,
      start_date: '2026-07-11',
      end_date: '2026-07-18',
      signed_slip_count: '18',
      pending_slip_count: '2',
      carpool_offer_count: '6',
      assigned_participant_count: '20'
    }]
  });

  test('renders as one chip, not as a meeting plus a duplicate outing', () => {
    const host = mount(renderYearGrid(model, { lang: 'fr' }));
    expect(host.querySelectorAll('.yp-chip')).toHaveLength(1);
  });

  test('shows the span, consent progress and transport at a glance', () => {
    const host = mount(renderYearGrid(model, { lang: 'fr' }));

    expect(host.querySelector('.yp-badge--days').textContent).toContain('8');
    expect(host.querySelector('.yp-badge--consent').textContent).toContain('18/20');
    expect(host.querySelector('.yp-badge--carpool').textContent).toContain('6');
  });

  test('its description names the camp and its status', () => {
    const text = describeChip(model.months[0].chips[0], 'fr');

    expect(text).toContain('yearly_planner_kind_camp');
    expect(text).toContain('La Symphonie des echos noirs');
    expect(text).toContain('18/20');
  });
});
