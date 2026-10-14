/**
 * The name to show for a youth or a member.
 *
 * People often go by another name in the unit than the one on their record:
 * a cub called Max rather than Maximilien, a leader known by a totem name
 * (Akela, Baloo). When a nickname is filled in it is shown instead; the
 * record keeps the legal name (migrations/030_nicknames.sql).
 *
 * These return plain text: escape it before putting it into markup.
 *
 * @module spa/utils/DisplayNameUtils
 */

/**
 * @param {*} value - A name field
 * @returns {string} The trimmed text, or '' when there is none
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A youth's first name as the unit says it: the nickname when there is one.
 * @param {{nickname?: string, first_name?: string}} participant
 * @returns {string}
 */
export function youthFirstName(participant) {
  return text(participant?.nickname) || text(participant?.first_name);
}

/**
 * A youth's name for lists: the first name as the unit says it, then the last name.
 * @param {{nickname?: string, first_name?: string, last_name?: string}} participant
 * @returns {string}
 */
export function youthDisplayName(participant) {
  return [youthFirstName(participant), text(participant?.last_name)].filter(Boolean).join(' ');
}

/**
 * A member's name: their nickname (a leader's totem name) when there is one,
 * else their full name.
 * @param {{nickname?: string, full_name?: string}} member
 * @returns {string}
 */
export function memberDisplayName(member) {
  return text(member?.nickname) || text(member?.full_name);
}
