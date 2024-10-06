import { DynamicFormHandler } from "./dynamicFormHandler.js";
import { translate } from "./app.js";
import {
  fetchParticipant,
  saveFormSubmission,
  getOrganizationFormFormats,
  saveParticipant,
     getGuardianCoreInfo,
    getGuardians,
      saveGuardian, // NEW: For saving guardian info
      linkGuardianToParticipant // NEW: For linking guardians to participants
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
              await this.fetchGuardianData();
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
            console.log("&&&&&&&&&&&&&&&&&&&&&&  Fetched participant data:", participantData); // Ensure it has the full participant data

            // Ensure the data includes these fields
            this.formData = {
                ...participantData.submission_data, // Include the rest of the submission data
                first_name: participantData.first_name, // Add or overwrite with specific fields
                last_name: participantData.last_name,
                date_naissance: participantData.date_naissance
            };

            this.formData.guardians = this.formData.guardians || [];
            console.log("Assigned formData:", this.formData);
        } catch (error) {
            console.error("Error fetching participant data:", error);
            throw error;
        }
    }


    async fetchGuardianData() {
        try {
            const guardianData = await getGuardians(this.participantId); // Call the function from ajax-functions.js
            this.formData.guardians = guardianData || [];
            console.log("Fetched guardian data:", this.formData.guardians);
        } catch (error) {
            console.error("Error fetching guardian data:", error);
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
        console.log("Rendering guardian forms");

        const container = document.getElementById('guardians-container');
        if (!container) {
            console.error("Guardians container not found");
            return;
        }
        container.innerHTML = '';  // Clear the container
        this.guardianFormHandlers = [];

        // Log current guardian form data
        console.log("Guardian form data:", this.formData.guardians);

        const renderGuardian = async (index, guardianData = {}) => {
            console.log("Rendering guardian at index:", index);
            const formHandler = new DynamicFormHandler(this.app);

            // Fetch core guardian info if available
            let coreGuardianInfo = {};
            if (guardianData.guardian_id) {
                try {
                    coreGuardianInfo = await getGuardianCoreInfo(guardianData.guardian_id);
                    console.log("Core guardian info fetched:", coreGuardianInfo);
                } catch (error) {
                    console.error("Failed to fetch guardian info:", error);
                }
            }

            // Merge core info with the initial guardian data
            const mergedGuardianData = { ...coreGuardianInfo, ...guardianData };
            console.log("Merged guardian data:", mergedGuardianData);

            // Create a container for each guardian form
            const formContainer = document.createElement('div');
            formContainer.className = 'guardian-form';
            formContainer.dataset.index = index;
            container.appendChild(formContainer);

            // Initialize the formHandler and assign it to render within formContainer
            await formHandler.init('parent_guardian', null, mergedGuardianData, formContainer);
            this.guardianFormHandlers.push(formHandler);
        };

        // Render each guardian's form or an empty one if no guardians exist
        if (this.formData.guardians && this.formData.guardians.length > 0) {
            this.formData.guardians.forEach((guardian, index) => renderGuardian(index, guardian));
        } else {
            renderGuardian(0); // Render an empty form if no guardians exist
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
                                 e.preventDefault();
                                 e.stopPropagation();

                                 // Retrieve participant data
                                 const participantData = this.participantFormHandler.getFormData();
                                 console.log("Participant data:", Object.fromEntries(participantData.entries())); // Debug output

                                 // Retrieve guardians' data
                                 const guardiansData = this.guardianFormHandlers.map(handler => {
                                     const formData = handler.getFormData();
                                     console.log("Guardian form data:", Object.fromEntries(formData.entries())); // Debug output
                                     return Object.fromEntries(formData.entries());
                                 });

                                 // Extracting basic participant fields including ID
                                 const participantBasicData = {
                                     id: this.participantId,  // Ensure you pass the correct participant ID for editing
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
                                             this.app.router.navigate("/parent-dashboard");
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
