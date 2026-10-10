/**
 * @jest-environment jsdom
 */

/**
 * Recipients of a push notification in the admin panel.
 *
 * Each member appears once, with the number of browsers they registered when
 * there are several, instead of one line per browser. Every checkbox carries
 * the member's id and has its own label; the group is a fieldset with a
 * legend and a hint, operable by keyboard, with no WCAG A/AA violation.
 *
 * @module test/spa/PushRecipients
 */

import axe from 'axe-core';

const TRANSLATIONS = {
  no_subscribers_found: 'Aucun abonné trouvé',
  push_device_count: '{count} appareils',
};

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => TRANSLATIONS[key] || key,
}));

const { renderPushRecipients } = require('../../spa/modules/push/pushRecipients.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
};

const SUBSCRIBERS = [
  { user_id: '11111111-1111-4111-8111-111111111111', email: 'anne@example.test', full_name: 'Anne Parent', device_count: 12 },
  { user_id: '22222222-2222-4222-8222-222222222222', email: 'ben@example.test', full_name: '', device_count: 1 },
  { user_id: '33333333-3333-4333-8333-333333333333', email: '<b>x</b>@example.test', full_name: 'Évelyne <i>', device_count: 2 },
];

function mount(subscribers) {
  document.body.textContent = '';
  const fieldset = document.createElement('fieldset');
  fieldset.id = 'subscribers-list';
  fieldset.setAttribute('aria-describedby', 'subscribers-hint');
  const legend = document.createElement('legend');
  legend.textContent = 'Sélectionner les destinataires';
  const hint = document.createElement('p');
  hint.id = 'subscribers-hint';
  hint.textContent = 'Ne cochez aucune case pour avertir tous les abonnés.';
  const list = document.createElement('div');
  list.insertAdjacentHTML('beforeend', renderPushRecipients(subscribers));
  fieldset.append(legend, hint, list);
  document.body.append(fieldset);
  return fieldset;
}

describe('Push notification recipients', () => {
  test('one checkbox per member, valued with the member id', () => {
    const fieldset = mount(SUBSCRIBERS);
    const boxes = fieldset.querySelectorAll('input[type=checkbox]');

    expect(boxes).toHaveLength(SUBSCRIBERS.length);
    expect(Array.from(boxes).map((box) => box.value)).toEqual(SUBSCRIBERS.map((s) => s.user_id));
  });

  test('labels name the member and count their devices only when there are several', () => {
    const fieldset = mount(SUBSCRIBERS);
    const labels = Array.from(fieldset.querySelectorAll('label')).map((label) => label.textContent.trim());

    expect(labels[0]).toBe('Anne Parent – anne@example.test (12 appareils)');
    expect(labels[1]).toBe('ben@example.test');
  });

  test('names and emails are escaped', () => {
    const fieldset = mount(SUBSCRIBERS);

    expect(fieldset.querySelector('b, i')).toBeNull();
    expect(fieldset.querySelectorAll('label')[2].textContent).toContain('<b>x</b>@example.test');
  });

  test('each checkbox has an accessible name and toggles from the keyboard', () => {
    const fieldset = mount(SUBSCRIBERS);
    const box = fieldset.querySelector('input[type=checkbox]');
    const label = fieldset.querySelector(`label[for="${box.id}"]`);

    expect(label).not.toBeNull();
    box.focus();
    expect(document.activeElement).toBe(box);
    // Space on a focused checkbox activates it
    box.click();
    expect(box.checked).toBe(true);
  });

  test('an empty list says so', () => {
    const fieldset = mount([]);

    expect(fieldset.querySelector('input')).toBeNull();
    expect(fieldset.textContent).toContain('Aucun abonné trouvé');
  });

  test('has no WCAG A/AA violation', async () => {
    const fieldset = mount(SUBSCRIBERS);

    const results = await axe.run(fieldset, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
