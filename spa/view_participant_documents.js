import { getParticipantsWithDocuments, getOrganizationFormFormats, getFormSubmission } from "./ajax-functions.js"; // Updated import to reflect getOrganizationFormFormats
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { JSONFormRenderer } from "./JSONFormRenderer.js";
import { canViewParticipants } from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";

export class ViewParticipantDocuments {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.organizationSettings = null;
    this.formRenderers = {};
  }

  async init() {
    if (!canViewParticipants()) {
      this.app.router.navigate("/");
      return;
    }

    try {
      await this.fetchOrganizationData(); // Use the renamed and updated function
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing view participant documents:", error);
      this.renderError(error.message);
    }
  }

  async fetchOrganizationData() {
      try {
          // Call the function to fetch organization form formats
          const formFormats = await getOrganizationFormFormats(); // Assuming this function is already set up correctly

          if (!formFormats || typeof formFormats !== 'object') {
              throw new Error('Invalid form formats received');
          }

          debugLog("Fetched form formats:", formFormats);

          // Directly set formFormats as the data we need
          this.organizationSettings = {}; // Clear the settings since it's not used in this case

          // Loop through the formFormats to set up formRenderers
          Object.keys(formFormats).forEach(formType => {
              const formStructure = formFormats[formType];

              if (formStructure) {
                  // Validate the form structure
                  if (!formStructure.fields || !Array.isArray(formStructure.fields)) {
                      debugWarn(`Invalid or missing fields in form structure for: ${formType}`, formStructure);
                  } else {
                      debugLog('Valid form structure for:', formType, formStructure);
                      this.formRenderers[formType] = new JSONFormRenderer(formStructure);
                  }
              } else {
                  debugWarn(`No form structure found for: ${formType}`);
              }
          });
      } catch (error) {
          debugError("Error fetching organization data:", error);
          throw error;
      }
  }



  async fetchData() {
    try {
      const data = await getParticipantsWithDocuments();
      debugLog("Fetched participants data:", data);
      this.participants = data.participants || [];
    } catch (error) {
      debugError("Error fetching participant documents data:", error);
      throw error;
    }
  }

  render() {
    const content = `
      <h1>${translate("view_participant_documents")}</h1>
      <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
      <div class="participant-documents">
        ${this.renderParticipantList()}
      </div>
      <div id="form-view-modal" class="modal">
        <div class="modal-content">
          <span class="close">&times;</span>
          <div id="form-content"></div>
        </div>
      </div>
    `;
    setContent(document.getElementById("app"), content);
  }

  renderParticipantList() {
    return this.participants.map(participant => `
      <div class="participant-card">
        <h2>${participant.first_name} ${participant.last_name}</h2>
        ${this.renderFormStatuses(participant)}
      </div>
    `).join('');
  }

  renderFormStatuses(participant) {
    // Render dynamically based on available form structures
    const formTypes = Object.keys(this.formRenderers); // Dynamically use the fetched form types
    return formTypes.map(formType => `
      <div class="form-status">
        <span>${translate(formType)}: </span>
        <span class="${participant[`has_${formType}`] ? 'filled' : 'missing'}">
          ${participant[`has_${formType}`] ? '✅' : '❌'}
        </span>
        ${participant[`has_${formType}`] ? `
          <button class="view-form" data-participant-id="${participant.id}" data-form-type="${formType}">
            ${translate("view")}
          </button>
        ` : ''}
      </div>
    `).join('');
  }

  attachEventListeners() {
    document.querySelectorAll('.view-form').forEach(button => {
      button.addEventListener('click', (e) => this.handleViewForm(e));
    });

    const modal = document.getElementById('form-view-modal');
    const span = modal.querySelector('.close');
    span.onclick = () => modal.style.display = "none";
    window.onclick = (event) => {
      if (event.target == modal) {
        modal.style.display = "none";
      }
    };
  }

  async handleViewForm(e) {
    const participantId = e.target.dataset.participantId;
    const formType = e.target.dataset.formType;

    debugLog(`Fetching form submission for participantId: ${participantId}, formType: ${formType}`);

    try {
      const response = await getFormSubmission(participantId, formType);
      debugLog("Fetched form data:", response);

      if (!this.formRenderers[formType]) {
        debugError(`No form renderer found for formType: ${formType}`);
        this.app.showMessage(translate("error_form_not_found"), "error");
        return;
      }

      // Extract the submission_data from the response
      const submissionData = response.data?.submission_data || response.submission_data || {};
      debugLog("Extracted submission data:", submissionData);

      // Pass submission_data to render
      const formContent = this.formRenderers[formType].render(submissionData);
      setContent(document.getElementById('form-content'), formContent);
      document.getElementById('form-view-modal').style.display = "block";
    } catch (error) {
      debugError(`Error fetching form data for ${formType}:`, error);
      this.app.showMessage(translate("error_fetching_form_data"), "error");
    }
  }

  renderError(message) {
    const errorMessage = `
      <h1>${translate("error")}</h1>
      <p>${message || translate("error_loading_participant_documents")}</p>
      <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
    `;
    setContent(document.getElementById("app"), errorMessage);
  }
}
