/**
 * @jest-environment jsdom
 */

/**
 * The participant screens moved out of the spa/ root, held to CLAUDE.md §7:
 * the way back first in every state, a loading state, a failed load shown as
 * an alert with a retry (never as an empty list), empty states that say what
 * would fill them, names shown as text, errors tied to their field, and no
 * WCAG 2.x A/AA violation axe can find without layout.
 *
 * @module test/spa/ParticipantScreens
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({
  app: { showMessage: jest.fn() },
  translate: (key) => key,
}));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { UI: { SUCCESS_REDIRECT_DELAY: 0 }, STORAGE_KEYS: {} },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/api/api-reports.js', () => ({ getTimeSinceRegistration: jest.fn() }));
jest.mock('../../spa/ajax-functions.js', () => ({
  getParticipantsWithDocuments: jest.fn(),
  getOrganizationFormFormats: jest.fn(),
  getFormSubmission: jest.fn(),
  getParentContactList: jest.fn(),
  fetchParticipant: jest.fn(),
  getGuardiansForParticipant: jest.fn(),
  saveGuardian: jest.fn(),
  saveParticipant: jest.fn(),
  saveFormSubmission: jest.fn(),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getGuardiansForParticipant: jest.fn(),
  saveGuardian: jest.fn(),
  removeGuardians: jest.fn(),
  removeGuardian: jest.fn(),
  linkGuardianToParticipant: jest.fn(),
}));
jest.mock('../../spa/api/api-family.js', () => ({ registerChild: jest.fn(), updateOwnChild: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewParticipants: () => true,
  canSendCommunications: () => true,
  hasPermission: () => false,
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirm: jest.fn(), confirmDestructive: jest.fn() }));
jest.mock('../../spa/JSONFormRenderer.js', () => ({
  JSONFormRenderer: jest.fn().mockImplementation(() => ({ render: () => '<p>form</p>' })),
}));
jest.mock('../../spa/dynamicFormHandler.js', () => ({
  // Draws the three core participant fields, as the real handler does from the form format.
  DynamicFormHandler: jest.fn().mockImplementation(() => ({
    container: null,
    init(_type, _id, _data, containerId) {
      this.container = typeof containerId === 'string' ? globalThis.document.getElementById(containerId) : containerId;
      return Promise.resolve();
    },
    render() {
      this.container.innerHTML = ['first_name', 'last_name', 'date_naissance']
        .map((name) => `<label for="p-${name}">${name}</label><input id="p-${name}" name="${name}">`).join('');
    },
    getFormData() {
      return Object.fromEntries([...this.container.querySelectorAll('input')].map((input) => [input.name, input.value]));
    },
  })),
}));

import { getTimeSinceRegistration } from '../../spa/api/api-reports.js';
import {
  getParticipantsWithDocuments, getOrganizationFormFormats, getParentContactList,
} from '../../spa/ajax-functions.js';
import * as guardianApi from '../../spa/api/api-endpoints.js';
import { TimeSinceRegistration } from '../../spa/modules/participants/TimeSinceRegistration.js';
import { ViewParticipantDocuments } from '../../spa/modules/participants/ViewParticipantDocuments.js';
import { ParentContactList } from '../../spa/modules/participants/ParentContactList.js';
import { initGuardianManagement } from '../../spa/modules/participants/GuardianManagement.js';
import { FormulaireInscription } from '../../spa/modules/participants/FormulaireInscription.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const app = () => ({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });
const page = () => document.getElementById('app');

/** @returns {Promise<Array>} axe violations inside #app */
async function violations() {
  return (await axe.run(page(), AXE_OPTIONS)).violations;
}

/** The first thing on the page is the way back. */
function expectBackLinkFirst(href = '/dashboard') {
  const first = page().querySelector('a');
  expect(first.getAttribute('href')).toBe(href);
  expect(first.compareDocumentPosition(page().querySelector('h1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/** A load that never answers until the test lets it. */
function pending() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  history.replaceState(null, '', '/');
});

describe('time since registration', () => {
  const ROWS = [
    { id: 1, first_name: 'Léa', last_name: 'Roy', group_name: HOSTILE, inscription_date: '2020-09-01', years_with_group: 6, months_with_group: 1 },
    { id: 2, first_name: 'Ana', last_name: 'Diaz', group_name: null, inscription_date: '2025-09-01', years_with_group: 1, months_with_group: 0 },
  ];

  test('says it is loading, with the way back, until the report arrives', async () => {
    const load = pending();
    getTimeSinceRegistration.mockReturnValue(load.promise);
    const screen = new TimeSinceRegistration(app());

    const done = screen.init();
    expect(page().querySelector('[aria-busy="true"] [role="status"]').textContent).toBe('loading');
    expectBackLinkFirst();

    load.resolve({ success: true, data: ROWS });
    await done;
    expect(page().querySelector('[aria-busy="true"]')).toBeNull();
  });

  test('shows group names as text, in a table that scrolls on its own, and passes axe', async () => {
    getTimeSinceRegistration.mockResolvedValue({ success: true, data: ROWS });
    await new TimeSinceRegistration(app()).init();

    expect(page().querySelector('img')).toBeNull();
    expect(page().textContent).toContain(HOSTILE);
    expect(page().querySelector('.table-scroll[tabindex="0"] table')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  test('the sort buttons are named and say which one is on', async () => {
    getTimeSinceRegistration.mockResolvedValue({ success: true, data: ROWS });
    await new TimeSinceRegistration(app()).init();

    const byName = page().querySelector('[data-sort="name"]');
    expect(byName.getAttribute('aria-label')).toBe('sort_by_name');
    expect(byName.getAttribute('aria-pressed')).toBe('false');
    byName.click();
    expect(byName.getAttribute('aria-pressed')).toBe('true');
    expect(page().querySelector('tbody th').textContent).toBe('Ana Diaz');
  });

  test('a failed load is an alert with a retry, not an empty list', async () => {
    getTimeSinceRegistration.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true, data: ROWS });
    const screen = new TimeSinceRegistration(app());
    await screen.init();

    expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_data');
    expectBackLinkFirst();
    expect(await violations()).toEqual([]);

    page().querySelector('#page-retry').click();
    await flush();
    expect(page().querySelectorAll('tbody tr')).toHaveLength(2);
  });

  test('an answer that arrives after the person left draws nothing', async () => {
    const load = pending();
    getTimeSinceRegistration.mockReturnValue(load.promise);
    const screen = new TimeSinceRegistration(app());
    const done = screen.init();

    screen.destroy();
    page().innerHTML = '<h1>Next screen</h1>';
    load.resolve({ success: true, data: ROWS });
    await done;

    expect(page().textContent).toBe('Next screen');
  });
});

describe('participant documents', () => {
  function formats() {
    getOrganizationFormFormats.mockResolvedValue({
      formats: { fiche_sante: { fields: [] }, risk: { fields: [] } },
      meta: { fiche_sante: { display_name: 'Fiche santé' }, risk: { display_name: 'Risques' } },
    });
  }

  test('says in words which forms are in, names each View button, and passes axe', async () => {
    formats();
    getParticipantsWithDocuments.mockResolvedValue({
      participants: [{ id: 3, first_name: HOSTILE, last_name: 'Roy', has_fiche_sante: true, has_risk: false }],
    });
    await new ViewParticipantDocuments(app()).init();

    expectBackLinkFirst();
    expect(page().querySelector('img')).toBeNull();
    expect(page().textContent).toContain('participant_documents_submitted');
    expect(page().textContent).toContain('participant_documents_missing');
    const view = page().querySelector('.view-form');
    expect(view.textContent.replace(/\s+/g, ' ').trim()).toBe(`view Fiche santé — ${HOSTILE} Roy`);
    expect(await violations()).toEqual([]);
  });

  test('with nobody to show, says so', async () => {
    formats();
    getParticipantsWithDocuments.mockResolvedValue({ participants: [] });
    await new ViewParticipantDocuments(app()).init();

    expect(page().querySelector('.no-data').textContent).toBe('no_participants_found');
  });

  test('a failed load keeps the page title and offers a retry', async () => {
    getOrganizationFormFormats.mockRejectedValue(new Error('offline'));
    await new ViewParticipantDocuments(app()).init();

    expect(page().querySelector('h1').textContent).toBe('view_participant_documents');
    expect(page().querySelector('[role="alert"]')).not.toBeNull();
    expect(page().querySelector('#page-retry')).not.toBeNull();
    expectBackLinkFirst();
  });
});

describe('parent contact list', () => {
  const CONTACTS = {
    contacts: [
      { participant_id: 1, first_name: 'Léa', last_name: 'Roy', guardian_id: 9, prenom: HOSTILE, nom: 'Roy', courriel: 'marie@example.org' },
    ],
  };

  test('has a labelled search, shows names as text and passes axe', async () => {
    getParentContactList.mockResolvedValue(CONTACTS);
    await new ParentContactList(app()).init();

    expectBackLinkFirst();
    expect(page().querySelector('label[for="contact-search"]').textContent).toBe('search_participants');
    expect(page().querySelector('img')).toBeNull();
    expect(page().textContent).toContain(HOSTILE);
    expect(await violations()).toEqual([]);
  });

  test('says when nobody matches the search, and when there is nobody at all', async () => {
    jest.useFakeTimers();
    getParentContactList.mockResolvedValue(CONTACTS);
    const screen = new ParentContactList(app());
    await screen.init();

    const search = page().querySelector('#contact-search');
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    jest.runAllTimers();
    expect(page().querySelector('.no-data').textContent).toBe('parent_contact_list_no_match');
    jest.useRealTimers();

    getParentContactList.mockResolvedValue({ contacts: [] });
    await new ParentContactList(app()).init();
    expect(page().querySelector('.no-data').textContent).toBe('parent_contact_list_empty');
  });

  test('a failed load keeps the way back and offers a retry', async () => {
    getParentContactList.mockRejectedValue(new Error('offline'));
    await new ParentContactList(app()).init();

    expectBackLinkFirst();
    expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_parent_contact_list');
    expect(page().querySelector('#page-retry')).not.toBeNull();
  });
});

describe('guardian management', () => {
  const GUARDIANS = [
    { id: 7, prenom: HOSTILE, nom: 'Roy', lien: 'Mère', courriel: 'marie@example.org', is_primary: true },
    { id: 8, prenom: 'Paul', nom: 'Roy', lien: 'Père' },
  ];

  async function open() {
    history.replaceState(null, '', '/guardian-management?participant_id=12&participant_name=L%C3%A9a%20Roy');
    guardianApi.getGuardiansForParticipant.mockResolvedValue({ success: true, data: GUARDIANS });
    const screen = await initGuardianManagement(app());
    return screen;
  }

  test('an address without a participant shows the reason and the way back, instead of crashing', async () => {
    history.replaceState(null, '', '/guardian-management');

    const screen = await initGuardianManagement(app());

    expect(screen).toBeNull();
    expectBackLinkFirst('/manage-participants');
    expect(page().querySelector('[role="alert"]').textContent).toBe('invalid_parameters');
  });

  test('lists guardians as text, returns the screen to the router, and passes axe', async () => {
    const screen = await open();

    expect(typeof screen.destroy).toBe('function');
    expectBackLinkFirst('/manage-participants');
    expect(page().querySelector('img')).toBeNull();
    expect(page().querySelector('.guardian-card h2').textContent).toBe(`${HOSTILE} Roy`);
    expect(await violations()).toEqual([]);
  });

  test('a missing required field is shown under it and nothing is sent', async () => {
    await open();
    page().querySelector('#add-guardian-btn').click();

    expect(document.activeElement.id).toBe('add-prenom');
    page().querySelector('#add-guardian-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    expect(guardianApi.saveGuardian).not.toHaveBeenCalled();
    const first = page().querySelector('#add-prenom');
    expect(first.getAttribute('aria-invalid')).toBe('true');
    expect(page().querySelector('#add-prenom-error').textContent).toBe('first_name_required');
    expect(first.getAttribute('aria-describedby')).toBe('add-prenom-error');
    expect(await violations()).toEqual([]);

    first.value = 'Anne';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    expect(page().querySelector('#add-prenom-error').textContent).toBe('');
  });

  test('saving goes through the form, so Enter in a field saves instead of reloading', async () => {
    await open();
    guardianApi.saveGuardian.mockResolvedValue({ success: true, data: { id: 9 } });
    guardianApi.linkGuardianToParticipant.mockResolvedValue({ success: true });
    page().querySelector('#add-guardian-btn').click();
    page().querySelector('#add-prenom').value = 'Anne';
    page().querySelector('#add-nom').value = 'Roy';
    page().querySelector('#add-lien').value = 'Tante';
    // The save button sits in the card footer and names the form it submits.
    expect(page().querySelector('button[type="submit"]').getAttribute('form')).toBe('add-guardian-form');

    const submit = new Event('submit', { cancelable: true });
    page().querySelector('#add-guardian-form').dispatchEvent(submit);
    await flush();

    expect(submit.defaultPrevented).toBe(true);
    expect(guardianApi.saveGuardian).toHaveBeenCalledWith(expect.objectContaining({ prenom: 'Anne', participant_id: 12 }));
    expect(guardianApi.linkGuardianToParticipant).toHaveBeenCalledWith(12, 9);
  });

  test('a failed load is an alert with a retry', async () => {
    history.replaceState(null, '', '/guardian-management?participant_id=12&participant_name=L%C3%A9a');
    guardianApi.getGuardiansForParticipant.mockRejectedValue(new Error('offline'));

    await initGuardianManagement(app());

    expectBackLinkFirst('/manage-participants');
    expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_guardians');
    expect(page().querySelector('#page-retry')).not.toBeNull();
  });
});

describe('registration form', () => {
  test('opens with the way back, and a missing field is marked and said under the form', async () => {
    const screen = new FormulaireInscription(app());
    await screen.init();

    expectBackLinkFirst();
    page().querySelector('#p-first_name').value = 'Léa';
    page().querySelector('#inscription-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    expect(page().querySelector('#inscription-error').textContent).toBe('missing_required_fields');
    expect(page().querySelector('#p-first_name').getAttribute('aria-invalid')).toBe('false');
    expect(page().querySelector('#p-last_name').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement.id).toBe('p-last_name');
    expect(await violations()).toEqual([]);
  });
});
