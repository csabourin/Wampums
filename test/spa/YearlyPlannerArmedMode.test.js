/**
 * @jest-environment jsdom
 *
 * Tests for series placement.
 *
 * This is the replacement for drag and drop, so the ordering and accessibility
 * assertions here are the feature, not polish: if occurrences stop being
 * numbered chronologically, "Preparation du camp 1 of 4" starts lying.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));

jest.mock('../../spa/utils/SecurityUtils.js', () => ({
  escapeHTML: (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}));

jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: (date, lang, options) => {
    if (options?.month === 'long') { return `MONTH(${date})`; }
    if (options?.weekday === 'short') { return `DOW(${date})`; }
    return `DATE(${date})`;
  }
}));

import { ArmedPlacement, PLACEMENT_STATE } from '../../spa/modules/yearly-planner/ArmedPlacement.js';
import { renderDateChip, renderArmBar } from '../../spa/modules/yearly-planner/YearGridView.js';

/** @returns {Object} Chip descriptor */
function chip(overrides = {}) {
  return {
    meetingId: 1,
    activityId: null,
    date: '2025-09-10',
    isEvent: false,
    dayNum: 10,
    kind: 'regular',
    theme: null,
    periodId: null,
    isCancelled: false,
    isPrepared: false,
    activityCount: 0,
    seriesIds: [],
    spanDays: 1,
    spanEndDate: null,
    isPast: false,
    isToday: false,
    consent: null,
    carpool: null,
    ...overrides
  };
}

function mount(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

const ACTIVITY = { activity_library_id: 5, name: 'Preparation du camp', duration_minutes: 20 };

describe('ArmedPlacement - lifecycle', () => {
  test('starts idle and exposes no armed state', () => {
    const placement = new ArmedPlacement();
    expect(placement.state).toBe(PLACEMENT_STATE.IDLE);
    expect(placement.isArmed).toBe(false);
    expect(placement.count).toBe(0);
  });

  test('choosing then arming moves through the states', () => {
    const placement = new ArmedPlacement();
    placement.choose();
    expect(placement.state).toBe(PLACEMENT_STATE.CHOOSING);
    // Not armed yet: tapping a date while the picker is open must not select it.
    expect(placement.isArmed).toBe(false);

    placement.arm(ACTIVITY);
    expect(placement.state).toBe(PLACEMENT_STATE.ARMED);
    expect(placement.isArmed).toBe(true);
  });

  test('arming a second activity clears the previous selection', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    placement.toggle(chip({ meetingId: 1 }));
    placement.arm({ name: 'Autre' });

    expect(placement.count).toBe(0);
  });

  test('disarming forgets everything', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    placement.toggle(chip({ meetingId: 1 }));
    placement.disarm();

    expect(placement.state).toBe(PLACEMENT_STATE.IDLE);
    expect(placement.count).toBe(0);
    expect(placement.payload()).toBeNull();
  });

  test('stays armed while committing so chips keep their state', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    placement.commit();
    expect(placement.isArmed).toBe(true);
  });
});

describe('ArmedPlacement - selection', () => {
  test('toggling adds then removes a date', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    const target = chip({ meetingId: 7 });

    expect(placement.toggle(target)).toBe(true);
    expect(placement.isSelected(7)).toBe(true);
    expect(placement.toggle(target)).toBe(false);
    expect(placement.isSelected(7)).toBe(false);
  });

  test('ignores taps while idle', () => {
    const placement = new ArmedPlacement();
    expect(placement.toggle(chip({ meetingId: 7 }))).toBe(false);
    expect(placement.count).toBe(0);
  });

  test('ignores a chip with no meeting behind it', () => {
    // An outing with no planned date has nothing to attach an activity to.
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    expect(placement.toggle(chip({ meetingId: null, activityId: 9 }))).toBe(false);
    expect(placement.count).toBe(0);
  });
});

describe('ArmedPlacement - payload', () => {
  test('orders meeting ids by date, not by tap order', () => {
    // The whole point of "1 of 4" is that it is chronological.
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    placement.toggle(chip({ meetingId: 30, date: '2025-10-15' }));
    placement.toggle(chip({ meetingId: 10, date: '2025-09-03' }));
    placement.toggle(chip({ meetingId: 20, date: '2025-09-24' }));

    expect(placement.payload().meeting_ids).toEqual([10, 20, 30]);
  });

  test('carries the activity and the series flag', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    placement.toggle(chip({ meetingId: 1, date: '2025-09-10' }));

    const payload = placement.payload();
    expect(payload.activity).toEqual(ACTIVITY);
    expect(payload.as_series).toBe(true);
    expect(payload.series_label).toBe('Preparation du camp');
  });

  test('numbering can be turned off', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    placement.setSeries(false);
    placement.toggle(chip({ meetingId: 1, date: '2025-09-10' }));

    expect(placement.payload().as_series).toBe(false);
  });

  test('is null with nothing selected', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    expect(placement.payload()).toBeNull();
  });
});

describe('chips under armed mode', () => {
  test('gain aria-pressed only while armed', () => {
    const placement = new ArmedPlacement();

    const idle = mount(renderDateChip(chip(), { placement }));
    expect(idle.querySelector('.yp-chip').hasAttribute('aria-pressed')).toBe(false);

    placement.arm(ACTIVITY);
    const armed = mount(renderDateChip(chip(), { placement }));
    expect(armed.querySelector('.yp-chip').getAttribute('aria-pressed')).toBe('false');
  });

  test('report their selected state', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    placement.toggle(chip({ meetingId: 1 }));

    const host = mount(renderDateChip(chip({ meetingId: 1 }), { placement }));
    const button = host.querySelector('.yp-chip');

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.classList.contains('is-selected')).toBe(true);
  });

  test('an outing chip never claims to be pressable', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);

    const host = mount(renderDateChip(chip({ meetingId: null, activityId: 9 }), { placement }));
    expect(host.querySelector('.yp-chip').hasAttribute('aria-pressed')).toBe(false);
  });

  test('lose aria-pressed entirely on disarm, rather than keeping false', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    placement.disarm();

    const host = mount(renderDateChip(chip(), { placement }));
    expect(host.querySelector('.yp-chip').hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('the arm bar', () => {
  test('renders nothing while idle', () => {
    expect(renderArmBar(new ArmedPlacement())).toBe('');
    expect(renderArmBar(null)).toBe('');
  });

  test('is a labelled region naming the armed activity', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);

    const host = mount(renderArmBar(placement));
    const bar = host.querySelector('.yp-armbar');

    expect(bar.getAttribute('role')).toBe('region');
    expect(bar.getAttribute('aria-label')).toBe('yearly_planner_series_mode');
    expect(bar.textContent).toContain('Preparation du camp');
  });

  test('confirm is disabled until a date is chosen', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    expect(mount(renderArmBar(placement)).querySelector('#yp-arm-confirm').disabled).toBe(true);

    placement.toggle(chip({ meetingId: 1 }));
    const host = mount(renderArmBar(placement));
    expect(host.querySelector('#yp-arm-confirm').disabled).toBe(false);
    expect(host.querySelector('.yp-armbar__count').textContent).toBe('1');
  });

  test('everything is disabled while the placement is in flight', () => {
    const placement = new ArmedPlacement();
    placement.arm(ACTIVITY);
    placement.toggle(chip({ meetingId: 1 }));
    placement.commit();

    const host = mount(renderArmBar(placement));
    expect(host.querySelector('#yp-arm-confirm').disabled).toBe(true);
    expect(host.querySelector('#yp-arm-cancel').disabled).toBe(true);
  });

  test('escapes an activity name rather than injecting it', () => {
    const placement = new ArmedPlacement();
    placement.arm({ name: '<img src=x onerror=alert(1)>' });

    const host = mount(renderArmBar(placement));
    expect(host.querySelector('img')).toBeNull();
  });
});
