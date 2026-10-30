/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true), hasOrganizationScope: jest.fn(() => true) }));
jest.mock('../../spa/api/api-camp-readiness.js', () => ({ getUpcomingCamps: jest.fn() }));
import { getUpcomingCamps } from '../../spa/api/api-camp-readiness.js';
import { hasOrganizationScope } from '../../spa/utils/PermissionUtils.js';
import { loadUpcomingCamps, upcomingCampsMarkup } from '../../spa/modules/camp-readiness/UpcomingCamps.js';

const CAMPS = [{ id: 3, theme: '<img src=x onerror=alert(1)>', date_from: '2026-11-14', date_to: '2026-11-16' }];
beforeEach(() => { jest.clearAllMocks(); hasOrganizationScope.mockReturnValue(true); getUpcomingCamps.mockResolvedValue({ data: CAMPS }); });

test('a camp coming up links to its team overview, its name shown as text', async () => {
  document.body.innerHTML = `<main id="app">${upcomingCampsMarkup(await loadUpcomingCamps(), 'fr')}</main>`;
  const link = document.querySelector('a[href="/camp-readiness/3"]');
  expect(link).not.toBeNull();
  expect(document.querySelector('#app img')).toBeNull();
  expect(link.textContent).toContain('<img');
  expect((await axe.run(document.getElementById('app'), { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
});

test('a family account is not offered the team overview and nothing is requested', async () => {
  hasOrganizationScope.mockReturnValue(false);
  expect(await loadUpcomingCamps()).toEqual([]);
  expect(getUpcomingCamps).not.toHaveBeenCalled();
});

test('with no camp near, or when the list cannot be read, the dashboard shows nothing rather than "ready"', async () => {
  expect(upcomingCampsMarkup([], 'fr')).toBe('');
  getUpcomingCamps.mockRejectedValue(new Error('offline'));
  expect(await loadUpcomingCamps()).toEqual([]);
});

test('a camp created as an activity links to the overview opened by its activity', () => {
  document.body.innerHTML = `<main id="app">${upcomingCampsMarkup([{ id: null, activity_id: 8, theme: 'Camp de la Toussaint', date_from: '2026-10-30', date_to: '2026-11-01' }], 'fr')}</main>`;
  expect(document.querySelector('a[href="/camp-readiness/activity-8"]')).not.toBeNull();
});
