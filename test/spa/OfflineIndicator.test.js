/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn() }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: { campMode: false } }));

import { OfflineIndicator } from '../../spa/components/OfflineIndicator.js';

test('connection status stays above the page and never covers its bottom actions', async () => {
  document.body.innerHTML = '<main id="app"><h1>Attendance</h1><button>Present</button></main>';
  const indicator = new OfflineIndicator();
  indicator.init();

  window.dispatchEvent(new CustomEvent('offlineStatusChanged', { detail: { isOffline: true } }));
  const status = document.querySelector('.offline-indicator');
  expect(status.nextElementSibling.id).toBe('app');
  expect(status.classList.contains('visible')).toBe(true);
  expect(status.textContent).toContain('Offline');

  window.dispatchEvent(new CustomEvent('pendingCountChanged', { detail: { count: 3 } }));
  expect(status.textContent).toContain('3 change(s) pending');
  expect((await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })).violations).toEqual([]);

  window.dispatchEvent(new CustomEvent('offlineStatusChanged', { detail: { isOffline: false } }));
  expect(status.classList.contains('visible')).toBe(false);
  indicator.destroy();
});
