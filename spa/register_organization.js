// register_organization.js
import { translate } from "./app.js";
import { registerForOrganization, getUserChildren } from "./ajax-functions.js";

export class RegisterOrganization {
	constructor(app) {
		this.app = app;
		this.children = [];
	}

	async init() {
		if (this.app.userRole === 'parent') {
			this.children = await getUserChildren(this.app.userId);
		}
		this.render();
		this.attachEventListeners();
	}

	render() {
		const content = `
			<h1>${translate("register_for_organization")}</h1>
			<form id="register-organization-form">
				<label for="role">${translate("select_role")}:</label>
				<select id="role" name="role" required>
					<option value="parent">${translate("parent")}</option>
					<option value="animation">${translate("animation")}</option>
				</select>
				<label for="registration_password">${translate("registration_password")}:</label>
				<input type="password" id="registration_password" name="registration_password" required>
				${this.renderChildrenOptions()}
				<button type="submit">${translate("register")}</button>
			</form>
		`;
		document.getElementById("app").innerHTML = content;
	}

	renderChildrenOptions() {
		if (this.children.length === 0) return '';
		return `
			<h2>${translate("link_children_to_organization")}</h2>
			${this.children.map(child => `
				<label>
					<input type="checkbox" name="link_children" value="${child.id}">
					${child.first_name} ${child.last_name}
				</label>
			`).join('')}
		`;
	}

	attachEventListeners() {
		document.getElementById("register-organization-form").addEventListener("submit", (e) => this.handleSubmit(e));
	}

	async handleSubmit(e) {
		e.preventDefault();
		const formData = new FormData(e.target);
		const registrationData = {
			role: formData.get("role"),
			registration_password: formData.get("registration_password"),
			link_children: formData.getAll("link_children")
		};

		try {
			const result = await registerForOrganization(registrationData);
			if (result.success) {
				this.app.showMessage(translate("registration_successful"));
				this.app.router.navigate("/dashboard");
			} else {
				this.app.showMessage(result.message, "error");
			}
		} catch (error) {
			console.error("Error registering for organization:", error);
			this.app.showMessage(translate("error_registering_for_organization"), "error");
		}
	}
}