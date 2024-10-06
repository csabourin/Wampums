import { translate } from "./app.js";
export class ResetPassword {
		constructor(app) {
				this.app = app;
		}

		render(token = null) {
			alert("loaded");
				const content = `
						<h1>${translate("reset_password")}</h1>
						<form id="reset-password-form">
								${token ? this.renderResetStep(token) : this.renderEmailStep()}
						</form>
						<div id="message"></div>
						<p><a href="/login">${translate("back_to_login")}</a></p>
				`;
				document.getElementById("app").innerHTML = content;
				this.attachEventListeners();
		}

		renderEmailStep() {
				return `
						<div id="email-step">
								<label for="email">${translate("email")}:</label>
								<input type="email" id="email" name="email" required>
								<button type="submit">${translate("send_reset_link")}</button>
						</div>
				`;
		}

		renderResetStep(token) {
				return `
						<div id="reset-step">
								<input type="hidden" id="token" name="token" value="${token}" required>
								<label for="new-password">${translate("new_password")}:</label>
								<input type="password" id="new-password" name="new-password" required>
								<label for="confirm-password">${translate("confirm_password")}:</label>
								<input type="password" id="confirm-password" name="confirm-password" required>
								<button type="submit">${translate("reset_password")}</button>
						</div>
				`;
		}

		attachEventListeners() {
				const form = document.getElementById("reset-password-form");
				form.addEventListener("submit", (e) => this.handleSubmit(e));
		}

		async handleSubmit(e) {
				e.preventDefault();
				const messageDiv = document.getElementById("message");
				const token = document.getElementById("token")?.value;

				if (token) {
						// Handle password reset
						const newPassword = document.getElementById("new-password").value;
						const confirmPassword = document.getElementById("confirm-password").value;

						if (!newPassword || !confirmPassword) {
								messageDiv.textContent = translate("please_fill_all_fields");
								return;
						}

						if (newPassword !== confirmPassword) {
								messageDiv.textContent = translate("passwords_do_not_match");
								return;
						}

						try {
								const response = await fetch("/api.php?action=reset_password", {
										method: "POST",
										headers: { "Content-Type": "application/json" },
										body: JSON.stringify({ token, new_password: newPassword })
								});

								const result = await response.json();
								console.log("Server response:", result);

								if (result.success) {
										messageDiv.textContent = translate("password_reset_successful");
										setTimeout(() => this.app.router.navigate("/login"), 2000);
								} else {
										messageDiv.textContent = result.message || translate("error_resetting_password");
								}
						} catch (error) {
								console.error("Error:", error);
								messageDiv.textContent = translate("error_resetting_password");
						}
				} else {
						// Handle email submission
						const email = document.getElementById("email").value;
						if (!email) {
								messageDiv.textContent = translate("please_enter_email");
								return;
						}
						try {
								const response = await fetch("/api.php?action=request_reset", {
										method: "POST",
										headers: { "Content-Type": "application/json" },
										body: JSON.stringify({ email })
								});
								const result = await response.json();
								if (result.success) {
										messageDiv.textContent = translate("reset_link_sent");
								} else {
										messageDiv.textContent = result.message || translate("error_sending_reset_link");
								}
						} catch (error) {
								console.error("Error:", error);
								messageDiv.textContent = translate("error_sending_reset_link");
						}
				}
		}
}