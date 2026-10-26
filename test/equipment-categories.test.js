/**
 * Equipment categories are a fixed list; what units typed before is read into it.
 */
const { EQUIPMENT_CATEGORIES, categoryFromText } = require('../services/equipmentCategories');

describe('reading a typed category', () => {
  test.each([
    ['games', 'games'],
    ['Jeux de société', 'games'],
    ['kitchen', 'kitchen'],
    ['Cuisine', 'kitchen'],
    ['Premiers soins', 'first_aid'],
    ['First Aid', 'first_aid'],
    ['Tentes et bâches', 'camping'],
    ['Éclairage', 'lighting'],
    ['Divers', 'other'],
    ['camping', 'camping'],
  ])('"%s" is %s', (typed, key) => {
    expect(categoryFromText(typed)).toBe(key);
  });

  test('text that names no category, or none at all, is not guessed', () => {
    expect(categoryFromText('Matériel de Ginette')).toBeNull();
    expect(categoryFromText('')).toBeNull();
    expect(categoryFromText(null)).toBeNull();
  });

  test('every key reads as itself, so the conversion can run again', () => {
    EQUIPMENT_CATEGORIES.forEach((key) => expect(categoryFromText(key)).toBe(key));
  });
});
