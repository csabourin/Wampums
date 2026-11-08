/**
 * @jest-environment jsdom
 *
 * "Lend a hand" on the parent dashboard: parents are the unit's cooks and
 * drivers, so the places still open reach them where they already look.
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({
  translate: (key) => ({
    parent_volunteering_open_other: '{count} volunteers wanted',
    parent_volunteering_open_one: '{count} volunteer wanted',
    parent_volunteering_mine_one: '{count} place of yours',
  }[key] || key),
}));

const { renderVolunteeringSection, summarizeVolunteering } = require('../../spa/modules/dashboard/ParentVolunteering.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const shift = (id, slots, taken, mine = false) => ({ id, slots, taken, mine });

test('counts the places still open on shifts the parent has not taken, and the parent\'s own', () => {
  expect(summarizeVolunteering([shift(1, 2, 0), shift(2, 3, 1), shift(3, 1, 1), shift(4, 2, 1, true)]))
    .toEqual({ openPlaces: 4, openShifts: 2, myPlaces: 1 });
  expect(summarizeVolunteering(undefined)).toEqual({ openPlaces: 0, openShifts: 0, myPlaces: 0 });
});

test('open places lead to the shifts; a place of one\'s own leads to the volunteer space', async () => {
  document.body.innerHTML = `<main id="app">${renderVolunteeringSection({ openPlaces: 3, myPlaces: 1 }, { space: true })}</main>`;

  expect(document.querySelector('h2').textContent).toBe('parent_volunteering_title');
  expect([...document.querySelectorAll('.parent-volunteering__text')].map((p) => p.textContent))
    .toEqual(['3 volunteers wanted', '1 place of yours']);
  expect([...document.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent]))
    .toEqual([['/volunteers', 'parent_volunteering_take'], ['/volunteer-space', 'parent_volunteering_my_space']]);
  const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});

test('says nothing when there is no place to take and none taken, or the count is unknown', () => {
  expect(renderVolunteeringSection({ openPlaces: 0, myPlaces: 0 }, { space: true })).toBe('');
  expect(renderVolunteeringSection(null, { space: true })).toBe('');
});

test('without the volunteer space, a place of one\'s own is said but not linked', () => {
  document.body.innerHTML = renderVolunteeringSection({ openPlaces: 0, myPlaces: 1 }, { space: false });
  expect(document.querySelector('a')).toBeNull();
  expect(document.querySelector('.parent-volunteering__text').textContent).toBe('1 place of yours');
});
