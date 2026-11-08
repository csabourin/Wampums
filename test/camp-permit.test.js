/**
 * The camp permit's checklist (#1416): how each line reads from what the camp
 * already holds. The sources are given as the service reads them; reading them
 * on a real database is covered by camp-permit.integration.
 */
const { permitLines, campDays, LINE_KEYS, REASONS } = require('../services/campPermit');

const RIGHTS = { participants: true, carpools: true, reviews: true };

/** A camp with everything the permit asks for, as fictional sources. */
const complete = () => ({
  unit: { name: '12e Meute', scout_groups: ['Groupe de la Rivière'], district: 'District du Nord', coeducation: 'mixed' },
  camp: { id: 12, date_from: '2027-07-04', date_to: '2027-07-06', activity_id: 30 },
  site: {
    details: { season: 'summer', accommodation: 'tent', on_site_lead_id: '00000000-0000-4000-8000-000000000001' },
    site: {
      archived: false, address: '1 chemin du Lac', owner_name: 'Base de plein air fictive', phone: '555-0100',
      hospital_name: 'Hôpital fictif', hospital_phone: '555-0101', hospital_travel_minutes: 20,
      poison_centre_phone: '555-0102', directions_url: 'https://example.org/route', has_own_insurance: true,
    },
  },
  plan: { to_write: [], to_review: [], rain_games: 2 },
  schedule_days: [0, 1, 2],
  titled_days: [0, 1, 2],
  material: { items: [{ category: 'first_aid' }, { category: 'kitchen' }], free_text: [] },
  personal: { published: true },
  roster: {
    gaps: [], blocking_gaps: [], youth: [{ id: 1 }, { id: 2 }], consent: { pending: 0 },
    team: [{ active_member: true }, { active_member: true }],
  },
  carpool_offers: 3,
  on_site_lead_active: true,
  evaluation: { over: true, closed: true },
});

const byKey = (lines) => Object.fromEntries(lines.map((entry) => [entry.key, entry]));

test('the checklist lists every line of the permit, in its order', () => {
  const lines = permitLines(complete(), RIGHTS);
  expect(lines.map((entry) => entry.key)).toEqual(LINE_KEYS);
  expect(lines.every(Boolean)).toBe(true);
});

test('a camp with everything recorded is complete where Wampums can tell, and never compliant where it cannot', () => {
  const lines = byKey(permitLines(complete(), RIGHTS));
  ['identification', 'dates', 'site', 'camp_type', 'emergency', 'insurance', 'directions', 'written_sections',
    'rain_games', 'schedule', 'group_material', 'personal_material', 'health_forms', 'allergies', 'evaluation']
    .forEach((key) => expect(lines[key].state).toBe('complete'));
  // The SISC comparison, the menu, and the letter to parents have no source yet.
  ['youth_list', 'team_list', 'menu', 'parent_letter', 'transport']
    .forEach((key) => expect(lines[key].state).toBe('unverified'));
  expect(lines.youth_list.reasons).toContain('sisc_not_compared');
  expect(lines.youth_list.counts.youth).toBe(2);
});

test.each([
  [null, 'to_complete', ['approval_submit']],
  [{ status: 'submitted' }, 'to_complete', ['approval_pending']],
  [{ status: 'changes_requested' }, 'to_complete', ['approval_changes']],
  [{ status: 'approved' }, 'complete', []],
  [{ status: 'approved', redacted: true }, 'to_complete', ['approval_redacted']],
])('the permit shows the approval state %j', (approval, state, reasons) => {
  expect(byKey(permitLines({ ...complete(), approval }, RIGHTS)).approvals).toMatchObject({ state, reasons });
});

test('an empty camp is to complete, never complete', () => {
  const sources = {
    unit: { scout_groups: [], district: null, coeducation: null },
    camp: { id: 12, date_from: '2027-07-04', date_to: '2027-07-05', activity_id: null },
    site: { details: null, site: null },
    plan: { to_write: ['vcpref_wanted', 'rain_games'], to_review: [], rain_games: 0 },
    schedule_days: [],
    material: { items: [], free_text: [] },
    personal: null,
    roster: { gaps: ['no_youth', 'no_lead', 'no_first_aider'], blocking_gaps: ['no_first_aider'], youth: [], consent: {}, team: [] },
    carpool_offers: 0,
    evaluation: { over: false, closed: false },
  };
  const lines = byKey(permitLines(sources, RIGHTS));
  expect(lines.identification).toMatchObject({ state: 'to_complete',
    reasons: ['missing_scout_group', 'missing_district', 'missing_coeducation'] });
  ['site', 'emergency', 'insurance', 'directions'].forEach((key) => expect(lines[key].reasons).toEqual(['no_site']));
  expect(lines.camp_type.reasons).toEqual(['missing_season', 'missing_accommodation']);
  expect(lines.written_sections).toMatchObject({ state: 'to_complete', counts: { to_write: 1 } });
  expect(lines.rain_games.reasons).toEqual(['no_rain_game']);
  expect(lines.schedule).toMatchObject({ state: 'to_complete', reasons: ['no_schedule'] });
  expect(lines.group_material.reasons).toEqual(['no_group_material']);
  expect(lines.personal_material.reasons).toEqual(['no_personal_list']);
  expect(lines.youth_list).toMatchObject({ state: 'to_complete', reasons: ['no_youth', 'sisc_not_compared'] });
  expect(lines.team_list).toMatchObject({ state: 'to_complete', blocking: true });
  expect(lines.team_list.reasons).toEqual(expect.arrayContaining(['no_lead', 'no_first_aider']));
  expect(lines.health_forms).toMatchObject({ state: 'unverified', reasons: ['no_youth'] });
  expect(lines.allergies).toMatchObject({ state: 'unverified', reasons: ['no_youth'] });
  expect(lines.transport.reasons).toEqual(['no_activity']);
  expect(lines.evaluation).toMatchObject({ state: 'unverified', reasons: ['after_camp'] });
  expect(Object.values(lines).some((entry) => entry.state === 'complete' && entry.key !== 'dates')).toBe(false);
});

test('a line whose source the person may not read is not verified, with no detail', () => {
  const lines = byKey(permitLines(complete(), { participants: false, carpools: false, reviews: false }));
  ['youth_list', 'team_list', 'health_forms', 'allergies', 'transport', 'evaluation'].forEach((key) => {
    expect(lines[key]).toEqual({ key, state: 'unverified', reasons: ['no_access'] });
  });
});

test('a day of the camp with nothing planned leaves the schedule to complete', () => {
  const sources = { ...complete(), schedule_days: [0, 2, 9] };
  expect(byKey(permitLines(sources, RIGHTS)).schedule).toMatchObject({
    state: 'to_complete', reasons: ['days_without_activity'], counts: { days: 3, empty_days: 1 },
  });
});

test('a day of the camp without a title leaves the schedule to complete', () => {
  const sources = { ...complete(), titled_days: [0, 2, 9] };
  expect(byKey(permitLines(sources, RIGHTS)).schedule).toMatchObject({
    state: 'to_complete', reasons: ['days_without_title'], counts: { untitled_days: 1, empty_days: 0 },
  });
});

test('material without a first aid kit is to complete; needs written as free text are to check', () => {
  const noKit = { ...complete(), material: { items: [{ category: 'kitchen' }], free_text: [] } };
  expect(byKey(permitLines(noKit, RIGHTS)).group_material).toMatchObject({ state: 'to_complete', reasons: ['no_first_aid_kit'] });
  const freeText = { ...complete(), material: { items: [{ category: 'first_aid' }], free_text: [{ material: 'cordes' }] } };
  expect(byKey(permitLines(freeText, RIGHTS)).group_material).toMatchObject({ state: 'unverified', reasons: ['material_free_text'] });
});

test('pending consent, missing health forms and undeclared adult allergies are to complete', () => {
  const sources = complete();
  sources.roster = { ...sources.roster, consent: { pending: 1 }, gaps: ['youth_health_form_missing', 'adult_allergies_not_declared', 'swimming_supervision'] };
  const lines = byKey(permitLines(sources, RIGHTS));
  expect(lines.youth_list).toMatchObject({ state: 'to_complete', reasons: ['consent_pending', 'sisc_not_compared'], counts: { pending: 1 } });
  expect(lines.health_forms.reasons).toEqual(['youth_health_form_missing']);
  expect(lines.allergies.reasons).toEqual(['youth_health_form_missing', 'adult_allergies_not_declared']);
  // Swimming supervision is to check, never a reason to call the team complete or blocking.
  expect(lines.team_list).toMatchObject({ state: 'unverified', blocking: false, reasons: ['swimming_supervision', 'sisc_not_compared'] });
});

test('an unanswered insurance question, a missing on-site lead and an archived site are to complete', () => {
  const sources = complete();
  sources.site = {
    details: { ...sources.site.details, on_site_lead_id: null },
    site: { ...sources.site.site, has_own_insurance: null, archived: true, hospital_phone: '' },
  };
  const lines = byKey(permitLines(sources, RIGHTS));
  expect(lines.insurance.reasons).toEqual(['insurance_unanswered']);
  expect(lines.emergency.reasons).toEqual(['missing_hospital_phone', 'missing_on_site_lead']);
  expect(lines.site.reasons).toEqual(['site_archived']);
});

test('an on-site lead who has left the unit leaves the emergency contacts to complete', () => {
  const sources = { ...complete(), on_site_lead_active: false };
  expect(byKey(permitLines(sources, RIGHTS)).emergency).toMatchObject({ state: 'to_complete', reasons: ['on_site_lead_inactive'] });
});

test('a camp that is over and whose review is still open has its evaluation to complete', () => {
  const sources = { ...complete(), evaluation: { over: true, closed: false } };
  expect(byKey(permitLines(sources, RIGHTS)).evaluation).toMatchObject({ state: 'to_complete', reasons: ['review_open'] });
});

test('a camp counts its days with both ends included', () => {
  expect(campDays('2027-07-04', '2027-07-11')).toBe(8);
  expect(campDays('2027-07-04', null)).toBe(1);
});

test('every reason a line gives is one the screen can explain', () => {
  const given = [complete(), { ...complete(), roster: { ...complete().roster, gaps: ['no_lead', 'aide_age_unknown', 'member_left_unit',
    'no_first_aider', 'certification_to_verify', 'swimming_supervision', 'youth_health_form_missing', 'adult_allergies_not_declared'],
  blocking_gaps: ['no_first_aider'] } }]
    .flatMap((sources) => [RIGHTS, {}].flatMap((rights) => permitLines(sources, rights)))
    .flatMap((entry) => entry.reasons);
  expect(given.filter((reason) => !REASONS.includes(reason))).toEqual([]);
});
