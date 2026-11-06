/** Attendance cards must stay readable in their interactive states, too. */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, storageStateFor, openScreen, axeViolations, waitForAnimations } from './helpers.mjs';

test.use({ storageState: storageStateFor(ACCOUNTS.leader) });

test('attendance uses light rows, one selected recipient and a separate focus outline', async ({ page }, testInfo) => {
  // Keep this interaction independent of the shared seed's single child and
  // current camps. These read fixtures never change the shared database.
  const participants = [
    { id: 91001, first_name: 'Alex', last_name: 'Rivière-Tremblay', group_id: 910, group_name: 'Les Érables', first_leader: true },
    { id: 91002, first_name: 'Sam', last_name: 'Rocher', group_id: 910, group_name: 'Les Érables' },
  ];
  await page.route(/\/api\/v1\/participants(?:\?.*)?$/, (route) => route.fulfill({
    json: { success: true, data: participants },
  }));
  await page.route(/\/api\/v1\/action-roster(?:\?.*)?$/, (route) => route.fulfill({
    json: { success: true, data: { activities: [], attendance: [] } },
  }));
  await openScreen(page, '/attendance');
  const rows = page.locator('#attendance-list .participant-row');
  const first = rows.nth(0);
  const second = rows.nth(1);
  const pressed = page.locator('#attendance-list [aria-pressed="true"]');
  const activate = (row) => testInfo.project.name === 'phone' ? row.tap() : row.click();
  const appearance = (row) => row.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      image: style.backgroundImage,
      color: style.color,
      outline: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });

  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const initial = await appearance(first);
  const secondInitial = await appearance(second);
  expect(initial.image).toBe('none');
  await expect(pressed).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  await activate(first);
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await waitForAnimations(page);
  expect((await appearance(first)).background).not.toBe(initial.background);
  expect(await axeViolations(page)).toEqual([]);

  await activate(second);
  await expect(pressed).toHaveCount(1);
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(await axeViolations(page)).toEqual([]);

  await activate(second);
  await expect(pressed).toHaveCount(0);
  await second.focus();
  await waitForAnimations(page);
  await expect(second).toBeFocused();
  const focused = await appearance(second);
  expect(focused.background).toBe(secondInitial.background);
  expect(focused.image).toBe('none');
  expect(focused.color).toBe(initial.color);
  expect(focused.outline).toBe('solid');
  expect(focused.outlineWidth).toBe('3px');
  expect(await axeViolations(page)).toEqual([]);

  const header = page.locator('#attendance-list .group-header').first();
  await activate(header);
  await expect(pressed).toHaveCount(1);
  await expect(header).toHaveAttribute('aria-pressed', 'true');
  expect(await axeViolations(page)).toEqual([]);
});
