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
