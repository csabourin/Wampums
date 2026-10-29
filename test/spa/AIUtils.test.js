/** @jest-environment jsdom */
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugError: jest.fn(), debugLog: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => ({ ai_label: 'IA', ai_full_name: 'Intelligence artificielle', translate_list: 'Traduire la liste' }[key] || key) }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(), hasOrganizationScope: jest.fn() }));
import { hasPermission, hasOrganizationScope } from '../../spa/utils/PermissionUtils.js';
import { canUseAI, aiActionLabel } from '../../spa/utils/AIUtils.js';
import { setButtonLoading } from '../../spa/utils/SkeletonUtils.js';
import { setContent } from '../../spa/utils/DOMUtils.js';
test('only organization-scoped staff with the explicit AI permission can use AI', () => {
  hasPermission.mockReturnValue(true); hasOrganizationScope.mockReturnValue(false); expect(canUseAI()).toBe(false);
  hasPermission.mockReturnValue(false); hasOrganizationScope.mockReturnValue(true); expect(canUseAI()).toBe(false);
  hasPermission.mockReturnValue(true); expect(canUseAI()).toBe(true);
});
test('an AI action names AI visibly and in its accessible name', () => {
  const button = document.createElement('button'); setContent(button, aiActionLabel('translate_list'));
  expect(button.textContent).toContain('IA');
  expect(button.textContent).toContain('Traduire la liste IA');
  expect(button.querySelector('.ai-badge').getAttribute('aria-hidden')).toBeNull();
  expect(button.hasAttribute('aria-label')).toBe(false);
  expect(button.textContent).toContain('Intelligence artificielle');
});


test('loading and restoring an AI button preserves its badge and accessible explanation', () => {
  const button = document.createElement('button'); setContent(button, aiActionLabel('translate_list'));
  setButtonLoading(button, true); setButtonLoading(button, false);
  expect(button.querySelector('.ai-badge').textContent).toBe('IA');
  expect(button.querySelector('.sr-only').textContent).toContain('Intelligence artificielle');
});
