/**
 * check-spa-files.js
 * 
 * Ensures no new files are added to the root of the spa/ directory.
 * All new features must be added as modules under spa/modules/.
 */

const fs = require('fs');
const path = require('path');

const SPA_ROOT = path.join(__dirname, '../../spa');

// Initial allow-list of 68 files as identified in the audit
const SPA_ALLOW_LIST = [
    'JSONFormRenderer.js',
    'MANUEL_PARENTS.md',
    'acceptation_risque.js',
    'activities.js',
    'activity-widget.js',
    'admin.js',
    'ajax-functions.js',
    'app.js',
    'approve_badges.js',
    'attendance.js',
    'badge_dashboard.js',
    'badge_form.js',
    'badge_tracker.js',
    'budgets.js',
    'calendars.js',
    'carpool.js',
    'carpool_dashboard.js',
    'communication-settings.js',
    'config.js',
    'create_organization.js',
    'dashboard.js',
    'district_management.js',
    'dynamicFormHandler.js',
    'expenses.js',
    'external-revenue.js',
    'fiche_sante.js',
    'finance.js',
    'formBuilder.js',
    'form_permissions.js',
    'formulaire_inscription.js',
    'functions.js',
    'fundraisers.js',
    'group-participant-report.js',
    'guardian-management.js',
    'indexedDB.js',
    'init-activity-widget.js',
    'inventory.js',
    'jwt-helper.js',
    'login.js',
    'mailing_list.js',
    'manage_groups.js',
    'manage_honors.js',
    'manage_participants.js',
    'manage_points.js',
    'manage_users_participants.js',
    'material_management.js',
    'medication_management.js',
    'medication_reception.js',
    'offline-init.js',
    'offline_preparation.js',
    'parent_contact_list.js',
    'parent_dashboard.js',
    'parent_finance.js',
    'permission_slip_dashboard.js',
    'permission_slip_sign.js',
    'preparation_reunions.js',
    'pwa-update-manager.js',
    'register.js',
    'register_organization.js',
    'reports.js',
    'reset_password.js',
    'resource_dashboard.js',
    'revenue-dashboard.js',
    'role_management.js',
    'router.js',
    'time_since_registration.js',
    'upcoming_meeting.js',
    'view_participant_documents.js'
];

function checkSpaFiles() {
    const files = fs.readdirSync(SPA_ROOT);
    let errors = [];

    files.forEach(file => {
        const filePath = path.join(SPA_ROOT, file);
        const stats = fs.statSync(filePath);

        // Only check files in the root, ignore directories
        if (stats.isFile()) {
            if (!SPA_ALLOW_LIST.includes(file)) {
                errors.push(`New top-level SPA file detected: spa/${file}`);
            }
        }
    });

    if (errors.length > 0) {
        console.error('❌ SPA Architecture Violation:');
        errors.forEach(err => console.error(`  - ${err}`));
        console.error('\nNo new files may be added to the spa/ root. Please use spa/modules/<feature>/');
        process.exit(1);
    } else {
        console.log('✅ SPA structure check passed.');
    }
}

checkSpaFiles();
