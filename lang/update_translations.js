const fs = require('fs');
const path = require('path');

// Load existing translations
const en = require('./en.json');
const fr = require('./fr.json');

// Missing keys from FR that need to be added to EN
const frToEn = {
  "injuries": "Injuries",
  "no_data_available": "No data available",
  "name": "Name",
  "leave_alone": "Leave alone",
  "media_consent": "Media consent",
  "health_details": "Health details",
  "eau_peu_profonde": "Shallow water",
  "logout": "Logout",
  "save_reminder": "Save reminder",
  "reminder_saved_successfully": "Reminder saved successfully",
  "error_saving_reminder": "Error saving reminder",
  "set_reminder": "Set reminder",
  "reminder_text": "Reminder text",
  "reminder_date": "Reminder date",
  "recurring_reminder": "Recurring reminder until this date",
  "reminder": "Reminder",
  "existing_reminder": "Existing reminder",
  "has_allergies_label": "Has allergies",
  "has_limitations_label": "Has limitations",
  "has_medication_label": "Takes medication",
  "has_probleme_sante_label": "Has health problems",
  "had_blessures_operations_label": "Has had injuries or operations",
  "select_form_type": "Select form type",
  "no_form_types_available": "No form types available",
  "error_loading_form_types": "Error loading form types",
  "missing_fields_report": "Missing fields report",
  "missing_fields": "Missing fields",
  "birthdate": "Birthdate",
  "create_new_organization": "Create new organization",
  "create_organization": "Create organization",
  "back_to_admin": "Back to district tools",
  "organization_created_successfully": "Organization created successfully",
  "error_creating_organization": "Error creating organization",
  "Logo": "Logo",
  "Name": "Name",
  "Unit": "Unit",
  "Location": "Location",
  "District": "District",
  "Meeting Day": "Meeting Day",
  "Monday": "Monday",
  "Tuesday": "Tuesday",
  "Wednesday": "Wednesday",
  "Thursday": "Thursday",
  "Friday": "Friday",
  "Saturday": "Saturday",
  "Sunday": "Sunday",
  "Responsible Animator": "Responsible Leader",
  "select_date": "Select date",
  "upcoming_meeting": "Upcoming meeting",
  "activities": "Activities",
  "location": "Location",
  "select_participant": "Select participant",
  "attendance_updated": "Attendance updated",
  "group_attendance_updated": "Group attendance updated",
  "error_updating_group_attendance": "Error updating group attendance",
  "no_participants_to_update": "No participants to update",
  "no_selection": "No selection"
};

// Missing keys from EN that need to be added to FR
const enToFr = {
  "parent_name_label": "Nom du parent",
  "signed_parent_label": "Signé",
  "date_signed_label": "Date",
  "child_name_label": "Nom de l'enfant",
  "permission_given_label": "J'autorise par la présente mon enfant à assister au camp d'automne des Louveteaux 2024",
  "emergency_contact_name_label": "En cas d'urgence, veuillez aviser (nom)",
  "emergency_contact_phone_label": "En cas d'urgence, veuillez aviser (numéro de téléphone)",
  "medication_required_label": "Votre enfant a-t-il besoin de médicaments pendant le camp ?",
  "medication_details_label": "Énumérer les médicaments, l'heure et la posologie",
  "additional_notes_label": "Notes ou informations supplémentaires",
  "infoText_permission": "En lien avec les activités scoutes, l'expérience a démontré qu'il y a des moments où des maladies ou des accidents peuvent survenir et où une attention chirurgicale ou médicale immédiate est nécessaire. C'est ma permission pour le responsable ou son adjoint de prendre des dispositions pour une attention chirurgicale ou médicale pour mon enfant/pupille en cas d'urgence, sans la nécessité de mon approbation préalable. Je comprends que je serai avisé par les moyens les plus rapides possibles si cette autorité est exercée.",
  "infoText_camp_details": "<strong>Camp d'automne des Louveteaux 2024</strong><br><br>Coût : 25,00 $ pour les inscriptions<br><br><strong>De :</strong> Vendredi 18 octobre<br><strong>Arrivée :</strong> 18h30 au CWP Longhouse, 4865 County Road 8<br><br><strong>À :</strong> Dimanche 20 octobre<br><strong>Ramassage :</strong> 11h30 au CWP Longhouse, 4865 County Road 8"
};

// New translations for hardcoded strings found in codebase
const newTranslations = {
  en: {
    // Error pages
    "error_403_forbidden": "403 - Forbidden",
    "error_404_not_found": "404 - Page Not Found",
    "error_403_not_authorized": "403 - Not Authorized",

    // Notifications
    "sending": "Sending...",
    "error_no_token": "Error: No token found. Please log in.",
    "notification_sent_successfully": "Notification sent successfully!",
    "failed_to_send_notification": "Failed to send notification",
    "new_notification": "New Notification",

    // Application errors
    "application_error": "Application Error",
    "error_loading_page": "An error occurred while loading the page.",
    "error_loading_application": "There was a problem loading the application. Please try reloading the page.",
    "go_to_homepage": "Go to homepage",
    "reload": "Reload",

    // Login errors
    "error_logging_in": "Error logging in",
    "login_error_no_token": "Login error: No authentication token received",
    "login_error_no_user_id": "Login error: No user ID received",

    // Points management
    "error_updating_points": "An error occurred while updating points",

    // Calendar view
    "calendar_sales_title": "Calendar Sales",
    "name_column": "Name",
    "quantity_column": "Quantity",
    "amount_paid_column": "Amount Paid",
    "paid_column": "Paid",
    "total": "Total",

    // Activity types (default placeholders)
    "activity_welcome_cubs": "Welcome of cub scouts",
    "activity_big_game": "Big Game",
    "activity_water_break": "Water break",
    "activity_technique": "Technical",
    "activity_discussion": "Discussion",
    "activity_short_game": "Short game",
    "activity_prayer_departure": "Prayer and departure",
    "activity_type_preparation": "Preparation",
    "activity_type_game": "Game",
    "activity_type_pause": "Pause",
    "activity_type_conclusion": "Conclusion",

    // Group report
    "den_list_report": "List of den groups",

    // Backend: Authentication & Authorization
    "authentication_required": "Authentication required",
    "invalid_or_expired_token": "Invalid or expired token",
    "insufficient_permissions": "Insufficient permissions",
    "invalid_email_or_password": "Invalid email or password",
    "account_not_verified_login": "Your account is not yet verified. Please wait for district verification.",
    "unauthorized": "Unauthorized",

    // Backend: Validation errors
    "organization_id_required": "Organization ID is required",
    "email_password_required": "Email and password are required",
    "missing_subscription_data": "Missing subscription data",
    "title_body_required": "Title and body are required",
    "participant_id_date_required": "Participant ID and date are required",
    "status_date_required": "Status and date are required",
    "at_least_one_participant_required": "At least one valid participant ID is required",
    "name_date_required": "Name and date are required",
    "first_last_name_required": "First name and last name are required",
    "participant_id_required": "Participant ID is required",
    "form_type_required": "Form type is required",
    "participant_territoire_required": "Participant ID and territoire_chasse are required",
    "badge_id_required": "Badge ID is required",
    "participant_form_type_required": "Participant ID and form_type are required",
    "participant_form_submission_required": "Participant ID, form_type, and submission_data are required",
    "user_id_required": "User ID is required",
    "user_id_role_required": "User ID and role are required",
    "participant_ids_array_required": "participant_ids array is required",
    "amount_paid_required": "Amount paid is required",
    "email_password_fullname_required": "Email, password, and full name are required",
    "email_required": "Email is required",
    "token_new_password_required": "Token and new password are required",
    "group_id_required": "Group ID is required",
    "at_least_one_field_required": "At least one field to update is required",
    "status_required": "Status is required",
    "name_organization_id_required": "Name and organization ID are required",
    "organization_name_required": "Organization name is required",
    "guardian_id_participant_id_required": "Participant ID and Guardian ID are required",
    "guardian_name_required": "Participant ID, nom, and prenom are required",

    // Backend: Success messages
    "login_successful": "Login successful",
    "reunion_preparation_saved": "Reunion preparation saved successfully",
    "attendance_updated_success": "Attendance updated successfully",
    "points_updated_successfully": "Points updated successfully",
    "reminder_saved_success": "Reminder saved successfully",
    "participant_updated": "Participant updated successfully",
    "participant_created": "Participant created successfully",
    "group_membership_updated": "Group membership updated successfully",
    "participant_removed_from_group": "Participant removed from group",
    "participant_linked_to_organization": "Participant linked to organization",
    "organization_created_success": "Organization created successfully",
    "acceptation_risque_saved": "Acceptation risque saved successfully",
    "reunion_preparation_saved_success": "Reunion preparation saved successfully",
    "successfully_registered_for_organization": "Successfully registered for organization",
    "calendar_updated_successfully": "Calendar updated successfully",
    "group_removed_successfully_action": "Group removed successfully",
    "attendance_updated_success_action": "Attendance updated successfully",
    "badge_progress_submitted": "Badge progress submitted for approval",
    "badge_approved": "Badge approved",
    "badge_rejected": "Badge rejected",
    "form_saved_success": "Form saved successfully",
    "guardian_saved_successfully": "Guardian saved successfully",
    "guardian_removed_successfully_action": "Guardian removed successfully",
    "user_approved_success": "User approved successfully",
    "user_role_updated_successfully_action": "User role updated successfully",
    "user_linked_to_participants_successfully": "User linked to participants successfully",
    "user_registered_await_approval": "User registered successfully. Please wait for district approval.",
    "password_reset_success": "Password reset successful",

    // Backend: Not found messages
    "no_reunion_preparation_found": "No reunion preparation found for this date",
    "no_users_found": "No users found",
    "no_subscribers_found": "No subscribers found",
    "participant_not_found": "Participant not found",
    "participant_duplicate": "A participant with this name and date of birth already exists",
    "no_upcoming_meetings_found": "No upcoming meetings found",
    "form_structure_not_found": "Form structure not found",
    "no_submission_data_found": "No submission data found",
    "honor_already_awarded_for_date": "Honor already awarded for this date",
    "badge_not_found": "Badge not found",
    "no_badge_system_settings": "No badge system settings found",
    "no_submission_returning_basic_info": "No submission found, returning participant basic info",
    "no_submission_or_participant": "No submission or participant found",
    "participant_not_found_in_organization": "Participant not found in this organization",
    "guardian_not_found": "Guardian not found in this organization",
    "guardian_link_not_found": "Guardian link not found in this organization",
    "user_not_found_in_organization": "User not found in this organization",
    "risk_acceptance_not_found": "Risk acceptance not found",
    "user_email_already_exists": "User with this email already exists",
    "reset_link_sent_if_exists": "If a user with that email exists, a reset link has been sent",

    // Backend: System errors
    "failed_to_load_translations": "Failed to load translations",
    "failed_to_fetch_news": "Failed to fetch news",
    "failed_to_generate_jwt": "Failed to generate JWT token",
    "internal_server_error": "Internal server error",
    "error_getting_organization_id": "Error getting organization ID",
    "error_getting_organization_settings": "Error getting organization settings",
    "error_fetching_reunion_preparation": "Error fetching reunion preparation",
    "failed_to_save_subscription": "Failed to save subscription",
    "forbidden_admin_required": "Forbidden: District access required",
    "vapid_key_not_set": "VAPID private key is not set",
    "web_push_not_configured": "Web push not configured. Install web-push package.",
    "updates_must_be_array": "Updates must be an array",
    "access_denied_to_participant": "Access denied to this participant",
    "cannot_change_own_role": "Cannot change your own role",
    "only_admins_can_link_participants": "Only district leads can link participants to other users",

    // Routes: Success messages
    "attendance_marked_successfully": "Attendance marked successfully",
    "participant_created_v1": "Participant created successfully",
    "participant_updated_v1": "Participant updated successfully",
    "participant_removed_v1": "Participant removed from organization",
    "group_created_successfully_v1": "Group created successfully",
    "group_updated_successfully_v1": "Group updated successfully",
    "group_deleted_successfully": "Group deleted successfully",

    // Routes: Error messages
    "participant_not_found_or_access_denied": "Participant not found or access denied",
    "participant_not_found_v1": "Participant not found",
    "group_not_found": "Group not found",

    // Middleware
    "success_default": "Success",
    "error_default": "An error occurred"
  },
  fr: {
    // Error pages
    "error_403_forbidden": "403 - Accès interdit",
    "error_404_not_found": "404 - Page non trouvée",
    "error_403_not_authorized": "403 - Non autorisé",

    // Notifications
    "sending": "Envoi en cours...",
    "error_no_token": "Erreur : Aucun jeton trouvé. Veuillez vous connecter.",
    "notification_sent_successfully": "Notification envoyée avec succès !",
    "failed_to_send_notification": "Échec de l'envoi de la notification",
    "new_notification": "Nouvelle notification",

    // Application errors
    "application_error": "Erreur d'application",
    "error_loading_page": "Une erreur s'est produite lors du chargement de la page.",
    "error_loading_application": "Un problème est survenu lors du chargement de l'application. Veuillez recharger la page.",
    "go_to_homepage": "Aller à l'accueil",
    "reload": "Recharger",

    // Login errors
    "error_logging_in": "Erreur de connexion",
    "login_error_no_token": "Erreur de connexion : Aucun jeton d'authentification reçu",
    "login_error_no_user_id": "Erreur de connexion : Aucun ID utilisateur reçu",

    // Points management
    "error_updating_points": "Une erreur s'est produite lors de la mise à jour des points",

    // Calendar view
    "calendar_sales_title": "Vente de calendriers",
    "name_column": "Nom",
    "quantity_column": "Quantité",
    "amount_paid_column": "Montant payé",
    "paid_column": "Payé",
    "total": "Total",

    // Activity types (default placeholders)
    "activity_welcome_cubs": "Accueil des louveteaux",
    "activity_big_game": "Grand Jeu",
    "activity_water_break": "Trêve de l'eau",
    "activity_technique": "Technique",
    "activity_discussion": "Discussion",
    "activity_short_game": "Jeu court",
    "activity_prayer_departure": "Prière et départ",
    "activity_type_preparation": "Préparation",
    "activity_type_game": "Jeu",
    "activity_type_pause": "Pause",
    "activity_type_conclusion": "Conclusion",

    // Group report
    "den_list_report": "Liste des tannières",

    // Backend: Authentication & Authorization
    "authentication_required": "Authentification requise",
    "invalid_or_expired_token": "Jeton invalide ou expiré",
    "insufficient_permissions": "Permissions insuffisantes",
    "invalid_email_or_password": "Email ou mot de passe invalide",
    "account_not_verified_login": "Votre compte n'est pas encore vérifié. Veuillez attendre la vérification par le district.",
    "unauthorized": "Non autorisé",

    // Backend: Validation errors
    "organization_id_required": "L'ID de l'organisation est requis",
    "email_password_required": "L'email et le mot de passe sont requis",
    "missing_subscription_data": "Données d'abonnement manquantes",
    "title_body_required": "Le titre et le corps sont requis",
    "participant_id_date_required": "L'ID du participant et la date sont requis",
    "status_date_required": "Le statut et la date sont requis",
    "at_least_one_participant_required": "Au moins un ID de participant valide est requis",
    "name_date_required": "Le nom et la date sont requis",
    "first_last_name_required": "Le prénom et le nom de famille sont requis",
    "participant_id_required": "L'ID du participant est requis",
    "form_type_required": "Le type de formulaire est requis",
    "participant_territoire_required": "L'ID du participant et territoire_chasse sont requis",
    "badge_id_required": "L'ID du badge est requis",
    "participant_form_type_required": "L'ID du participant et form_type sont requis",
    "participant_form_submission_required": "L'ID du participant, form_type et submission_data sont requis",
    "user_id_required": "L'ID de l'utilisateur est requis",
    "user_id_role_required": "L'ID de l'utilisateur et le rôle sont requis",
    "participant_ids_array_required": "Le tableau participant_ids est requis",
    "amount_paid_required": "Le montant payé est requis",
    "email_password_fullname_required": "L'email, le mot de passe et le nom complet sont requis",
    "email_required": "L'email est requis",
    "token_new_password_required": "Le jeton et le nouveau mot de passe sont requis",
    "group_id_required": "L'ID du groupe est requis",
    "at_least_one_field_required": "Au moins un champ à mettre à jour est requis",
    "status_required": "Le statut est requis",
    "name_organization_id_required": "Le nom et l'ID de l'organisation sont requis",
    "organization_name_required": "Le nom de l'organisation est requis",
    "guardian_id_participant_id_required": "L'ID du participant et l'ID du tuteur sont requis",
    "guardian_name_required": "L'ID du participant, nom et prénom sont requis",

    // Backend: Success messages
    "login_successful": "Connexion réussie",
    "reunion_preparation_saved": "Préparation de la réunion enregistrée avec succès",
    "attendance_updated_success": "Présence mise à jour avec succès",
    "points_updated_successfully": "Points mis à jour avec succès",
    "reminder_saved_success": "Rappel enregistré avec succès",
    "participant_updated": "Participant mis à jour avec succès",
    "participant_created": "Participant créé avec succès",
    "group_membership_updated": "Appartenance au groupe mise à jour avec succès",
    "participant_removed_from_group": "Participant retiré du groupe",
    "participant_linked_to_organization": "Participant lié à l'organisation",
    "organization_created_success": "Organisation créée avec succès",
    "acceptation_risque_saved": "Acceptation de risque enregistrée avec succès",
    "reunion_preparation_saved_success": "Préparation de la réunion enregistrée avec succès",
    "successfully_registered_for_organization": "Inscription à l'organisation réussie",
    "calendar_updated_successfully": "Calendrier mis à jour avec succès",
    "group_removed_successfully_action": "Groupe supprimé avec succès",
    "attendance_updated_success_action": "Présence mise à jour avec succès",
    "badge_progress_submitted": "Progrès du badge soumis pour approbation",
    "badge_approved": "Badge approuvé",
    "badge_rejected": "Badge rejeté",
    "form_saved_success": "Formulaire enregistré avec succès",
    "guardian_saved_successfully": "Tuteur enregistré avec succès",
    "guardian_removed_successfully_action": "Tuteur supprimé avec succès",
    "user_approved_success": "Utilisateur approuvé avec succès",
    "user_role_updated_successfully_action": "Rôle de l'utilisateur mis à jour avec succès",
    "user_linked_to_participants_successfully": "Utilisateur lié aux participants avec succès",
    "user_registered_await_approval": "Utilisateur enregistré avec succès. Veuillez attendre l'approbation du district.",
    "password_reset_success": "Réinitialisation du mot de passe réussie",

    // Backend: Not found messages
    "no_reunion_preparation_found": "Aucune préparation de réunion trouvée pour cette date",
    "no_users_found": "Aucun utilisateur trouvé",
    "no_subscribers_found": "Aucun abonné trouvé",
    "participant_not_found": "Participant non trouvé",
    "participant_duplicate": "Un participant avec ce nom et cette date de naissance existe déjà",
    "no_upcoming_meetings_found": "Aucune réunion à venir trouvée",
    "form_structure_not_found": "Structure de formulaire non trouvée",
    "no_submission_data_found": "Aucune donnée de soumission trouvée",
    "honor_already_awarded_for_date": "Loup d'honneur déjà attribué pour cette date",
    "badge_not_found": "Badge non trouvé",
    "no_badge_system_settings": "Aucun paramètre du système de badges trouvé",
    "no_submission_returning_basic_info": "Aucune soumission trouvée, retour des informations de base du participant",
    "no_submission_or_participant": "Aucune soumission ou participant trouvé",
    "participant_not_found_in_organization": "Participant non trouvé dans cette organisation",
    "guardian_not_found": "Tuteur non trouvé dans cette organisation",
    "guardian_link_not_found": "Lien du tuteur non trouvé dans cette organisation",
    "user_not_found_in_organization": "Utilisateur non trouvé dans cette organisation",
    "risk_acceptance_not_found": "Acceptation de risque non trouvée",
    "user_email_already_exists": "Un utilisateur avec cet email existe déjà",
    "reset_link_sent_if_exists": "Si un utilisateur avec cet email existe, un lien de réinitialisation a été envoyé",

    // Backend: System errors
    "failed_to_load_translations": "Échec du chargement des traductions",
    "failed_to_fetch_news": "Échec de la récupération des nouvelles",
    "failed_to_generate_jwt": "Échec de la génération du jeton JWT",
    "internal_server_error": "Erreur interne du serveur",
    "error_getting_organization_id": "Erreur lors de l'obtention de l'ID de l'organisation",
    "error_getting_organization_settings": "Erreur lors de l'obtention des paramètres de l'organisation",
    "error_fetching_reunion_preparation": "Erreur lors de la récupération de la préparation de la réunion",
    "failed_to_save_subscription": "Échec de l'enregistrement de l'abonnement",
    "forbidden_admin_required": "Interdit : accès réservé au district",
    "vapid_key_not_set": "La clé privée VAPID n'est pas définie",
    "web_push_not_configured": "Web push non configuré. Installez le package web-push.",
    "updates_must_be_array": "Les mises à jour doivent être un tableau",
    "access_denied_to_participant": "Accès refusé à ce participant",
    "cannot_change_own_role": "Impossible de changer son propre rôle",
    "only_admins_can_link_participants": "Seuls les responsables de district peuvent lier des participants à d'autres utilisateurs",

    // Routes: Success messages
    "attendance_marked_successfully": "Présence marquée avec succès",
    "participant_created_v1": "Participant créé avec succès",
    "participant_updated_v1": "Participant mis à jour avec succès",
    "participant_removed_v1": "Participant retiré de l'organisation",
    "group_created_successfully_v1": "Groupe créé avec succès",
    "group_updated_successfully_v1": "Groupe mis à jour avec succès",
    "group_deleted_successfully": "Groupe supprimé avec succès",

    // Routes: Error messages
    "participant_not_found_or_access_denied": "Participant non trouvé ou accès refusé",
    "participant_not_found_v1": "Participant non trouvé",
    "group_not_found": "Groupe non trouvé",

    // Middleware
    "success_default": "Succès",
    "error_default": "Une erreur s'est produite"
  }
};

// Merge all translations
const updatedEn = { ...en, ...frToEn, ...newTranslations.en };
const updatedFr = { ...fr, ...enToFr, ...newTranslations.fr };

// Sort keys alphabetically
const sortedEn = Object.keys(updatedEn).sort().reduce((acc, key) => {
  acc[key] = updatedEn[key];
  return acc;
}, {});

const sortedFr = Object.keys(updatedFr).sort().reduce((acc, key) => {
  acc[key] = updatedFr[key];
  return acc;
}, {});

// Write updated files
fs.writeFileSync('./en.json', JSON.stringify(sortedEn, null, 4));
fs.writeFileSync('./fr.json', JSON.stringify(sortedFr, null, 4));

console.log('✓ Translation files updated successfully!');
console.log(`  - en.json: ${Object.keys(en).length} → ${Object.keys(sortedEn).length} keys (+${Object.keys(sortedEn).length - Object.keys(en).length})`);
console.log(`  - fr.json: ${Object.keys(fr).length} → ${Object.keys(sortedFr).length} keys (+${Object.keys(sortedFr).length - Object.keys(fr).length})`);
