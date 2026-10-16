/**
 * The few words the app needs when it cannot start: the error page and the
 * page chrome around it. They ship with the code because a failed start can
 * come before the translation bundle arrives, and a page of raw keys
 * ("application_error") tells nobody anything.
 *
 * Copies of lang/en.json and lang/fr.json; test/spa/ErrorPageUtils.test.js
 * keeps them equal.
 *
 * @module spa/config/startup-texts
 */

export const STARTUP_TEXTS = Object.freeze({
  en: Object.freeze({
    application_error: 'Application Error',
    error_loading_application: 'There was a problem loading the application. Please try reloading the page.',
    reload: 'Reload',
    go_to_homepage: 'Go to homepage',
    back: 'Back',
    back_to_home: 'Back to home',
    error: 'Error',
    loading: 'Loading...',
    skip_to_content: 'Skip to main content',
    privacy_policy_link: 'Privacy policy (in French)',
  }),
  fr: Object.freeze({
    application_error: 'Erreur d’application',
    error_loading_application: 'Un problème est survenu lors du chargement de l’application. Veuillez recharger la page.',
    reload: 'Recharger',
    go_to_homepage: 'Aller à l’accueil',
    back: 'Retour',
    back_to_home: 'Retour à l’accueil',
    error: 'Erreur',
    loading: 'Chargement en cours...',
    skip_to_content: 'Aller au contenu principal',
    privacy_policy_link: 'Politique de confidentialité',
  }),
});
