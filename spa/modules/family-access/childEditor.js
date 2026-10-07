import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { openModal, closeModal } from '../../utils/ModalUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { birthDateBounds, childProblem } from './childValidation.js';
import { familyOperationErrorKey, beginFamilyOperation, refreshFamilyAfterWrite } from './operations.js';

const CONFLICT_STATUS = 409;
const MODAL_ID = 'family-child-modal';

/**
 * A shared child correction form for parents and walk-in staff. Keep entered
 * values on rejection and close only after the server confirms the save.
 * @param {Object} page - Family page instance
 * @param {Object} child - Child currently displayed on the screen
 * @param {Function} save - API function accepting participant id and details
 */
export function openChildEditor(page, child, save) {
  if (page.pendingAction) {return;}
  page.operationModalId = MODAL_ID;
  const { today, earliest } = birthDateBounds();
  const input = (name, type, extra = '') => `<div class="form-group">
    <label for="family-edit-${name}">${translate(name)}</label>
    <input id="family-edit-${name}" name="${name}" type="${type}" required
      value="${escapeHTML(child[name] || '')}" ${extra} />
  </div>`;
  openModal({
    id: MODAL_ID, title: translate('family_child_edit'),
    canClose: () => !page.pendingAction,
    body: `<form id="family-child-edit-form">
      ${input('first_name', 'text', 'maxlength="255" autocomplete="given-name"')}
      ${input('last_name', 'text', 'maxlength="255" autocomplete="family-name"')}
      ${input('date_naissance', 'date', `min="${earliest}" max="${today}"`)}
      <p class="status-message error" id="family-child-edit-error" role="alert" hidden></p>
    </form>`,
    footer: `<button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
      <button type="submit" form="family-child-edit-form" class="button button--primary">${translate('save')}</button>`,
  });
  document.getElementById('family-child-edit-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (page.pendingAction) {return;}
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const details = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
    const alert = document.getElementById('family-child-edit-error');
    const problem = childProblem(details);
    if (problem) {
      alert.textContent = translate(problem);
      alert.hidden = false;
      return;
    }
    const release = beginFamilyOperation(page);
    if (!release) {return;}
    try {
      await save(child.id, details);
      closeModal(MODAL_ID);
      if (await refreshFamilyAfterWrite(page)) {page.showStatus('family_child_updated');}
    } catch (err) {
      debugError('Failed to correct child:', err);
      alert.textContent = translate(familyOperationErrorKey(err, err.status === CONFLICT_STATUS ? 'onboarding_error_duplicate' : 'onboarding_error_failed'));
      alert.hidden = false;
    } finally {
      release();
    }
  });
}
