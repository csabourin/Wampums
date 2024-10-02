import { DynamicFormHandler } from "./dynamicFormHandler.js";
import { translate } from "./app.js";
import {
  fetchParticipant,
  saveFormSubmission,
  getOrganizationFormFormats,
  saveParticipant 
} from "./ajax-functions.js";

export class FormulaireInscription {
  constructor(app) {
    this.app = app;
    this.participant = null;
    this.participantId = null;
    this.formData = {};
    this.formStructures = {};
    this.participantFormHandler = null;
    this.guardianFormHandlers = [];
  }

  render() {
    console.log("Rendering form");

    // Render the participant's form
    const participantContainer = document.getElementById("participant-form");
    if (participantContainer && this.participantFormHandler) {
      this.participantFormHandler.render(); // No need to pass the container since it defaults to the one set in init
    } else {
      console.error("Participant container or form handler not found");
    }

    // Render the guardian forms
    this.renderGuardianForms();
  }

  async init(participantId = null) {
      console.log("Initializing FormulaireInscription");
      this.participantId = participantId;
      try {
          // Step 1: Fetch necessary data
          await this.fetchFormStructures();
          if (this.participantId) {
              await this.fetchParticipantData();
          } else {
              this.formData = { guardians: [] };
          }

          // Step 2: Create the form structure
          this.createInitialStructure();

          // Step 3: Initialize DynamicFormHandler for participant form
          this.participantFormHandler = new DynamicFormHandler(this.app);
          await this.participantFormHandler.init('participant_registration', this.participantId, this.formData, 'participant-form'); // Specify container

          // Step 4: Render and attach event listeners
          this.render();
          this.attachEventListeners();
      } catch (error) {
          console.error("Error initializing form:", error);
          this.showError(translate("error_loading_form"));
      }
  }

  async fetchFormStructures() {
    try {
      this.formStructures = await getOrganizationFormFormats();
    } catch (error) {
      console.error("Error fetching form structures:", error);
      throw error;
    }
  }

  async fetchParticipantData() {
    try {
      const participantData = await fetchParticipant(this.participantId);
      this.formData = participantData.submission_data || {};
      this.formData.guardians = this.formData.guardians || [];
    } catch (error) {
      console.error("Error fetching participant data:", error);
      throw error;
    }
  }

  createInitialStructure() {
      console.log("Creating initial structure");
      const content = `
        <h1>${this.participantId ? translate("edit_participant") : translate("add_participant")}</h1>
        <div id="error-message" class="error hidden"></div>
        <div id="success-message" class="success hidden"></div>
        <form id="inscription-form">
          <fieldset id="participant-form"></fieldset>  <!-- Changed to a fieldset -->
          <h2>${translate("informations_parents")}</h2>
          <div id="guardians-container"></div>
          <button type="button" id="add-guardian">${translate("add_parent_guardian")}</button>
          <button type="submit" id="submit-form">${translate("save")}</button>
        </form>
      `;
      document.getElementById("app").innerHTML = content;
  }


  renderGuardianForms() {
      const container = document.getElementById('guardians-container');
      if (!container) {
          console.error("Guardians container not found");
          return;
      }
      container.innerHTML = '';
      this.guardianFormHandlers = [];

      const renderGuardian = (index, guardianData = {}) => {
          const formHandler = new DynamicFormHandler(this.app);

          // Create a container for each guardian form
          const formContainer = document.createElement('div');
          formContainer.className = 'guardian-form';
          formContainer.dataset.index = index;
          container.appendChild(formContainer);

          console.log(`Rendering guardian form ${index} in container`, formContainer);

          // Initialize the formHandler and assign it to render within formContainer
          formHandler.init('parent_guardian', null, guardianData, formContainer); 
          this.guardianFormHandlers.push(formHandler);

          // Add remove button for additional guardian forms
          if (index > 0) {
              const removeButton = document.createElement('button');
              removeButton.type = 'button';
              removeButton.className = 'remove-guardian';
              removeButton.textContent = translate("remove_guardian");
              removeButton.onclick = () => this.removeGuardianForm(index);
              formContainer.appendChild(removeButton);
          }
      };

      if (this.formData.guardians && this.formData.guardians.length > 0) {
          this.formData.guardians.forEach((guardian, index) => renderGuardian(index, guardian));
      } else {
          renderGuardian(0);
      }
  }



  attachEventListeners() {
      console.log("Attaching event listeners");
      const form = document.getElementById("inscription-form");
      const addGuardianButton = document.getElementById("add-guardian");

      if (form) {
          form.addEventListener("submit", (e) => this.handleSubmit(e));
      } else {
          console.error("Inscription form not found");
      }

      if (addGuardianButton) {
          addGuardianButton.addEventListener("click", () => this.addGuardianForm());
      } else {
          console.error("Add guardian button not found");
      }
  }

  addGuardianForm() {
    const index = this.guardianFormHandlers.length;
    this.formData.guardians.push({});
    this.renderGuardianForms();
  }

  removeGuardianForm(index) {
    this.formData.guardians.splice(index, 1);
    this.renderGuardianForms();
  }

  async handleSubmit(e) {
      console.log("Form submission started");
      e.preventDefault(); // Prevent the default form submission
      e.stopPropagation(); // Stop the event from bubbling up

      // Retrieve participant data
      const participantData = this.participantFormHandler.getFormData();
      console.log("Participant data:", Object.fromEntries(participantData.entries())); // Debug output

      // Retrieve guardians' data
      const guardiansData = this.guardianFormHandlers.map(handler => {
          const formData = handler.getFormData();
          console.log("Guardian form data:", Object.fromEntries(formData.entries())); // Debug output
          return Object.fromEntries(formData.entries());
      });

      // Extracting basic participant fields
      const participantBasicData = {
          first_name: participantData.get('first_name'),
          last_name: participantData.get('last_name'),
          date_naissance: participantData.get('date_naissance')
      };

      // Organizing full form data, excluding the extracted participant basic data
      const formSubmissionData = {
          ...Object.fromEntries(participantData.entries()), // All participant data
          guardians: guardiansData // Including guardians' data
      };

      console.log("Full form data to be submitted:", formSubmissionData);

      try {
          // Step 1: Save to the `participants` table
          const saveParticipantResult = await saveParticipant(participantBasicData);
          if (!saveParticipantResult.success) {
              throw new Error(saveParticipantResult.message || translate("error_saving_participant"));
          }

          const participantId = saveParticipantResult.participant_id;
          console.log("Participant saved with ID:", participantId);

          // Step 2: Save the remaining data in `form_submissions`
          const result = await saveFormSubmission('participant_registration', participantId, formSubmissionData);
          console.log("Form submission result:", result);

          if (result.success) {
              this.showMessage(translate("inscription_saved_successfully"));
              setTimeout(() => {
                  this.app.router.navigate("/parent_dashboard");
              }, 2000); // Delay navigation to allow user to see the success message
          } else {
              throw new Error(result.message || translate("error_saving_form"));
          }
      } catch (error) {
          console.error("Error saving form:", error);
          this.showError(translate("error_saving_data") + ": " + error.message);
      }

      return false; // Ensure the form doesn't submit traditionally
  }



  showMessage(message) {
    console.log("Showing success message:", message);
    const messageElement = document.getElementById("success-message");
    if (messageElement) {
      messageElement.textContent = message;
      messageElement.classList.remove("hidden");
    } else {
      console.error("Success message element not found");
      alert(message); // Fallback to alert if the success element is not found
    }
  }

  showError(message) {
    console.log("Showing error message:", message);
    const errorElement = document.getElementById("error-message");
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.remove("hidden");
    } else {
      console.error("Error message element not found");
      alert(message); // Fallback to alert if the error element is not found
    }
  }
}
