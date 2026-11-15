/**
 * @jest-environment jsdom
 *
 * Counted texts are written out in the right form, never "place(s)" (#1428).
 */
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));

import { pluralForm, translatePlural } from '../../spa/utils/PluralUtils.js';

test.each([
  ['fr', 0, 'one'], ['fr', 1, 'one'], ['fr', 2, 'other'],
  ['en', 0, 'other'], ['en', 1, 'one'], ['en', 2, 'other'],
])('in %s, %i takes the "%s" form', (lang, count, form) => {
  expect(pluralForm(count, lang)).toBe(form);
});

test('in French, no free place reads in the singular; in English, in the plural', () => {
  expect(translatePlural('volunteers_free_places', 0, 'fr')).toBe('volunteers_free_places_one');
  expect(translatePlural('volunteers_free_places', 0, 'en')).toBe('volunteers_free_places_other');
});

test('a language with more forms uses the "other" text every bundle has', () => {
  // Ukrainian has "few" and "many": both read the _other key.
  expect(translatePlural('volunteers_free_places', 3, 'uk')).toBe('volunteers_free_places_other');
  expect(translatePlural('volunteers_free_places', 5, 'uk')).toBe('volunteers_free_places_other');
});
