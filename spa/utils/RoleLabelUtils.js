import { translate } from '../app.js';

/**
 * Human-readable name for a role, in the interface's language.
 *
 * A role's `display_name` is stored once, in one language, so showing it
 * mixed languages on a page (a French page listing "Leader"). Built-in roles
 * (no unit, `is_system_role`) therefore read their name from
 * `role_label_<role_name>` in `lang/*.json`. A unit's custom role keeps the
 * name the unit gave it; its generated key (`u<unit>_<slug>`) never has a
 * translation.
 *
 * `translate()` echoes an unknown key back, so the result is compared with
 * the key before it is used.
 *
 * @param {Object|string|null} role - Role row (`role_name`, `display_name`) or
 *   a bare role name
 * @returns {string} A label fit to show a user
 */
export function roleLabel(role) {
  const roleName = typeof role === 'string' ? role : role?.role_name;
  if (roleName) {
    const key = `role_label_${roleName}`;
    const translated = translate(key);
    if (translated && translated !== key) {
      return translated;
    }
  }

  if (role && typeof role === 'object') {
    return role.display_name || role.role_name || '';
  }
  return roleName || '';
}
