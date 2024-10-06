// dynamicFormHandler.js
import { translate } from "./app.js";
import { JSONFormRenderer } from "./JSONFormRenderer.js";
import { 
	getOrganizationFormFormats, 
	getFormSubmission, 
	saveFormSubmission,
	saveParticipant // Add this import
} from "./ajax-functions.js";

export class DynamicFormHandler {
	constructor(app) {
			this.app = app;
			this.formFormats = {};
			this.formData = {};
			this.participantId = null;
			this.formType = null;
			this.formRenderer = null;
			this.container = document.getElementById("app"); // Default to #app
	}

	async init(formType, participantId = null, initialData = {}, container = null) {
			console.log("Initializing DynamicFormHandler", { formType, participantId, initialData, container });
			this.formType = formType;
			this.participantId = participantId;
			this.formData = initialData;
			this.container = container ? 
					(typeof container === 'string' ? document.getElementById(container) : container) 
					: document.getElementById("app"); // Use #app if container is not specified

			if (!this.container) {
					console.error("Container not found for rendering the form.");
					this.showError(translate("error_loading_form"));
					return;
			}

			try {
					await this.fetchFormFormats();
					if (this.participantId) {
							await this.fetchFormData();
					}
					this.formRenderer = new JSONFormRenderer(this.formFormats[this.formType], this.formData);
					this.render(); // Call render here to display the form
			} catch (error) {
					console.error("Error initializing dynamic form:", error);
					this.showError(translate("error_loading_form"));
			}
	}

		async fetchFormFormats() {
			this.formFormats = await getOrganizationFormFormats();
			if (!this.formFormats || !this.formFormats[this.formType]) {
				throw new Error("Failed to fetch form formats or form type not found");
			}
		}

	async fetchFormData() {
			if (this.participantId) {
					try {
							const response = await getFormSubmission(this.participantId, this.formType);
							console.log("Full response from API:", response);

							// If the API response is successful and form data exists
							if (response.success && response.form_data) {
									// Include core participant fields and submission data
									this.formData = {
											...response.form_data, // Include all fields from form submission
											first_name: response.first_name, // Core participant data
											last_name: response.last_name,
											date_naissance: response.date_naissance
									};
									console.log("Fetched form data:", this.formData);
							} else {
									console.warn(`No form data found for ${this.formType} and participant ${this.participantId}`);
									this.formData = {};
							}
					} catch (error) {
							console.error("Error fetching form data:", error);
							this.formData = {};
					}
			} else {
					this.formData = {};
			}
	}


	async saveFormData(formData) {
			console.log("Saving form data", { formType: this.formType, participantId: this.participantId, formData });
			try {
					let result;
					if (this.formType === 'participant_registration') {
							// Directly pass the formData to saveParticipant
							result = await saveParticipant(formData); // Removed this.participantId as we want to pass only formData
					} else {
							// Use saveFormSubmission for other forms
							result = await saveFormSubmission(this.formType, this.participantId, formData);
					}
					console.log("Form save result:", result);
					if (result.success) {
							this.showMessage(translate("form_saved_successfully"));
							return result;
					} else {
							throw new Error(result.message || translate("error_saving_form"));
					}
			} catch (error) {
					console.error("Error saving form:", error);
					this.showError(translate("error_saving_data") + ": " + error.message);
					throw error;
			}
	}


	render() {
			if (!this.container) {
					console.error("Container not found for rendering the form.");
					this.showError(translate("error_loading_form"));
					return;
			}

			const formStructure = this.formFormats[this.formType];
			if (!formStructure) {
					this.showError(translate("form_not_found"));
					return;
			}

			console.log("Rendering form structure for type:", this.formType);

			const formRenderer = new JSONFormRenderer(formStructure, this.formData);

			// Check if this handler is standalone or embedded within another form
			const content = this.isStandalone() 
					? `
							<h1>${translate(this.formType)}</h1>
							<p><a href="/dashboard">${translate("retour_tableau_bord")}</a></p>
							<form id="dynamic-form-${this.formType}">
									${formRenderer.render()}
									<button type="submit">${translate("save")}</button>
							</form>
					`
					: `
							<fieldset id="dynamic-form-${this.formType}">
									<legend>${translate(this.formType)}</legend>
									${formRenderer.render()}
							</fieldset>
					`;

			this.container.innerHTML = content;

			// Attach event listeners only if it's standalone
			if (this.isStandalone()) {
					this.attachEventListeners();
			}
	}



		
	attachEventListeners() {
			const formElement = this.container.querySelector(`#dynamic-form-${this.formType}`);
			if (formElement) {
					formElement.addEventListener("submit", (e) => this.handleSubmit(e));
					console.log(`Event listener attached for form: ${this.formType}`);
			} else {
					console.error(`Form element for ${this.formType} not found.`);
			}
	}


			async handleSubmit(e) {
					e.preventDefault();
					const formData = new FormData(e.target);
					const submissionData = Object.fromEntries(formData.entries());

					try {
							const result = await saveFormSubmission(this.formType, this.participantId, submissionData);
							if (result.success) {
									this.app.showMessage(translate("form_saved_successfully"));
									this.app.router.navigate("/parent-dashboard");
							} else {
									throw new Error(result.message || translate("error_saving_form"));
							}
					} catch (error) {
							console.error("Error saving form:", error);
							this.showError(error.message);
					}
			}

			showError(message) {
					this.app.showMessage(message, "error");
			}

	getFormData() {
			const formElement = this.container.querySelector(
					this.isStandalone() ? `#dynamic-form-${this.formType}` : `#dynamic-form-${this.formType}`
			);

			if (!formElement) {
					console.error(`Form/fieldset element for ${this.formType} not found.`);
					return new FormData(); // Return empty form data if the element is not found
			}

			// Collect data from fieldset or form
			return new FormData(formElement.closest('form'));
	}



			// Utility method to determine if this instance is standalone
			isStandalone() {
					return this.container === document.getElementById("app");
			}
	}