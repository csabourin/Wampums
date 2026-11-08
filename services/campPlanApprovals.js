'use strict';

const { isIP } = require('node:net');
const transaction = require('../utils/transaction');
const { HTTP_STATUS } = require('../utils/http-status');
const { generateInvitationToken, digestInvitationToken, invitationExpiresAt, isInvitationExpired } = require('../utils/invitation-tokens');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const { sendEmail } = require('../utils/index');
const { resolveOrganizationEmailSender } = require('./emailSender');
const { CampPlanError } = require('./campPlan');
const { lockCamp, sha256, verificationCode } = require('./campPlanVersions');
const { renderPlanPdf, translator } = require('./campPlanPdf');
const RULES = require('../config/camp_plan_approvals.json');

const STAGES = ['lead', 'group', 'branch'];
const DECISIONS = ['approved', 'changes_requested'];

/** The first stage without a decision. Earlier approvals are required to advance. */
function nextStage(attestations) {
  if (attestations.some((attestation) => attestation.decision === 'changes_requested')) {
    return null;
  }
  return STAGES.find((stage) => !attestations.some((attestation) => attestation.stage === stage)) || null;
}

/** Lock in submission order: camp, then version. Redaction also locks the version. */
async function lockVersion(db, organizationId, meetingId, number) {
  await lockCamp(db, organizationId, meetingId);
  const version = (await db.query(
    `SELECT id, organization_id, meeting_id, version_number, status, submitted_by, submitted_at,
            redacted_at, snapshot, snapshot_sha256, pdf_sha256, language
       FROM camp_plan_versions WHERE organization_id = $1 AND meeting_id = $2 AND version_number = $3 FOR UPDATE`,
    [organizationId, meetingId, number]
  )).rows[0];
  if (!version) {
    throw new CampPlanError('camp_plan_version_not_found', HTTP_STATUS.NOT_FOUND);
  }
  return version;
}

/** Signing is permitted only on the exact version the signer reviewed. */
function assertCurrent(version, expectedDigest) {
  if (version.status !== 'submitted' || version.redacted_at || version.pdf_sha256 !== expectedDigest) {
    throw new CampPlanError('camp_approval_version_changed', HTTP_STATUS.CONFLICT);
  }
}

/** Read the public part of the signature record. IPs and account IDs stay in the audit table. */
async function readAttestations(db, organizationId, versionId) {
  return (await db.query(
    `SELECT stage, decision, signer_name, signer_function, comment, signed_at, received_on::text, snapshot_sha256, pdf_sha256
       FROM camp_plan_attestations WHERE organization_id = $1 AND version_id = $2 ORDER BY signed_at, stage`,
    [organizationId, versionId]
  )).rows;
}

/** Save the decision and, for the final approval, freeze a separate signed PDF. */
async function recordDecision(db, version, attestations, stage, decision, signer) {
  if (nextStage(attestations) !== stage) {
    throw new CampPlanError('camp_approval_wrong_stage', HTTP_STATUS.CONFLICT);
  }
  const { id, organization_id: organizationId, snapshot_sha256: snapshotDigest, pdf_sha256: pdfDigest } = version;
  const saved = (await db.query(
    `INSERT INTO camp_plan_attestations
       (organization_id, version_id, stage, decision, actor_id, signer_name, signer_function, comment, signer_ip, snapshot_sha256, pdf_sha256, received_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING stage, decision, signer_name, signer_function, comment, signed_at, received_on::text, snapshot_sha256, pdf_sha256`,
    [organizationId, id, stage, decision, signer.id, signer.name, signer.job, signer.comment,
      isIP(signer.ip || '') ? signer.ip : null, snapshotDigest, pdfDigest, signer.receivedOn || null]
  )).rows[0];
  if (decision === 'changes_requested') {
    await db.query(
      "UPDATE camp_plan_versions SET status = 'changes_requested' WHERE organization_id = $1 AND id = $2",
      [organizationId, id]
    );
  } else if (stage === 'branch') {
    const pdf = await renderApprovalPdf(version, [...attestations, saved]);
    await db.query(
      "UPDATE camp_plan_versions SET status = 'approved', approved_pdf = $3, approved_pdf_sha256 = $4 WHERE organization_id = $1 AND id = $2",
      [organizationId, id, pdf, sha256(pdf)]
    );
  }
  return saved;
}

/** All attestation copies use the plain snapshot and never reproduce the allergies attachment. */
function renderApprovalPdf(version, attestations) {
  return renderPlanPdf(version.snapshot, null, {
    version: version.version_number,
    submittedAt: new Date(version.submitted_at),
    language: version.language,
    code: verificationCode(version.snapshot_sha256),
    attestations,
  });
}

/** Record a signed-in decision from a user whose stage permission was checked by the route. */
function attestCampPlan(pool, { organizationId, meetingId, number, expectedDigest, actorId, stage, decision, job, comment, ip }) {
  return transaction(pool, async (db) => {
    const version = await lockVersion(db, organizationId, meetingId, number);
    assertCurrent(version, expectedDigest);
    if (decision === 'approved' && version.submitted_by === actorId) {
      throw new CampPlanError('camp_approval_self', HTTP_STATUS.FORBIDDEN);
    }
    const actor = (await db.query('SELECT full_name, email FROM users WHERE id = $1', [actorId])).rows[0];
    const attestations = await readAttestations(db, organizationId, version.id);
    return recordDecision(db, version, attestations, stage, decision,
      { id: actorId, name: actor.full_name || actor.email, job, comment, ip });
  });
}

/** Create or rotate the single outstanding link, then deliver it outside the transaction. */
async function requestBranchApproval(pool, { organizationId, meetingId, number, expectedDigest, email }) {
  const { token, digest } = generateInvitationToken();
  const version = await transaction(pool, async (db) => {
    const row = await lockVersion(db, organizationId, meetingId, number);
    assertCurrent(row, expectedDigest);
    const attestations = await readAttestations(db, organizationId, row.id);
    if (nextStage(attestations) !== 'branch') {
      throw new CampPlanError('camp_approval_wrong_stage', HTTP_STATUS.CONFLICT);
    }
    const submitter = (await db.query('SELECT email FROM users WHERE id = $1', [row.submitted_by])).rows[0];
    if (submitter?.email?.toLowerCase() === email) {
      throw new CampPlanError('camp_approval_self', HTTP_STATUS.FORBIDDEN);
    }
    await db.query(
      `INSERT INTO camp_plan_branch_links (organization_id, version_id, token_digest, pdf_sha256, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (version_id) DO UPDATE SET token_digest = EXCLUDED.token_digest,
         pdf_sha256 = EXCLUDED.pdf_sha256, expires_at = EXCLUDED.expires_at, created_at = now()`,
      [organizationId, row.id, digest, row.pdf_sha256, invitationExpiresAt({ days: RULES.branch_link_days })]
    );
    return row;
  });

  let sent = false;
  try {
    const t = translator(version.language);
    const origin = await resolveOrganizationBaseUrl(pool, organizationId);
    const link = `${origin}/camp-branch-approval#${token}`;
    const sender = await resolveOrganizationEmailSender(pool, organizationId);
    sent = await sendEmail(email, t('camp_approval_email_subject'),
      `${t('camp_approval_email_body')}\n\n${link}`, null, sender, { throwOnError: true });
  } catch {
    // Provider errors can contain the message payload. Keep the token out of logs.
  }
  if (!sent) {
    await pool.query('DELETE FROM camp_plan_branch_links WHERE organization_id = $1 AND version_id = $2 AND token_digest = $3',
      [organizationId, version.id, digest]);
    throw new CampPlanError('camp_approval_email_failed', HTTP_STATUS.BAD_GATEWAY);
  }
}

/** Validate an opaque link without mutating it or disclosing why it is unavailable. */
async function readBranchLink(db, token, withPdf = false) {
  const digest = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? digestInvitationToken(token) : null;
  if (!digest) {
    throw new CampPlanError('camp_approval_link_unavailable', HTTP_STATUS.GONE);
  }
  const row = (await db.query(
    `SELECT v.organization_id, v.meeting_id, v.version_number, v.language, v.snapshot_sha256,
            v.snapshot->'header'->>'name' AS unit_name, v.snapshot->'camp'->>'theme' AS camp_name,
            v.pdf_sha256, CASE WHEN $2 THEN v.pdf END AS pdf, l.expires_at, l.created_at
       FROM camp_plan_branch_links l
       JOIN camp_plan_versions v ON v.id = l.version_id AND v.organization_id = l.organization_id
       JOIN year_plan_meetings m ON m.id = v.meeting_id AND m.organization_id = v.organization_id
      WHERE l.token_digest = $1 AND l.pdf_sha256 = v.pdf_sha256 AND v.status = 'submitted'
        AND v.redacted_at IS NULL AND m.is_cancelled IS NOT TRUE`,
    [digest, withPdf]
  )).rows[0];
  if (!row || isInvitationExpired(row.expires_at)) {
    throw new CampPlanError('camp_approval_link_unavailable', HTTP_STATUS.GONE);
  }
  return row;
}

/** Recheck after locking so a scanner, duplicate click, resend or newer version cannot act. */
async function decideBranchApproval(pool, token, { decision, name, job, comment, ip, receivedOn }) {
  const initial = await readBranchLink(pool, token);
  return transaction(pool, async (db) => {
    let version;
    try {
      version = await lockVersion(db, initial.organization_id, initial.meeting_id, initial.version_number);
    } catch (err) {
      if (err instanceof CampPlanError) {
        throw new CampPlanError('camp_approval_link_unavailable', HTTP_STATUS.GONE);
      }
      throw err;
    }
    await readBranchLink(db, token);
    const attestations = await readAttestations(db, version.organization_id, version.id);
    await recordDecision(db, version, attestations, 'branch', decision, { id: null, name, job, comment, ip, receivedOn });
    await db.query('DELETE FROM camp_plan_branch_links WHERE organization_id = $1 AND version_id = $2',
      [version.organization_id, version.id]);
  });
}

/** Read the current attestation copy. The approved copy is never regenerated on download. */
async function readAttestationPdf(db, organizationId, meetingId, number) {
  const row = (await db.query(
    `SELECT v.id, v.status, v.version_number, v.snapshot, v.snapshot_sha256, v.submitted_at, v.language,
            v.approved_pdf, v.approved_pdf_sha256,
            COALESCE((SELECT json_agg(a ORDER BY a.signed_at, a.stage) FROM (
              SELECT stage, decision, signer_name, signer_function, comment, signed_at, received_on, pdf_sha256
                FROM camp_plan_attestations WHERE organization_id = v.organization_id AND version_id = v.id
            ) a), '[]'::json) AS attestations
       FROM camp_plan_versions v
      WHERE v.organization_id = $1 AND v.meeting_id = $2 AND v.version_number = $3 AND v.redacted_at IS NULL`,
    [organizationId, meetingId, number]
  )).rows[0];
  if (!row?.attestations.length) {
    throw new CampPlanError('camp_plan_version_not_found', HTTP_STATUS.NOT_FOUND);
  }
  const pdf = row.approved_pdf || await renderApprovalPdf(row, row.attestations);
  return {
    pdf, sha256: row.approved_pdf_sha256 || sha256(pdf),
    filename: `camp-plan-${meetingId}-v${number}-${row.approved_pdf ? 'approved' : 'attestations'}.pdf`,
  };
}

module.exports = { RULES, DECISIONS, nextStage, attestCampPlan, requestBranchApproval, readBranchLink, decideBranchApproval, readAttestationPdf };
