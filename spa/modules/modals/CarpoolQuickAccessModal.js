/**
 * CarpoolQuickAccessModal
 * Handles the carpool quick access modal display and interactions
 */

import { getActivities, createActivity } from "../../api/api-activities.js";
import { translate } from "../../app.js";
import { clearActivityRelatedCaches } from "../../indexedDB.js";
import { debugError } from "../../utils/DebugUtils.js";
import { escapeHTML } from "../../utils/SecurityUtils.js";
import { setContent } from "../../utils/DOMUtils.js";
import { formatDateShort, isoToDateString } from "../../utils/DateUtils.js";

export class CarpoolQuickAccessModal {
  constructor(app) {
    this.app = app;
    this.modal = null;
  }

  /**
   * Show the carpool quick access modal
   */
  async show() {
    try {
      const activities = await getActivities();
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const upcomingActivities = activities.filter((activity) => {
        const activityDate = new Date(activity.activity_date);
        activityDate.setHours(0, 0, 0, 0);
        return activityDate >= now;
      });

      this.render(upcomingActivities);
      this.attachListeners(upcomingActivities);
    } catch (error) {
      debugError("Error loading carpool activities:", error);
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
          <h2 style="margin: 0;">${translate("carpool_coordination")}</h2>
          <button type="button" id="close-carpool-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; padding: 0.5rem;">✕</button>
        </div>

        ${activities.length > 0
          ? `
            <p style="color: #666; margin-bottom: 1rem;">${translate("select_activity_for_carpool")}</p>
            <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
              ${activities
                .map(
                  (activity) => `
                    <a href="/carpool/${activity.id}" style="padding: 1rem; border: 2px solid #e0e0e0; border-radius: 8px; text-decoration: none; color: inherit; display: block; transition: all 0.2s;">
                      <div style="display: flex; justify-content: space-between; gap: 1rem;">
                        <div style="flex: 1;">
                          <h3 style="margin: 0 0 0.5rem 0;">${escapeHTML(activity.name)}</h3>
                          <p style="margin: 0; color: #666; font-size: 0.9rem;">
                            ${formatDateShort(isoToDateString(activity.activity_date), this.app.lang || "fr")} - ${activity.departure_time_going}
                          </p>
                          <p style="margin: 0.25rem 0 0 0; color: #999; font-size: 0.85rem;">
                            ${escapeHTML(activity.meeting_location_going)}
                          </p>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem; font-size: 0.85rem;">
                          <span style="background: #667eea; color: white; padding: 0.25rem 0.75rem; border-radius: 20px;">
                            ${activity.carpool_offer_count || 0} ${translate("vehicles")}
                          </span>
                          <span style="color: #666;">
                            ${activity.assigned_participant_count || 0} ${translate("assigned")}
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
          <button type="button" id="quick-create-activity-btn" class="button" style="width: 100%; padding: 0.75rem; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 500;">
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
    const closeBtn = this.modal.querySelector("#close-carpool-modal");
    closeBtn?.addEventListener("click", () => this.close());

    // Click outside to close
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.close();
    });

    // Hover effects on activity links
    const activityLinks = this.modal.querySelectorAll('a[href^="/carpool/"]');
    activityLinks.forEach((link) => {
      link.addEventListener("mouseenter", (e) => {
        e.currentTarget.style.borderColor = "#667eea";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(102,126,234,0.15)";
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
    const modal = new QuickCreateActivityModal(this.app);
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

/**
 * QuickCreateActivityModal
 * Handles quick activity creation in a modal
 */
class QuickCreateActivityModal {
  constructor(app) {
    this.app = app;
    this.modal = null;
  }

  /**
   * Show the quick create activity modal
   */
  show() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

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
      <div style="background: white; border-radius: 12px; max-width: 500px; width: 90%; padding: 2rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h2 style="margin: 0;">${translate("quick_create_activity")}</h2>
          <button type="button" id="close-quick-create-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; padding: 0.5rem;">✕</button>
        </div>

        <form id="quick-create-activity-form">
          <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
              ${translate("activity_name")} <span style="color: #dc3545;">*</span>
            </label>
            <input type="text" name="name" required
              style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;"
              placeholder="${translate("activity_name")}">
          </div>

          <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
              ${translate("activity_date")} <span style="color: #dc3545;">*</span>
            </label>
            <input type="date" name="activity_date" required value="${tomorrowStr}"
              style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
          </div>

          <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
              ${translate("meeting_location")} (${translate("going")}) <span style="color: #dc3545;">*</span>
            </label>
            <input type="text" name="meeting_location_going" required
              style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;"
              placeholder="${translate("meeting_location_placeholder")}">
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
            <div>
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                ${translate("meeting_time")} <span style="color: #dc3545;">*</span>
              </label>
              <input type="time" name="meeting_time_going" required value="09:00"
                style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                ${translate("departure_time")} <span style="color: #dc3545;">*</span>
              </label>
              <input type="time" name="departure_time_going" required value="09:15"
                style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
            </div>
          </div>

          <div style="margin: 1.5rem 0; padding-top: 1.5rem; border-top: 2px solid #e9ecef;">
            <h3 style="margin: 0 0 1rem 0; font-size: 1.1rem; color: #667eea;">${translate("returning_from_activity")}</h3>

            <div style="margin-bottom: 1rem;">
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                ${translate("meeting_location")}
              </label>
              <input type="text" name="meeting_location_return"
                style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;"
                placeholder="${translate("meeting_location_placeholder")}">
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                  ${translate("meeting_time")}
                </label>
                <input type="time" name="meeting_time_return"
                  style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
              </div>
              <div>
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                  ${translate("departure_time")}
                </label>
                <input type="time" name="departure_time_return"
                  style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
              </div>
            </div>
          </div>

          <div style="margin-top: 2rem; display: flex; gap: 1rem;">
            <button type="button" id="cancel-quick-create" style="flex: 1; padding: 0.75rem; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem;">
              ${translate("cancel")}
            </button>
            <button type="submit" style="flex: 1; padding: 0.75rem; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem; font-weight: 500;">
              ${translate("create_activity")}
            </button>
          </div>
        </form>
      </div>
    `;

    setContent(this.modal, content);
    document.body.appendChild(this.modal);
    this.attachListeners();
  }

  /**
   * Attach event listeners
   */
  attachListeners() {
    // Close button
    const closeBtn = this.modal.querySelector("#close-quick-create-modal");
    closeBtn?.addEventListener("click", () => this.close());

    // Cancel button
    const cancelBtn = this.modal.querySelector("#cancel-quick-create");
    cancelBtn?.addEventListener("click", () => this.close());

    // Click outside to close
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.close();
    });

    // Form submission
    const form = this.modal.querySelector("#quick-create-activity-form");
    form?.addEventListener("submit", (e) => this.handleSubmit(e));
  }

  /**
   * Handle form submission
   */
  async handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = translate("creating") + "...";

      const newActivity = await createActivity(data);
      await clearActivityRelatedCaches();

      this.close();
      this.app.showToast(translate("activity_created_success"), "success");

      // Redirect to carpool page
      this.app.setTimeout?.(() => {
        window.location.hash = `/carpool/${newActivity.id}`;
      }, 500);
    } catch (error) {
      debugError("Error creating activity:", error);
      this.app.showToast(
        error.message || translate("error_saving_activity"),
        "error"
      );
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = false;
      submitBtn.textContent = translate("create_activity");
    }
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
