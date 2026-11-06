/**
 * Splitting the medication a parent wrote on the health form.
 */

jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatClockTime: (value) => (value === 'bad' ? '' : `[${value}]`),
}));

const {
  describeMedicationDose,
  describeMedicationFrequency,
  isSameMedication,
  splitDeclaredMedications,
} = require('../../spa/utils/MedicationTextUtils.js');

describe('splitDeclaredMedications', () => {
  it.each([
    ['one per line', 'Vyvance\nLanzoprazole\nAmlodipine', ['Vyvance', 'Lanzoprazole', 'Amlodipine']],
    ['commas', 'Vyvance, Lanzoprazole,Amlodipine', ['Vyvance', 'Lanzoprazole', 'Amlodipine']],
    ['semicolons', 'Vyvance; Ventolin', ['Vyvance', 'Ventolin']],
    ['Windows line endings and bullets', '- Vyvance\r\n• Ventolin', ['Vyvance', 'Ventolin']],
    ['a French decimal', 'Ritalin 10,5 mg, Ventolin', ['Ritalin 10,5 mg', 'Ventolin']],
    ['duplicates and blanks', 'Ventolin,\n\nventolin ,', ['Ventolin']],
    ['a "none" answer', 'Aucun', []],
  ])('splits %s', (_label, text, expected) => {
    expect(splitDeclaredMedications(text)).toEqual(expected);
  });

  it('returns nothing without an answer', () => {
    expect(splitDeclaredMedications(null)).toEqual([]);
  });
});

describe('isSameMedication', () => {
  it('ignores case, accents and punctuation', () => {
    expect(isSameMedication('Lanzoprazole', 'lanzoprazole.')).toBe(true);
    expect(isSameMedication('Advil', 'Tylenol')).toBe(false);
  });
});

describe('describeMedicationDose', () => {
  it('shows a quantity with its unit, in the interface language, then the instructions', () => {
    expect(describeMedicationDose({ default_dose_amount: '2.50', default_dose_unit: 'ml', dosage_instructions: 'avec le déjeuner' }, 'fr'))
      .toBe('2,5 ml · avec le déjeuner');
    expect(describeMedicationDose({ default_dose_amount: 200, default_dose_unit: 'mg' }, 'en')).toBe('200 mg');
  });

  it('keeps the instructions when no quantity was given, and says nothing when neither was', () => {
    expect(describeMedicationDose({ default_dose_amount: null, dosage_instructions: '1 comprimé' }, 'fr')).toBe('1 comprimé');
    expect(describeMedicationDose({}, 'fr')).toBe('');
  });
});

describe('describeMedicationFrequency', () => {
  const TEMPLATE = '{frequency} : {times}';

  it('names the times a dose is given, stored as a list or as JSON text', () => {
    expect(describeMedicationFrequency({ frequency_text: 'Le matin', frequency_times: ['08:00'] }, 'fr', 'Au besoin', TEMPLATE))
      .toBe('Le matin : [08:00]');
    expect(describeMedicationFrequency({ frequency_text: 'Repas', frequency_times: '["08:00","18:00"]' }, 'fr', 'Au besoin', TEMPLATE))
      .toBe('Repas : [08:00], [18:00]');
  });

  it('falls back to the frequency alone without readable times', () => {
    expect(describeMedicationFrequency({ frequency_text: 'Au besoin', frequency_times: [] }, 'fr', 'x', TEMPLATE)).toBe('Au besoin');
    expect(describeMedicationFrequency({ frequency_times: 'not json' }, 'fr', 'Au besoin', TEMPLATE)).toBe('Au besoin');
    expect(describeMedicationFrequency({ frequency_text: 'Le soir', frequency_times: ['bad'] }, 'fr', 'x', TEMPLATE)).toBe('Le soir');
  });
});
