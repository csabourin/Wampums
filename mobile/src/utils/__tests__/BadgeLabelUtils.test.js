/**
 * translate() returns the key itself when a translation is missing, so a
 * `t(key) || name` fallback never reached the badge's name.
 */

const TRANSLATIONS = {
  badge_template_vrai_comme_baloo: 'Vrai comme Baloo',
  badge_unknown_label: 'Badge inconnu',
};

jest.mock('../../i18n', () => ({
  translate: (key) => TRANSLATIONS[key] || key,
}));

import { badgeLabel } from '../BadgeLabelUtils';

describe('badgeLabel', () => {
  test('uses the translation when the key exists', () => {
    expect(badgeLabel({ translation_key: 'badge_template_vrai_comme_baloo', name: 'x' }))
      .toBe('Vrai comme Baloo');
  });

  test('falls back to the template name when the key has no translation', () => {
    expect(badgeLabel({
      translation_key: 'badge_template__brouillard_comme_aa',
      name: 'Débrouillard comme Kaa',
    })).toBe('Débrouillard comme Kaa');
  });

  test('falls back to the name stored on a progress entry', () => {
    expect(badgeLabel({ translation_key: 'missing', badge_name: 'Frère Gris' })).toBe('Frère Gris');
    expect(badgeLabel({ territoire_chasse: 'Kaa' })).toBe('Kaa');
  });

  test('never shows a raw key when nothing names the badge', () => {
    expect(badgeLabel({ translation_key: 'badge_template_x' })).toBe('Badge inconnu');
    expect(badgeLabel(null)).toBe('Badge inconnu');
  });
});
