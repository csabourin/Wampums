/**
 * @jest-environment jsdom
 *
 * A meeting an outing replaces (#1327) stays on the year view: its chip says
 * "Replaced" in words, with an icon, never by colour alone, and its description
 * for assistive technology names the outing, as text.
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({
  translate: (key) => (key === 'yearly_planner_replaced_by' ? 'Replaced by {outing}.' : key),
}));
jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: (value) => String(value),
}));

import { renderDateChip, describeChip } from '../../spa/modules/yearly-planner/YearGridView.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

/** @returns {Object} Chip descriptor */
function chip(overrides = {}) {
  return {
    meetingId: 12, activityId: null, date: '2026-11-17', isEvent: false, dayNum: 17, kind: 'regular',
    theme: 'La jungle', periodId: null, isCancelled: false, isPrepared: false, activityCount: 0,
    seriesIds: [], spanDays: 1, spanEndDate: null, isPast: false, isToday: false, consent: null, carpool: null,
    replacedBy: { activityId: 77, name: '<img src=x onerror=alert(1)>Musée' },
    ...overrides,
  };
}

function mount(html) {
  document.body.innerHTML = `<main><ul>${html}</ul></main>`;
  return document.body;
}

test('the chip says in words that the meeting is replaced', async () => {
  const host = mount(renderDateChip(chip()));

  const button = host.querySelector('button.yp-chip');
  expect(button.classList.contains('is-replaced')).toBe(true);
  expect(button.querySelector('.yp-badge--replaced').textContent.trim()).toBe('yearly_planner_replaced_short');
  const results = await axe.run(host, AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});

test('its description names the outing, as text', () => {
  const host = mount(renderDateChip(chip()));

  const description = host.querySelector('.visually-hidden').textContent;
  expect(description).toContain('Replaced by <img src=x onerror=alert(1)>Musée.');
  expect(host.querySelector('img')).toBeNull();
  expect(describeChip(chip({ replacedBy: null }))).not.toContain('Replaced by');
});
