/**
 * @jest-environment jsdom
 */

/**
 * Interface text lookup with a unit fallback language
 *
 * A key missing from an optional language is read from the unit's fallback
 * language, with that language's unit vocabulary, so the unit's own terms
 * still appear. Core languages read their own bundle as before.
 *
 * @module test/spa/TranslationFallback
 */

import { translateKey } from '../../spa/utils/TranslationUtils.js';

const translations = {
  fr: {
    manage_groups: 'Gestion des groupes',
    vocabulary_manage_groups: 'Gestion des {subgroup_plural}',
    save: 'Enregistrer',
  },
  en: {
    manage_groups: 'Manage groups',
    vocabulary_manage_groups: 'Manage {subgroup_plural}',
    save: 'Save',
  },
  uk: {
    save: 'Зберегти',
  },
};
const cubs = { program_section: 'cubs' };

describe('translateKey', () => {
  it('reads an optional language key from its own bundle', () => {
    expect(translateKey('save', {
      lang: 'uk', fallbackLang: 'fr', defaultLang: 'fr', translations, settings: cubs,
    })).toEqual({ text: 'Зберегти', missing: false });
  });

  it('applies the fallback language vocabulary to a missing key', () => {
    expect(translateKey('manage_groups', {
      lang: 'uk', fallbackLang: 'fr', defaultLang: 'fr', translations, settings: cubs,
    }).text).toBe('Gestion des Tanières');
    expect(translateKey('manage_groups', {
      lang: 'uk', fallbackLang: 'en', defaultLang: 'fr', translations, settings: cubs,
    }).text).toBe('Manage Dens');
  });

  it('applies a direct vocabulary term from the fallback language', () => {
    expect(translateKey('groups', {
      lang: 'uk', fallbackLang: 'fr', defaultLang: 'fr', translations, settings: cubs,
    }).text).toBe('Tanières');
  });

  it('leaves core languages on their own bundle and vocabulary', () => {
    expect(translateKey('manage_groups', {
      lang: 'en', fallbackLang: null, defaultLang: 'fr', translations, settings: cubs,
    }).text).toBe('Manage Dens');
  });

  it('reports a key no bundle has', () => {
    expect(translateKey('nowhere', {
      lang: 'uk', fallbackLang: 'en', defaultLang: 'fr', translations, settings: cubs,
    })).toEqual({ text: 'nowhere', missing: true });
  });
});
