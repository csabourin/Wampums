const { sameText } = require('../services/packingPublications');
const list = { notes_fr: 'Consigne', notes_en: '', published: false, items: [{ key: 'bag', label_fr: 'Sac', label_en: 'Bag', quantity: 1 }] };
test('changing quantities and publication state preserves valid translations', () => {
  expect(sameText(list, { ...list, published: true, items: [{ ...list.items[0], quantity: 2 }] })).toBe(true);
});
test('a source edit or changed stable key invalidates translations', () => {
  expect(sameText(list, { ...list, notes_fr: 'Autre consigne' })).toBe(false);
  expect(sameText(list, { ...list, items: [{ ...list.items[0], key: 'new_bag' }] })).toBe(false);
  expect(sameText(list, { ...list, items: [{ ...list.items[0], label_fr: 'Sac étanche' }] })).toBe(false);
});

describe('carrying a translation to the next version', () => {
  const { carryTranslation, missingFromTranslation, completeTranslations } = require('../services/packingPublications');
  const before = { notes_fr: 'Consigne', notes_en: '', items: [
    { key: 'bag', label_fr: 'Sac', label_en: '' }, { key: 'socks', label_fr: 'Bas', label_en: '' }] };
  const spanish = { notes: 'Instrucción', items: [{ key: 'bag', label: 'Bolsa' }, { key: 'socks', label: 'Calcetines' }] };

  test('a typo fixed in one item keeps the other items translated', () => {
    const after = { ...before, items: [before.items[0], { key: 'socks', label_fr: 'Bas de laine', label_en: '' }] };
    const carried = carryTranslation(before, after, spanish);
    expect(carried).toEqual({ notes: 'Instrucción', items: [{ key: 'bag', label: 'Bolsa' }], partial: true });
    expect(missingFromTranslation(after, carried)).toEqual({ items: ['socks'], notes: false });
  });
  test('changed instructions are the only thing left to translate', () => {
    const carried = carryTranslation(before, { ...before, notes_fr: 'Autre consigne' }, spanish);
    expect(carried).toEqual({ notes: null, items: spanish.items, partial: true });
    expect(missingFromTranslation(before, carried)).toEqual({ items: [], notes: true });
  });
  test('quantity or order changes keep the translation complete, removed items drop out', () => {
    const after = { ...before, items: [{ ...before.items[1], quantity: 4 }] };
    expect(carryTranslation(before, after, spanish)).toEqual({ notes: 'Instrucción', items: [{ key: 'socks', label: 'Calcetines' }] });
  });
  test('nothing is carried when every text changed', () => {
    const after = { notes_fr: 'Neuf', notes_en: '', items: [{ key: 'bag', label_fr: 'Sac à dos', label_en: '' }] };
    expect(carryTranslation(before, after, spanish)).toBeNull();
  });
  test('families receive only complete translations', () => {
    expect(completeTranslations({ es: spanish, de: { ...spanish, partial: true } })).toEqual({ es: spanish });
  });
});
