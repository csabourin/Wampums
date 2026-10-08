/**
 * Splitting the medication a parent wrote on the health form.
 */

const { splitDeclaredMedications, isSameMedication } = require('../../spa/utils/MedicationTextUtils.js');

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
