/**
 * @jest-environment jsdom
 */

/**
 * The two pages an emailed link opens: completing an invitation, and answering
 * another parent's request to share a family.
 *
 * What these pages must never do is act on their own. A mail client or a
 * security scanner fetches the link before any human does, so opening the page
 * may only *ask* what the link is; spending it takes a submit. The assertions
 * are about the requests the page makes, because that is the whole of what a
 * scanner could trigger.
 *
 * @module test/spa/FamilyAccessLinks
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

// config.js reads import.meta and cannot load under Jest. The stub returns a
// base that already carries a query string -- the shape that once broke the
// reactivation page -- so a URL built by concatenation would visibly fail here.
jest.mock('../../spa/config.js', () => ({
  getApiUrl: (endpoint) => `https://unit.example.org${endpoint}?organization_id=1`,
  CONFIG: { API_BASE_URL: 'https://unit.example.org', SUPPORTED_LANGS: ['en', 'fr'] },
}));

jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

import { CompleteRegistration } from '../../spa/modules/family-access/CompleteRegistration.js';
import { FamilyLinkReview } from '../../spa/modules/family-access/FamilyLinkReview.js';
import { passwordProblem } from '../../spa/modules/family-access/AccountFields.js';

const TOKEN = 'Abc_def-123ghiJKLmnoPQRstuVWXyz0123456789abc';
const GOOD_PASSWORD = 'Scouts2026-';

/**
 * Answer fetch calls in order, recording each request.
 *
 * @param {Array<Object>} bodies - Response bodies, one per call
 * @param {Array<number>} [statuses] - Status per call, default 200
 * @returns {void}
 */
function respondWith(bodies, statuses = []) {
  let call = 0;
  global.fetch = jest.fn(() => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    const status = statuses[call] || 200;
    call += 1;
    return Promise.resolve({ ok: status < 400, status, json: async () => body });
  });
}

/** @returns {Array<{url: string, method: string, body: Object|null}>} Requests made */
function requests() {
  return global.fetch.mock.calls.map(([input, init = {}]) => ({
    url: input instanceof URL ? input.toString() : String(input),
    method: init.method || 'GET',
    body: init.body ? JSON.parse(init.body) : null,
  }));
}

/**
 * Let pending promises settle.
 *
 * @returns {Promise<void>}
 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Fill the account form.
 *
 * @param {Object} values - Field values
 * @returns {void}
 */
function fill(values) {
  const set = (id, value) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  };
  set('account-first-name', values.first ?? 'Ada');
  set('account-last-name', values.last ?? 'Lovelace');
  set('account-password', values.password ?? GOOD_PASSWORD);
  set('account-password-confirm', values.confirm ?? values.password ?? GOOD_PASSWORD);
}

/**
 * Submit a form the way the browser does.
 *
 * @param {string} id - Form id
 * @returns {Promise<void>}
 */
async function submit(id) {
  document.getElementById(id).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

describe('completing an invitation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', `/complete-registration?token=${encodeURIComponent(TOKEN)}`);
  });

  test('opening the page only asks what the link is', async () => {
    respondWith([{ data: { state: 'ready_new_account', email: 'ada@example.org' } }]);

    await new CompleteRegistration({ lang: 'fr' }).init();

    const made = requests();
    expect(made).toHaveLength(1);
    expect(made[0].method).toBe('GET');
    expect(made[0].url).toContain('/api/v1/public/parent-invitations/describe');
    // Appended to the existing query string, not a second one.
    expect(made[0].url.split('?')).toHaveLength(2);
    expect(new URL(made[0].url).searchParams.get('token')).toBe(TOKEN);
  });

  test('shows the address locked and the admin\'s prefill ready to correct', async () => {
    respondWith([{
      data: {
        state: 'ready_new_account',
        email: 'ada@example.org',
        first_name: 'Adda',
        last_name: 'Lovelace',
        organization_name: '6A St-Paul',
      },
    }]);

    await new CompleteRegistration({}).init();

    const email = document.getElementById('account-email');
    expect(email.disabled).toBe(true);
    expect(email.value).toBe('ada@example.org');
    expect(document.getElementById('account-first-name').value).toBe('Adda');
    expect(document.querySelector('h1').textContent).toBe('6A St-Paul');
    expect(document.getElementById('account-password')).not.toBeNull();
  });

  test('never offers a password field to someone who already has an account', async () => {
    respondWith([{ data: { state: 'ready_existing_account', email: 'veteran@example.org' } }]);

    await new CompleteRegistration({}).init();

    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.getElementById('complete-registration-confirm')).not.toBeNull();
  });

  test('a weak password is caught before anything is sent', async () => {
    respondWith([{ data: { state: 'ready_new_account', email: 'ada@example.org' } }]);
    await new CompleteRegistration({}).init();

    fill({ password: 'weakpass' });
    await submit('complete-registration-form');

    expect(requests()).toHaveLength(1);
    const error = document.getElementById('complete-registration-error');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('password_needs_uppercase');
  });

  test('mismatched passwords are caught before anything is sent', async () => {
    respondWith([{ data: { state: 'ready_new_account', email: 'ada@example.org' } }]);
    await new CompleteRegistration({}).init();

    fill({ confirm: 'Different2026!' });
    await submit('complete-registration-form');

    expect(requests()).toHaveLength(1);
    expect(document.getElementById('complete-registration-error').textContent).toBe('passwords_do_not_match');
  });

  test('submitting sends the token and the fields, never an address or the confirmation', async () => {
    respondWith([
      { data: { state: 'ready_new_account', email: 'ada@example.org' } },
      { data: { state: 'ready_new_account', result: 'account_created', organization_name: '6A' } },
    ]);
    await new CompleteRegistration({}).init();

    fill({});
    await submit('complete-registration-form');

    const post = requests()[1];
    expect(post.method).toBe('POST');
    expect(post.url).toContain('/api/v1/public/parent-invitations/accept');
    expect(post.body).toMatchObject({ token: TOKEN, first_name: 'Ada', last_name: 'Lovelace', password: GOOD_PASSWORD });
    expect(post.body).not.toHaveProperty('email');
    expect(post.body).not.toHaveProperty('password_confirm');

    expect(document.querySelector('[role="status"]').textContent).toBe('complete_registration_done_created');
    expect(document.querySelector('a[href="/login"]')).not.toBeNull();
  });

  test.each([
    ['accepted', 'complete_registration_already_used', true],
    ['expired', 'complete_registration_expired', false],
    ['revoked', 'complete_registration_revoked', false],
    ['invalid', 'complete_registration_invalid', false],
  ])('a %s link says so and offers login only when there is an account', async (state, message, login) => {
    respondWith([{ data: { state } }]);

    await new CompleteRegistration({}).init();

    expect(document.querySelector('[role="status"]').textContent).toBe(message);
    expect(Boolean(document.querySelector('a[href="/login"]'))).toBe(login);
    expect(document.querySelector('form')).toBeNull();
  });

  test('a page opened without a token asks the server nothing', async () => {
    window.history.replaceState({}, '', '/complete-registration');
    respondWith([{ data: { state: 'ready_new_account' } }]);

    await new CompleteRegistration({}).init();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]').textContent).toBe('complete_registration_invalid');
  });

  test('names from the server are escaped, not rendered', async () => {
    respondWith([{
      data: {
        state: 'ready_new_account',
        email: 'ada@example.org',
        organization_name: '<img src=x onerror="window.__pwned=1">',
        support_contact_name: '<script>window.__pwned=1</script>',
        support_contact_email: 'help@example.org',
      },
    }]);

    await new CompleteRegistration({}).init();

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('h1').textContent).toContain('<img');
  });
});

describe('answering a family-link request', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', `/family-link?token=${encodeURIComponent(TOKEN)}`);
  });

  test('opening the page asks, explains, and shares nothing', async () => {
    respondWith([{
      data: {
        state: 'ready_existing_account',
        email: 'carole@example.org',
        requester_name: 'Alice',
        organization_name: '6A',
        shared_children_count: 2,
      },
    }]);

    await new FamilyLinkReview({}).init();

    expect(requests()).toHaveLength(1);
    expect(requests()[0].method).toBe('GET');
    const text = document.getElementById('app').textContent;
    expect(text).toContain('family_link_shares_many');
    expect(text).toContain('family_link_shares_yours');
    expect(text).toContain('family_link_shares_future');
    expect(document.getElementById('family-link-decline')).not.toBeNull();
  });

  test('declining posts only to the decline endpoint', async () => {
    respondWith([
      { data: { state: 'ready_existing_account', email: 'carole@example.org' } },
      { data: { state: 'ready_existing_account', declined: true } },
    ]);
    await new FamilyLinkReview({}).init();

    document.getElementById('family-link-decline').click();
    await flush();

    const post = requests()[1];
    expect(post.url).toContain('/api/v1/public/family-links/decline');
    expect(post.body).toEqual({ token: TOKEN });
    expect(document.querySelector('[role="status"]').textContent).toBe('family_link_done_declined');
  });

  test('accepting with an account sends only the token', async () => {
    respondWith([
      { data: { state: 'ready_existing_account', email: 'carole@example.org' } },
      { data: { state: 'ready_existing_account', result: 'linked' } },
    ]);
    await new FamilyLinkReview({}).init();

    await submit('family-link-form');

    const post = requests()[1];
    expect(post.url).toContain('/api/v1/public/family-links/accept');
    expect(post.body).toEqual({ token: TOKEN });
    expect(document.querySelector('[role="status"]').textContent).toBe('family_link_done_linked');
  });

  test('a new reader must create an account, and the page checks it first', async () => {
    respondWith([
      { data: { state: 'ready_new_account', email: 'new@example.org' } },
      { data: { state: 'ready_new_account', result: 'linked' } },
    ]);
    await new FamilyLinkReview({}).init();

    fill({ first: '' });
    await submit('family-link-form');
    expect(requests()).toHaveLength(1);
    expect(document.getElementById('family-link-error').textContent).toBe('account_name_required');

    fill({});
    await submit('family-link-form');
    expect(requests()[1].body).toMatchObject({ token: TOKEN, first_name: 'Ada', password: GOOD_PASSWORD });
  });

  test('someone an administrator removed is told to contact the unit', async () => {
    respondWith([
      { data: { state: 'ready_existing_account', email: 'removed@example.org' } },
      { data: { state: 'ready_existing_account', error: 'membership_blocked' } },
    ]);
    await new FamilyLinkReview({}).init();

    await submit('family-link-form');

    expect(document.getElementById('family-link-error').textContent).toBe('family_link_membership_blocked');
    expect(document.getElementById('family-link-accept').disabled).toBe(false);
  });

  test('the requester\'s name is escaped', async () => {
    respondWith([{
      data: {
        state: 'ready_existing_account',
        email: 'carole@example.org',
        requester_name: '<img src=x onerror="window.__pwned=1">',
        organization_name: '6A',
        shared_children_count: 1,
      },
    }]);

    await new FamilyLinkReview({}).init();

    expect(document.querySelector('img')).toBeNull();
  });

  test.each([
    ['declined', 'family_link_already_declined'],
    ['unavailable', 'family_link_unavailable'],
    ['expired', 'family_link_expired'],
    ['revoked', 'family_link_withdrawn'],
  ])('a %s request cannot be answered and says why', async (state, message) => {
    respondWith([{ data: { state } }]);

    await new FamilyLinkReview({}).init();

    expect(document.querySelector('[role="status"]').textContent).toBe(message);
    expect(document.getElementById('family-link-accept')).toBeNull();
  });
});

describe('password rules', () => {
  test('match the server: any non-alphanumeric character is special', () => {
    // The older client rule listed specific characters and refused these.
    expect(passwordProblem('Scouts2026-')).toBeNull();
    expect(passwordProblem('Scouts2026_')).toBeNull();
    expect(passwordProblem('Scouts2026é')).toBeNull();
  });

  test('refuse what the server refuses', () => {
    expect(passwordProblem('Short1!')).toBe('password_min_length');
    expect(passwordProblem('nouppercase1!')).toBe('password_needs_uppercase');
    expect(passwordProblem('NOLOWERCASE1!')).toBe('password_needs_lowercase');
    expect(passwordProblem('NoDigitsHere!')).toBe('password_needs_number');
    expect(passwordProblem('NoSpecial2026')).toBe('password_needs_special');
  });
});

describe('opening in the email\'s language', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', `/complete-registration?token=${encodeURIComponent(TOKEN)}`);
  });

  test('switches to the invitation\'s language before showing anything else', async () => {
    respondWith([{ data: { state: 'ready_new_account', email: 'ada@example.org', language: 'fr' } }]);
    const app = { lang: 'en', setLanguage: jest.fn(async function set(lang) { this.lang = lang; }) };

    await new CompleteRegistration(app).init();

    expect(app.setLanguage).toHaveBeenCalledWith('fr');
    // The app was still starting, so no reload follows: this pass renders the form.
    expect(document.getElementById('complete-registration-form')).not.toBeNull();
  });

  test('once the app is running, lets the reload render instead of racing it', async () => {
    respondWith([{ data: { state: 'ready_new_account', email: 'ada@example.org', language: 'fr' } }]);
    const app = {
      lang: 'en',
      initCompleted: true,
      router: {},
      setLanguage: jest.fn(async () => {}),
    };

    await new CompleteRegistration(app).init();

    expect(app.setLanguage).toHaveBeenCalledWith('fr');
    expect(document.getElementById('complete-registration-form')).toBeNull();
  });

  test('leaves the language alone when it already matches, or is not offered', async () => {
    const app = { lang: 'fr', setLanguage: jest.fn() };

    respondWith([{ data: { state: 'ready_new_account', email: 'ada@example.org', language: 'fr' } }]);
    await new CompleteRegistration(app).init();
    respondWith([{ data: { state: 'ready_new_account', email: 'ada@example.org', language: 'it' } }]);
    await new CompleteRegistration(app).init();

    expect(app.setLanguage).not.toHaveBeenCalled();
  });

  test('the family-link page follows its email\'s language too', async () => {
    window.history.replaceState({}, '', `/family-link?token=${encodeURIComponent(TOKEN)}`);
    respondWith([{ data: { state: 'ready_existing_account', email: 'c@example.org', language: 'en' } }]);
    const app = { lang: 'fr', setLanguage: jest.fn(async function set(lang) { this.lang = lang; }) };

    await new FamilyLinkReview(app).init();

    expect(app.setLanguage).toHaveBeenCalledWith('en');
  });
});
