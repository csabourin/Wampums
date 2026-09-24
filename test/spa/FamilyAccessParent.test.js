/**
 * @jest-environment jsdom
 */

/**
 * Parent screens: registering one's children, sharing a family, and being
 * brought back to registration after signing in.
 *
 * Two answers on the registration page need the parent's judgement rather than
 * an error message -- a same-name child already in the family, and a child the
 * family already had -- and the page must ask rather than guess. Sharing a
 * family and ending it both move access to children, so both are held to "ask
 * first, then act".
 *
 * @module test/spa/FamilyAccessParent
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  getApiUrl: (endpoint) => `https://unit.example.org${endpoint}`,
  CONFIG: { API_BASE_URL: 'https://unit.example.org' },
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

jest.mock('../../spa/api/api-family.js', () => ({
  getOnboardingContext: jest.fn(),
  registerChild: jest.fn(),
  completeOnboarding: jest.fn(),
  getFamilyLinks: jest.fn(),
  requestFamilyLink: jest.fn(),
  resendFamilyLinkRequest: jest.fn(),
  withdrawFamilyLinkRequest: jest.fn(),
  endFamilyLink: jest.fn(),
}));

import * as api from '../../spa/api/api-family.js';
import { confirm } from '../../spa/utils/DialogUtils.js';
import { ParentOnboarding, childProblem } from '../../spa/modules/parent-onboarding/ParentOnboarding.js';
import { FamilyAccess } from '../../spa/modules/family-access/FamilyAccess.js';

/** @returns {Promise<void>} Let pending promises settle */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * An error shaped the way the API client throws one.
 *
 * @param {number} status - HTTP status
 * @param {string} code - Machine-readable reason
 * @param {Object} [data] - Details
 * @returns {Error} The error
 */
function apiError(status, code, data = null) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  error.data = data;
  return error;
}

const CONTEXT = {
  organization_name: '6A St-Paul',
  scout_year: { id: 3, label: '2026-2027' },
  onboarding_pending: true,
  support_contact: null,
  children: [
    { id: 11, first_name: 'Léa', last_name: 'Tremblay', date_naissance: '2016-05-01', enrolled_this_year: true },
    { id: 12, first_name: 'Noé', last_name: 'Tremblay', date_naissance: '2014-03-03', enrolled_this_year: false },
  ],
};

/**
 * Fill and submit the child form.
 *
 * @param {Object} child - Field values
 * @returns {Promise<void>}
 */
async function addChild({ first = 'Zoé', last = 'Tremblay', born = '2019-02-14' } = {}) {
  document.getElementById('child-first-name').value = first;
  document.getElementById('child-last-name').value = last;
  document.getElementById('child-birth-date').value = born;
  document.getElementById('onboarding-child-form')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await flush();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  confirm.mockResolvedValue(true);
  api.getOnboardingContext.mockResolvedValue({ data: CONTEXT });
});

describe('registering children', () => {
  test('shows the unit, the year, and each child with what is left to do', async () => {
    await new ParentOnboarding({ lang: 'fr' }).init();

    const text = document.getElementById('app').textContent;
    expect(text).toContain('6A St-Paul');
    expect(text).toContain('2026-2027');
    // Registered this year: straight to the paperwork.
    expect(document.querySelector('a[href="/formulaire-inscription/11"]')).not.toBeNull();
    // Not yet this year: a one-click return, and no paperwork link yet.
    expect(document.querySelector('[data-reenroll="12"]')).not.toBeNull();
    expect(document.querySelector('a[href="/formulaire-inscription/12"]')).toBeNull();
  });

  test('checks the details before sending anything', async () => {
    await new ParentOnboarding({}).init();

    await addChild({ born: '' });
    expect(api.registerChild).not.toHaveBeenCalled();
    expect(document.getElementById('onboarding-error').textContent).toBe('onboarding_error_dob_required');

    await addChild({ first: '' });
    expect(document.getElementById('onboarding-error').textContent).toBe('onboarding_error_name_required');
    expect(api.registerChild).not.toHaveBeenCalled();
  });

  test('adds a child and says so by name', async () => {
    api.registerChild.mockResolvedValue({ data: { result: 'created', participant_id: 20 } });
    await new ParentOnboarding({}).init();

    await addChild();

    expect(api.registerChild).toHaveBeenCalledWith({
      first_name: 'Zoé', last_name: 'Tremblay', date_naissance: '2019-02-14',
    });
    expect(document.getElementById('onboarding-status').textContent).toBe('onboarding_child_created');
  });

  test('a child already known from another unit is reported as such', async () => {
    api.registerChild.mockResolvedValue({ data: { result: 'enrolled_existing', participant_id: 30 } });
    await new ParentOnboarding({}).init();

    await addChild();

    expect(document.getElementById('onboarding-status').textContent).toBe('onboarding_child_enrolled_existing');
  });

  test('a same-name child asks the parent, and goes through only on a yes', async () => {
    api.registerChild
      .mockRejectedValueOnce(apiError(409, 'similar_child_exists', {
        matches: [{ id: 11, first_name: 'Léa', last_name: 'Tremblay', date_naissance: '2016-05-01' }],
      }))
      .mockResolvedValueOnce({ data: { result: 'created', participant_id: 21 } });
    await new ParentOnboarding({ lang: 'en' }).init();

    await addChild({ first: 'Léa' });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Léa Tremblay'),
    }));
    expect(api.registerChild).toHaveBeenLastCalledWith(expect.objectContaining({
      first_name: 'Léa', confirm_similar: true,
    }));
  });

  test('saying no to the same-name question adds nothing', async () => {
    confirm.mockResolvedValueOnce(false);
    api.registerChild.mockRejectedValueOnce(apiError(409, 'similar_child_exists', { matches: [] }));
    await new ParentOnboarding({}).init();

    await addChild({ first: 'Léa' });

    expect(api.registerChild).toHaveBeenCalledTimes(1);
    expect(document.getElementById('onboarding-error').textContent).toBe('onboarding_similar_cancelled');
  });

  test('the same child twice this year is refused plainly', async () => {
    api.registerChild.mockRejectedValue(apiError(409, 'duplicate_child', { participant_id: 11 }));
    await new ParentOnboarding({}).init();

    await addChild({ first: 'Léa', born: '2016-05-01' });

    expect(document.getElementById('onboarding-error').textContent).toBe('onboarding_error_duplicate');
  });

  test('a returning child is put back on the roster with one click', async () => {
    api.registerChild.mockResolvedValue({ data: { result: 'reenrolled', participant_id: 12 } });
    await new ParentOnboarding({}).init();

    document.querySelector('[data-reenroll="12"]').click();
    await flush();

    expect(api.registerChild).toHaveBeenCalledWith({
      first_name: 'Noé', last_name: 'Tremblay', date_naissance: '2014-03-03',
    });
  });

  test('finishing marks onboarding done and goes to the dashboard', async () => {
    api.completeOnboarding.mockResolvedValue({ data: { completed: true } });
    const route = jest.fn();
    await new ParentOnboarding({ router: { route } }).init();

    document.getElementById('onboarding-done').click();
    await flush();

    expect(api.completeOnboarding).toHaveBeenCalled();
    expect(route).toHaveBeenCalledWith('/parent-dashboard');
  });

  test('finishing still reaches the dashboard when the server does not answer', async () => {
    api.completeOnboarding.mockRejectedValue(new Error('offline'));
    const route = jest.fn();
    await new ParentOnboarding({ router: { route } }).init();

    document.getElementById('onboarding-done').click();
    await flush();

    expect(route).toHaveBeenCalledWith('/parent-dashboard');
  });

  test('children\'s names are escaped', async () => {
    api.getOnboardingContext.mockResolvedValue({
      data: { ...CONTEXT, children: [{ ...CONTEXT.children[0], first_name: '<img src=x onerror=alert(1)>' }] },
    });

    await new ParentOnboarding({}).init();

    expect(document.querySelector('img')).toBeNull();
  });

  test('birth-date checks match the server\'s bounds', () => {
    const now = new Date(2026, 8, 24);
    const child = (born) => ({ first_name: 'A', last_name: 'B', date_naissance: born });

    expect(childProblem(child('2026-09-24'), now)).toBeNull();
    expect(childProblem(child('2026-09-25'), now)).toBe('onboarding_error_dob_future');
    expect(childProblem(child('2000-09-24'), now)).toBeNull();
    expect(childProblem(child('2000-09-23'), now)).toBe('onboarding_error_dob_too_old');
  });
});

describe('sharing a family', () => {
  const LINKS = {
    links: [{ id: 5, partner_name: 'Carole', partner_email: 'carole@example.org' }],
    requests: [
      { id: 'r1', target_email: 'waiting@example.org', state: 'pending', sent_at: '2026-09-20T12:00:00Z' },
      { id: 'r2', target_email: 'done@example.org', state: 'accepted' },
    ],
  };

  beforeEach(() => {
    api.getFamilyLinks.mockResolvedValue({ data: LINKS });
  });

  test('lists who the parent shares with and what is still waiting', async () => {
    await new FamilyAccess({}).init();

    const text = document.getElementById('app').textContent;
    expect(text).toContain('Carole');
    expect(text).toContain('waiting@example.org');
    // Only the waiting request can be resent or withdrawn.
    expect(document.querySelectorAll('[data-resend]')).toHaveLength(1);
    expect(document.querySelector('[data-resend]').dataset.resend).toBe('r1');
  });

  test('explains what sharing means before asking for an address', async () => {
    await new FamilyAccess({}).init();

    const text = document.getElementById('app').textContent;
    expect(text).toContain('family_access_means_both_ways');
    expect(text).toContain('family_access_means_consent');
    expect(text).toContain('family_link_can_end');
  });

  test('sends a request and says nothing is shared yet', async () => {
    api.requestFamilyLink.mockResolvedValue({ data: { email_sent: true } });
    await new FamilyAccess({}).init();

    document.getElementById('family-access-email').value = ' other@example.org ';
    document.getElementById('family-access-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(api.requestFamilyLink).toHaveBeenCalledWith('other@example.org');
    expect(document.getElementById('family-access-status').textContent).toBe('family_access_sent');
  });

  test.each([
    ['self', 'family_access_error_self'],
    ['no_children', 'family_access_error_no_children'],
    ['already_linked', 'family_access_error_already_linked'],
    ['already_requested', 'family_access_error_already_requested'],
  ])('a %s refusal is explained', async (code, message) => {
    api.requestFamilyLink.mockRejectedValue(apiError(code === 'self' || code === 'no_children' ? 400 : 409, code));
    await new FamilyAccess({}).init();

    document.getElementById('family-access-email').value = 'x@example.org';
    document.getElementById('family-access-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(document.getElementById('family-access-error').textContent).toBe(message);
  });

  test('stopping sharing asks first, naming the person', async () => {
    api.endFamilyLink.mockResolvedValue({ data: {} });
    await new FamilyAccess({}).init();

    document.querySelector('[data-end-link="5"]').click();
    await flush();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(api.endFamilyLink).toHaveBeenCalledWith(5);
  });

  test('saying no keeps the link', async () => {
    confirm.mockResolvedValueOnce(false);
    await new FamilyAccess({}).init();

    document.querySelector('[data-end-link="5"]').click();
    await flush();

    expect(api.endFamilyLink).not.toHaveBeenCalled();
  });

  test('a partner\'s name is escaped', async () => {
    api.getFamilyLinks.mockResolvedValue({
      data: { links: [{ id: 5, partner_name: '<img src=x onerror=alert(1)>', partner_email: 'x@example.org' }], requests: [] },
    });

    await new FamilyAccess({}).init();

    expect(document.querySelector('img')).toBeNull();
  });
});
