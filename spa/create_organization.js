import { DynamicFormHandler } from "./dynamicFormHandler.js";
import { translate } from "./app.js";
import {
        createOrganization,
        getCurrentOrganizationId,
        getOrganizationFormFormats,
} from "./ajax-functions.js";
import { canCreateOrganization, hasRole } from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";

export class CreateOrganization {
		constructor(app) {
				this.app = app;
                this.formHandler = null;
		}

                async init() {
                                if (!canCreateOrganization() && !hasRole('district')) {
                                                this.app.router.navigate("/dashboard");
                                                return;
                                }

                                // Use organization_id=0 to get template form formats
                                this.templateOrganizationId = 0;

                                await this.render();
                                await this.initializeForm();
                                this.attachEventListeners();
                }

		async render() {
				const content = `
						<h1>${translate("create_new_unit")}</h1>
						<div id="organization-form-container"></div>
						<button id="submit-organization">${translate("create_unit")}</button>
						<p><a href="/admin">${translate("back_to_admin")}</a></p>
				`;
				setContent(document.getElementById("app"), content);
		}

        async initializeForm() {
                        // Load form formats from template organization (id=0)
                        const formFormats =
                                await getOrganizationFormFormats(
                                        this.templateOrganizationId,
                                );

                        if (!formFormats || !formFormats.organization_info) {
                                        this.app.showMessage(
                                                        translate(
                                                                        "error_loading_form",
                                                        ),
                                                        "error",
                                        );
                                        return;
                        }

                        this.formHandler = new DynamicFormHandler(this.app);
                        await this.formHandler.init(
                                "organization_info",
                                null,
                                {},
                                "organization-form-container",
                                false,
                                null,
                                null,
                                this.templateOrganizationId,
                        );
                }

		attachEventListeners() {
				document.getElementById("submit-organization").addEventListener("click", () => this.handleSubmit());
		}

		async handleSubmit() {
				const formData = this.formHandler.getFormData();
				try {
						const response = await createOrganization(formData);
						if (response.success) {
								this.app.showMessage(translate("unit_created_successfully"), "success");
								setTimeout(() => this.app.router.navigate("/admin"), 2000);
						} else {
								throw new Error(response.message || translate("error_creating_unit"));
						}
				} catch (error) {
						this.app.showMessage(error.message, "error");
				}
		}
}
