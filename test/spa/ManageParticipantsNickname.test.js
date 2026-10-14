/**
 * @jest-environment jsdom
 *
 * Participant management: the nickname a youth goes by, shown in place of
 * the first name and set by the unit's leaders.
 */
import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { CACHE_DURATION: { MEDIUM: 1 }, PROGRAM_SECTIONS: { DEFAULT: [] } },
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  getParticipants: jest.fn(),
  getGroups: jest.fn(),
  updateParticipantGroup: jest.fn(),
}));
jest.mock('../../spa/indexedDB.js', () => ({
  setCachedData: jest.fn(() => Promise.resolve()),
  clearGroupRelatedCaches: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewParticipants: jest.fn(() => true),
  hasPermission: jest.fn(() => true),
}));
jest.mock('../../spa/api/api-participants.js', () => ({
  updateParticipantNickname: jest.fn(),
}));

const { getParticipants, getGroups } = require('../../spa/ajax-functions.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { updateParticipantNickname } = require('../../spa/api/api-participants.js');
const { ManageParticipants } = require('../../spa/modules/participants/ManageParticipants.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE_NAME = '<img src=x onerror=alert(1)>';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let app;

async function renderPage() {
  document.body.innerHTML = '<main id="app"></main>';
  const screen = new ManageParticipants(app);
  await screen.init();
  return document.getElementById('app');
}

function nicknameField(root, participantId) {
  return root.querySelector(`.nickname-input[data-participant-id="${participantId}"]`);
}

beforeEach(() => {
  jest.clearAllMocks();
  hasPermission.mockReturnValue(true);
  app = { showMessage: jest.fn(), router: { navigate: jest.fn() }, organizationSettings: {} };
  getGroups.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Rouge' }] });
  getParticipants.mockResolvedValue({
    success: true,
    data: [
      { id: 10, first_name: 'Maximilien', last_name: 'Roy', nickname: 'Max', group_id: 1 },
      { id: 11, first_name: HOSTILE_NAME, last_name: 'Tremblay', nickname: null, group_id: 1 },
    ],
  });
});

test('a youth with a nickname is listed by it, with the legal name kept beside it', async () => {
  const root = await renderPage();
  const row = nicknameField(root, 10).closest('tr');

  expect(row.cells[0].textContent).toContain('Max Roy');
  expect(row.cells[0].querySelector('.participant-legal-name').textContent).toBe('Maximilien Roy');
  expect(nicknameField(root, 10).value).toBe('Max');
});

test('names are shown as text', async () => {
  const root = await renderPage();
  expect(root.querySelector('img')).toBeNull();
  expect(root.textContent).toContain(HOSTILE_NAME);
});

test('changing the nickname saves it, trimmed, and says so', async () => {
  updateParticipantNickname.mockResolvedValue({ success: true, data: { id: 11, nickname: 'Vince' } });
  const root = await renderPage();
  const field = nicknameField(root, 11);

  field.value = '  Vince ';
  field.dispatchEvent(new Event('change'));
  await flush();

  expect(updateParticipantNickname).toHaveBeenCalledWith(11, 'Vince');
  expect(app.showMessage).toHaveBeenCalledWith('nickname_saved', 'success');
  // The row shows the new name at once, the legal one beside it, still as text
  const cell = field.closest('tr').cells[0];
  expect(cell.textContent).toContain('Vince Tremblay');
  expect(cell.querySelector('.participant-legal-name').textContent).toBe(`${HOSTILE_NAME} Tremblay`);
  expect(cell.querySelector('img')).toBeNull();
});

test('a nickname saved offline is said to be queued, not saved', async () => {
  updateParticipantNickname.mockResolvedValue({ queued: true });
  const root = await renderPage();
  const field = nicknameField(root, 11);

  field.value = 'Vince';
  field.dispatchEvent(new Event('change'));
  await flush();

  expect(app.showMessage).toHaveBeenCalledWith('nickname_saved_offline', 'info');
});

test('a refused save puts the previous nickname back and explains it', async () => {
  updateParticipantNickname.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
  const root = await renderPage();
  const field = nicknameField(root, 10);

  field.value = 'Maxou';
  field.dispatchEvent(new Event('change'));
  await flush();

  expect(field.value).toBe('Max');
  expect(app.showMessage).toHaveBeenCalledWith('nickname_save_failed', 'error');
});

test('an unchanged nickname sends nothing', async () => {
  const root = await renderPage();
  nicknameField(root, 10).dispatchEvent(new Event('change'));
  await flush();
  expect(updateParticipantNickname).not.toHaveBeenCalled();
});

test('without participants.edit the nickname cannot be changed', async () => {
  hasPermission.mockReturnValue(false);
  const root = await renderPage();
  expect(nicknameField(root, 10).disabled).toBe(true);
});

test('each field is named for its youth, and the page has no accessibility violations', async () => {
  const root = await renderPage();
  const field = nicknameField(root, 10);

  expect(field.getAttribute('aria-label')).toBe('nickname — Maximilien Roy');
  expect(field.getAttribute('aria-describedby')).toBe('participants-nickname-hint');
  expect(root.firstElementChild.tagName).toBe('A');
  const results = await axe.run(root, AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});
