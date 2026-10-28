/**
 * QuickCreateActivityModal
 * Creates an activity from another screen (permission slips, carpools) with
 * the same form the activities page uses, then optionally opens the new
 * activity's page.
 */

import { canFollowPermissionSlips } from '../../utils/PermissionUtils.js';
import { openActivityFormModal } from '../activities/ActivityFormModal.js';

export class QuickCreateActivityModal {
  constructor(app, options = {}) {
    this.app = app;
    this.handle = null;
    this.defaultAuthorization = options.defaultAuthorization || false;
    this.onSuccess = options.onSuccess || null; // Callback after successful creation
    this.redirectPath = options.redirectPath || null; // e.g., '/permission-slips/{id}' or '/carpool/{id}'
  }

  /**
   * Show the activity creation form
   */
  show() {
    this.handle = openActivityFormModal(this.app, {
      defaultAuthorization: this.defaultAuthorization,
      onSaved: async (newActivity) => {
        this.handle = null;
        if (this.onSuccess) {
          await this.onSuccess(newActivity);
        }
        const mayRedirect = !this.redirectPath?.startsWith('/permission-slips/') || canFollowPermissionSlips();
        if (this.redirectPath && newActivity?.id && !newActivity.authorization_required && mayRedirect) {
          this.app.router.navigate(this.redirectPath.replace('{id}', newActivity.id));
        }
      },
    });
  }

  /**
   * Close the modal
   */
  close() {
    this.handle?.close();
    this.handle = null;
  }
}
