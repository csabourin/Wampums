import {
        debugLog,
        debugError,
        debugWarn,
        debugInfo,
} from "./utils/DebugUtils.js";
import {
        getUsers,
        updateUserRole,
        approveUser,
        getSubscribers,
        getCurrentOrganizationId,
        importSISC,
        clearUserCaches,
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { escapeHTML } from "./utils/SecurityUtils.js";
import { canAccessAdminPanel, canCreateOrganization, canManageUsers, canSendCommunications, canViewUsers } from "./utils/PermissionUtils.js";

export class Admin {
        constructor(app) {
                this.app = app;
                this.users = [];
                this.subscribers = [];
                this.currentOrganizationId = null;
                this.permissions = {
                        canAccessAdmin: false,
                        canCreateOrg: false,
                        canManageUsers: false,
                        canViewUsers: false,
                        canSendCommunications: false,
                };
        }

        async init() {
                this.permissions = {
                        canAccessAdmin: canAccessAdminPanel(),
                        canCreateOrg: canCreateOrganization(),
                        canManageUsers: canManageUsers(),
                        canViewUsers: canViewUsers(),
                        canSendCommunications: canSendCommunications(),
                };

                if (!this.permissions.canAccessAdmin) {
                        this.app.router.navigate("/dashboard");
                        return;
                }
                this.currentOrganizationId =
                        (await getCurrentOrganizationId()) ||
                        this.app.organizationId ||
                        null;

                if (!this.currentOrganizationId) {
                        this.app.showMessage(
                                this.app.translate(
                                        "error_loading_data",
                                ),
                                "error",
                        );
                        return;
                }
                await this.fetchData(this.getDataFetchOptions());
                this.render();
                this.initEventListeners();
        }

        async fetchData(options = {}) {
                const {
                        loadUsers = false,
                        loadSubscribers = false,
                        userCacheOptions = {},
                } = options;

                try {
                        if (loadUsers) {
                                try {
                                        const usersResult = await getUsers(
                                                this.currentOrganizationId,
                                                userCacheOptions,
                                        );
                                        this.users = this.normalizeUserList(usersResult);

                                        if (!usersResult?.success) {
                                                debugWarn(
                                                        "Users request did not return success flag",
                                                        usersResult,
                                                );
                                        }
                                } catch (userError) {
                                        debugError("Error fetching users:", userError);
                                        this.users = [];
                                }
                        } else {
                                this.users = [];
                        }

                        if (loadSubscribers) {
                                try {
                                        const subscribersResult = await getSubscribers(
                                                this.currentOrganizationId,
                                        );
                                        this.subscribers = Array.isArray(
                                                subscribersResult?.data,
                                        )
                                                ? subscribersResult.data
                                                : [];

                                        if (!subscribersResult?.success) {
                                                debugWarn(
                                                        "Subscribers request did not return success flag",
                                                        subscribersResult,
                                                );
                                        }
                                } catch (subscriberError) {
                                        debugWarn(
                                                "Unable to load subscribers; proceeding without list",
                                                subscriberError,
                                        );
                                        this.subscribers = [];
                                }
                        } else {
                                this.subscribers = [];
                        }
                } catch (error) {
                        debugError("Error fetching data:", error);
                        this.users = [];
                        this.subscribers = [];
                        this.app.showMessage(
                                this.app.translate("error_loading_data"),
                                "error",
                        );
                }
        }

        getDataFetchOptions() {
                return {
                        loadUsers: this.permissions.canManageUsers || this.permissions.canViewUsers,
                        loadSubscribers: this.permissions.canSendCommunications,
                        userCacheOptions: {},
                };
        }

        render() {
                const showNotifications = this.permissions.canSendCommunications;
                const showUserManagement = this.permissions.canManageUsers || this.permissions.canViewUsers;
                const content = `
                        <a href="/dashboard" class="home-icon" aria-label="${translate("back_to_dashboard")}">🏠</a>
                        <h1>${this.app.translate("admin_panel")}</h1>
                        <div id="message"></div>

                        <div class="admin-quick-actions" style="margin: 1rem 0; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                ${this.permissions.canCreateOrg ? `<button id="create-organization-btn">${translate("create_new_organization")}</button>` : ""}
                                <a href="/form-builder" class="button-link" style="display: inline-block; padding: 0.5rem 1rem; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">
                                        ${translate("form_builder_title")}
                                </a>
                        </div>

${showNotifications ? `
<h2>${this.app.translate("send_notification")}</h2>
<form id="notification-form">
        <label for="notification-title">${this.app.translate("title")}</label>
        <input type="text" id="notification-title" name="title" required><br><br>

        <label for="notification-body">${this.app.translate("body")}</label>
        <textarea id="notification-body" name="body" rows="4" cols="50" required></textarea><br><br>

        <h3>${this.app.translate("select_recipients")}</h3>
        <div id="subscribers-list">
                ${this.renderSubscribers()}
        </div>

        <button type="submit">${this.app.translate("send_notification")}</button>
</form>

<div id="notification-result"></div>` : ""}

<h2>${this.app.translate("import_data")}</h2>
<div class="import-section">
        <p>${this.app.translate("import_sisc_description")}</p>
        <div class="file-upload-area">
                <input type="file" id="sisc-file-input" accept=".csv" class="hidden">
                <button type="button" id="select-file-btn" class="secondary-button">${this.app.translate("select_csv_file")}</button>
                <span id="selected-file-name"></span>
        </div>
        <button type="button" id="import-sisc-btn" class="primary-button" disabled>${this.app.translate("import_data")}</button>
        <div id="import-progress" class="hidden">
                <div class="progress-bar"><div class="progress-fill"></div></div>
                <p id="import-status">${this.app.translate("importing")}</p>
        </div>
        <div id="import-result"></div>
</div>

                        ${showUserManagement ? `
                        <h2>${this.app.translate("user_management")}</h2>
                        <table>
                                <thead>
                                        <tr>
                                                <th>${this.app.translate("email")}</th>
                                                <th>${this.app.translate("role")}</th>
                                                <th>${this.app.translate("verified")}</th>
                                                <th>${this.app.translate("actions")}</th>
                                        </tr>
                                </thead>
                                <tbody id="users-table">
                                        ${this.renderUsers()}
                                </tbody>
                        </table>
                        ` : ""}

                        <a href="/dashboard">${this.app.translate("back_to_dashboard")}</a>
                `;
                document.getElementById("app").innerHTML = content;
        }

        getRoleOptions() {
                const roleLabels = {
                        district: translate("district") || "District",
                        unitadmin: translate("unitadmin") || translate("admin"),
                        leader: translate("leader"),
                        parent: translate("parent"),
                        finance: translate("finance"),
                        equipment: translate("equipment") || translate("inventory"),
                        administration: translate("administration") || translate("reports"),
                        demoadmin: translate("demoadmin") || translate("demo_admin"),
                        demoparent: translate("demoparent") || translate("demo_parent"),
                };

                return [
                        "district",
                        "unitadmin",
                        "leader",
                        "finance",
                        "equipment",
                        "administration",
                        "parent",
                        "demoadmin",
                        "demoparent",
                ].map((role) => ({
                        value: role,
                        label: roleLabels[role] || role,
                }));
        }

        renderUsers() {
                const users = Array.isArray(this.users)
                        ? this.users
                        : this.normalizeUserList(this.users);
                const canModifyUsers = this.permissions.canManageUsers;
                const roleSelectAttributes = canModifyUsers ? "" : ' disabled aria-disabled="true"';

                debugLog(users);
                if (!users.length) {
                        return `<tr><td colspan="4">${this.app.translate("no_users_found")}</td></tr>`;
                }

                return users
                        .map((user) => {
                        const safeFullName = escapeHTML(
                                        user.full_name || user.fullName || "",
                                );
                                const safeEmail = escapeHTML(user.email || "");
                                const isVerified =
                                        user.isVerified !== undefined
                                                ? user.isVerified
                                                : user.is_verified;
                                const roleOptions = this.getRoleOptions();
                                const primaryRole = Array.isArray(user.roles)
                                        ? user.roles[0]
                                        : user.role;

                                return `
                        <tr>
                                <td>${safeFullName} - ${safeEmail}</td>
                                <td>
                                        <select class="role-select" data-user-id="${user.id}"${roleSelectAttributes}>
                                                ${roleOptions.map((role) => `
                                                        <option value="${role.value}" ${primaryRole === role.value ? "selected" : ""}>${role.label}</option>
                                                `).join("")}
                                        </select>
                                </td>
                                <td>${isVerified ? "✅" : "❌"}</td>
                                <td>
                                        ${!isVerified && canModifyUsers ? `<button class="approve-btn" data-user-id="${user.id}">${this.app.translate("approve")}</button>` : ""}
                                </td>
                        </tr>`;
                        })
                        .join("");
        }

        /**
         * Optimistically update the local user list with a new role selection.
         *
         * @param {string|number} userId - Identifier of the user being updated
         * @param {string} newRole - New primary role value
         */
        applyOptimisticRoleUpdate(userId, newRole) {
                if (!Array.isArray(this.users)) {
                        return;
                }

                this.users = this.users.map((user) => {
                        if (`${user.id}` !== `${userId}`) {
                                return user;
                        }

                        const updatedRoles = Array.isArray(user.roles)
                                ? [newRole, ...user.roles.filter((role) => role !== newRole)]
                                : [newRole];

                        return {
                                ...user,
                                role: newRole,
                                roles: updatedRoles,
                        };
                });
        }

        /**
         * Optimistically mark a user as approved in the local list.
         *
         * @param {string|number} userId - Identifier of the approved user
         */
        applyOptimisticApproval(userId) {
                if (!Array.isArray(this.users)) {
                        return;
                }

                this.users = this.users.map((user) => (`${user.id}` === `${userId}`
                        ? {
                                ...user,
                                isVerified: true,
                                is_verified: true,
                        }
                        : user));
        }

        renderSubscribers() {
                const subscribers = Array.isArray(this.subscribers)
                        ? this.subscribers
                        : [];

                if (!subscribers.length) {
                        return `<div>${this.app.translate("no_subscribers_found")}</div>`;
                }

                return subscribers
                        .map(
                                (subscriber) => `
                        <div>
                                <input type="checkbox" id="subscriber-${subscriber.id}" name="subscribers" value="${subscriber.id}">
                                <label for="subscriber-${subscriber.id}">${escapeHTML(subscriber.email || "")}</label>
                        </div>
                `,
                        )
                        .join("");
        }

        initEventListeners() {
                const createOrganizationBtn = document.getElementById(
                        "create-organization-btn",
                );
                if (createOrganizationBtn) {
                        createOrganizationBtn.addEventListener("click", () => {
                                this.app.router.navigate("/create-organization");
                        });
                }

                const usersTable = document.getElementById("users-table");
                if (usersTable && this.permissions.canManageUsers) {
                        usersTable.addEventListener(
                                "change",
                                async (event) => {
                                        if (
                                                event.target.classList.contains(
                                                        "role-select",
                                                )
                                        ) {
                                                const userId =
                                                        event.target.dataset.userId;
                                                const newRole = event.target.value;
                                                await this.updateUserRole(
                                                        userId,
                                                        newRole,
                                                );
                                        }
                                },
                        );

                        usersTable.addEventListener(
                                "click",
                                async (event) => {
                                        if (
                                                event.target.classList.contains(
                                                        "approve-btn",
                                                )
                                        ) {
                                                const userId =
                                                        event.target.dataset.userId;
                                                await this.approveUser(userId);
                                        }
                                },
                        );
                }

                if (document.getElementById("notification-form")) {
                        this.initNotificationForm();
                }
                this.initImportHandlers();
        }

        async updateUserRole(userId, newRole) {
                try {
                        const result = await updateUserRole(
                                userId,
                                newRole,
                                this.currentOrganizationId,
                        );
                        if (result.success) {
                                this.app.showMessage(
                                        this.app.translate(
                                                "role_updated_successfully",
                                        ),
                                        "success",
                                );
                                this.applyOptimisticRoleUpdate(userId, newRole);
                                await clearUserCaches(this.currentOrganizationId);
                                await this.fetchData({
                                        ...this.getDataFetchOptions(),
                                        userCacheOptions: { forceRefresh: true },
                                });
                                this.render();
                        } else {
                                this.app.showMessage(
                                        this.app.translate(
                                                "error_updating_role",
                                        ),
                                        "error",
                                );
                        }
                } catch (error) {
                        debugError("Error updating user role:", error);
                        this.app.showMessage(
                                this.app.translate("error_updating_role"),
                                "error",
                        );
                }
        }

        async approveUser(userId) {
                try {
                        const result = await approveUser(
                                userId,
                                this.currentOrganizationId,
                        );
                        if (result.success) {
                                this.app.showMessage(
                                        this.app.translate(
                                                "user_approved_successfully",
                                        ),
                                        "success",
                                );
                                this.applyOptimisticApproval(userId);
                                await clearUserCaches(this.currentOrganizationId);
                                await this.fetchData({
                                        ...this.getDataFetchOptions(),
                                        userCacheOptions: { forceRefresh: true },
                                });
                                this.render();
                        } else {
                                this.app.showMessage(
                                        this.app.translate(
                                                "error_approving_user",
                                        ),
                                        "error",
                                );
                        }
                } catch (error) {
                        debugError("Error approving user:", error);
                        this.app.showMessage(
                                this.app.translate("error_approving_user"),
                                "error",
                        );
                }
        }

        initImportHandlers() {
                const fileInput = document.getElementById("sisc-file-input");
                const selectBtn = document.getElementById("select-file-btn");
                const importBtn = document.getElementById("import-sisc-btn");
                const fileNameSpan = document.getElementById("selected-file-name");
                const progressDiv = document.getElementById("import-progress");
                const resultDiv = document.getElementById("import-result");

                let selectedFile = null;

                selectBtn.addEventListener("click", () => {
                        fileInput.click();
                });

                fileInput.addEventListener("change", (e) => {
                        if (e.target.files.length > 0) {
                                selectedFile = e.target.files[0];
                                fileNameSpan.textContent = selectedFile.name;
                                importBtn.disabled = false;
                        } else {
                                selectedFile = null;
                                fileNameSpan.textContent = "";
                                importBtn.disabled = true;
                        }
                });

                importBtn.addEventListener("click", async () => {
                        if (!selectedFile) return;

                        importBtn.disabled = true;
                        progressDiv.style.display = "block";
                        resultDiv.innerHTML = "";

                        try {
                                const reader = new FileReader();
                                reader.onload = async (e) => {
                                        try {
                                                const arrayBuffer = e.target.result;
                                                const bytes = new Uint8Array(arrayBuffer);
                                                
                                                let csvContent;
                                                try {
                                                        const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
                                                        csvContent = utf8Decoder.decode(bytes);
                                                } catch (utf8Error) {
                                                        const iso88591Decoder = new TextDecoder("iso-8859-1");
                                                        csvContent = iso88591Decoder.decode(bytes);
                                                }

                                                const result = await importSISC(csvContent);

                                                progressDiv.style.display = "none";

                                                if (result.success) {
                                                        const stats = result.stats;
                                                        resultDiv.innerHTML = `
                                                                <div class="success-message">
                                                                        <h4>${translate("import_successful")}</h4>
                                                                        <ul>
                                                                                <li>${translate("participants_created")}: ${stats.participantsCreated}</li>
                                                                                <li>${translate("participants_updated")}: ${stats.participantsUpdated}</li>
                                                                                <li>${translate("guardians_created")}: ${stats.guardiansCreated}</li>
                                                                                <li>${translate("guardians_updated")}: ${stats.guardiansUpdated}</li>
                                                                                <li>${translate("users_created")}: ${stats.usersCreated}</li>
                                                                                <li>${translate("user_participant_links_created")}: ${stats.userParticipantLinksCreated}</li>
                                                                                <li>${translate("form_submissions_created")}: ${stats.formSubmissionsCreated}</li>
                                                                        </ul>
                                                                        ${stats.errors.length > 0 ? `
                                                                                <h5>${translate("errors")}:</h5>
                                                                                <ul class="error-list">
                                                                                        ${stats.errors.map(err => `<li>${escapeHTML(err)}</li>`).join("")}
                                                                                </ul>
                                                                        ` : ""}
                                                                        ${result.verification ? `
                                                                                <h5>${translate("database_verification")}:</h5>
                                                                                <ul>
                                                                                        <li>${translate("total_participants_in_org")}: ${result.verification.totalParticipants}</li>
                                                                                        <li>${translate("total_guardians_in_org")}: ${result.verification.totalGuardians}</li>
                                                                                        <li>${translate("total_parent_child_links")}: ${result.verification.totalUserParticipantLinks}</li>
                                                                                </ul>
                                                                        ` : ""}
                                                                </div>
                                                        `;
                                                } else {
                                                        resultDiv.innerHTML = `<div class="error-message">${translate("import_failed")}: ${escapeHTML(result.message)}</div>`;
                                                }
                                        } catch (error) {
                                                progressDiv.style.display = "none";
                                                resultDiv.innerHTML = `<div class="error-message">${translate("import_failed")}: ${escapeHTML(error.message)}</div>`;
                                        }
                                        importBtn.disabled = false;
                                };

                                reader.onerror = () => {
                                        progressDiv.style.display = "none";
                                        resultDiv.innerHTML = `<div class="error-message">${translate("file_read_error")}</div>`;
                                        importBtn.disabled = false;
                                };

                                reader.readAsArrayBuffer(selectedFile);
                        } catch (error) {
                                progressDiv.style.display = "none";
                                resultDiv.innerHTML = `<div class="error-message">${translate("import_failed")}: ${escapeHTML(error.message)}</div>`;
                                importBtn.disabled = false;
                        }
                });
        }

        initNotificationForm() {
                const notificationForm =
                        document.getElementById("notification-form");
                const resultContainer = document.getElementById(
                        "notification-result",
                );
                notificationForm.addEventListener("submit", async (event) => {
                        event.preventDefault();
                        const title =
                                document.getElementById(
                                        "notification-title",
                                ).value;
                        const body =
                                document.getElementById(
                                        "notification-body",
                                ).value;
                        resultContainer.innerHTML = translate("sending");

                        // Get selected subscribers
                        const selectedSubscribers = Array.from(
                                document.querySelectorAll(
                                        "#subscribers-list input:checked",
                                ),
                        ).map((input) => input.value);

                        // Retrieve the JWT token from localStorage
                        const token = localStorage.getItem("jwtToken");
                        if (!token) {
                                resultContainer.innerHTML =
                                        translate("error_no_token");
                                return;
                        }

                        try {
                                const response = await fetch(
                                        "/api/send-notification",
                                        {
                                                method: "POST",
                                                headers: {
                                                        "Content-Type":
                                                                "application/json",
                                                        Authorization: `Bearer ${token}`, // Send the token in the Authorization header
                                                },
                                                body: JSON.stringify({
                                                        title,
                                                        body,
                                                        subscribers:
                                                                selectedSubscribers,
                                                }),
                                        },
                                );
                                const result = await response.json();
                                if (response.ok) {
                                        resultContainer.innerHTML = translate(
                                                "notification_sent_successfully",
                                        );
                                        notificationForm.reset();
                                } else {
                                        resultContainer.innerHTML = `${translate("failed_to_send_notification")}: ${result.error}`;
                                }
                        } catch (error) {
                                resultContainer.innerHTML = `${translate("error")}: ${error.message}`;
                        }
                });
        }

        /**
         * Normalize user response shapes to a consistent array
         * @param {object|Array} usersResult
         * @returns {Array}
         */
        normalizeUserList(usersResult) {
                const candidates = [
                        usersResult?.users,
                        usersResult?.data,
                        usersResult,
                ];

                const userList = candidates.find((candidate) =>
                        Array.isArray(candidate),
                );

                return userList || [];
        }
}
