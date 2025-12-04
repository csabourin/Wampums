import { translate } from "./app.js";
import { getApiUrl } from "./ajax-functions.js";
export class ResetPassword {
				constructor(app) {
								this.app = app;
				}

				render(token = null) {
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
																<input type="password" id="new-password" name="new-password" required minlength="8">
																<small class="password-hint">${translate("password_requirements")}</small>
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
																messageDiv.className = "error-message";
																return;
												}

												// Client-side validation for better UX
												const validationError = this.validatePassword(newPassword);
												if (validationError) {
																messageDiv.textContent = validationError;
																messageDiv.className = "error-message";
																return;
												}

												try {
																const response = await fetch(getApiUrl('auth/reset-password'), {
																				method: "POST",
																				headers: { "Content-Type": "application/json" },
																				body: JSON.stringify({ token, new_password: newPassword })
																});

																const result = await response.json();
																console.log("Server response:", result);

																if (result.success) {
																				messageDiv.className = "success-message";
																				messageDiv.textContent = translate("password_reset_successful");
																				setTimeout(() => this.app.router.navigate("/login"), 2000);
																} else {
																				messageDiv.className = "error-message";
																				// Handle validation errors from server
																				if (result.errors && result.errors.length > 0) {
																								const errorMessages = result.errors.map(err => this.translateValidationError(err.msg)).join('. ');
																								messageDiv.textContent = errorMessages;
																				} else {
																								messageDiv.textContent = result.message || translate("error_resetting_password");
																				}
																}
												} catch (error) {
																console.error("Error:", error);
																messageDiv.className = "error-message";
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
																const response = await fetch(getApiUrl('auth/request-reset'), {
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

				validatePassword(password) {
								if (password.length < 8) {
												return translate("password_min_length");
								}
								if (!/[A-Z]/.test(password)) {
												return translate("password_needs_uppercase");
								}
								if (!/[a-z]/.test(password)) {
												return translate("password_needs_lowercase");
								}
								if (!/[0-9]/.test(password)) {
												return translate("password_needs_number");
								}
								return null;
				}

				translateValidationError(errorMsg) {
								const errorMap = {
												'Password must be between 8 and 255 characters': translate("password_min_length"),
												'Password must contain at least one uppercase letter': translate("password_needs_uppercase"),
												'Password must contain at least one lowercase letter': translate("password_needs_lowercase"),
												'Password must contain at least one number': translate("password_needs_number")
								};
								return errorMap[errorMsg] || errorMsg;
				}
}
