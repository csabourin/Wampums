/**
 * @jest-environment jsdom
 *
 * The printable den list: who is in each den, and who leads it.
 */
import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  getParticipants: jest.fn(),
  getGroups: jest.fn(),
}));

const { getParticipants, getGroups } = require('../../spa/ajax-functions.js');
const { PrintableGroupParticipantReport } = require('../../spa/modules/groups/GroupParticipantReport.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const HOSTILE_NAME = '<img src=x onerror=alert(1)>';

async function renderReport() {
  document.body.innerHTML = '<main id="app"></main>';
  const app = { showMessage: jest.fn() };
  const report = new PrintableGroupParticipantReport(app);
  await report.init();
  return document.getElementById('app');
}

describe('Printable den list', () => {
  beforeEach(() => {
    getGroups.mockResolvedValue({ data: [{ id: 1, name: HOSTILE_NAME }] });
    getParticipants.mockResolvedValue({
      data: [
        { id: 10, first_name: 'Maxime', last_name: 'Tremblay', group_id: 1, first_leader: true },
        { id: 11, first_name: 'Vincent', last_name: 'Tremblay', group_id: 1, second_leader: true },
        { id: 12, first_name: HOSTILE_NAME, last_name: 'Roy', group_id: 1 },
      ],
    });
  });

  test('a den leader is labelled with the unit\'s term for it, not as an adult leader', async () => {
    const root = await renderReport();
    const rows = [...root.querySelectorAll('tbody tr')];
    const leaderRow = rows.find((row) => row.textContent.includes('Maxime'));
    const secondRow = rows.find((row) => row.textContent.includes('Vincent'));

    // translate('first_leader') resolves to the unit vocabulary (Pisteur for a cub pack)
    expect(leaderRow.textContent).toContain('first_leader');
    expect(root.textContent).not.toMatch(/\bleader\b(?!_)/);
    expect(secondRow.textContent).toContain('second_leader');
  });

  test('den and youth names are shown as text', async () => {
    const root = await renderReport();
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain(HOSTILE_NAME);
  });

  test('the page opens with a back link and has no accessibility violations', async () => {
    const root = await renderReport();
    expect(root.querySelector('a')).not.toBeNull();
    expect(root.firstElementChild.querySelector('a').getAttribute('href')).toBe('/dashboard');
    const results = await axe.run(root, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

test('a youth with a nickname is listed by it', async () => {
  getGroups.mockResolvedValue({ data: [{ id: 1, name: 'Rouge' }] });
  getParticipants.mockResolvedValue({
    data: [{ id: 10, first_name: 'Maximilien', last_name: 'Roy', nickname: 'Max', group_id: 1 }],
  });
  const root = await renderReport();
  expect(root.querySelector('tbody').textContent).toContain('Max Roy');
  expect(root.querySelector('tbody').textContent).not.toContain('Maximilien');
});
