// ActivityDeleteDialog.js
// Confirming an activity's deletion, and choosing whether everyone it concerns
// (families, drivers and the unit's leaders) is emailed that it is cancelled.
// Deleting also removes mistakes, so the email is a choice, off by default like
// the edit form's update notice. An outing that replaced a meeting then asks
// whether the meeting comes back (#1327).
import { translate } from '../../app.js';
import { openModal } from '../../utils/ModalUtils.js';
import { confirm } from '../../utils/DialogUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';

const DIALOG_ID = 'activity-delete-dialog';

/**
 * Ask whether to delete an activity and whether to announce its cancellation.
 *
 * @param {{name?: string, replaces_meeting_id?: number, replaces_meeting_date?: string}} activity - Activity about to be deleted
 * @param {string} [lang] - Interface language, for the meeting's date
 * @returns {Promise<{notify: boolean, restoreMeeting: boolean}|null>} The choice, or null when declined
 */
export async function confirmActivityDeletion(activity, lang) {
  const answer = await confirmDeletion(activity);
  if (!answer) {
    return null;
  }
  return { ...answer, restoreMeeting: await askRestoreReplacedMeeting(activity, lang) };
}

/**
 * The outing replaced a meeting: does the meeting come back now the outing is
 * cancelled? Declining (or dismissing) leaves the meeting cancelled.
 *
 * @param {{replaces_meeting_id?: number, replaces_meeting_date?: string}} activity
 * @param {string} [lang]
 * @returns {Promise<boolean>} true when nothing was replaced
 */
export function askRestoreReplacedMeeting(activity, lang) {
  // Keeping it cancelled takes the planner's right to cancel a meeting; without it, it comes back.
  if (!activity?.replaces_meeting_id || !hasPermission('meetings.edit')) {
    return Promise.resolve(true);
  }
  const date = activity.replaces_meeting_date ? formatDate(activity.replaces_meeting_date, lang) : '';
  return confirm({
    title: translate('activity_delete_restore_meeting_title'),
    message: translate('activity_delete_restore_meeting_message').replace('{date}', () => date),
    confirmLabel: translate('activity_delete_restore_meeting_yes'),
    cancelLabel: translate('activity_delete_restore_meeting_no'),
  });
}

/**
 * What to tell the person once the deletion is confirmed by the server.
 *
 * @param {?{restored: boolean}} replacedMeeting - `replaced_meeting` of the DELETE answer
 * @returns {string} Translation key
 */
export function deletedMessageKey(replacedMeeting) {
  if (!replacedMeeting) {
    return 'activity_deleted_success';
  }
  return replacedMeeting.restored ? 'activity_deleted_meeting_restored' : 'activity_deleted_meeting_cancelled';
}

/**
 * @param {{name?: string}} activity
 * @returns {Promise<{notify: boolean}|null>}
 */
function confirmDeletion(activity) {
  return new Promise((resolve) => {
    let answer = null;
    const { overlay, close } = openModal({
      id: DIALOG_ID,
      size: 'small',
      title: escapeHTML(translate('activity_delete_title')),
      body: `
        <p><strong>${escapeHTML(activity?.name || '')}</strong></p>
        <p>${escapeHTML(translate('confirm_delete_activity'))}</p>
        <div class="form-group">
          <label>
            <input type="checkbox" id="activity-delete-notify" aria-describedby="activity-delete-notify-help">
            ${escapeHTML(translate('activity_delete_notify_label'))}
          </label>
          <small class="form-help" id="activity-delete-notify-help">${escapeHTML(translate('activity_delete_notify_help'))}</small>
        </div>
      `,
      footer: `
        <button type="button" class="button button--secondary" id="activity-delete-cancel" data-modal-close>${escapeHTML(translate('cancel'))}</button>
        <button type="button" class="button button--danger" id="activity-delete-confirm">${escapeHTML(translate('delete'))}</button>
      `,
      initialFocus: '#activity-delete-cancel',
      onClose: () => resolve(answer),
    });
    overlay.querySelector('#activity-delete-confirm').addEventListener('click', () => {
      answer = { notify: overlay.querySelector('#activity-delete-notify').checked };
      close();
    });
  });
}
