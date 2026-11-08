/**
 * @jest-environment jsdom
 */

/**
 * The camp permit's checklist (#1416): the plan's header, then each line of the
 * permit in words, grouped as the permit lists them, leading to the screen that
 * completes it; a line the person may not read says so without a link; nothing
 * reads as compliant; a failed load offers a retry; names are shown as text;
 * the screen meets WCAG A/AA.
 *
 * @module test/spa/CampPermit
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
// A version names who submitted it through a placeholder; every other key reads as itself.
jest.mock('../../spa/app.js', () => ({ translate: (key) => (key === 'camp_plan_version_meta' ? 'by {name}' : key) }));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { PROGRAM_SECTIONS: { DEFAULT: [{ key: 'general', labelKey: 'program_section_general' }, { key: 'cubs', labelKey: 'program_section_cubs' }] } },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(() => true), canAccessAdminPanel: jest.fn(() => true), canViewCarpools: jest.fn(() => true),
  isDemoUser: jest.fn(() => false),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirm: jest.fn() }));
jest.mock('../../spa/api/api-camp-plans.js', () => ({
  getCampPermit: jest.fn(), getCampPlanVersions: jest.fn(), submitCampPlanVersion: jest.fn(), getCampPlanVersionPdf: jest.fn(),
}));

const { getCampPermit, getCampPlanVersions, submitCampPlanVersion, getCampPlanVersionPdf } = require('../../spa/api/api-camp-plans.js');
const { hasPermission, canAccessAdminPanel, isDemoUser } = require('../../spa/utils/PermissionUtils.js');
const { confirm } = require('../../spa/utils/DialogUtils.js');
const { CampPermit } = require('../../spa/modules/camp-plan/CampPermit.js');
const RULES = require('../../config/camp_permit.json');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
const lineOf = (key) => Array.from(document.querySelectorAll('.camp-permit__line'))
  .find((item) => item.querySelector('h3').textContent === `camp_permit_line_${key}`);
let screen;

/** Every line not verified, then the ones a test needs. */
function permit(overrides = {}) {
  const lines = RULES.GROUPS.flatMap((group) => group.lines).map((key) => ({ key, state: 'unverified', reasons: ['not_in_wampums'] }));
  const set = (key, entry) => Object.assign(lines.find((item) => item.key === key), entry);
  set('identification', { state: 'to_complete', reasons: ['missing_district'] });
  set('dates', { state: 'complete', reasons: [], counts: { days: 8 } });
  set('written_sections', { state: 'to_complete', reasons: ['sections_to_write'], counts: { to_write: 3, to_review: 0 } });
  set('team_list', { state: 'to_complete', reasons: ['no_first_aider'], blocking: true });
  set('evaluation', { state: 'unverified', reasons: ['no_access'] });
  Object.entries(overrides).forEach(([key, entry]) => set(key, entry));
  return { success: true, data: {
    camp: { id: 12, theme: 'Camp d’été', date_from: '2027-07-04', date_to: '2027-07-11', activity_id: 30, is_cancelled: false, year_plan_id: 5 },
    header: { name: '12e Meute', unit: '12e', scout_groups: ['Groupe de la Rivière'], district: null, coeducation: 'mixed',
      program_section: 'cubs', days: 8, youth_count: 14 },
    groups: RULES.GROUPS,
    lines,
  } };
}

let app;
async function open() {
  app = { lang: 'fr', showMessage: jest.fn() };
  screen = new CampPermit(app, { meetingId: 12 });
  await screen.init();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  hasPermission.mockImplementation(() => true);
  canAccessAdminPanel.mockReturnValue(true);
  getCampPermit.mockReset().mockResolvedValue(permit());
  isDemoUser.mockReturnValue(false);
  confirm.mockReset().mockResolvedValue(true);
  getCampPlanVersions.mockReset().mockResolvedValue({ success: true, data: { versions: [], changed_since_latest: null } });
  submitCampPlanVersion.mockReset().mockResolvedValue({ success: true, data: { version_number: 1 } });
  getCampPlanVersionPdf.mockReset();
});

afterEach(() => screen?.destroy());

test('the checklist opens with a back link, then the plan’s header, then every line in the permit’s groups', async () => {
  await open();
  expect(getCampPermit).toHaveBeenCalledWith(12);
  expect($('#app .page').firstElementChild.matches('.back-link, a, nav')).toBe(true);
  expect($('h1').textContent).toBe('camp_permit_title');
  const headings = Array.from(document.querySelectorAll('.camp-plan__group > h2')).map((heading) => heading.textContent);
  expect(headings).toEqual(['camp_permit_header_title', ...RULES.GROUPS.map((group) => `camp_permit_group_${group.key}`),
    'camp_plan_versions_title']);
  expect(document.querySelectorAll('.camp-permit__line')).toHaveLength(RULES.GROUPS.flatMap((group) => group.lines).length);
  const header = $('.camp-permit__header').textContent;
  expect(header).toContain('Groupe de la Rivière');
  expect(header).toContain('program_section_cubs');
  expect(header).toContain('unit_coeducation_mixed');
  expect(header).toContain('14');
});

test('each line says its state in words, with what is missing, and leads to the screen that completes it', async () => {
  await open();
  const identification = lineOf('identification');
  expect(identification.querySelector('.camp-plan__chip').textContent).toBe('camp_permit_state_to_complete');
  expect(identification.textContent).toContain('camp_permit_reason_missing_district');
  expect(identification.querySelector('a').getAttribute('href')).toBe('/unit-settings');
  // A line to complete invites to complete it; any other only to view it.
  expect(identification.querySelector('a').textContent).toContain('camp_permit_open');
  expect(lineOf('rain_games').querySelector('a').textContent).toContain('camp_permit_view');
  expect(lineOf('written_sections').querySelector('a').getAttribute('href')).toBe('/camp-plan/12');
  expect(lineOf('rain_games').querySelector('a').getAttribute('href')).toBe('/camp-plan/12?part=rain');
  expect(lineOf('schedule').querySelector('a').getAttribute('href')).toBe('/yearly-planner/5');
  expect(lineOf('transport').querySelector('a').getAttribute('href')).toBe('/carpool/30');
  expect(lineOf('youth_list').querySelector('a').getAttribute('href')).toBe('/camp-roster/12');
  // Lines with no source in Wampums lead nowhere.
  expect(lineOf('menu').querySelector('a')).toBeNull();
  expect(lineOf('approvals').querySelector('a')).toBeNull();
});

test('a blocking gap says so in words, not by colour alone', async () => {
  await open();
  const team = lineOf('team_list');
  expect(team.querySelector('.camp-permit__state strong').textContent).toBe('camp_permit_blocking');
  expect(team.textContent).toContain('camp_permit_reason_no_first_aider');
});

test('a line the person may not read says so, with no link', async () => {
  await open();
  const evaluation = lineOf('evaluation');
  expect(evaluation.textContent).toContain('camp_permit_reason_no_access');
  expect(evaluation.querySelector('a')).toBeNull();
});

test('links are offered only to the screens the person may open', async () => {
  hasPermission.mockImplementation((key) => !['participants.view', 'personal_equipment.manage', 'camp_reviews.view'].includes(key));
  canAccessAdminPanel.mockReturnValue(false);
  getCampPermit.mockResolvedValue(permit({ evaluation: { state: 'unverified', reasons: ['after_camp'] } }));
  await open();
  ['identification', 'youth_list', 'team_list', 'health_forms', 'allergies', 'personal_material', 'evaluation']
    .forEach((key) => expect(lineOf(key).querySelector('a')).toBeNull());
  expect(Array.from(document.querySelectorAll('a')).some((link) => link.getAttribute('href') === '/unit-settings')).toBe(false);
});

test('a missing header value reads “to complete”, and the summary counts each state', async () => {
  await open();
  const district = Array.from(document.querySelectorAll('.camp-permit__header div'))
    .find((row) => row.querySelector('dt').textContent === 'District');
  expect(district.querySelector('dd').textContent.trim()).toBe('camp_permit_state_to_complete');
  const summary = Array.from(document.querySelectorAll('.camp-permit__summary li')).map((item) => item.textContent);
  expect(summary).toEqual(['camp_permit_summary_to_complete', 'camp_permit_summary_unverified', 'camp_permit_summary_complete']);
  // Nothing on the screen says the camp is compliant.
  expect(document.body.textContent).not.toMatch(/compliant|conforme/i);
});

test('names from the unit and the camp are shown as text', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const response = permit();
  response.data.camp.theme = hostile;
  response.data.header.scout_groups = [hostile];
  getCampPermit.mockResolvedValue(response);
  await open();
  expect(document.querySelector('#app img')).toBeNull();
  expect($('.camp-plan__camp').textContent).toContain(hostile);
  expect($('.camp-permit__header').textContent).toContain(hostile);
});

test('a failed load says so, with a retry that loads again', async () => {
  getCampPermit.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
  await open();
  expect($('[role="alert"]')).not.toBeNull();
  expect($('#app .page, #app section').querySelector('a')).not.toBeNull();
  $('#camp-permit-retry').click();
  await flush();
  expect(getCampPermit).toHaveBeenCalledTimes(2);
  expect($('h1').textContent).toBe('camp_permit_title');
  expect(document.querySelectorAll('.camp-permit__line').length).toBeGreaterThan(0);
});

test('a response arriving after the person left does not draw over the next screen', async () => {
  let answer;
  getCampPermit.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  screen = new CampPermit({ lang: 'fr' }, { meetingId: 12 });
  const loading = screen.init();
  screen.destroy();
  document.getElementById('app').textContent = 'next screen';
  answer(permit());
  await loading;
  expect(document.getElementById('app').textContent).toBe('next screen');
});

test('the checklist meets WCAG A/AA', async () => {
  await open();
  const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});

describe('submitted versions (#1418)', () => {
  const DIGEST = 'ab'.repeat(32);
  const VERSIONS = { versions: [
    { version_number: 2, status: 'submitted', snapshot_sha256: `2cec53a4${'0'.repeat(56)}`, pdf_sha256: DIGEST, has_health: true, submitted_at: '2027-06-01T16:00:00.000Z',
      submitted_by_name: 'Ada <img src=x onerror=alert(1)>' },
    { version_number: 1, status: 'superseded', snapshot_sha256: 'ef'.repeat(32), pdf_sha256: 'cd'.repeat(32), has_health: false, submitted_at: '2027-05-20T16:00:00.000Z',
      submitted_by_name: null, redacted_at: '2027-06-10T12:00:00.000Z' },
  ], changed_since_latest: ['schedule', 'team'] };
  const versionsBox = () => $('#camp-permit-versions');

  test('each version shows its state, who submitted it, its digest and a download, and what changed since', async () => {
    getCampPlanVersions.mockResolvedValue({ success: true, data: VERSIONS });
    await open();
    expect(getCampPlanVersions).toHaveBeenCalledWith(12);
    const items = [...document.querySelectorAll('.camp-permit__version')];
    expect(items.map((item) => item.querySelector('h3').textContent.replace(/\s+/g, ' ').trim()))
      .toEqual(['camp_plan_version_label camp_plan_version_status_submitted', 'camp_plan_version_label camp_plan_version_status_superseded']);
    // People compare a short code, also printed on the PDF; the full fingerprint is a technical detail.
    expect(items[0].querySelector('.camp-permit__code-value').textContent).toBe('2CEC 53A4');
    expect(items[0].querySelector('details summary').textContent).toBe('camp_plan_version_digest_details');
    expect(items[0].querySelector('details').open).toBe(false);
    expect(items[0].querySelector('details code').textContent).toBe(DIGEST);
    expect(items[0].textContent).toContain('Ada <img src=x onerror=alert(1)>');
    expect(items[0].textContent).toContain('camp_plan_version_health_note');
    expect(items[1].textContent).not.toContain('camp_plan_version_health_note');
    // A version a family's erasure rewrote says so, and why its code changed.
    expect(items[1].querySelector('.camp-permit__redacted').textContent).toBe('camp_plan_version_redacted');
    expect(items[0].querySelector('.camp-permit__redacted')).toBeNull();
    expect(document.querySelector('#app img')).toBeNull();
    expect([...versionsBox().querySelectorAll('.camp-permit__changes li')].map((item) => item.textContent))
      .toEqual(['camp_plan_part_schedule', 'camp_plan_part_team']);
  });

  test('versions show team qualifications: without meetings.manage or volunteers.manage, they are not asked for', async () => {
    hasPermission.mockImplementation((key) => !['meetings.manage', 'volunteers.manage'].includes(key));
    await open();
    expect(versionsBox()).toBeNull();
    expect(getCampPlanVersions).not.toHaveBeenCalled();
  });

  test('before any submission, the screen says none was submitted', async () => {
    await open();
    expect(versionsBox().textContent).toContain('camp_plan_versions_none');
    expect(document.querySelectorAll('.camp-permit__version')).toHaveLength(0);
  });

  test('versions name youth: without participants.view, they are neither shown nor asked for', async () => {
    hasPermission.mockImplementation((key) => key !== 'participants.view');
    await open();
    expect(versionsBox()).toBeNull();
    expect(getCampPlanVersions).not.toHaveBeenCalled();
  });

  test('declining the confirmation submits nothing', async () => {
    confirm.mockResolvedValue(false);
    await open();
    $('#camp-permit-submit').click();
    await flush();
    expect(submitCampPlanVersion).not.toHaveBeenCalled();
  });

  test('a confirmed submission is sent once, announced, the list reloaded and focus kept on it', async () => {
    let finish;
    submitCampPlanVersion.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await open();
    const button = $('#camp-permit-submit');
    button.click();
    await flush();
    expect(button.disabled).toBe(true);
    button.click();
    getCampPlanVersions.mockResolvedValue({ success: true, data: VERSIONS });
    finish({ success: true });
    await flush();
    await flush();
    expect(submitCampPlanVersion).toHaveBeenCalledTimes(1);
    expect(submitCampPlanVersion).toHaveBeenCalledWith(12);
    expect(app.showMessage).toHaveBeenCalledWith('camp_plan_version_submitted', 'success');
    expect(document.querySelectorAll('.camp-permit__version')).toHaveLength(2);
    expect(document.activeElement).toBe($('#camp-permit-versions-title'));
  });

  test('a refused submission says why and leaves the button usable', async () => {
    submitCampPlanVersion.mockRejectedValue(Object.assign(new Error('camp_plan_camp_cancelled'), { status: 409 }));
    await open();
    $('#camp-permit-submit').click();
    await flush();
    await flush();
    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect($('#camp-permit-submit').disabled).toBe(false);
  });

  test('someone who may not plan meetings, a demo account, or a cancelled camp is not offered to submit', async () => {
    hasPermission.mockImplementation((key) => key !== 'meetings.manage');
    await open();
    expect($('#camp-permit-submit')).toBeNull();
    hasPermission.mockImplementation(() => true);
    isDemoUser.mockReturnValue(true);
    await open();
    expect($('#camp-permit-submit')).toBeNull();
    isDemoUser.mockReturnValue(false);
    const cancelled = permit();
    cancelled.data.camp.is_cancelled = true;
    getCampPermit.mockResolvedValue(cancelled);
    await open();
    expect($('#camp-permit-submit')).toBeNull();
  });

  test('downloading a version saves its PDF under the name the server gives', async () => {
    getCampPlanVersions.mockResolvedValue({ success: true, data: VERSIONS });
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    getCampPlanVersionPdf.mockResolvedValue({ blob, filename: 'camp-plan-12-v2.pdf', sha256: DIGEST });
    URL.createObjectURL = jest.fn(() => 'blob:fictional');
    URL.revokeObjectURL = jest.fn();
    const clicked = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      expect(this.download).toBe('camp-plan-12-v2.pdf');
      expect(this.getAttribute('href')).toBe('blob:fictional');
    });
    await open();
    document.querySelector('[data-version-download="2"]').click();
    await flush();
    expect(getCampPlanVersionPdf).toHaveBeenCalledWith(12, 2, { signal: expect.any(AbortSignal) });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveBeenCalled();
    clicked.mockRestore();
  });

  test('a document arriving after the person left the screen is never saved', async () => {
    getCampPlanVersions.mockResolvedValue({ success: true, data: VERSIONS });
    let answer;
    let signal;
    getCampPlanVersionPdf.mockImplementation((_meeting, _version, options) => {
      ({ signal } = options);
      return new Promise((resolve) => { answer = resolve; });
    });
    URL.createObjectURL = jest.fn(() => 'blob:fictional');
    await open();
    document.querySelector('[data-version-download="2"]').click();
    await flush();
    screen.destroy();
    expect(signal.aborted).toBe(true);
    answer({ blob: new Blob(['%PDF-']), filename: 'camp-plan-12-v2.pdf', sha256: DIGEST });
    await flush();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(app.showMessage).not.toHaveBeenCalled();
  });

  test('versions that cannot be loaded say so with a retry, and the checklist stays readable', async () => {
    getCampPlanVersions.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
    await open();
    expect(versionsBox().querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelectorAll('.camp-permit__line').length).toBeGreaterThan(0);
    $('#camp-permit-versions-retry').click();
    await flush();
    expect(getCampPlanVersions).toHaveBeenCalledTimes(2);
    expect(versionsBox().textContent).toContain('camp_plan_versions_none');
  });

  test('the screen with its versions meets WCAG A/AA', async () => {
    getCampPlanVersions.mockResolvedValue({ success: true, data: VERSIONS });
    await open();
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
