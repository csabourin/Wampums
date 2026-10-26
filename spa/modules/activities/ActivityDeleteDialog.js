// ActivityDeleteDialog.js
// Confirming an activity's deletion, and choosing whether everyone it concerns
// (families, drivers and the unit's leaders) is emailed that it is cancelled.
// Deleting also removes mistakes, so the email is a choice, off by default like
// the edit form's update notice.
import { translate } from '../../app.js';
import { openModal } from '../../utils/ModalUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';

const DIALOG_ID = 'activity-delete-dialog';

/**
 * Ask whether to delete an activity and whether to announce its cancellation.
 *
 * @param {{name?: string}} activity - Activity about to be deleted
 * @returns {Promise<{notify: boolean}|null>} The choice, or null when declined
 */
export function confirmActivityDeletion(activity) {
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
