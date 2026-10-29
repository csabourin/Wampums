const { readList, readTranslation } = require('../services/personalEquipment');
const input = () => ({ expected_version: 0, season: 'winter', stay_type: 'cabin', nights: 2, published: true, reviewed: true, notes_fr: '', notes_en: '', items: [{ key: 'sleeping_bag', label_fr: 'Sac de couchage', label_en: '', quantity: 1 }] });
test('a list can be published with one authored language after team review', () => { expect(readList(input())).not.toBeNull(); });
test.each([
  { notes_fr: '\0' }, { items: [] }, { reviewed: false }, { items: [{ key: 'x', label_fr: '', label_en: '', quantity: 1 }] },
  { nights: -1 }, { expected_version: '1' }, { items: [{ key: 'x', label_fr: ['Sac'], label_en: '', quantity: 1 }] },
])('invalid packing content is refused before a transaction', (change) => { expect(readList({ ...input(), ...change })).toBeNull(); });
test('translated text must preserve exactly the offered stable item keys', () => {
  const items = input().items;
  expect(readTranslation({ notes: '', items: [{ key: 'sleeping_bag', label: 'Sleeping bag' }] }, items)).not.toBeNull();
  expect(readTranslation({ notes: '', items: [{ key: 'new', label: 'Sleeping bag' }] }, items)).toBeNull();
  expect(readTranslation({ notes: '', items: [] }, items)).toBeNull();
});
