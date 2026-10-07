/** @jest-environment jsdom */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key, app: { showMessage: jest.fn() } }));
jest.mock('../../spa/config.js', () => ({ getApiUrl: (path) => `https://unit.example.test${path}` }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true) }));
jest.mock('../../spa/utils/DateUtils.js', () => ({ formatDate: (value) => value }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirm: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../spa/modules/family-access/styles.js', () => ({ loadFamilyAccessStyles: jest.fn() }));
jest.mock('../../spa/api/api-parent-invitations.js', () => ({
  createParentInvitation: jest.fn(), updateParentInvitation: jest.fn(), getParentInvitations: jest.fn(),
  resendParentInvitation: jest.fn(), revokeParentInvitation: jest.fn(),
}));
jest.mock('../../spa/api/api-family.js', () => ({
  registerChild: jest.fn(), updateOwnChild: jest.fn(), withdrawOwnChild: jest.fn(),
  completeOnboarding: jest.fn(), getOnboardingContext: jest.fn(), getFamilyLinks: jest.fn(),
  requestFamilyLink: jest.fn(), resendFamilyLinkRequest: jest.fn(),
  withdrawFamilyLinkRequest: jest.fn(), endFamilyLink: jest.fn(),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({ removeGuardian: jest.fn() }));
jest.mock('../../spa/ajax-functions.js', () => ({
  saveParticipant: jest.fn(), saveFormSubmission: jest.fn(), saveGuardian: jest.fn(),
  fetchParticipant: jest.fn(), getGuardiansForParticipant: jest.fn(),
}));
jest.mock('../../spa/dynamicFormHandler.js', () => ({ DynamicFormHandler: jest.fn() }));

import { setContent } from '../../spa/utils/DOMUtils.js';
import { hasPermission } from '../../spa/utils/PermissionUtils.js';
import { releaseAllScrollLocks } from '../../spa/utils/ScrollLockUtils.js';
import { beginFamilyOperation, refreshFamilyAfterWrite } from '../../spa/modules/family-access/operations.js';
import { describeLink } from '../../spa/modules/family-access/publicLinks.js';
import { CompleteRegistration } from '../../spa/modules/family-access/CompleteRegistration.js';
import { FamilyAccess } from '../../spa/modules/family-access/FamilyAccess.js';
import { ParentInvitations } from '../../spa/modules/parent-invitations/ParentInvitations.js';
import { FormulaireInscription } from '../../spa/formulaire_inscription.js';
import { createParentInvitation, updateParentInvitation, resendParentInvitation } from '../../spa/api/api-parent-invitations.js';
import { saveParticipant, saveFormSubmission, saveGuardian } from '../../spa/ajax-functions.js';

beforeEach(() => {
  jest.clearAllMocks();
  setContent(document.body, '<div id="app"><button id="enabled">save</button><button id="disabled" disabled>restricted</button></div>');
  hasPermission.mockReturnValue(true);
});

afterEach(() => {
  releaseAllScrollLocks();
  delete global.fetch;
});

test('pending family writes block double submission and restore permission-disabled controls', () => {
  const page = { root: () => document.getElementById('app') };
  const release = beginFamilyOperation(page);
  expect(document.getElementById('enabled').disabled).toBe(true);
  expect(beginFamilyOperation(page)).toBeNull();
  release();
  expect(document.getElementById('enabled').disabled).toBe(false);
  expect(document.getElementById('disabled').disabled).toBe(true);
  expect(page.root().hasAttribute('aria-busy')).toBe(false);
});

test('a committed write with a failed refresh offers a read-only retry', async () => {
  const page = {
    root: () => document.getElementById('app'), load: jest.fn().mockRejectedValue(new Error('offline')),
    render: jest.fn(), showStatus: jest.fn(),
  };
  expect(await refreshFamilyAfterWrite(page)).toBe(false);
  expect(page.showStatus).toHaveBeenCalledWith('family_saved_refresh_failed', 'warning');
  expect(page.root().querySelector('[data-family-refresh]')).not.toBeNull();
  page.load.mockResolvedValue(undefined);
  expect(await refreshFamilyAfterWrite(page)).toBe(true);
  expect(page.render).toHaveBeenCalledTimes(1);
});

test.each([
  ['network failure', () => Promise.reject(new Error('offline'))],
  ['server failure', () => Promise.resolve({ ok: false, status: 503 })],
  ['unreadable response', () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) })],
])('%s is retryable instead of declaring an emailed token invalid', async (_label, response) => {
  global.fetch = jest.fn(response);
  expect(await describeLink('/api/v1/public/parent-invitations/describe', 'token')).toEqual({ state: 'load_error' });
  const page = new CompleteRegistration({});
  page.token = 'token';
  await page.init();
  expect(document.querySelector('[data-link-retry]')).not.toBeNull();
  expect(document.getElementById('app').textContent).toContain('family_link_load_failed');
  expect(document.getElementById('app').textContent).not.toContain('complete_registration_invalid');
});

test('family-link resend reports failed delivery', async () => {
  const page = new FamilyAccess({});
  page.load = jest.fn(async () => {});
  page.render = jest.fn();
  page.showStatus = jest.fn();
  await page.act(() => Promise.resolve({ data: { email_sent: false } }), 'family_access_resent');
  expect(page.showStatus).toHaveBeenCalledWith('family_access_created_not_sent', 'warning');
  expect(page.showStatus).not.toHaveBeenCalledWith('family_access_resent');
});

test('invitation edit preserves recipient language, clears fields and uses the update endpoint', async () => {
  const page = new ParentInvitations({ lang: 'fr' });
  page.openInviteForm({ id: 'invitation-id', email: 'family@example.test', language: 'en', first_name: 'Old name' });
  const form = document.getElementById('parent-invitation-form');
  expect(form.querySelector('[name="language"]').value).toBe('en');
  form.querySelector('[name="first_name"]').value = '';
  updateParentInvitation.mockResolvedValue({ data: { email_sent: true } });
  page.load = jest.fn(async () => {});
  page.render = jest.fn();
  await page.submitInvitation(form);
  expect(updateParentInvitation).toHaveBeenCalledWith('invitation-id', expect.objectContaining({ language: 'en', first_name: null }));
  expect(createParentInvitation).not.toHaveBeenCalled();
});

test('a saved invitation with a failed reload remains visibly saved with a retry', async () => {
  const page = new ParentInvitations({ lang: 'en' });
  page.render();
  page.openInviteForm();
  const form = document.getElementById('parent-invitation-form');
  form.querySelector('[name="email"]').value = 'family@example.test';
  createParentInvitation.mockResolvedValue({ data: { email_sent: true } });
  page.load = jest.fn().mockRejectedValue(new Error('offline'));
  await page.submitInvitation(form);
  expect(document.getElementById('parent-invitation-modal')).toBeNull();
  expect(document.getElementById('parent-invitations-status').textContent).toBe('family_saved_refresh_failed');
  expect(document.querySelector('[data-family-refresh]')).not.toBeNull();
});

test('two resend submissions only rotate and send once while the first is pending', async () => {
  const page = new ParentInvitations({});
  let finish;
  resendParentInvitation.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  page.load = jest.fn(async () => {});
  page.render = jest.fn();
  const first = page.resend('same-id');
  await page.resend('same-id');
  expect(resendParentInvitation).toHaveBeenCalledTimes(1);
  finish({ data: { email_sent: true } });
  await first;
});

test('an invitation dialog keeps its draft while saving and closes after confirmed success', async () => {
  const page = new ParentInvitations({ lang: 'en' });
  page.openInviteForm();
  const form = document.getElementById('parent-invitation-form');
  form.querySelector('[name="email"]').value = 'pending@example.test';
  let finish;
  createParentInvitation.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  page.load = jest.fn(() => Promise.resolve());
  page.render = jest.fn();
  const writing = page.submitInvitation(form);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  const modal = document.getElementById('parent-invitation-modal');
  modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(modal.isConnected).toBe(true);
  expect(form.querySelector('[name="email"]').value).toBe('pending@example.test');
  finish({ data: { email_sent: true } });
  await writing;
  expect(modal.isConnected).toBe(false);
});

test('adding a guardian captures typed values and keeps loaded record identity', () => {
  const page = new FormulaireInscription({});
  page.formData.guardians = [{ guardian_id: 12, nom: 'Original' }];
  page.guardianFormHandlers = [{ getFormData: () => ({ nom: 'Edited', prenom: 'Ada', courriel: 'ada@example.test' }) }];
  page.renderGuardianForms = jest.fn();
  page.addGuardianForm();
  expect(page.formData.guardians).toEqual([
    { guardian_id: 12, nom: 'Edited', prenom: 'Ada', courriel: 'ada@example.test' }, {},
  ]);
});

test('retry after paperwork failure uses the saved child id', async () => {
  hasPermission.mockReturnValue(false);
  const page = new FormulaireInscription({});
  const core = { first_name: 'Léa', last_name: 'Tremblay', date_naissance: '2016-05-01' };
  saveParticipant.mockResolvedValue({ success: true, data: { participant_id: 21 } });
  saveFormSubmission.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ success: true });
  await expect(page.saveParticipantAndGuardians(core, { guardians: [] })).rejects.toThrow('offline');
  expect(page.participantId).toBe(21);
  await page.saveParticipantAndGuardians(core, { guardians: [] });
  expect(saveParticipant.mock.calls[0][0].id).toBeFalsy();
  expect(saveParticipant.mock.calls[1][0].id).toBe(21);
});

test('retry after the second guardian fails updates the first saved guardian', async () => {
  const page = new FormulaireInscription({});
  page.formData.guardians = [{}, {}];
  const guardians = [{ nom: 'A', prenom: 'Ada' }, { nom: 'B', prenom: 'Bob' }];
  saveGuardian.mockResolvedValueOnce({ success: true, data: { guardian_id: 31 } })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ success: true, data: { guardian_id: 31 } });
  await expect(page.saveGuardians(21, guardians)).rejects.toThrow('offline');
  await page.saveGuardians(21, guardians);
  expect(saveGuardian.mock.calls[2][0].guardian_id).toBe(31);
});
