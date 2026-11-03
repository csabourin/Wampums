/**
 * @jest-environment jsdom
 */

/**
 * Where a camp is held (#1317).
 *
 * Held here: the camp's site, its emergency information and what it lacks;
 * a camp with no site says so; someone who may only look sees no choice to
 * make; a manager's choices are sent with the version loaded; a refusal is
 * shown next to its field or in the form, never as saved; a lead who left the
 * unit stays visible as such; directions open safely in a new tab; names are
 * shown as text; the screen meets WCAG A/AA; a late answer does not draw over
 * the next screen.
 *
 * @module test/spa/CampSite
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
  getCampSite: jest.fn(), getCampSites: jest.fn(), saveCampSite: jest.fn(),
  createCampSite: jest.fn(), updateCampSite: jest.fn(), setCampSiteArchived: jest.fn(),
}));

const api = require('../../spa/api/api-camp-sites.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');
const { CampSite } = require('../../spa/modules/camp-sites/CampSite.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const LEAD = '00000000-0000-4000-8000-000000000002';
const SITE = {
  id: 4, name: 'Fictional Lake Camp', owner_name: 'Fictional Trust', address: '1 Fictional Road', province: 'QC',
  phone: '555-0100', accommodation: 'tent', heating: 'wood', has_own_insurance: true,
  hospital_name: 'Fictional Memorial Hospital', hospital_phone: '555-0199', hospital_travel_minutes: 47, hospital_distance_km: 46.4,
  poison_centre_phone: '1-800-463-5060', directions_url: 'https://maps.example.test/to-camp', hospital_directions_url: 'javascript:alert(1)',
  version: 2, archived: false, gaps: [],
};

/** @returns {Object} A camp held at the fictional lake */
function campSite(overrides = {}) {
  return {
    camp: { id: 12, theme: 'Camp d’été', date_from: '2027-07-10', date_to: '2027-07-17', is_cancelled: false },
    details: { camp_site_id: 4, season: 'summer', accommodation: null, on_site_lead_id: LEAD, on_site_lead_name: 'Ada Fiction', contact_phone: null, version: 3 },
    site: SITE,
    gaps: [],
    members: [{ id: LEAD, full_name: 'Ada Fiction' }, { id: '00000000-0000-4000-8000-000000000003', full_name: 'Léa Tremblay' }],
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
let app;
let screen;

async function open() {
  screen = new CampSite(app, { meetingId: 12 });
  await screen.init();
  await flush();
  return screen;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  app = { showMessage: jest.fn(), lang: 'fr' };
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getCampSite.mockResolvedValue({ success: true, data: campSite() });
  api.getCampSites.mockResolvedValue({ success: true, data: [SITE, { id: 5, name: 'Fictional Hill', archived: false }] });
  hasPermission.mockReset();
  hasPermission.mockImplementation(() => true);
});

afterEach(() => {
  closeAllModals();
  screen?.destroy();
});

describe('reading where the camp is held', () => {
  test('shows the site, the number families call (the site’s by default) and the trip to the hospital', async () => {
    hasPermission.mockImplementation((key) => key === 'meetings.view');
    await open();
    const text = $('.camp-site__site').textContent;
    expect(text).toContain('Fictional Lake Camp');
    expect(text).toContain('Fictional Memorial Hospital');
    expect(text).toContain('camp_site_minutes_value');
    expect(text).toContain('555-0100');
    expect(text).toContain('Ada Fiction');
    expect($('.camp-site__complete')).not.toBeNull();
    expect($('#camp-site-camp-form')).toBeNull();
    expect($('#camp-site-edit')).toBeNull();
    expect(api.getCampSites).not.toHaveBeenCalled();
    expect($('a[href="/camp-readiness/12"]')).not.toBeNull();
  });

  test('directions open in a new tab, say so, and a link that is not a web address is left out', async () => {
    await open();
    const links = [...document.querySelectorAll('.camp-site__links a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://maps.example.test/to-camp');
    expect(links[0].getAttribute('rel')).toContain('noopener');
    expect(links[0].textContent).toContain('camp_site_opens_new_tab');
  });

  test('what the emergency information lacks is listed in words', async () => {
    api.getCampSite.mockResolvedValue({ success: true, data: campSite({ gaps: ['hospital_phone', 'poison_centre_phone'] }) });
    await open();
    const gaps = $('.camp-site__gaps');
    expect(gaps.textContent).toContain('camp_site_hospital_phone');
    expect(gaps.textContent).toContain('camp_site_poison_centre');
  });

  test('a camp with no site says so', async () => {
    api.getCampSite.mockResolvedValue({ success: true, data: campSite({ site: null, details: null, gaps: ['site'] }) });
    await open();
    expect($('.camp-site__site .empty-state').textContent).toBe('camp_site_empty_manage');
    expect($('#camp-site-choice').value).toBe('');
  });

  test('a failed load is explained and can be retried', async () => {
    api.getCampSite.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await open();
    expect($('#app [role="alert"]').textContent).toContain('camp_site_load_failed');
    $('#camp-site-retry').click();
    await flush();
    expect($('.camp-site__site')).not.toBeNull();
  });

  test('names are shown as text', async () => {
    api.getCampSite.mockResolvedValue({ success: true, data: campSite({ site: { ...SITE, name: '<img src=x onerror=alert(1)>', owner_name: '<b>x</b>' } }) });
    await open();
    expect($('#app img')).toBeNull();
    expect($('.camp-site__site b')).toBeNull();
    expect($('#camp-site-site-title').textContent).toContain('<img src=x onerror=alert(1)>');
  });

  test('an answer arriving after leaving the screen draws nothing', async () => {
    let release;
    api.getCampSite.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    screen = new CampSite(app, { meetingId: 12 });
    const opening = screen.init();
    screen.destroy();
    document.getElementById('app').textContent = 'next screen';
    release({ success: true, data: campSite() });
    await opening;
    expect(document.getElementById('app').textContent).toBe('next screen');
  });

  test('the screen meets WCAG A/AA, for a manager and for a reader', async () => {
    await open();
    expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
    screen.destroy();
    hasPermission.mockImplementation((key) => key === 'meetings.view');
    await open();
    expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
  });
});

describe('choosing for this camp', () => {
  test('sends what was chosen with the version it loaded, then shows the result', async () => {
    api.saveCampSite.mockResolvedValue({ success: true, data: campSite({ details: { ...campSite().details, camp_site_id: 5, version: 4 } }) });
    await open();
    $('#camp-site-choice').value = '5';
    $('#camp-site-season').value = 'autumn';
    $('#camp-site-stay').value = 'cabin';
    $('#camp-site-contact').value = ' 555-0177 ';
    $('#camp-site-camp-form button[type="submit"]').click();
    await flush();

    expect(api.saveCampSite).toHaveBeenCalledTimes(1);
    expect(api.saveCampSite).toHaveBeenCalledWith(12, {
      camp_site_id: 5, season: 'autumn', accommodation: 'cabin', on_site_lead_id: LEAD, contact_phone: '555-0177', expected_version: 3,
    });
    expect(app.showMessage).toHaveBeenCalledWith('camp_site_saved', 'success');
    expect(document.activeElement.id).toBe('camp-site-site-title');
  });

  test('a refusal naming a field is shown next to it, and nothing reads as saved', async () => {
    api.saveCampSite.mockRejectedValue(Object.assign(new Error('camp_site_lead_inactive'), {
      status: 400, errors: [{ path: 'on_site_lead_id', msg: 'camp_site_lead_inactive' }],
    }));
    await open();
    $('#camp-site-camp-form button[type="submit"]').click();
    await flush();
    const error = $('#camp-site-lead-error');
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect($('#camp-site-lead').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement.id).toBe('camp-site-lead');
    expect(app.showMessage).not.toHaveBeenCalledWith('camp_site_saved', 'success');

    $('#camp-site-lead').dispatchEvent(new Event('change', { bubbles: true }));
    expect(error.hidden).toBe(true);
  });

  test('another leader’s change since is explained in the form', async () => {
    api.saveCampSite.mockRejectedValue(Object.assign(new Error('camp_site_version_conflict'), { status: 409 }));
    await open();
    $('#camp-site-camp-form button[type="submit"]').click();
    await flush();
    expect($('#camp-site-camp-error').hidden).toBe(false);
    expect($('#camp-site-camp-error').getAttribute('role')).toBe('alert');
  });

  test('a lead who left the unit stays chosen and is marked as such', async () => {
    api.getCampSite.mockResolvedValue({ success: true, data: campSite({ members: [{ id: '00000000-0000-4000-8000-000000000003', full_name: 'Léa Tremblay' }] }) });
    await open();
    const chosen = $('#camp-site-lead').selectedOptions[0];
    expect(chosen.value).toBe(LEAD);
    expect(chosen.textContent).toContain('camp_site_lead_inactive_option');
  });

  test('a site can be added from here, and is chosen once saved', async () => {
    api.createCampSite.mockResolvedValue({ success: true, data: { id: 7, name: 'Fictional New Site' } });
    await open();
    api.getCampSites.mockResolvedValue({ success: true, data: [SITE, { id: 7, name: 'Fictional New Site', archived: false }] });
    $('#camp-site-add').click();
    document.querySelector('[name="site_name"]').value = 'Fictional New Site';
    document.querySelector('button[form="camp-site-form"]').click();
    await flush();
    await flush();
    expect($('#camp-site-choice').value).toBe('7');
  });

  test('without site management, no site can be added or edited from here', async () => {
    hasPermission.mockImplementation((key) => key !== 'camp_sites.manage');
    await open();
    expect($('#camp-site-add')).toBeNull();
    expect($('#camp-site-edit')).toBeNull();
    expect($('#camp-site-camp-form')).not.toBeNull();
  });
});
