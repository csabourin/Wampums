/**
 * QuickCreateActivityModal
 * Creates an activity from another screen (permission slips, carpools) with
 * the same form the activities page uses, then optionally opens the new
 * activity's page.
 */

import { openActivityFormModal } from '../activities/ActivityFormModal.js';

export class QuickCreateActivityModal {
  constructor(app, options = {}) {
    this.app = app;
    this.handle = null;
    this.onSuccess = options.onSuccess || null; // Callback after successful creation
    this.redirectPath = options.redirectPath || null; // e.g., '/permission-slips/{id}' or '/carpool/{id}'
  }

  /**
   * Show the activity creation form
   */
  show() {
    this.handle = openActivityFormModal(this.app, {
      onSaved: async (newActivity) => {
        this.handle = null;
        if (this.onSuccess) {
          await this.onSuccess(newActivity);
        }
        if (this.redirectPath && newActivity?.id) {
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
