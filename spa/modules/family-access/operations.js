import { translate } from '../../app.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';

/**
 * Serialize writes on a family screen, preserving controls already disabled
 * by permissions. The returned release function also survives a page render.
 * @param {Object} page - Screen with root() and a pendingAction property
 * @returns {Function|null} Release function, or null while another write runs
 */
export function beginFamilyOperation(page) {
  if (page.pendingAction) {return null;}
  page.pendingAction = true;
  const roots = [page.root(), document.getElementById(page.operationModalId || 'parent-invitation-modal')].filter(Boolean);
  const controls = roots.flatMap((root) => [...root.querySelectorAll('button, input, select, textarea')])
    .map((element) => ({ element, disabled: element.disabled }));
  controls.forEach(({ element }) => { element.disabled = true; });
  roots.forEach((root) => root.setAttribute('aria-busy', 'true'));
  return () => {
    page.pendingAction = false;
    controls.forEach(({ element, disabled }) => { element.disabled = disabled; });
    roots.forEach((root) => root.removeAttribute('aria-busy'));
  };
}

/**
 * Refresh after a committed write without pretending the write failed. Keep
 * the current screen, and offer a read-only retry if the network goes away.
 * @param {Object} page - Screen with load(), render(), root(), showStatus()
 * @returns {Promise<boolean>} Whether the fresh state was rendered
 */
export async function refreshFamilyAfterWrite(page, { emailSent = null } = {}) {
  try {
    await page.load();
    page.render();
    return true;
  } catch (err) {
    debugError('Saved family operation; refresh failed:', err);
    page.showStatus(emailSent === false ? 'family_saved_not_sent_refresh_failed' : 'family_saved_refresh_failed', 'warning');
    let retry = page.root()?.querySelector('[data-family-refresh]');
    if (!retry && page.root()) {
      retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'button button--secondary';
      retry.dataset.familyRefresh = '';
      retry.textContent = translate('parent_invitations_retry');
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        if (!(await refreshFamilyAfterWrite(page, { emailSent }))) {retry.disabled = false;}
      });
      page.root().appendChild(retry);
    }
    return false;
  }
}

/**
 * An invitation's language belongs to its recipient rather than the sender.
 * @param {string} id - Unique label/input id
 * @param {string} language - Selected supported language
 * @returns {string} Translated select field
 */
export function invitationLanguageField(id, language) {
  return `<div class="form-group">
    <label for="${escapeHTML(id)}">${translate('family_invitation_language')}</label>
    <select id="${escapeHTML(id)}" name="language">
      <option value="en" ${language === 'en' ? 'selected' : ''}>${translate('family_language_en')}</option>
      <option value="fr" ${language === 'fr' ? 'selected' : ''}>${translate('family_language_fr')}</option>
    </select>
  </div>`;
}

/** Pick a translated recovery message without exposing raw server errors. */
export function familyOperationErrorKey(err, fallback) {
  if (err?.code === 'online_required') {return 'family_operation_online_required';}
  if (err?.code === 'operation_unconfirmed') {return 'family_operation_unconfirmed';}
  return fallback;
}
