import {
	getUsers,
	updateUserRole,
	approveUser,
	getSubscribers
} from './ajax-functions.js';

export class Admin {
	constructor(app) {
		this.app = app;
		this.users = [];
		this.subscribers = [];
	}

	async init() {
		await this.fetchData();
		this.render();
		this.initEventListeners();
	}

	async fetchData() {
		try {
			this.users = await getUsers();
			this.subscribers = await getSubscribers();
		} catch (error) {
			console.error('Error fetching data:', error);
			this.app.showMessage('Error loading data. Please try again.', 'error');
		}
	}

	render() {
		const content = `
			<h1>${this.app.translate('admin_panel')}</h1>
			<div id="message"></div>

<h2>${this.app.translate('send_notification')}</h2>
<form id="notification-form">
	<label for="notification-title">${this.app.translate('title')}</label>
	<input type="text" id="notification-title" name="title" required><br><br>

	<label for="notification-body">${this.app.translate('body')}</label>
	<textarea id="notification-body" name="body" rows="4" cols="50" required></textarea><br><br>

	<h3>${this.app.translate('select_recipients')}</h3>
	<div id="subscribers-list">
		${this.renderSubscribers()}
	</div>

	<button type="submit">${this.app.translate('send_notification')}</button>
</form>

<div id="notification-result"></div>

			<h2>${this.app.translate('user_management')}</h2>
			<table>
				<thead>
					<tr>
						<th>${this.app.translate('email')}</th>
						<th>${this.app.translate('role')}</th>
						<th>${this.app.translate('verified')}</th>
						<th>${this.app.translate('actions')}</th>
					</tr>
				</thead>
				<tbody id="users-table">
					${this.renderUsers()}
				</tbody>
			</table>

			
			<a href="/dashboard">${this.app.translate('back_to_dashboard')}</a>
		`;
		document.getElementById('app').innerHTML = content;
	}

	renderUsers() {
		return this.users.map(user => `
			<tr>
				<td>${user.email}</td>
				<td>
					<select class="role-select" data-user-id="${user.id}">
						<option value="parent" ${user.role === 'parent' ? 'selected' : ''}>${this.app.translate('parent')}</option>
						<option value="animation" ${user.role === 'animation' ? 'selected' : ''}>${this.app.translate('animation')}</option>
						<option value="admin" ${user.role === 'admin' ? 'selected' : ''}>${this.app.translate('admin')}</option>
					</select>
				</td>
				<td>${user.isVerified ? '✅' : '❌'}</td>
				<td>
					${!user.isVerified ? `<button class="approve-btn" data-user-id="${user.id}">${this.app.translate('approve')}</button>` : ''}
				</td>
			</tr>
		`).join('');
	}

	renderSubscribers() {
		return this.subscribers.map(subscriber => `
			<div>
				<input type="checkbox" id="subscriber-${subscriber.id}" name="subscribers" value="${subscriber.id}">
				<label for="subscriber-${subscriber.id}">${subscriber.email}</label>
			</div>
		`).join('');
	}

	initEventListeners() {
		document.getElementById('users-table').addEventListener('change', async (event) => {
			if (event.target.classList.contains('role-select')) {
				const userId = event.target.dataset.userId;
				const newRole = event.target.value;
				await this.updateUserRole(userId, newRole);
			}
		});

		document.getElementById('users-table').addEventListener('click', async (event) => {
			if (event.target.classList.contains('approve-btn')) {
				const userId = event.target.dataset.userId;
				await this.approveUser(userId);
			}
		});

		this.initNotificationForm();
	}

	async updateUserRole(userId, newRole) {
		try {
			const result = await updateUserRole(userId, newRole);
			if (result.success) {
				this.app.showMessage(this.app.translate('role_updated_successfully'), 'success');
				await this.fetchData();
				this.render();
			} else {
				this.app.showMessage(this.app.translate('error_updating_role'), 'error');
			}
		} catch (error) {
			console.error('Error updating user role:', error);
			this.app.showMessage(this.app.translate('error_updating_role'), 'error');
		}
	}

	async approveUser(userId) {
		try {
			const result = await approveUser(userId);
			if (result.success) {
				this.app.showMessage(this.app.translate('user_approved_successfully'), 'success');
				await this.fetchData();
				this.render();
			} else {
				this.app.showMessage(this.app.translate('error_approving_user'), 'error');
			}
		} catch (error) {
			console.error('Error approving user:', error);
			this.app.showMessage(this.app.translate('error_approving_user'), 'error');
		}
	}

	initNotificationForm() {
		const notificationForm = document.getElementById("notification-form");
		const resultContainer = document.getElementById("notification-result");
		notificationForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			const title = document.getElementById("notification-title").value;
			const body = document.getElementById("notification-body").value;
			resultContainer.innerHTML = "Sending...";

			// Get selected subscribers
			const selectedSubscribers = Array.from(document.querySelectorAll('#subscribers-list input:checked')).map(input => input.value);

			// Retrieve the JWT token from localStorage
			const token = localStorage.getItem('jwtToken');
			if (!token) {
				resultContainer.innerHTML = "Error: No token found. Please log in.";
				return;
			}

			try {
				const response = await fetch("/send-notification.php", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Authorization": `Bearer ${token}` // Send the token in the Authorization header
					},
					body: JSON.stringify({ title, body, subscribers: selectedSubscribers }),
				});
				const result = await response.json();
				if (response.ok) {
					resultContainer.innerHTML = "Notification sent successfully!";
					notificationForm.reset();
				} else {
					resultContainer.innerHTML = `Failed to send notification: ${result.error}`;
				}
			} catch (error) {
				resultContainer.innerHTML = `Error: ${error.message}`;
			}
		});
	}
}