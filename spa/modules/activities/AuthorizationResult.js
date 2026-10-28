import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatTimestamp } from '../../utils/DateUtils.js';

/** Render server-confirmed counts; emails and requests have different units. */
export function authorizationResultHTML(result, lang = 'fr') {
  const fill = (key, values) => escapeHTML(Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value), translate(key),
  ));
  const stateKeys = {
    answered: 'authorization_state_answered', no_invitees: 'authorization_state_no_invitees',
    not_created: 'authorization_state_not_created', not_sent: 'authorization_state_not_sent',
    sent: 'authorization_state_sent', incomplete: 'authorization_state_incomplete', uncertain: 'authorization_state_uncertain',
  };
  return `
    <p><strong>${escapeHTML(translate(stateKeys[result.state] || 'authorization_state_uncertain'))}</strong></p>
    <p>${fill('authorization_request_counts', { created: result.requests, total: result.participants, missing: result.to_create })}</p>
    <p>${fill('authorization_email_counts', { sent: result.sent, unsent: result.unsent, failed: result.failed, unknown: result.unknown })}</p>
    ${result.legacy ? `<p>${escapeHTML(translate('authorization_legacy_deliveries'))}</p>` : ''}
    ${result.last_attempt ? `<p>${escapeHTML(translate('authorization_last_attempt'))} ${escapeHTML(formatTimestamp(result.last_attempt, lang))}</p>` : ''}
    ${result.missing?.length ? `<p>${fill('authorization_missing_contacts', { count: result.missing.length })}</p>
      <ul>${result.missing.map((child) => `<li>${escapeHTML(`${child.first_name} ${child.last_name}`)}</li>`).join('')}</ul>` : ''}
    ${result.problems?.length ? `<details><summary>${escapeHTML(translate('authorization_view_problems'))}</summary><ul>
      ${result.problems.map((problem) => `<li>${escapeHTML(`${problem.first_name} ${problem.last_name}`)} — ${escapeHTML(problem.email)} : ${escapeHTML(translate(problem.status === 'failed' ? 'authorization_address_failed' : 'authorization_address_unknown'))}</li>`).join('')}
    </ul></details>` : ''}
    ${result.state === 'uncertain' ? `<p>${escapeHTML(translate('authorization_uncertain_help'))}</p>` : ''}
  `;
}
