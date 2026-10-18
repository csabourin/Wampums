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
// DateUtils reads the configuration, which uses import.meta.
jest.mock('../../spa/utils/DateUtils.js', () => ({ formatDateShort: () => '2026-10-18' }));
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
    const members = [...root.querySelectorAll('.den-list-card__member')];
    const leaderRow = members.find((row) => row.textContent.includes('Maxime'));
    const secondRow = members.find((row) => row.textContent.includes('Vincent'));

    // translate('first_leader') resolves to the unit vocabulary (Pisteur for a cub pack)
    expect(leaderRow.textContent).toContain('first_leader');
    expect(root.textContent).not.toMatch(/\bleader\b(?!_)/);
    expect(secondRow.textContent).toContain('second_leader');
  });

  test('each den is a section named after the den, leader first and second leader last', async () => {
    const root = await renderReport();
    const den = root.querySelector('.den-list-card');
    const heading = document.getElementById(den.getAttribute('aria-labelledby'));
    expect(heading.textContent).toContain(HOSTILE_NAME);
    expect(heading.textContent).toContain('(3)');
    const names = [...den.querySelectorAll('.den-list-card__name')].map((el) => el.textContent);
    expect(names[0]).toContain('Maxime');
    expect(names[names.length - 1]).toContain('Vincent');
  });

  test('youth in no den are listed under their own heading rather than dropped', async () => {
    getParticipants.mockResolvedValue({
      data: [
        { id: 10, first_name: 'Maxime', last_name: 'Tremblay', group_id: 1 },
        { id: 13, first_name: 'Noa', last_name: 'Roy', group_id: null },
      ],
    });
    const root = await renderReport();
    const headings = [...root.querySelectorAll('.den-list-card h2')].map((h) => h.textContent);
    expect(headings[headings.length - 1]).toContain('unassigned_participants');
    expect(root.textContent).toContain('Noa Roy');
  });

  test('a unit with no youth placed yet says so', async () => {
    getParticipants.mockResolvedValue({ data: [] });
    const root = await renderReport();
    expect(root.querySelector('.den-list-card')).toBeNull();
    expect(root.textContent).toContain('den_list_empty');
    expect(root.querySelector('#den-list-print')).toBeNull();
  });

  test('a failed load is explained, not shown as an empty list, and can be retried', async () => {
    getParticipants.mockRejectedValueOnce(new Error('offline'));
    const root = await renderReport();
    expect(root.querySelector('[role="alert"]').textContent).toContain('error_loading_group_participant_report');
    expect(root.textContent).not.toContain('den_list_empty');

    root.querySelector('#den-list-retry').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('app').querySelector('.den-list-card')).not.toBeNull();
  });

  test('the print button prints the page, which carries the date it was printed', async () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    const root = await renderReport();
    expect(root.querySelector('.den-list-report__printed').textContent).toContain('printed_on');
    root.querySelector('#den-list-print').click();
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  test('the page adds no style sheet of its own each time it is shown', async () => {
    const before = document.head.querySelectorAll('style').length;
    await renderReport();
    await renderReport();
    expect(document.head.querySelectorAll('style').length).toBe(before);
  });

  test('den and youth names are shown as text', async () => {
    const root = await renderReport();
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain(HOSTILE_NAME);
  });

  test('the page opens with a back link and has no accessibility violations', async () => {
    const root = await renderReport();
    expect(root.querySelector('a')).not.toBeNull();
    expect(root.querySelector('h1').textContent).toBe('den_list_report');
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
  expect(root.querySelector('.den-list-grid').textContent).toContain('Max Roy');
  expect(root.querySelector('.den-list-grid').textContent).not.toContain('Maximilien');
});
