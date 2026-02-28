/**
 * PermissionSlipQuickAccessModal
 * Handles the permission slip quick access modal display and interactions
 */

import { getActivities } from "../../api/api-activities.js";
import { translate } from "../../app.js";
import { debugError } from "../../utils/DebugUtils.js";
import { escapeHTML } from "../../utils/SecurityUtils.js";
import { setContent } from "../../utils/DOMUtils.js";
import {
  formatActivityDateRange,
  getActivityEndDateObj
} from "../../utils/ActivityDateUtils.js";
import { QuickCreateActivityModal } from "./QuickCreateActivityModal.js";

export class PermissionSlipQuickAccessModal {
  constructor(app) {
    this.app = app;
    this.modal = null;
  }

  /**
   * Show the permission slip quick access modal
   */
  async show() {
    try {
      const activities = await getActivities();
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const upcomingActivities = activities.filter((activity) => {
        const activityEndDate = getActivityEndDateObj(activity);
        return activityEndDate && activityEndDate >= now;
      });

      this.render(upcomingActivities);
      this.attachListeners(upcomingActivities);
    } catch (error) {
      debugError("Error loading permission slip activities:", error);
      this.app.showToast(translate("error_loading_activities"), "error");
    }
  }

  /**
   * Render the modal
   */
  render(activities) {
    this.modal = document.createElement("div");
    this.modal.className = "modal-screen";
    this.modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    const content = `
      <div style="background: white; border-radius: 12px; max-width: 600px; width: 90%; max-height: 80vh; overflow: auto; padding: 2rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h2 style="margin: 0;">${translate("permission_slip_dashboard_title")}</h2>
          <button type="button" id="close-permission-slip-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; padding: 0.5rem;">✕</button>
        </div>

        ${activities.length > 0
          ? `
            <p style="color: #666; margin-bottom: 1rem;">${translate("select_activity_for_permission_slip")}</p>
            <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
              ${activities
                .map(
                  (activity) => `
                    <a href="/permission-slips/${activity.id}" style="padding: 1rem; border: 2px solid #e0e0e0; border-radius: 8px; text-decoration: none; color: inherit; display: block; transition: all 0.2s;">
                      <div style="display: flex; justify-content: space-between; gap: 1rem;">
                        <div style="flex: 1;">
                          <h3 style="margin: 0 0 0.5rem 0;">${escapeHTML(activity.name)}</h3>
                          <p style="margin: 0; color: #666; font-size: 0.9rem;">
                            ${formatActivityDateRange(activity, this.app.lang || "fr")}
                          </p>
                          ${activity.meeting_location_going ? `
                            <p style="margin: 0.25rem 0 0 0; color: #999; font-size: 0.85rem;">
                              ${escapeHTML(activity.meeting_location_going)}
                            </p>
                          ` : ''}
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem; font-size: 0.85rem;">
                          <span style="background: #28a745; color: white; padding: 0.25rem 0.75rem; border-radius: 20px;">
                            ${translate("create_permission_slip")}
                          </span>
                        </div>
                      </div>
                    </a>
                  `
                )
                .join("")}
            </div>
          `
          : `
            <div style="text-align: center; padding: 2rem; color: #999;">
              <p style="margin-bottom: 1rem;">${translate("no_upcoming_activities")}</p>
            </div>
          `
        }

        <div style="border-top: 1px solid #e0e0e0; padding-top: 1.5rem; margin-top: 1.5rem;">
          <button type="button" id="quick-create-activity-btn" class="button" style="width: 100%; padding: 0.75rem; background: #28a745; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 500;">
            ➕ ${translate("quick_create_activity")}
          </button>
        </div>
      </div>
    `;

    setContent(this.modal, content);
    document.body.appendChild(this.modal);
  }

  /**
   * Attach event listeners
   */
  attachListeners(activities) {
    // Close button
    const closeBtn = this.modal.querySelector("#close-permission-slip-modal");
    closeBtn?.addEventListener("click", () => this.close());

    // Click outside to close
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.close();
    });

    // Hover effects on activity links
    const activityLinks = this.modal.querySelectorAll('a[href^="/permission-slips/"]');
    activityLinks.forEach((link) => {
      link.addEventListener("mouseenter", (e) => {
        e.currentTarget.style.borderColor = "#28a745";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(40,167,69,0.15)";
      });
      link.addEventListener("mouseleave", (e) => {
        e.currentTarget.style.borderColor = "#e0e0e0";
        e.currentTarget.style.boxShadow = "none";
      });
    });

    // Quick create activity button
    const quickCreateBtn = this.modal.querySelector("#quick-create-activity-btn");
    quickCreateBtn?.addEventListener("click", () => {
      this.close();
      this.showQuickCreateModal();
    });
  }

  /**
   * Show quick create activity modal
   */
  showQuickCreateModal() {
    const modal = new QuickCreateActivityModal(this.app, {
      redirectPath: '/permission-slips/{id}'
    });
    modal.show();
  }

  /**
   * Close the modal
   */
  close() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }
}
