// dynamicFormHandler.js
import { translate } from "./app.js";
import { JSONFormRenderer } from "./JSONFormRenderer.js";
import { 
    getOrganizationFormFormats, 
    getFormSubmission, 
    saveFormSubmission,
} from "./ajax-functions.js";

export class DynamicFormHandler {
    constructor(app, customSaveHandler = null, useUniqueIds = false, formIndex = null) {
        this.app = app;
        this.customSaveHandler = customSaveHandler; 
        this.formFormats = {};
        this.formData = {};
        this.participantId = null;
        this.formType = null;
        this.formRenderer = null;
        this.container = document.getElementById("app"); // Default to #app
        this.useUniqueIds = false;
        this.uniqueIdPart = '';
    }

    async init(formType, participantId = null, initialData = {}, container = null, useUniqueIds = false, formIndex = null) {
        console.log("Initializing DynamicFormHandler", { formType, participantId, initialData, container });
        this.formType = formType;
        this.participantId = participantId;

        // Merge URL query parameters with initialData
        const queryParams = this.getQueryParams();  // New function to get URL parameters
        this.formData = { ...initialData, ...queryParams };  // Merge URL parameters into formData
        this.useUniqueIds = useUniqueIds;
        this.formIndex = formIndex;
        this.uniqueIdPart = this.useUniqueIds && this.formIndex !== null ? `-${this.formIndex}` : ''; 
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
            if (this.participantId && Object.keys(this.formData).length === 0) {
                await this.fetchFormData();
            }
            this.formRenderer = new JSONFormRenderer(this.formFormats[this.formType], this.formData, this.formType, this.useUniqueIds, this.formIndex);
            this.render(); // Call render here to display the form
        } catch (error) {
            console.error("Error initializing dynamic form:", error);
            this.showError(translate("error_loading_form"));
        }
    }

    // Function to extract query parameters from the URL
    getQueryParams() {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        const params = {};
        urlParams.forEach((value, key) => {
            params[key] = value;
        });
        return params;
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

			// Conditionally add formIndex if useUniqueIds is true
				const uniqueIdPart = this.useUniqueIds && this.formIndex !== null ? `-${this.formIndex}` : '';


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
                   <fieldset id="dynamic-form-${this.formType}${uniqueIdPart}">
                    <legend>${translate(this.formType)}</legend>
                    ${formContent}
                </fieldset>
                `;

          this.container.innerHTML = content;

        // Attach event listeners for dependent fields
        this.attachDependencyListeners();

        // Attach event listeners only if it's standalone
        if (this.isStandalone()) {
            this.attachEventListeners(uniqueIdPart);
        }
    }

    // Attach dependency listeners to controlling fields after rendering
    attachDependencyListeners() {
        const fields = this.formFormats[this.formType].fields;

        // Loop through all fields and attach listeners to controlling fields
        fields.forEach((field) => {
            if (field.dependsOn) {
                const controllingFieldName = field.dependsOn.field;
                const controllingElements = document.getElementsByName(controllingFieldName);

                controllingElements.forEach((element) => {
                    const eventType = this.getEventType(element.type);
                    element.addEventListener(eventType, (e) => {
                        const controllingValue = this.getFieldValue(element);
                        this.toggleDependentFields(field, controllingValue);
                    });
                });
            }
        });
    }

    // Get the appropriate event type based on the input type
    getEventType(type) {
        switch (type) {
            case "text":
            case "textarea":
            case "select-one":
                return "input";
            case "checkbox":
            case "radio":
                return "change";
            default:
                return "input";
        }
    }

    // Get the current value of a field based on its type
    getFieldValue(field) {
            switch (field.type) {
                    case 'checkbox':
                            return field.checked ? 'yes' : 'no'; // Normalizing value for checkboxes
                    case 'radio':
                            return field.checked ? field.value : '';
                    default:
                            return field.value;
            }
    }

    // Enable or disable dependent fields based on the controlling value
    toggleDependentFields(dependentField, controllingValue) {
        const dependentElement = document.getElementsByName(dependentField.name)[0];
        if (!dependentElement) return;

        const expectedValue = dependentField.dependsOn.value;
        if (controllingValue === expectedValue) {
            dependentElement.disabled = false;
            dependentElement.setAttribute("required", "true");
        } else {
            dependentElement.disabled = true;
            dependentElement.removeAttribute("required");
        }
    }
    
    
    
    attachEventListeners() {
        const formElement = this.container.querySelector(`#dynamic-form-${this.formType}${this.uniqueIdPart}`);
        if (formElement) {
            formElement.addEventListener("submit", (e) => this.handleSubmit(e));
            console.log(`Event listener attached for form: ${this.formType}`);
        } else {
            console.error(`Form element for ${this.formType}${this.uniqueIdPart} not found.`);
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
		// Select the fieldset (or form) inside the container for this specific formType and formIndex
		const formElement = this.container.querySelector(`#dynamic-form-${this.formType}${this.uniqueIdPart}`);

		// Check if the form element exists
		if (!formElement) {
			console.error(`Form element for ${this.formType}${this.uniqueIdPart} not found or is not a valid form.`);
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