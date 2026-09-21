import { translate } from "../app.js";

/**
 * Human-readable name for a dynamic form type.
 *
 * `translate()` echoes an unknown key back verbatim rather than returning a falsy
 * value, so `translate("test_form")` yields the string `"test_form"`. Screens that
 * labelled a form with it therefore printed raw keys for any form type without an
 * entry in `lang/*.json` — which is every form type an organization builds for
 * itself in the form builder.
 *
 * Resolution order: the translation, then the name the organization gave the form,
 * then the key with its underscores opened up so it at least reads as words.
 *
 * @param {string} formType - The raw `form_type` value, e.g. `fiche_sante`
 * @param {string|null} [displayName] - `organization_form_formats.display_name`, if known
 * @returns {string} A label fit to show a user
 */
export function formTypeLabel(formType, displayName = null) {
  if (!formType) {
    return displayName || "";
  }

  const translated = translate(formType);
  if (translated && translated !== formType) {
    return translated;
  }

  return displayName || formType.replace(/_/g, " ");
}
