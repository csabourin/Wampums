/** Keyboard and editing behaviour in the live unit and district matrices. */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, storageStateFor, openScreen, axeViolations } from './helpers.mjs';

test.use({ storageState: storageStateFor(ACCOUNTS.admin) });

for (const target of ['/roles?tab=permissions', '/district?tab=roles']) {
  test(`${target} lets an admin configure a unit role using the keyboard`, async ({ page }, testInfo) => {
    await openScreen(page, target);
    await expect(page.locator('#role-matrix-create')).toBeVisible();
    const token = await page.evaluate(() => localStorage.getItem('jwtToken'));
    const headers = { Authorization: `Bearer ${token}` };
    const created = await page.request.post('/api/v1/roles', { headers, data: { display_name: `Keyboard ${testInfo.project.name} ${Date.now()}` } });
    expect(created.status()).toBe(201);
    const role = (await created.json()).data;
    try {
      await page.reload();
      await expect(page.locator('#role-matrix-save-form')).toBeVisible();
      const mobile = testInfo.project.name === 'phone';
      if (mobile) { await page.locator('#role-matrix-role').selectOption(String(role.id)); }
      const prefix = mobile ? 'mobile' : 'table';
      const matrix = await page.request.get('/api/v1/roles/matrix', { headers });
      const catalog = (await matrix.json()).data.permissions;
      const manageId = catalog.find((p) => p.permission_key === 'points.manage').id;
      const viewId = catalog.find((p) => p.permission_key === 'points.view').id;
      const manage = page.locator(`#role-matrix-${prefix}-${role.id}-${manageId}`);
      const view = page.locator(`#role-matrix-${prefix}-${role.id}-${viewId}`);
      await manage.focus(); await page.keyboard.press('Space');
      await expect(manage).toBeChecked(); await expect(manage).toBeFocused();
      await expect(view).toBeChecked(); await expect(view).toBeDisabled();
      await expect(page.locator('#role-matrix-live')).toContainText('Voir');
      await page.locator('#role-matrix-save-form button[type="submit"]').click();
      await expect(page.locator('#role-matrix-changes')).toContainText('0 changements');
      const saved = await page.request.get(`/api/v1/roles/${role.id}/permissions`, { headers });
      expect((await saved.json()).data.map((p) => p.permission_key).sort()).toEqual(['points.manage', 'points.view']);
      const opener = page.locator('#role-matrix-create');
      await opener.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
      await page.locator('#role-matrix-name').fill('Rôle temporaire');
      const last = dialog.locator('button[type="submit"]'); await last.focus();
      await page.keyboard.press('Tab');
      await expect(dialog.locator('.modal-close')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
      expect(await axeViolations(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath('matrix.png'), fullPage: false });
    } finally {
      expect((await page.request.delete(`/api/v1/roles/${role.id}`, { headers })).status()).toBe(200);
    }
  });
}
