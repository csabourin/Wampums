/**
 * index.html ships a few words outside #app: the privacy policy link and the
 * loading indicator. Put them in the page's language too, so one page never
 * mixes two languages.
 *
 * @param {Function} translate - Translation lookup for the active language
 * @param {Document} [root=document] - Document holding the static elements
 * @returns {void}
 */
export function localizeStaticChrome(translate, root = document) {
  const privacyLink = root.querySelector('.privacy-policy-link');
  if (privacyLink) {
    privacyLink.textContent = translate('privacy_policy_link');
    // The policy itself is only published in French.
    privacyLink.setAttribute('hreflang', 'fr');
  }
  const loadingIndicator = root.getElementById('loading-indicator');
  if (loadingIndicator) {
    loadingIndicator.textContent = translate('loading');
  }
}
