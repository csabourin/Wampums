import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { confirm } from '../../utils/DialogUtils.js';
import RULES from '../../../config/camp_plan_approvals.json';

export const APPROVAL_STAGES = ['lead', 'group', 'branch'];
export const APPROVAL_PERMISSIONS = {
  lead: 'camp_plans.attest_lead',
  group: 'camp_plans.approve_group',
  branch: 'camp_plans.request_branch_approval',
};

const text = (key) => escapeHTML(translate(key));

/** The same signing fields and explicit choice for team members and the branch lead. */
export function decisionFields(id, { external = false, ownSubmission = false } = {}) {
  return `
    ${external ? `
      <div class="form-group">
        <label for="${id}-name">${text('camp_approval_signer')}</label>
        <input id="${id}-name" name="signer_name" autocomplete="name" required maxlength="${RULES.signer_name_max}">
      </div>
      <div class="form-group">
        <label for="${id}-received">${text('camp_approval_received_on')}</label>
        <input id="${id}-received" name="received_on" type="date" required>
      </div>` : ''}
    <div class="form-group">
      <label for="${id}-job">${text('camp_approval_function')}</label>
      <input id="${id}-job" name="job" autocomplete="organization-title" required maxlength="${RULES.signer_function_max}">
    </div>
    <div class="form-group">
      <label for="${id}-comment">${text('camp_approval_comment_optional')}</label>
      <textarea id="${id}-comment" name="comment" rows="3" maxlength="${RULES.comment_max}"
        aria-describedby="${id}-comment-hint"></textarea>
      <p id="${id}-comment-hint" class="field-hint">${text('camp_approval_comment_hint')}</p>
    </div>
    <div class="form-group">
      <label for="${id}-decision">${text('camp_approval_decision')}</label>
      <select id="${id}-decision" name="decision" required>
        <option value="">${text('camp_approval_choose')}</option>
        ${ownSubmission ? '' : `<option value="approved">${text('camp_approval_approve')}</option>`}
        <option value="changes_requested">${text('camp_approval_request_changes')}</option>
      </select>
    </div>
    ${ownSubmission ? `<p class="field-hint">${text('camp_approval_self')}</p>` : ''}
    <p class="field-error" role="alert" data-approval-error></p>
    <button type="submit" class="button button--primary">${text('camp_approval_review_decision')}</button>`;
}

/** Confirm the decision against the code printed on the submitted PDF. */
export function confirmDecision(decision, code) {
  const approving = decision === 'approved';
  const title = translate(approving ? 'camp_approval_approve' : 'camp_approval_request_changes');
  return confirm({
    title,
    message: translate(approving ? 'camp_approval_confirm_sign' : 'camp_approval_confirm_return').replace('{code}', code),
    confirmLabel: title,
  });
}

/** Save a PDF without placing its contents or bearer credential in a URL. */
export function savePlanDocument(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  const DOWNLOAD_URL_LIFETIME_MS = 10000;
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
}
