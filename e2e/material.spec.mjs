/** One material list, stock first, with real unit or Scout group ownership. */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, storageStateFor, openScreen, axeViolations } from './helpers.mjs';
test.use({ storageState: storageStateFor(ACCOUNTS.admin) });

test('an existing item can belong to the Scout group without moving or duplicating its stock', async ({ page }, testInfo) => {
  await openScreen(page, '/material');
  await expect(page.getByRole('tab', { name: 'En stock', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('h1')).toHaveCount(1);
  const token = await page.evaluate(() => localStorage.getItem('jwtToken'));
  const headers = { Authorization: `Bearer ${token}` };
  const name = `Réchaud historique ${testInfo.project.name} ${Date.now()}`;
  const created = await page.request.post('/api/v1/resources/equipment', { headers, data: { name, quantity_total: 7, owner_type: null, share_with_local_group: false } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).data.equipment.id;
  try {
    await openScreen(page, `/material?tab=stock&item=${id}`);
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await expect(dialog.locator('[name=material_owner_type]')).toHaveValue('');
    await dialog.locator('[name=material_owner_type]').selectOption('group');
    await expect(dialog.locator('[name=material_owner_group]')).toHaveValue(/\d+/);
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    const inventory = await page.request.get('/api/v1/resources/equipment', { headers });
    const rows = (await inventory.json()).data.equipment.filter((row) => row.id === id);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ owner_type: 'group', quantity_total: 7 });
    await expect(page.locator('#app')).toContainText('Groupe scout fictif');
    expect(await axeViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('material-stock.png'), fullPage: true });
    const articlesTab = page.getByRole('tab', { name: 'Tous les articles', exact: true });
    await articlesTab.click();
    await expect(page.locator('.equipment-catalog__item').filter({ hasText: name })).toHaveCount(1);
  } finally { expect((await page.request.delete(`/api/v1/resources/equipment/${id}`, { headers })).status()).toBe(200); }
});

test('one save creates an article and its group stock with zero quantity', async ({ page }, testInfo) => {
  await openScreen(page, '/material?tab=articles');
  await page.locator('#equipment-catalog-create').click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  const name = `Marmite du groupe ${testInfo.project.name} ${Date.now()}`;
  await dialog.locator('[name=catalog_name]').fill(name);
  await dialog.locator('[name=track_stock]').check();
  await dialog.locator('[name=stock_total]').fill('0');
  await dialog.locator('[name=material_owner_type]').selectOption('group');
  expect(await axeViolations(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('material-create-group.png'), fullPage: true });
  await page.locator('button[type=submit][form=equipment-catalog-form]').click();
  await expect(dialog).toHaveCount(0);
  const card = page.locator('.equipment-catalog__item').filter({ hasText: name });
  await expect(card).toHaveCount(1); await expect(card).toContainText('Groupe scout fictif');
  const token = await page.evaluate(() => localStorage.getItem('jwtToken'));
  const headers = { Authorization: `Bearer ${token}` };
  const response = await page.request.get('/api/v1/equipment-catalog', { headers });
  const item = (await response.json()).data.find((row) => row.name === name);
  try {
    const stock = await page.request.get('/api/v1/resources/equipment', { headers });
    expect((await stock.json()).data.equipment.find((row) => row.id === item.equipment_item_id)).toMatchObject({ quantity_total: 0, owner_type: 'group' });
  } finally {
    await page.request.patch(`/api/v1/equipment-catalog/${item.id}`, { headers, data: { archived: true } });
    expect((await page.request.delete(`/api/v1/resources/equipment/${item.equipment_item_id}`, { headers })).status()).toBe(200);
  }
});
