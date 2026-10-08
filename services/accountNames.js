/**
 * One name per person.
 *
 * A family member is stored twice: the account (`users.full_name`, typed once
 * at sign-up) and their contact record (`parents_guardians.prenom` / `nom`,
 * which the unit calls in an emergency). The contact record tied to the
 * account by `user_uuid` owns the name; `users.full_name` is a copy kept in
 * line here. The `account_display_names` view
 * (migrations/017_account_display_names.sql) says which name wins.
 *
 * @module services/accountNames
 */

/** Width of `users.full_name`. */
const FULL_NAME_MAX_LENGTH = 255;

/**
 * Bring `users.full_name` in line with each account's own contact record.
 *
 * Accounts without one are left as they are.
 *
 * @param {Object} client - Database client (inside the caller's transaction)
 * @param {string[]} userIds - Account UUIDs
 * @returns {Promise<void>}
 */
async function syncAccountNames(client, userIds) {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) {
    return;
  }
  await client.query(
    `UPDATE users u
        SET full_name = left(d.display_name, $2)
       FROM account_display_names d
      WHERE d.user_id = u.id
        AND u.id = ANY($1::uuid[])
        AND d.guardian_id IS NOT NULL
        AND d.display_name IS NOT NULL
        AND u.full_name IS DISTINCT FROM left(d.display_name, $2)`,
    [ids, FULL_NAME_MAX_LENGTH]
  );
}

/**
 * Bring the accounts these contact records belong to in line with them.
 *
 * Only `user_uuid` ties a record to an account here; the older mapping and
 * address matching can point at someone else's record.
 *
 * @param {Object} client - Database client (inside the caller's transaction)
 * @param {number[]} guardianIds - `parents_guardians` ids just saved
 * @returns {Promise<void>}
 */
async function syncAccountNamesForGuardians(client, guardianIds) {
  if (guardianIds.length === 0) {
    return;
  }
  const owners = await client.query(
    `SELECT DISTINCT user_uuid FROM parents_guardians
      WHERE id = ANY($1::int[]) AND user_uuid IS NOT NULL`,
    [guardianIds]
  );
  await syncAccountNames(client, owners.rows.map((row) => row.user_uuid));
}

/**
 * Split a name typed in one field into first and last name, keeping whichever
 * part of the current record it still contains: "Marie-Eve Tremblay Roy"
 * against Tremblay Roy keeps that surname whole.
 *
 * @param {string} fullName - The name as typed
 * @param {{prenom: string, nom: string}} current - The contact record now
 * @returns {{prenom: string, nom: string}|null} Null for a single word, which
 *   cannot fill both columns without inventing one
 */
function splitAgainstRecord(fullName, current) {
  const typed = fullName.trim().replace(/\s+/g, ' ');
  if (!typed.includes(' ')) {
    return null;
  }
  const lower = typed.toLowerCase();
  const nom = String(current.nom || '').trim();
  const prenom = String(current.prenom || '').trim();
  if (nom && lower.endsWith(` ${nom.toLowerCase()}`)) {
    return { prenom: typed.slice(0, typed.length - nom.length - 1), nom: typed.slice(-nom.length) };
  }
  if (prenom && lower.startsWith(`${prenom.toLowerCase()} `)) {
    return { prenom: typed.slice(0, prenom.length), nom: typed.slice(prenom.length + 1) };
  }
  const firstSpace = typed.indexOf(' ');
  return { prenom: typed.slice(0, firstSpace), nom: typed.slice(firstSpace + 1) };
}

/**
 * Rename an account and, when it has one, its own contact record.
 *
 * @param {Object} client - Database client (inside the caller's transaction)
 * @param {string} userId - Account UUID
 * @param {Object} name - The new name
 * @param {string} name.fullName - As typed in a single field
 * @param {string} [name.firstName] - Given name, when the form asked for it
 * @param {string} [name.lastName] - Surname, when the form asked for it
 * @returns {Promise<{renamed: boolean, needsBothNames?: boolean}>}
 *   `needsBothNames` when the account has a contact record and only one word
 *   was given
 */
async function renameAccount(client, userId, { fullName, firstName, lastName }) {
  const own = await client.query(
    'SELECT id, prenom, nom FROM parents_guardians WHERE user_uuid = $1 ORDER BY id LIMIT 1',
    [userId]
  );

  if (own.rows.length === 0) {
    await client.query(
      'UPDATE users SET full_name = $1 WHERE id = $2',
      [fullName.trim().slice(0, FULL_NAME_MAX_LENGTH), userId]
    );
    return { renamed: true };
  }

  const names = firstName && lastName
    ? { prenom: firstName.trim(), nom: lastName.trim() }
    : splitAgainstRecord(fullName, own.rows[0]);
  if (!names) {
    return { renamed: false, needsBothNames: true };
  }

  await client.query(
    'UPDATE parents_guardians SET prenom = $1, nom = $2 WHERE user_uuid = $3',
    [names.prenom, names.nom, userId]
  );
  await syncAccountNames(client, [userId]);
  return { renamed: true };
}

module.exports = {
  renameAccount,
  syncAccountNames,
  syncAccountNamesForGuardians,
  splitAgainstRecord,
};
