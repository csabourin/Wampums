/**
 * The letter to parents Wampums proposes from a camp (#1321): pure rules, no database.
 */
const { draftLetter, missingFacts, readLetterInput } = require('../services/campParentLetter');

const FACTS = {
  camp: { id: 12, name: 'Camp des étoiles', date_from: '2099-07-04', date_to: '2099-07-06', activity_id: 30, is_cancelled: false },
  activity: { going_date: '2099-07-04', going_place: 'Salle paroissiale', going_time: '18:45', going_departure: '19:00',
    return_date: '2099-07-06', return_place: 'Salle paroissiale', return_time: '15:00' },
  emergency: { phone: '819-555-0100', name: 'Léa Tremblay' },
  personal_list: true,
};

test('a complete camp gives a letter with every fact, in each language, and no gap', () => {
  const fr = draftLetter(FACTS, 'fr', 'https://meute.example');
  expect(fr.subject).toBe('Camp des étoiles : ce qu’il faut savoir avant le camp');
  expect(fr.body_html).toContain('18 h 45');
  expect(fr.body_html).toContain('Léa Tremblay, 819-555-0100');
  expect(fr.body_html).not.toContain('à préciser');
  expect(fr.body_html).toContain('href="https://meute.example/carpool/30"');
  expect(fr.body_html).toContain('href="https://meute.example/personal-equipment/12"');
  const en = draftLetter(FACTS, 'en', 'https://meute.example');
  expect(en.body_html).toMatch(/6:45\s?p\.m\./);
  expect(missingFacts(FACTS)).toEqual([]);
});

test('without the activity, the letter says "to be confirmed" and offers no carpool link', () => {
  const facts = { ...FACTS, camp: { ...FACTS.camp, activity_id: null }, activity: null, emergency: { phone: null, name: null }, personal_list: false };
  const { body_html: html } = draftLetter(facts, 'en', 'https://meute.example');
  expect(html.match(/to be confirmed/g)).toHaveLength(3);
  expect(html).not.toContain('/carpool/');
  expect(html).not.toContain('/personal-equipment/');
  expect(missingFacts(facts)).toEqual(['activity', 'going_place', 'going_time', 'return_place', 'return_time', 'emergency_phone']);
});

test('a camp name typed with markup stays text', () => {
  const { body_html: html } = draftLetter({ ...FACTS, camp: { ...FACTS.camp, name: '<img src=x onerror=alert(1)>' } }, 'fr', 'https://meute.example');
  expect(html).not.toContain('<img');
});

test('both versions are required, and the formatted text is rebuilt', () => {
  const letter = readLetterInput({ subject_fr: ' Camp ', body_fr_html: '<p>Bonjour</p><script>x</script>', subject_en: 'Camp', body_en_html: '<p>Hello</p>' });
  expect(letter.fr).toEqual({ subject: 'Camp', html: '<p>Bonjour</p>', text: 'Bonjour' });
  expect(() => readLetterInput({ subject_fr: 'Camp', body_fr_html: '<p>Bonjour</p>', subject_en: '', body_en_html: '<p>Hello</p>' }))
    .toThrow('camp_letter_subject_invalid');
});
