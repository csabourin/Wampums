/**
 * What a parent answered on a permission slip, and proof of it.
 *
 * When a parent signs or declines, the server freezes the text the slip
 * presented (activity, dates, description, authorization text, conditions)
 * into `permission_slips.answered_content`, and stores the SHA-256 of a stable
 * representation of it in `signature_hash`. Verification compares the two,
 * and the frozen copy with the slip's own text: it shows which text was
 * accepted or refused, not who answered (that is `signed_by`, `declined_by`
 * and the account).
 *
 * The fingerprint is a plain SHA-256 (decision on #1410): it detects a change
 * made by mistake or by code, not one made by someone who can write to the
 * database and recompute it.
 *
 * A screen showing a pending slip receives its `presented_fingerprint` and
 * sends it back with the answer. If the slip's text changed in between, the
 * answer is refused (409 `permission_slip_text_changed`) and the parent reads
 * it again: the fingerprint is always that of the text the parent was shown.
 */

const crypto = require('crypto');

/** Version of the frozen content's shape. Bump it when the fields change. */
const ANSWERED_CONTENT_VERSION = 1;

/** A SHA-256 written in lowercase hexadecimal. */
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/** Refusal sent when the text changed between reading and answering (a translation key). */
const TEXT_CHANGED = 'permission_slip_text_changed';

/** Fingerprint states shown to the team for an answered slip. */
const FINGERPRINT_STATUS = Object.freeze({
  VERIFIED: 'verified',
  ALTERED: 'altered',
  NOT_VERIFIABLE: 'not_verifiable',
});

/**
 * SQL building the text a slip presents, as one JSON object. Dates are
 * written in SQL so the representation does not depend on the server's
 * time zone.
 *
 * @param {string} [alias='ps'] - Alias of `permission_slips` in the query
 * @returns {string} SQL expression
 */
function slipContentSql(alias = 'ps') {
  return `jsonb_build_object(
    'participant_id', ${alias}.participant_id,
    'activity_id', ${alias}.activity_id,
    'meeting_date', to_char(${alias}.meeting_date, 'YYYY-MM-DD'),
    'deadline_date', to_char(${alias}.deadline_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'activity_title', ${alias}.activity_title,
    'activity_description', ${alias}.activity_description,
    'activity_description_html', ${alias}.activity_description_html,
    'authorization_text', ${alias}.authorization_text,
    'consent_payload', COALESCE(${alias}.consent_payload, '{}'::jsonb)
  )`;
}

/**
 * JSON with object keys sorted at every level, so equal content always gives
 * the same text.
 *
 * @param {*} value - JSON-compatible value
 * @returns {string} Canonical JSON
 */
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * The frozen form of a slip's text: its content and the shape's version.
 *
 * @param {Object} content - Result of `slipContentSql()`
 * @returns {Object} Content to store in `answered_content`
 */
function answeredContent(content) {
  return { version: ANSWERED_CONTENT_VERSION, content };
}

/**
 * SHA-256 of a frozen content, in hexadecimal.
 *
 * @param {Object} frozen - Result of `answeredContent()`
 * @returns {string} Fingerprint
 */
function fingerprintOf(frozen) {
  return crypto.createHash('sha256').update(canonicalJson(frozen), 'utf8').digest('hex');
}

/**
 * Fingerprint of the text a slip presents now.
 *
 * @param {Object} content - Result of `slipContentSql()`
 * @returns {string} Fingerprint
 */
function presentedFingerprint(content) {
  return fingerprintOf(answeredContent(content));
}

/**
 * Whether an answered slip's fingerprint proves its text.
 *
 * A slip answered before fingerprints existed has no frozen content: whatever
 * its `signature_hash` holds, it is never shown as verified.
 *
 * @param {Object} row - Slip with `answered_content`, `signature_hash` and `slip_content`
 * @returns {string|null} A FINGERPRINT_STATUS, or null for an unanswered slip
 */
function fingerprintStatus(row) {
  if (row.status !== 'signed' && row.status !== 'declined') {
    return null;
  }
  const frozen = row.answered_content;
  if (!frozen || typeof frozen !== 'object' || frozen.version !== ANSWERED_CONTENT_VERSION
    || !FINGERPRINT_PATTERN.test(String(row.signature_hash || ''))) {
    return FINGERPRINT_STATUS.NOT_VERIFIABLE;
  }
  const hashMatches = fingerprintOf(frozen) === row.signature_hash;
  const textUnchanged = !row.slip_content
    || canonicalJson(frozen.content) === canonicalJson(row.slip_content);
  return hashMatches && textUnchanged ? FINGERPRINT_STATUS.VERIFIED : FINGERPRINT_STATUS.ALTERED;
}

/**
 * A slip as the API returns it: the fingerprint of a pending slip's text, to
 * send back with the answer, and an answered slip's verification. The
 * working columns are left out.
 *
 * @param {Object} row - Slip selected with `slipContentSql() AS slip_content`
 * @returns {Object} Slip for the response
 */
function describeSlip(row) {
  const { slip_content: content, answered_content: _frozen, ...slip } = row;
  return {
    ...slip,
    presented_fingerprint: row.status === 'pending' && content ? presentedFingerprint(content) : null,
    fingerprint_status: fingerprintStatus(row),
  };
}

/**
 * Record a parent's answer, freezing the text they were shown.
 *
 * Runs in one transaction with the slip locked, so the text cannot change
 * between the comparison and the answer.
 *
 * @param {import('pg').Pool} pool - Database pool
 * @param {Object} options
 * @param {string} options.where - Condition on `ps` naming one slip (parameters from $1)
 * @param {Array} options.params - Its parameters
 * @param {'signed'|'declined'} options.answer - The parent's answer
 * @param {string} options.answeredBy - Name the parent typed
 * @param {string} options.presentedFingerprint - Fingerprint of the text the screen showed
 * @param {function(Object, import('pg').PoolClient): Promise<boolean>} [options.mayAnswer] - Checks the
 *   caller may answer this slip, on the transaction's own connection
 * @returns {Promise<{outcome: string, slip?: Object}>} `answered` with the slip, or
 *   `not_found`, `already_answered`, `forbidden`, `text_changed`
 */
async function recordAnswer(pool, {
  where, params, answer, answeredBy, presentedFingerprint: presented, mayAnswer,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT ps.id, ps.organization_id, ps.participant_id, ps.status,
              ${slipContentSql('ps')} AS slip_content
         FROM permission_slips ps
        WHERE ${where}
        FOR UPDATE`,
      params,
    );
    const slip = found.rows[0];
    let outcome = null;
    if (!slip) {
      outcome = 'not_found';
    } else if (slip.status !== 'pending') {
      outcome = 'already_answered';
    } else if (mayAnswer && !(await mayAnswer(slip, client))) {
      outcome = 'forbidden';
    }
    const frozen = slip ? answeredContent(slip.slip_content) : null;
    const fingerprint = frozen ? fingerprintOf(frozen) : null;
    if (!outcome && fingerprint !== presented) {
      outcome = 'text_changed';
    }
    if (outcome) {
      await client.query('ROLLBACK');
      return { outcome };
    }

    // The server's clock dates the answer: a time sent by the device could be backdated.
    const answerColumns = answer === 'signed'
      ? 'signed_by = $2, signed_at = CURRENT_TIMESTAMP'
      : 'declined_by = $2, declined_at = CURRENT_TIMESTAMP';
    const updated = await client.query(
      `UPDATE permission_slips ps
          SET ${answerColumns},
              status = $3,
              answered_content = $4::jsonb,
              signature_hash = $5,
              updated_at = CURRENT_TIMESTAMP
        WHERE ps.id = $1 AND ps.status = 'pending'
        RETURNING ps.*, ${slipContentSql('ps')} AS slip_content`,
      [slip.id, answeredBy, answer, JSON.stringify(frozen), fingerprint],
    );
    await client.query('COMMIT');
    return { outcome: 'answered', slip: describeSlip(updated.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  ANSWERED_CONTENT_VERSION,
  FINGERPRINT_PATTERN,
  FINGERPRINT_STATUS,
  TEXT_CHANGED,
  slipContentSql,
  canonicalJson,
  answeredContent,
  fingerprintOf,
  presentedFingerprint,
  fingerprintStatus,
  describeSlip,
  recordAnswer,
};
