import { DynamicFormHandler } from "./dynamicFormHandler.js";
import { translate } from "./app.js";
import { fetchFromApi, getOrganizationFormFormats  } from "./ajax-functions.js";

export class CreateOrganization {
		constructor(app) {
				this.app = app;
				this.formHandler = null;
		}

		async init() {
				if (this.app.userRole !== "admin") {
						this.app.router.navigate("/dashboard");
						return;
				}

				await this.render();
				await this.initializeForm();
				this.attachEventListeners();
		}

		async render() {
				const content = `
						<h1>${translate("create_new_organization")}</h1>
						<div id="organization-form-container"></div>
						<button id="submit-organization">${translate("create_organization")}</button>
						<p><a href="/admin">${translate("back_to_admin")}</a></p>
				`;
				document.getElementById("app").innerHTML = content;
		}

	async initializeForm() {
			// Fetch form formats for the template organization (ID 0)
			const formFormats = await getOrganizationFormFormats(0);

			// Initialize the form handler with the fetched format
			this.formHandler = new DynamicFormHandler(this.app);
	await this.formHandler.init('organization_info', null, {}, 'organization-form-container', false, null, null, 0);
		}

		attachEventListeners() {
				document.getElementById("submit-organization").addEventListener("click", () => this.handleSubmit());
		}

		async handleSubmit() {
				const formData = this.formHandler.getFormData();
				try {
						const response = await fetchFromApi('create_organization', 'POST', formData);
						if (response.success) {
								this.app.showMessage(translate("organization_created_successfully"), "success");
								setTimeout(() => this.app.router.navigate("/admin"), 2000);
						} else {
								throw new Error(response.message || translate("error_creating_organization"));
						}
				} catch (error) {
						this.app.showMessage(error.message, "error");
				}
		}
}