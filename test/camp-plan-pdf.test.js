/**
 * The camp plan's document (#1418): a tagged, accessible PDF in the unit's
 * language, printing "to complete" for what is missing, and naming allergies
 * only in the copy made for whoever may read them.
 */
const PDFDocument = require('pdfkit');
const { renderPlanPdf } = require('../services/campPlanPdf');

/** Every string written on the pages, in order, for the render under way. */
let written = [];
const realText = PDFDocument.prototype.text;
beforeAll(() => {
  jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function text(value, ...rest) {
    written.push(String(value));
    return realText.call(this, value, ...rest);
  });
});
beforeEach(() => { written = []; });
afterAll(() => jest.restoreAllMocks());

/** A fictional camp, as buildPlanSnapshot reads it. */
function snapshot() {
  return {
    camp: { theme: 'Camp des étoiles', date_from: '2027-07-04', date_to: '2027-07-05' },
    header: { name: '12e Meute', unit: '12e', scout_groups: ['Groupe fictif'], district: 'District fictif', coeducation: 'mixed',
      program_section: 'cubs', days: 2, youth_count: 1 },
    checklist: [
      { key: 'schedule', state: 'to_complete', reasons: ['days_without_title'], counts: { untitled_days: 1 } },
      { key: 'team_list', state: 'to_complete', reasons: ['no_first_aider'], blocking: true },
    ],
    sections: [{ key: 'theme', source: 'camp', text: 'Les explorateurs.\n\nUn indice par soir.' }, { key: 'motivation', source: 'empty', text: null }],
    rain_games: [],
    schedule: [
      { day_offset: 0, date: '2027-07-04', title: 'Arrivée', notes: null, lines: [
        { start_time: '18:30', name: 'Montage', duration_minutes: 60, leaders: [{ name: 'Ada Lovelace', left: false }],
          responsable: 'Parent bénévole', description: 'Bâches dans le bac bleu' },
      ] },
      { day_offset: 1, date: '2027-07-05', title: null, notes: null, lines: [] },
    ],
    site: null,
    team: [{ name: 'Ada Lovelace', team_role: 'lead', active_member: true, certifications: ['first_aid_certificate'] }],
    volunteers: [],
    youth: [{ first_name: 'Léa', last_name: 'Tremblay', age_at_camp: 10 }],
    material: { items: [], free_text: [] },
  };
}
const HEALTH = {
  youth: [{ first_name: 'Léa', last_name: 'Tremblay', allergies: 'Arachides', epipen: true, reaction: null, action: null,
    emergency_medication: 'Injecter dans la cuisse, appeler le 911' }],
  adults: [{ name: 'Ada Lovelace', allergies: 'Pénicilline', carries_epipen: false, person_to_notify: 'Contact fictif' }],
};
const META = { version: 3, submittedAt: new Date('2027-06-01T12:00:00Z'), language: 'fr', code: '2CEC 53A4' };

test('the document is a tagged PDF/UA file in the unit’s language, with its title shown', async () => {
  const pdf = await renderPlanPdf(snapshot(), null, META);
  const text = pdf.toString('latin1');
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  ['/StructTreeRoot', '/MarkInfo', '/Lang (fr-CA)', '/DisplayDocTitle true', '/FontFile2', 'pdfuaid:part', '/H1', '/H2', '/H3', '/TH', '/Scope']
    .forEach((marker) => expect([marker, text.includes(marker)]).toEqual([marker, true]));
  expect(written[0]).toBe('Plan de camp — Camp des étoiles');
});

test('the first page carries the version’s verification code, in words people can compare', async () => {
  await renderPlanPdf(snapshot(), null, META);
  expect(written.slice(0, 4)).toContain('Code de vérification : 2CEC 53A4. Le même code apparaît dans Wampums pour cette version.');
});

test('what is missing is printed “to complete”, never left out', async () => {
  await renderPlanPdf(snapshot(), null, META);
  // The motivation system, the site, the rain games and the second day's schedule have nothing.
  expect(written.filter((entry) => entry === 'À compléter').length).toBeGreaterThanOrEqual(4);
  expect(written).toContain('Cette journée n’a pas encore de titre.');
  expect(written).toContain('Jours sans titre : 1');
  expect(written).toContain('Bloquant : À compléter');
});

test('the schedule names who leads each line and its notes; the team its verified qualifications', async () => {
  await renderPlanPdf(snapshot(), null, META);
  expect(written).toContain('Ada Lovelace, Parent bénévole');
  expect(written).toContain('Bâches dans le bac bleu');
  expect(written).toContain('Montage (60 min)');
  expect(written).toContain('Certificat de premiers soins');
});

test('allergies are named only in the copy made with them; the other says where to find them', async () => {
  await renderPlanPdf(snapshot(), null, META);
  expect(written.join(' ')).not.toMatch(/Arachides|Pénicilline/);
  expect(written.some((entry) => entry.startsWith('Cette copie ne nomme les allergies de personne'))).toBe(true);

  written = [];
  await renderPlanPdf(snapshot(), HEALTH, META);
  expect(written).toContain('Arachides — porte un auto-injecteur d’épinéphrine');
  expect(written).toContain('Pénicilline');
  expect(written).toContain('Contact fictif');
  // The emergency medication is printed, even when it is the only instruction recorded.
  expect(written).toContain('Injecter dans la cuisse, appeler le 911');
});

test('a unit writing in English gets the document in English', async () => {
  const pdf = await renderPlanPdf(snapshot(), null, { ...META, language: 'en' });
  expect(pdf.toString('latin1')).toContain('/Lang (en-CA)');
  expect(written[0]).toBe('Camp plan — Camp des étoiles');
  expect(written).toContain('To complete');
});

test('every text the document prints has its translation in both languages', () => {
  const source = require('fs').readFileSync(require.resolve('../services/campPlanPdf'), 'utf8');
  const keys = [...source.matchAll(/\bt\('([a-z0-9_]+)'/gi)].map((match) => match[1]);
  const languages = [require('../lang/en.json'), require('../lang/fr.json')];
  expect(keys.length).toBeGreaterThan(40);
  expect(keys.filter((key) => languages.some((strings) => !(key in strings)))).toEqual([]);
});

test('the verification code is the start of the version’s fingerprint, in capitals, in groups of four', () => {
  const { verificationCode } = require('../services/campPlanVersions');
  expect(verificationCode(`2cec53a4${'0'.repeat(56)}`)).toBe('2CEC 53A4');
  expect(verificationCode(null)).toBe('');
});
