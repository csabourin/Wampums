import { translate } from "./app.js";

export class ResetPassword {
		constructor(app) {
				this.app = app;
		}

		render() {
				const content = `
						<h1>${translate("reset_password")}</h1>
						<form id="reset-password-form">
								<div id="email-step">
										<label for="email">${translate("email")}:</label>
										<input type="email" id="email" name="email" required>
										<button type="submit">${translate("send_reset_link")}</button>
								</div>
								<div id="reset-step" style="display: none;">
										<label for="token">${translate("reset_token")}:</label>
										<input type="text" id="token" name="token">
										<label for="new-password">${translate("new_password")}:</label>
										<input type="password" id="new-password" name="new-password">
										<label for="confirm-password">${translate("confirm_password")}:</label>
										<input type="password" id="confirm-password" name="confirm-password">
										<button type="submit">${translate("reset_password")}</button>
								</div>
						</form>
						<div id="message"></div>
						<p><a href="/login">${translate("back_to_login")}</a></p>
				`;
				document.getElementById("app").innerHTML = content;
				this.attachEventListeners();
		}

		attachEventListeners() {
				const form = document.getElementById("reset-password-form");
				form.addEventListener("submit", (e) => this.handleSubmit(e));
		}

		async handleSubmit(e) {
				e.preventDefault();
				const emailStep = document.getElementById("email-step");
				const resetStep = document.getElementById("reset-step");
				const messageDiv = document.getElementById("message");

				if (emailStep.style.display !== "none") {
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
										emailStep.style.display = "none";
										resetStep.style.display = "block";
										// Make reset step fields required
										document.getElementById("token").required = true;
										document.getElementById("new-password").required = true;
										document.getElementById("confirm-password").required = true;
								} else {
										messageDiv.textContent = result.message || translate("error_sending_reset_link");
								}
						} catch (error) {
								console.error("Error:", error);
								messageDiv.textContent = translate("error_sending_reset_link");
						}
				} else {
						// Handle password reset
						const token = document.getElementById("token").value;
						const newPassword = document.getElementById("new-password").value;
						const confirmPassword = document.getElementById("confirm-password").value;

						if (!token || !newPassword || !confirmPassword) {
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
				}
		}
}