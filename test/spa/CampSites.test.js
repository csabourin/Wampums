/**
 * @jest-environment jsdom
 */

/**
 * The unit's camp sites (#1317), and the form a site is added or edited with.
 *
 * Held here: loading, error with retry, and an empty state that says what
 * would fill it; each site says what its emergency information lacks; only
 * whoever manages sites is offered add, edit and archive; names are shown as
 * text; the form checks the name and links before sending, ties each error to
 * its field and clears it on change, suggests the province's poison centre,
 * sends one request however often Save is pressed, and shows server refusals
 * next to their field; page and dialog meet WCAG A/AA; focus stays in the
 * dialog and returns on Escape.
 *
 * @module test/spa/CampSites
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(() => true),
  isDemoUser: jest.fn(() => false),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ hasActiveDialog: () => false }));
jest.mock('../../spa/api/api-camp-sites.js', () => ({
  getCampSites: jest.fn(), createCampSite: jest.fn(), updateCampSite: jest.fn(), setCampSiteArchived: jest.fn(),
}));

const api = require('../../spa/api/api-camp-sites.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');
const { CampSites } = require('../../spa/modules/camp-sites/CampSites.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

/** @returns {Object[]} Two fictional sites, one with its emergency information incomplete */
function sites() {
  return [
    { id: 4, name: 'Fictional Lake Camp', address: '1 Fictional Road', province: 'QC', accommodation: 'tent', version: 2, archived: false, gaps: [] },
    { id: 5, name: 'Fictional Hill', province: null, version: 1, archived: false, gaps: ['hospital_phone', 'poison_centre_phone'] },
  ];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const dialog = () => document.querySelector('#camp-site-dialog');
const field = (name) => dialog().querySelector(`[name="site_${name}"]`);
const submit = () => dialog().querySelector('button[type="submit"][form="camp-site-form"]');

let app;
let screen;

/** @returns {Promise<CampSites>} The open screen */
async function open() {
  screen = new CampSites(app);
  await screen.init();
  await flush();
  return screen;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  app = { showMessage: jest.fn(), lang: 'fr' };
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getCampSites.mockResolvedValue({ success: true, data: sites() });
  hasPermission.mockReset();
  hasPermission.mockImplementation(() => true);
});

afterEach(() => {
  closeAllModals();
  screen?.destroy();
});

describe('the unit’s sites', () => {
  test('says it is loading, then lists the sites with what each one’s emergency information lacks', async () => {
    let release;
    api.getCampSites.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    screen = new CampSites(app);
    const opening = screen.init();
    expect(document.querySelector('#app [role="status"]').textContent).toBe('loading');
    release({ success: true, data: sites() });
    await opening;

    const cards = [...document.querySelectorAll('.camp-sites__card')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('camp_site_emergency_complete');
    expect(cards[1].textContent).toContain('camp_site_emergency_missing');
    expect(cards[1].textContent).toContain('camp_site_hospital_phone');
    expect(document.querySelector('.back-link, a[href="/dashboard"]')).not.toBeNull();
  });

  test('a failed load is explained and can be retried', async () => {
    api.getCampSites.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await open();
    expect(document.querySelector('#app [role="alert"]').textContent).toContain('camp_sites_load_failed');
    document.getElementById('camp-sites-retry').click();
    await flush();
    expect(document.querySelectorAll('.camp-sites__card')).toHaveLength(2);
  });

  test('with no site yet, says what would fill the list', async () => {
    api.getCampSites.mockResolvedValue({ success: true, data: [] });
    await open();
    expect(document.querySelector('.empty-state').textContent).toBe('camp_sites_empty_manage');
  });

  test('someone who may only read sees no add, edit or archive control', async () => {
    hasPermission.mockImplementation((key) => key !== 'camp_sites.manage');
    await open();
    expect(document.getElementById('camp-sites-add')).toBeNull();
    expect(document.querySelector('[data-edit-site], [data-archive-site]')).toBeNull();
    expect(document.querySelector('.empty-state')).toBeNull();
  });

  test('site names are shown as text', async () => {
    api.getCampSites.mockResolvedValue({ success: true, data: [{ ...sites()[0], name: '<img src=x onerror=alert(1)>' }] });
    await open();
    expect(document.querySelector('#app img')).toBeNull();
    expect(document.querySelector('.camp-sites__name').textContent).toContain('<img src=x onerror=alert(1)>');
  });

  test('archiving a site sends it, says so, and reloads; showing archived sites asks for them', async () => {
    api.setCampSiteArchived.mockResolvedValue({ success: true, data: { id: 4, archived: true } });
    await open();
    document.querySelector('[data-archive-site="4"]').click();
    await flush();
    expect(api.setCampSiteArchived).toHaveBeenCalledWith(4, true);
    expect(app.showMessage).toHaveBeenCalledWith('camp_site_archived_done', 'success');

    const toggle = document.getElementById('camp-sites-archived');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await flush();
    expect(api.getCampSites).toHaveBeenLastCalledWith({ includeArchived: true });
  });

  test('a refused archive is explained, not reported as done', async () => {
    api.setCampSiteArchived.mockRejectedValue(Object.assign(new Error('camp_site_name_conflict'), { status: 409 }));
    await open();
    document.querySelector('[data-archive-site="4"]').click();
    await flush();
    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(app.showMessage).not.toHaveBeenCalledWith('camp_site_archived_done', 'success');
  });

  test('the page meets WCAG A/AA', async () => {
    await open();
    expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
  });
});

describe('adding and editing a site', () => {
  test('without a name, the error is shown next to the field and announced, and nothing is sent; it clears on typing', async () => {
    await open();
    document.getElementById('camp-sites-add').click();
    submit().click();
    await flush();

    const error = dialog().querySelector('#camp-site-name-error');
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(field('name').getAttribute('aria-invalid')).toBe('true');
    expect(field('name').getAttribute('aria-describedby')).toBe('camp-site-name-error');
    expect(document.activeElement).toBe(field('name'));
    expect(api.createCampSite).not.toHaveBeenCalled();

    field('name').value = 'Fictional';
    field('name').dispatchEvent(new Event('input', { bubbles: true }));
    expect(error.hidden).toBe(true);
    expect(field('name').hasAttribute('aria-invalid')).toBe(false);
  });

  test('a link that is not a web address is refused before sending', async () => {
    await open();
    document.getElementById('camp-sites-add').click();
    field('name').value = 'Fictional';
    field('directions_url').value = 'javascript:alert(1)';
    submit().click();
    await flush();
    expect(dialog().querySelector('#camp-site-directions-url-error').textContent).toBe('camp_site_invalid_url');
    expect(api.createCampSite).not.toHaveBeenCalled();
  });

  test('choosing a province suggests its poison centre, without replacing one already written', async () => {
    await open();
    document.getElementById('camp-sites-add').click();
    field('province').value = 'QC';
    field('province').dispatchEvent(new Event('change', { bubbles: true }));
    expect(field('poison_centre_phone').value).toBe('1-800-463-5060');

    field('poison_centre_phone').value = '555-0123';
    field('province').value = 'ON';
    field('province').dispatchEvent(new Event('change', { bubbles: true }));
    expect(field('poison_centre_phone').value).toBe('555-0123');
  });

  test('sends the site once however often Save is pressed, then reloads the list', async () => {
    let release;
    api.createCampSite.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    await open();
    document.getElementById('camp-sites-add').click();
    field('name').value = ' Fictional Lake ';
    field('accommodation').value = 'tent';
    field('hospital_travel_minutes').value = '47';
    field('hospital_distance_km').value = '46.4';
    dialog().querySelector('#camp-site-insurance-yes').checked = true;
    submit().click();
    submit().click();
    await flush();

    expect(api.createCampSite).toHaveBeenCalledTimes(1);
    expect(api.createCampSite.mock.calls[0][0]).toMatchObject({
      name: 'Fictional Lake', accommodation: 'tent', heating: null, has_own_insurance: true,
      hospital_travel_minutes: 47, hospital_distance_km: 46.4, phone: null, province: null,
    });
    release({ success: true, data: { id: 9 } });
    await flush();
    expect(dialog()).toBeNull();
    expect(app.showMessage).toHaveBeenCalledWith('camp_site_saved', 'success');
    expect(api.getCampSites).toHaveBeenCalledTimes(2);
  });

  test('editing sends the version it loaded, and a server refusal is shown next to its field', async () => {
    api.updateCampSite.mockRejectedValue(Object.assign(new Error('camp_site_name_conflict'), {
      status: 409, errors: [{ path: 'name', msg: 'camp_site_name_conflict' }],
    }));
    await open();
    document.querySelector('[data-edit-site="4"]').click();
    expect(field('name').value).toBe('Fictional Lake Camp');
    submit().click();
    await flush();

    expect(api.updateCampSite).toHaveBeenCalledWith(4, expect.objectContaining({ name: 'Fictional Lake Camp', expected_version: 2 }));
    expect(dialog()).not.toBeNull();
    expect(dialog().querySelector('#camp-site-name-error').hidden).toBe(false);
    expect(app.showMessage).not.toHaveBeenCalledWith('camp_site_saved', 'success');
  });

  test('the dialog meets WCAG A/AA, keeps focus inside, and Escape returns focus to the opener', async () => {
    await open();
    const opener = document.getElementById('camp-sites-add');
    opener.focus();
    opener.click();
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect((await axe.run(dialog(), AXE_OPTIONS)).violations).toEqual([]);

    submit().focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(dialog().contains(document.activeElement)).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
