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
	 constructor(app, customSaveHandler = null, formIndex = null) {
			this.app = app;
		  this.customSaveHandler = customSaveHandler; 
			this.formFormats = {};
			this.formData = {};
			this.participantId = null;
			this.formType = null;
			this.formRenderer = null;
			this.container = document.getElementById("app"); // Default to #app
		 this.useUniqueIds = false;
		 
	}

	async init(formType, participantId = null, initialData = {}, container = null, useUniqueIds = false, formIndex = null) {
			console.log("Initializing DynamicFormHandler", { formType, participantId, initialData, container });
			this.formType = formType;
			this.participantId = participantId;
			this.formData = initialData;
		this.useUniqueIds = useUniqueIds;
		this.formIndex = formIndex;
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
					this.formRenderer = new JSONFormRenderer(this.formFormats[this.formType], this.formData, this.formType, this.useUniqueIds, this.formIndex);
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

            if (response.success && response.form_data) {
                this.formData = { ...response.form_data };
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

    // Add a check to ensure critical fields are present
    this.validateFormData();
}

validateFormData() {
    const criticalFields = ['first_name', 'last_name', 'date_naissance'];
    for (const field of criticalFields) {
        if (this.formData[field] === undefined) {
            console.warn(`Critical field '${field}' is missing from form data`);
            // You could set a default value or handle this case as needed
            // this.formData[field] = '';
        }
    }
}


	async saveFormData(formData) {
	console.log("Saving form data", { formType: this.formType, participantId: this.participantId, formData });

	try {
			let result;

			// If a custom save handler is provided, use that instead of the default logic
			if (this.customSaveHandler) {
					console.log("Using custom save handler");
					result = await this.customSaveHandler(formData); // Use custom save handler
			} else {
					// Default save behavior
					console.log("Using default save handler");
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
			console.log("Form data:", this.formData);

			let fields = formStructure.fields;

			// If there's a custom form structure, add those fields
			if (this.formData.custom_form && Array.isArray(this.formData.custom_form.fields)) {
				// Merge formStructure fields and custom_form fields, removing duplicates
				fields = [
						...fields,
						...this.formData.custom_form.fields.filter(customField => 
								!fields.some(field => field.name === customField.name)
						)
				];
			}

			const formRenderer = new JSONFormRenderer({ fields }, this.formData, this.formType, this.useUniqueIds, this.formIndex);

			const formContent = formRenderer.render();

			// Check if this handler is standalone or embedded within another form
			const content = this.isStandalone() 
					? `
							<h2>${translate(this.formType)}</h2>
							<form id="dynamic-form-${this.formType}">
									${formContent}
									<button type="submit">${translate("save")}</button>
							</form>
					`
					: `
							<fieldset id="dynamic-form-${this.formType}-${this.formIndex}">
									<legend>${translate(this.formType)}</legend>
									${formContent}
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
			// Select the fieldset (or form) inside the container for this specific formType
			const formElement = this.container.querySelector(`#dynamic-form-${this.formType}`);

			// Check if the form element exists
			if (!formElement) {
					console.error(`Form element for ${this.formType} not found or is not a valid form.`);
					return {}; // Return an empty object if the form element is not found
			}

			// Collect data directly from input, select, and textarea elements within this specific formElement
			const filteredData = {};
			formElement.querySelectorAll('input, select, textarea').forEach(field => {
					if (field.type === 'checkbox') {
							filteredData[field.name] = field.checked;
					} else if (field.type === 'radio') {
							// Only add the value of the selected radio button
							if (field.checked) {
									filteredData[field.name] = field.value;
							}
					} else {
							filteredData[field.name] = field.value;
					}
			});

			return filteredData; // Return all the form data as an object
	}



			// Utility method to determine if this instance is standalone
			isStandalone() {
					return this.container === document.getElementById("app");
			}
	}