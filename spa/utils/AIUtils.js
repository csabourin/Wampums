/** Shared staff authorization and explicit visible/accessibility labels for AI actions. */
import { translate } from '../app.js';
import { hasPermission, hasOrganizationScope } from './PermissionUtils.js';
import { escapeHTML } from './SecurityUtils.js';
export function canUseAI() { return hasOrganizationScope() && hasPermission('ai.use'); }
export function aiActionLabel(key) {
  return `${escapeHTML(translate(key))} <span class="ai-badge">${escapeHTML(translate('ai_label'))}</span><span class="sr-only"> — ${escapeHTML(translate('ai_full_name'))}</span>`;
}
