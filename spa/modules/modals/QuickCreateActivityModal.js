/**
 * QuickCreateActivityModal
 * Shared modal for quick activity creation across the app
 */

import { createActivity } from "../../api/api-activities.js";
import { translate } from "../../app.js";
import { clearActivityRelatedCaches } from "../../indexedDB.js";
import { debugError } from "../../utils/DebugUtils.js";
import { setContent } from "../../utils/DOMUtils.js";

export class QuickCreateActivityModal {
  constructor(app, options = {}) {
    this.app = app;
    this.modal = null;
    this.onSuccess = options.onSuccess || null; // Callback after successful creation
    this.redirectPath = options.redirectPath || null; // e.g., '/permission-slips/{id}' or '/carpool/{id}'
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
              ${translate("activity_start_date")} <span style="color: #dc3545;">*</span>
            </label>
            <input type="date" name="activity_start_date" required value="${tomorrowStr}"
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

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
            <div>
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                ${translate("activity_start_time")} <span style="color: #dc3545;">*</span>
              </label>
              <input type="time" name="activity_start_time" required value="09:00"
                style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                ${translate("activity_end_time")} <span style="color: #dc3545;">*</span>
              </label>
              <input type="time" name="activity_end_time" required value="12:00"
                style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
            </div>
          </div>

          <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
              ${translate("activity_end_date")} <span style="color: #dc3545;">*</span>
            </label>
            <input type="date" name="activity_end_date" required value="${tomorrowStr}"
              style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem;">
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
            <button type="submit" style="flex: 1; padding: 0.75rem; background: #28a745; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem; font-weight: 500;">
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
    if (!data.activity_date && data.activity_start_date) {
      data.activity_date = data.activity_start_date;
    }

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = translate("creating") + "...";

      const newActivity = await createActivity(data);
      await clearActivityRelatedCaches();

      this.close();
      this.app.showMessage(translate("activity_created_success"), "success");

      // Call success callback if provided
      if (this.onSuccess) {
        this.onSuccess(newActivity);
      }

      // Handle redirect if path provided
      if (this.redirectPath) {
        const path = this.redirectPath.replace('{id}', newActivity.id);
        this.app.setTimeout?.(() => {
          window.location.hash = path;
        }, 500);
      }
    } catch (error) {
      debugError("Error creating activity:", error);
      this.app.showMessage(
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
