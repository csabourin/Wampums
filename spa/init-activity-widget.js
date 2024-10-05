import { ActivityWidget } from './activity-widget.js';

console.log('init-activity-widget.js loaded');

export function initActivityWidget(app) {
		console.log('Initializing ActivityWidget');
		console.log('App state:', { isLoggedIn: app.isLoggedIn, userRole: app.userRole });

		if (app.isLoggedIn && (app.userRole === 'admin' || app.userRole === 'animation')) {
				new ActivityWidget(app);
		} else {
				console.log('User not logged in or not authorized for ActivityWidget');
		}
}