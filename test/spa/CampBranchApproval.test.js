/** @jest-environment jsdom */

import axe from 'axe-core';
import { CampBranchApproval } from '../../spa/modules/camp-plan/CampBranchApproval.js';
import { getCampBranchReview, submitCampBranchReview } from '../../spa/api/api-camp-branch-approval.js';
import { confirm } from '../../spa/utils/DialogUtils.js';

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirm: jest.fn() }));
jest.mock('../../spa/api/api-camp-branch-approval.js', () => ({
  getCampBranchReview: jest.fn(), getCampBranchReviewPdf: jest.fn(), submitCampBranchReview: jest.fn(),
}));

const token = 'a'.repeat(43);
const app = { lang: 'en', isLoggedIn: false };
let screen;

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '<main id="app"></main>';
  history.replaceState({}, '', `/camp-branch-approval#${token}`);
  getCampBranchReview.mockResolvedValue({ ok: true, json: () => ({ data: {
    unit_name: '<img src=x onerror=alert(1)>', camp_name: 'Fictional camp',
    version_number: 2, language: 'en', code: 'ABCD 1234', sent_at: '2027-01-01T12:00:00Z',
  } }) });
  screen = new CampBranchApproval(app);
});
afterEach(() => screen.destroy());

test('opening the emailed link only describes it and offers a labelled, escaped review form', async () => {
  await screen.init();
  expect(getCampBranchReview).toHaveBeenCalledWith(token, expect.any(AbortSignal));
  expect(submitCampBranchReview).not.toHaveBeenCalled();
  expect(document.querySelector('img')).toBeNull();
  expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(document.querySelector('select[name=decision]').value).toBe('');
  const result = await axe.run(document.getElementById('app'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(result.violations).toEqual([]);
});

test('a decision is sent only after confirmation, then the form and secret leave the page', async () => {
  await screen.init();
  const form = document.querySelector('form');
  form.elements.namedItem('signer_name').value = 'Fictional Signer';
  form.elements.namedItem('job').value = 'Branch lead';
  form.elements.namedItem('received_on').value = '2027-01-01';
  form.elements.namedItem('decision').value = 'changes_requested';
  submitCampBranchReview.mockResolvedValue({ ok: true });
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const submit = async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  await submit();
  expect(submitCampBranchReview).not.toHaveBeenCalled();
  await submit();
  expect(submitCampBranchReview).toHaveBeenCalledWith(token, {
    name: 'Fictional Signer', job: 'Branch lead', received_on: '2027-01-01', decision: 'changes_requested', comment: '',
  }, expect.any(AbortSignal));
  expect(document.querySelector('form')).toBeNull();
  expect(window.location.hash).toBe('');
  expect(document.activeElement).toBe(document.querySelector('h1'));
});
