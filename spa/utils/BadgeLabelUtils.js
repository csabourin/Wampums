import { translate } from "../app.js";

/**
 * Human-readable name for a badge template or a badge progress entry.
 *
 * `translate()` echoes an unknown key back verbatim instead of returning a falsy
 * value, so `translate(badge.translation_key) || badge.name` never reached the
 * name: a template whose `translation_key` has no entry in `lang/*.json` was
 * shown as the raw key (`badge_template__brouillard_comme_aa`).
 *
 * Resolution order: the translation, then the template's own name, then the
 * name stored on a progress entry, then a generic "unknown badge" label.
 *
 * @param {Object|null} badge - Template (`translation_key`, `name`) or progress
 *   entry (`translation_key`, `badge_name`, `territoire_chasse`)
 * @returns {string} A label fit to show a user
 */
export function badgeLabel(badge) {
  const key = badge?.translation_key;
  if (key) {
    const translated = translate(key);
    if (translated && translated !== key) {
      return translated;
    }
  }

  return (
    badge?.name ||
    badge?.badge_name ||
    badge?.territoire_chasse ||
    translate("badge_unknown_label")
  );
}
