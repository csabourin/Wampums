/**
 * Labels for badges and dynamic forms.
 *
 * `translate()` returns the key itself when a translation is missing, so a
 * `translate(key) || name` fallback never reaches the name. Parents saw raw
 * keys such as `acceptation_risque` in the forms-to-review banner and
 * `badge_template__brouillard_comme_aa` on the badge page.
 */

const TRANSLATIONS = {
  acceptation_risque: 'Formulaire d’acceptation de risque',
  badge_template_vrai_comme_baloo: 'Vrai comme Baloo',
  badge_unknown_label: 'Badge inconnu'
};

jest.mock('../../spa/app.js', () => ({
  translate: (key) => TRANSLATIONS[key] || key
}));

import { badgeLabel } from '../../spa/utils/BadgeLabelUtils.js';
import { formTypeLabel } from '../../spa/utils/FormLabelUtils.js';

describe('badgeLabel', () => {
  test('uses the translation when the key exists', () => {
    expect(badgeLabel({
      translation_key: 'badge_template_vrai_comme_baloo',
      name: 'vrai comme baloo'
    })).toBe('Vrai comme Baloo');
  });

  test('falls back to the template name when the key has no translation', () => {
    expect(badgeLabel({
      translation_key: 'badge_template__brouillard_comme_aa',
      name: 'Débrouillard comme Kaa'
    })).toBe('Débrouillard comme Kaa');
  });

  test('falls back to the name stored on a progress entry', () => {
    expect(badgeLabel({
      translation_key: 'badge_template__olidaire_comme_fr_re_gris',
      badge_name: 'Solidaire comme Frère Gris'
    })).toBe('Solidaire comme Frère Gris');
    expect(badgeLabel({ territoire_chasse: 'Kaa' })).toBe('Kaa');
  });

  test('never shows a raw key when nothing names the badge', () => {
    expect(badgeLabel({ translation_key: 'badge_template_x' })).toBe('Badge inconnu');
    expect(badgeLabel(null)).toBe('Badge inconnu');
  });
});

describe('formTypeLabel', () => {
  test('translates a known form type even when display_name repeats the key', () => {
    expect(formTypeLabel('acceptation_risque', 'acceptation_risque'))
      .toBe('Formulaire d’acceptation de risque');
  });

  test('uses the organization display name for a custom form', () => {
    expect(formTypeLabel('camp_hiver', 'Camp d’hiver')).toBe('Camp d’hiver');
  });

  test('opens up underscores when nothing else names the form', () => {
    expect(formTypeLabel('camp_hiver')).toBe('camp hiver');
  });
});
