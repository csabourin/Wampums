'use strict';

const { sendEmail, getUserEmailLanguage } = require('../utils/index');
const { buildPermissionSlipEmailContent } = require('../utils/permission-slip-email');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const { resolveOrganizationEmailSender } = require('./emailSender');
const createPermissionSlipCopies = require('./permissionSlipCopies');
const logger = require('../config/logger');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_TIMEOUT = 408;
const HTTP_SERVER_ERROR = 500;
const SMTP_STATUS_LIMIT = 600;

/** A validation refusal safe to return through the standard API response. */
class AuthorizationFlowError extends Error {
  constructor(code, status = HTTP_BAD_REQUEST) {
    super(code);
    this.status = status;
  }
}

/**
 * Resolve the current enrolled audience once for preview, creation and sending.
 * Child form emails are deliberately absent. Case/space variants of one adult
 * address are one recipient for a child's request.
 */
async function audience(db, organizationId, invitation) {
  const result = await db.query(
    `SELECT p.id, p.first_name, p.last_name,
            COALESCE(array_agg(DISTINCT LOWER(BTRIM(contact.email)))
              FILTER (WHERE BTRIM(contact.email) <> ''), '{}') AS emails
       FROM participant_enrollments pe
       JOIN scout_years sy ON sy.id = pe.scout_year_id AND sy.organization_id = pe.organization_id AND sy.status = 'active'
       JOIN participants p ON p.id = pe.participant_id
       LEFT JOIN LATERAL (
         SELECT g.courriel AS email FROM participant_guardians pg
           JOIN parents_guardians g ON g.id = pg.guardian_id WHERE pg.participant_id = p.id
         UNION
         SELECT u.email FROM user_participants up JOIN users u ON u.id = up.user_id
           JOIN user_organizations uo ON uo.user_id = u.id AND uo.organization_id = $1 AND uo.status = 'active'
          WHERE up.participant_id = p.id
       ) contact ON TRUE
      WHERE pe.organization_id = $1 AND pe.status = 'active'
        AND ($2::boolean OR p.id = ANY($3::int[]))
      GROUP BY p.id ORDER BY p.first_name, p.last_name, p.id`,
    [organizationId, invitation.invites_everyone !== false, invitation.invited_participant_ids || []],
  );
  return result.rows;
}

/** Load an active activity with its authoritative invitation. */
async function activityFor(db, organizationId, activityId, lock = false) {
  const result = await db.query(
    `SELECT a.*, COALESCE((SELECT array_agg(ai.participant_id) FROM activity_invitees ai
       WHERE ai.activity_id = a.id AND ai.organization_id = a.organization_id), '{}') AS invited_participant_ids
       FROM activities a WHERE a.id = $1 AND a.organization_id = $2 AND a.is_active = TRUE${lock ? ' FOR UPDATE OF a' : ''}`,
    [activityId, organizationId],
  );
  if (!result.rows.length) {throw new AuthorizationFlowError('activity_not_found', HTTP_NOT_FOUND);}
  return result.rows[0];
}

/** Counts for an unsaved activity, without exposing family addresses. */
async function preview(db, organizationId, invitation) {
  const children = await audience(db, organizationId, invitation);
  return {
    participants: children.length,
    addresses: children.reduce((sum, child) => sum + child.emails.length, 0),
    missing: children.filter((child) => !child.emails.length).map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
  };
}

/**
 * Persist missing requests as one transaction. Never take over another activity's
 * request on the same date and never rewrite an answer or a previously issued
 * request. An activity row lock serializes two leaders doing this together.
 */
async function prepare(pool, organizationId, activityId, deadlineDate) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activity = await activityFor(client, organizationId, activityId, true);
    const children = await audience(client, organizationId, activity);
    if (!children.length) {throw new AuthorizationFlowError('authorization_no_invitees');}
    for (const child of children) {
      // eslint-disable-next-line no-await-in-loop -- one transaction, with the activity locked
      const existing = await client.query(
        `SELECT id, activity_id, status FROM permission_slips
          WHERE organization_id = $1 AND participant_id = $2 AND meeting_date = $3 FOR UPDATE`,
        [organizationId, child.id, activity.activity_date],
      );
      if (existing.rows.length) {
        if (Number(existing.rows[0].activity_id) !== Number(activityId) || ['archived', 'revoked', 'expired'].includes(existing.rows[0].status)) {
          throw new AuthorizationFlowError('authorization_date_conflict', HTTP_CONFLICT);
        }
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- requests commit all together
      await client.query(
        `INSERT INTO permission_slips (organization_id, participant_id, activity_id, meeting_date,
           activity_title, activity_description, activity_description_html, authorization_text, deadline_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
        [organizationId, child.id, activityId, activity.activity_date, activity.name, activity.description,
          activity.description_html, activity.authorization_text, deadlineDate || activity.authorization_deadline_date || null],
      );
    }
    await client.query('UPDATE activities SET authorization_required = TRUE WHERE id = $1 AND organization_id = $2', [activityId, organizationId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Claim one address before calling the provider. Only an explicit failed result
 * is retryable. A lost response, crash, or failed receipt stays uncertain and
 * cannot cause another delivery. Shared by the old and the combined workflow.
 */
async function deliver(pool, organizationId, slip, email, sender, content) {
  const normalized = email.trim().toLowerCase();
  const claim = await pool.query(
    `INSERT INTO permission_slip_deliveries (organization_id, slip_id, email, access_token, status)
     VALUES ($1, $2, $3, $4, 'sending')
     ON CONFLICT (slip_id, access_token, email) DO UPDATE SET status = 'sending', updated_at = NOW()
       WHERE permission_slip_deliveries.status = 'failed' AND permission_slip_deliveries.organization_id = $1
     RETURNING id`,
    [organizationId, slip.id, normalized, slip.access_token],
  );
  if (!claim.rows.length) {return 'skipped';}
  let status = 'unknown';
  try {
    const built = content || buildPermissionSlipEmailContent({
      activityTitle: slip.activity_title,
      activityDescription: slip.activity_description,
      activityDescriptionHtml: slip.activity_description_html,
      meetingDate: slip.meeting_date,
      deadlineDate: slip.deadline_date,
      participantFirstName: slip.first_name,
      participantLastName: slip.last_name,
      signLink: `${await resolveOrganizationBaseUrl(pool, organizationId)}/permission-slip/${slip.access_token}`,
      languageCode: await getUserEmailLanguage(pool, normalized, organizationId),
      isReminder: false,
    });
    status = await sendEmail(normalized, built.subject, built.textBody, built.htmlBody, sender, { throwOnError: true }) ? 'sent' : 'failed';
  } catch (err) {
    const httpStatus = Number(err.response?.status || err.statusCode);
    const smtpStatus = Number(err.responseCode);
    if ((httpStatus >= HTTP_BAD_REQUEST && httpStatus < HTTP_SERVER_ERROR && httpStatus !== HTTP_TIMEOUT) || (smtpStatus >= HTTP_BAD_REQUEST && smtpStatus < SMTP_STATUS_LIMIT)) {status = 'failed';}
    logger.warn('Authorization email outcome is uncertain', { slipId: slip.id });
  }
  try {
    await pool.query(
      `UPDATE permission_slip_deliveries SET status = $1, updated_at = NOW(),
         sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END
        WHERE id = $2 AND organization_id = $3`,
      [status, claim.rows[0].id, organizationId],
    );
  } catch (_err) {
    logger.warn('Authorization email receipt could not be saved', { slipId: slip.id });
    return 'unknown';
  }
  return status;
}

/** Rebuild the persistent result from requests and address-level receipts. */
async function summary(pool, organizationId, activityId) {
  const activity = await activityFor(pool, organizationId, activityId);
  const children = await audience(pool, organizationId, activity);
  const allSlips = (await pool.query(
    `SELECT id, participant_id, status, email_sent, email_sent_at FROM permission_slips
      WHERE organization_id = $1 AND activity_id = $2 AND status IN ('pending', 'signed', 'declined')`,
    [organizationId, activityId],
  )).rows;
  const slips = allSlips.filter((slip) => children.some((child) => Number(child.id) === Number(slip.participant_id)));
  const deliveries = (await pool.query(
    `SELECT d.slip_id, d.email, d.status, d.updated_at FROM permission_slip_deliveries d
       JOIN permission_slips ps ON ps.id = d.slip_id AND ps.organization_id = d.organization_id AND ps.access_token = d.access_token
      WHERE d.organization_id = $1 AND ps.activity_id = $2`, [organizationId, activityId],
  )).rows;
  const result = { participants: children.length, requests: slips.length, legacy: 0, answered_addresses: 0, to_create: 0, addresses: 0,
    sent: 0, failed: 0, unknown: 0, unsent: 0, missing: [], problems: [], signed: 0, declined: 0, pending: 0, last_attempt: null };
  for (const slip of slips) {result[slip.status]++;}
  for (const child of children) {
    const slip = slips.find((item) => Number(item.participant_id) === Number(child.id));
    if (!slip) {result.to_create++;}
    result.addresses += child.emails.length;
    if (!child.emails.length && (!slip || slip.status === 'pending')) {result.missing.push({ id: child.id, first_name: child.first_name, last_name: child.last_name });}
    const receipts = deliveries.filter((item) => Number(item.slip_id) === Number(slip?.id));
    for (const email of child.emails) {
      const receipt = receipts.find((item) => item.email === email);
      // Honour pre-migration deliveries and answered requests, without resending.
      const legacy = slip?.email_sent && receipts.length === 0;
      const status = receipt?.status || ((slip && slip.status !== 'pending') ? 'answered_addresses' : legacy ? 'legacy' : 'unsent');
      const bucket = status === 'sending' ? 'unknown' : status;
      result[bucket]++;
      if (['failed', 'unknown'].includes(bucket)) {
        result.problems.push({ participant_id: child.id, first_name: child.first_name, last_name: child.last_name, email, status: bucket });
      }
    }
  }
  const dates = [...deliveries.map((item) => item.updated_at), ...slips.map((item) => item.email_sent_at)].filter(Boolean);
  result.last_attempt = dates.length ? new Date(Math.max(...dates.map((date) => new Date(date).getTime()))).toISOString() : null;
  result.state = !children.length ? 'no_invitees' : !slips.length ? 'not_created' : result.unknown ? 'uncertain'
    : result.failed ? 'incomplete' : result.to_create ? 'not_created' : !result.pending ? 'answered'
      : result.missing.length ? 'incomplete' : result.unsent ? 'not_sent' : 'sent';
  return result;
}

/** Send only current invitees' pending requests to unclaimed/failed addresses. */
async function dispatch(pool, organizationId, activityId) {
  const activity = await activityFor(pool, organizationId, activityId);
  const children = await audience(pool, organizationId, activity);
  const slips = (await pool.query(
    `SELECT ps.*, p.first_name, p.last_name FROM permission_slips ps JOIN participants p ON p.id = ps.participant_id
      WHERE ps.organization_id = $1 AND ps.activity_id = $2 AND ps.status = 'pending'`, [organizationId, activityId],
  )).rows;
  const sender = await resolveOrganizationEmailSender(pool, organizationId);
  const copies = createPermissionSlipCopies(pool);
  const sentSlips = [];
  for (const slip of slips) {
    const child = children.find((item) => Number(item.id) === Number(slip.participant_id));
    if (!child) {continue;}
    // Pre-migration requests already mailed retain their existing protection.
    // eslint-disable-next-line no-await-in-loop -- check legacy delivery before sending
    const receipts = await pool.query('SELECT id FROM permission_slip_deliveries WHERE slip_id = $1 AND organization_id = $2 AND access_token = $3', [slip.id, organizationId, slip.access_token]);
    if (slip.email_sent && !receipts.rows.length) {continue;}
    let sent = false;
    for (const email of child.emails) {
      // eslint-disable-next-line no-await-in-loop -- provider outcomes are recorded per address
      if (await deliver(pool, organizationId, slip, email, sender) === 'sent') {
        sent = true;
        try {
          // eslint-disable-next-line no-await-in-loop -- leader copies share the address receipt
          await copies.recordFamilyDelivery(organizationId, slip, email);
        } catch (_err) {logger.warn('Authorization family-copy receipt failed', { slipId: slip.id });}
      }
    }
    if (sent) {
      sentSlips.push(slip);
      // eslint-disable-next-line no-await-in-loop -- retain legacy email_sent consumers
      await pool.query('UPDATE permission_slips SET email_sent = TRUE, email_sent_at = NOW() WHERE id = $1 AND organization_id = $2 AND access_token = $3', [slip.id, organizationId, slip.access_token]);
    }
  }
  try {await copies.sendLeaderCopies(organizationId, sentSlips, sender);}
  catch (_err) {logger.warn('Authorization leader copies failed', { activityId });}
  return summary(pool, organizationId, activityId);
}

module.exports = { AuthorizationFlowError, audience, preview, prepare, deliver, dispatch, summary };
