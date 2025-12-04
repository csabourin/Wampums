import { ActivityWidget } from './activity-widget.js';
import { debugLog } from './utils/DebugUtils.js';

debugLog('init-activity-widget.js loaded');

export function initActivityWidget(app) {
		debugLog('Initializing ActivityWidget');
		debugLog('App state:', { isLoggedIn: app.isLoggedIn, userRole: app.userRole });

		if (app.isLoggedIn && (app.userRole === 'admin' || app.userRole === 'animation')) {
				new ActivityWidget(app);
		} else {
				debugLog('User not logged in or not authorized for ActivityWidget');
		}
}