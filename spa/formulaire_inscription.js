import { app } from "./app.js";
import { DynamicFormHandler } from "./dynamicFormHandler.js";
import { translate } from "./app.js";
import {
    getAuthHeader,
  fetchParticipant,
  saveFormSubmission,
  getOrganizationFormFormats,
  saveParticipant,
     getGuardianCoreInfo,
    getGuardians,
      saveGuardian, // NEW: For saving guardian info
      linkGuardianToParticipant, // NEW: For linking guardians to participants
    getCurrentOrganizationId,
    fetchFromApi
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
        console.log("Initializing FormulaireInscription with ID:", participantId);
        this.participantId = participantId;
        try {
            // Check if participant ID exists and fetch participant data accordingly
            if (this.participantId) {
                console.log("Fetching participant data for ID:", this.participantId);
                await this.fetchParticipantData(); // Fetching participant data
                await this.fetchGuardianData(); // Fetching associated guardian data
            } else {
                console.log("No participant ID provided, initializing empty form");
                this.formData = { guardians: [] }; // Initialize empty form data
            }

            // Create the form structure and initialize the form handlers
            this.createInitialStructure();

            // Initialize DynamicFormHandler for participant form, passing the correct participant ID
            this.participantFormHandler = new DynamicFormHandler(this.app, this.saveParticipantAndGuardians.bind(this));
            await this.participantFormHandler.init('participant_registration', this.participantId, this.formData, 'participant-form');

            // Render the form and attach event listeners
            this.render();
            this.attachEventListeners();
        } catch (error) {
            console.error("Error initializing form:", error);
            this.showError(translate("error_loading_form"));
        }
    }



    async fetchParticipantData() {
        try {
            const response = await fetchParticipant(this.participantId);
            console.log("Fetched participant data:", response);

            if (response.success && response.participant) {
                this.formData = {
                    ...response.participant,
                    first_name: response.participant.first_name,
                    last_name: response.participant.last_name,
                    date_naissance: response.participant.date_naissance
                };

                this.participantId = response.participant.id; // **Ensure participantId is captured here**
                this.formData.guardians = response.participant.guardians || [];
                console.log("Assigned formData:", this.formData);
            } else {
                throw new Error("Invalid participant data received");
            }
        } catch (error) {
            console.error("Error fetching participant data:", error);
            throw error;
        }
    }



    async fetchGuardianData() {
        try {
            const guardianData = await getGuardians(this.participantId);
            if (Array.isArray(guardianData)) {
                this.formData.guardians = guardianData;
            } else {
                console.warn("No guardians found or invalid guardian data received");
                this.formData.guardians = [];
            }
        } catch (error) {
            console.warn("Error fetching guardian data:", error.message);
            this.formData.guardians = [];
        }
        console.log("Guardian data after fetch:", this.formData.guardians);
    }

      createInitialStructure() {
        console.log("Creating initial structure");
        const content = `
         <button type="button" id="go-to-dashboard">${translate("go_to_dashboard")}</button>
          <h1>${this.participantId ? translate("edit_participant") : translate("add_participant")}</h1>
          <form id="inscription-form">
            <fieldset id="participant-form"></fieldset>  <!-- Changed to a fieldset -->

            <h2>${translate("informations_parents")}</h2>
            <button type="button" id="add-guardian">${translate("add_parent_guardian")}</button>
            <div id="guardians-container"></div>
            <button type="submit" id="submit-form">${translate("save")}</button>
          </form>
          <div id="error-message" class="error hidden"></div>
            <div id="success-message" class="success hidden"></div>
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

        this.guardianFormHandlers = [];  // Reset handlers to avoid duplicate form handling

        console.log("Guardian form data:", this.formData.guardians);

        if (Array.isArray(this.formData.guardians) && this.formData.guardians.length > 0) {
            this.formData.guardians.forEach((guardian, index) => {
                console.log(`Rendering guardian at index: ${index}`, guardian);
                this.renderGuardianForm(index, guardian);
             
            });
        } else {
            // Render an empty form if no guardians exist
            this.renderGuardianForm(0);
        }
    }


    renderGuardianForm(index, guardianData = {}) {
        const formHandler = new DynamicFormHandler(this.app);
        const formContainer = document.createElement('div');
        formContainer.className = 'guardian-form';
        formContainer.dataset.index = index;

        const guardianContainer = document.getElementById('guardians-container');
        guardianContainer.appendChild(formContainer);

        console.log(`Initializing guardian form at index ${index} with data:`, guardianData);

        const defaultGuardianData = {
            nom: '',
            prenom: '',
            lien: '',
            courriel: '',
            telephone_residence: '',
            telephone_travail: '',
            telephone_cellulaire: '',
            is_primary: false,
            is_emergency_contact: false,
            ...guardianData  // Overwrite defaults with actual data if present
        };

         formHandler.init('parent_guardian', null, defaultGuardianData, formContainer, true, index);

        
        this.guardianFormHandlers.push(formHandler);
    }





  attachEventListeners() {
      console.log("Attaching event listeners");
      const form = document.getElementById("inscription-form");
      const addGuardianButton = document.getElementById("add-guardian");
       const dashboardButton = document.getElementById("go-to-dashboard");

      if (dashboardButton) {
          dashboardButton.addEventListener("click", () => {
              this.app.router.navigate("/parent-dashboard");
          });
      } else {
          console.error("Go to dashboard button not found");
      }

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

        // Step 1: Get the participant data from the participant form
        const participantData = this.participantFormHandler.getFormData();

        // **Ensure participant ID is passed for update**
        const participantCoreData = {
            first_name: participantData.first_name || null,
            last_name: participantData.last_name || null,
            date_naissance: participantData.date_naissance || null,
            id: this.participantId || participantData.id // **Ensure ID is passed for update**
        };

        // Step 2: Validate participant core data before submission
        if (!participantCoreData.first_name || !participantCoreData.last_name || !participantCoreData.date_naissance) {
            console.error("Missing required participant core fields.");
            this.showError(translate("missing_required_fields"));
            return; // Stop submission if core data is missing
        }

        // Step 3: Get guardian data separately
        const guardiansData = this.guardianFormHandlers.map(handler => handler.getFormData());

        // Step 4: Prepare form submission data
        const formSubmissionData = {
            ...participantData,
            guardians: guardiansData
        };

        console.log("Full form data to be submitted:", { participantCoreData, formSubmissionData });

        try {
            await this.saveParticipantAndGuardians(participantCoreData, formSubmissionData);
            this.showMessage(translate("form_saved_successfully"), "success");

            setTimeout(() => {
                this.app.router.navigate("/parent-dashboard");  
            }, 3000);  // Delay to allow users to see the success message

            
        } catch (error) {
            console.error("Error during form submission:", error);
            this.showError(translate("error_saving_data") + ": " + error.message);
        }
    }


    async saveParticipantAndGuardians(participantCoreData, formSubmissionData) {
      console.log("Saving participant registration", {
        participantData: participantCoreData,
        guardiansData: formSubmissionData.guardians
      });

      try {
        // Step 1: Save participant core data
        const saveParticipantResult = await saveParticipant(participantCoreData);
        if (!saveParticipantResult.success) {
          throw new Error(saveParticipantResult.message || translate("error_saving_participant"));
        }

        const participantId = saveParticipantResult.participant_id || participantCoreData.id;
        this.participantId = participantId; // Update the current participantId
        console.log("Participant saved with ID:", participantId);

        // Step 2: Save the remaining fields in `form_submissions` for the participant
        const participantSubmissionData = { ...formSubmissionData };
        delete participantSubmissionData.guardians;

        const formSubmissionResult = await saveFormSubmission('participant_registration', participantId, participantSubmissionData);
        if (!formSubmissionResult.success) {
          throw new Error(formSubmissionResult.message || translate("error_saving_form"));
        }

        // Step 3: Save guardians and link them to the participant
        await this.saveGuardians(participantId, formSubmissionData.guardians);

        // Step 4: Link participant to organization (if not already linked)
        await this.linkParticipantToOrganization(participantId);

        console.log("Participant and guardians saved successfully");
        this.showMessage(translate("form_saved_successfully"));
      } catch (error) {
        console.error("Error saving participant and guardians:", error);
        this.showError(translate("error_saving_data") + ": " + error.message);
        throw error;
      }
    }

    async linkParticipantToOrganization(participantId) {
      try {
        const organizationId = getCurrentOrganizationId();
        const response = await fetch("/api.php?action=link_participant_to_organization", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeader(),
          },
          body: JSON.stringify({ participant_id: participantId, organization_id: organizationId }),
        });
        const result = await response.json();
        if (!result.success) {
          throw new Error(result.message || "Failed to link participant to organization");
        }
      } catch (error) {
        console.error("Error linking participant to organization:", error);
        throw error;
      }
    }
    
    async saveGuardians(participantId, guardians) {
      if (guardians && guardians.length > 0) {
          console.log("Guardians data before saving:", guardians);
        for (let guardian of guardians) {
          const guardianData = {
            participant_id: participantId,
            nom: guardian.nom,
            prenom: guardian.prenom,
            lien: guardian.lien,
            courriel: guardian.courriel,
            telephone_residence: guardian.telephone_residence,
            telephone_travail: guardian.telephone_travail,
            telephone_cellulaire: guardian.telephone_cellulaire,
            is_primary: guardian.is_primary,
            is_emergency_contact: guardian.is_emergency_contact
          };

          try {
            const result = await saveGuardian(guardianData);
            if (!result.success) {
              throw new Error(result.message || "Failed to save guardian");
            }
            console.log("Guardian saved successfully:", result);

            // Link the guardian to the participant
            await linkGuardianToParticipant(participantId, result.parent_id);

            // If there are custom fields, save them using form submission
            const guardianCustomFields = { ...guardian };
            delete guardianCustomFields.nom;
            delete guardianCustomFields.prenom;
            delete guardianCustomFields.lien;
            delete guardianCustomFields.courriel;
            delete guardianCustomFields.telephone_residence;
            delete guardianCustomFields.telephone_travail;
            delete guardianCustomFields.telephone_cellulaire;
            delete guardianCustomFields.is_primary;
            delete guardianCustomFields.is_emergency_contact;

            if (Object.keys(guardianCustomFields).length > 0) {
              const guardianFormSubmissionResult = await saveFormSubmission('parent_guardian', result.parent_id, guardianCustomFields);
              if (!guardianFormSubmissionResult.success) {
                throw new Error("Error saving guardian custom fields: " + guardianFormSubmissionResult.message);
              }
            }
          } catch (error) {
            console.error("Error saving guardian:", error);
            throw error;
          }
        }
      }
    }


    showMessage(message, type = 'success') {
        app.showMessage(message, type);
    }

    showError(message) {
        app.showMessage(message, 'error');
    }

      hideMessageAfterDelay(element, delay = 50000) {
        setTimeout(() => {
          element.classList.add("hidden");
        }, delay);
      }

}
