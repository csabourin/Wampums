/**
 * Validation of a unit's interface languages (utils/interfaceLanguages.js).
 */

const { validateInterfaceLanguages, ALL_INTERFACE_LANGUAGES } = require('../utils/interfaceLanguages');

describe('validateInterfaceLanguages', () => {
  it('accepts optional languages and a core fallback, in catalogue order', () => {
    expect(validateInterfaceLanguages({ enabled: ['id', 'uk', 'uk'], fallback: 'fr' }))
      .toEqual({ value: { enabled: ['uk', 'id'], fallback: 'fr' }, errors: [] });
  });

  it('defaults to no optional language and an English fallback', () => {
    expect(validateInterfaceLanguages({})).toEqual({ value: { enabled: [], fallback: 'en' }, errors: [] });
  });

  it.each([
    [{ enabled: ['fr'] }, 'enabled'],
    [{ enabled: ['de'] }, 'enabled'],
    [{ enabled: 'uk' }, 'enabled'],
    [{ fallback: 'uk' }, 'fallback'],
  ])('rejects %j', (body, field) => {
    expect(validateInterfaceLanguages(body).errors.map((e) => e.field)).toContain(field);
  });

  it('lists every interface language for language preferences', () => {
    expect(ALL_INTERFACE_LANGUAGES).toEqual(['fr', 'en', 'uk', 'it', 'id']);
  });
});
