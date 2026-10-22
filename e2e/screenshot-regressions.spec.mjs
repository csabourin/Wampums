/** Layout regressions visible in landing/images/screenshots, in both languages. */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, storageStateFor, openScreen, axeViolations } from './helpers.mjs';

for (const lang of ['en', 'fr']) {
  test.describe(`${lang} screenshot regressions`, () => {
    test.use({ storageState: storageStateFor(ACCOUNTS.admin) });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem('lang', language), lang);
    });

    test('the skip link stays fully offscreen until reached by keyboard', async ({ page }) => {
      await openScreen(page, '/attendance');
      const hidden = await page.locator('.skip-link').boundingBox();
      expect(hidden.y + hidden.height).toBeLessThanOrEqual(0);
      await page.locator('body').focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('.skip-link')).toBeFocused();
      const shown = await page.locator('.skip-link').boundingBox();
      expect(shown.y).toBeGreaterThanOrEqual(0);
      await page.keyboard.press('Enter');
      await expect(page.locator('#app h1')).toBeFocused();
    });

    test('fee amounts keep readable labels and every finance tab fits', async ({ page }) => {
      await openScreen(page, '/finance');
      // A populated card exercises mobile stacking even on an otherwise empty unit.
      await page.evaluate(() => {
        const screen = window.app.router.currentModuleInstance;
        screen.participantFees = [{
          id: 1, first_name: 'Alice', last_name: 'Boucher', total_amount: 200,
          total_paid: 100, status: 'partial', fee_definition_id: 1,
        }];
        screen.feeDefinitions = [{ id: 1, year_start: '2026-09-01', year_end: '2027-08-31' }];
        screen.render();
      });
      const tabBoxes = await page.locator('.finance-tab').evaluateAll((tabs) => tabs.map((tab) => {
        const { x, width } = tab.getBoundingClientRect();
        return { x, width };
      }));
      for (const box of tabBoxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
      }
      const search = await page.locator('#finance-search').boundingBox();
      const heading = await page.locator('.finance-section-header h2').boundingBox();
      expect(search.y >= heading.y + heading.height || search.x >= heading.x + heading.width).toBe(true);
      const labelsFit = await page.locator('.mobile-labeled-table td').evaluateAll((cells) => cells.every((cell) => {
        if (!cell.dataset.label) { return false; }
        if (innerWidth > 600) { return true; }
        const style = getComputedStyle(cell, '::before');
        return style.position === 'static' && cell.scrollWidth <= cell.clientWidth;
      }));
      expect(labelsFit).toBe(true);
      expect(await axeViolations(page)).toEqual([]);
    });

    test('inventory keeps quantity, value and editing actions on a phone', async ({ page }) => {
      await openScreen(page, '/inventory');
      await page.evaluate(() => {
        const screen = window.app.router.currentModuleInstance;
        screen.equipment = [{ id: 1, name: 'Tente 4 places', category: 'Camping', quantity_total: 2, item_value: 120 }];
        screen.viewMode = 'table';
        screen.render();
      });
      const cells = page.locator('.mobile-labeled-table tbody tr').first().locator('td');
      await expect(cells.nth(4)).toBeVisible();
      await expect(cells.nth(5)).toBeVisible();
      await expect(cells.nth(6).locator('button')).toHaveCount(2);
      await expect(cells.nth(6).locator('button').first()).toBeVisible();
      const readable = await page.locator('.view-toggle-btn').evaluateAll((buttons) => buttons.every((button) => {
        const style = getComputedStyle(button);
        return style.color !== 'rgb(255, 255, 255)' && button.clientHeight >= 44;
      }));
      expect(readable).toBe(true);
      expect(await axeViolations(page)).toEqual([]);
    });

    test('badge search text clears its icon', async ({ page }) => {
      await openScreen(page, '/progression');
      const spacing = await page.locator('input.badge-tracker__search-input').evaluate((input) => {
        const icon = input.parentElement.querySelector('.badge-tracker__search-icon').getBoundingClientRect();
        const box = input.getBoundingClientRect();
        const style = getComputedStyle(input);
        return box.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) - icon.right;
      });
      expect(spacing).toBeGreaterThan(0);
    });

    test('attendance status and date remain readable beside a long leader label', async ({ page }) => {
      await openScreen(page, '/attendance');
      await page.locator('.participant-row').first().evaluate((row, language) => {
        row.querySelector('.participant-name').textContent = 'Chloé Lavoie — Second pisteur';
        const status = row.querySelector('.participant-status');
        status.textContent = language === 'fr' ? 'En retard' : 'Present';
      }, lang);
      expect(await page.locator('.participant-status').first().evaluate((status) => {
        const style = getComputedStyle(status);
        return getComputedStyle(status).whiteSpace === 'nowrap'
          && status.clientWidth >= status.scrollWidth
          && parseFloat(style.lineHeight) * 2 > status.clientHeight;
      })).toBe(true);
      expect(await page.locator('#dateSelect').evaluate((select) => {
        const style = getComputedStyle(select);
        const context = document.createElement('canvas').getContext('2d');
        context.font = style.font;
        const textWidth = context.measureText(select.selectedOptions[0].textContent.trim()).width;
        return textWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 24 <= select.clientWidth;
      })).toBe(true);
    });

    test('reward labels and their point values stay inside their buttons', async ({ page }) => {
      await openScreen(page, '/manage-points');
      expect(await page.locator('.point-split-action__main').evaluateAll((buttons) => buttons.every((button) => {
        const box = button.getBoundingClientRect();
        return [...button.children].every((child) => {
          const content = child.getBoundingClientRect();
          return content.left >= box.left && content.right <= box.right && content.bottom <= box.bottom;
        });
      }))).toBe(true);
      await page.locator('.list-item').first().hover();
      await page.locator('.list-item').first().evaluate(async (row) => {
        await Promise.all(row.getAnimations({ subtree: true }).map((animation) => animation.finished));
      });
      expect(await axeViolations(page)).toEqual([]);
    });

    test('offline status stays above content and clear of the attendance actions', async ({ page }) => {
      await openScreen(page, '/attendance');
      await page.context().setOffline(true);
      const banner = page.locator('.offline-indicator');
      await expect(banner).toHaveClass(/visible/);
      const status = await banner.boundingBox();
      const content = await page.locator('#app').boundingBox();
      expect(status.y + status.height).toBeLessThanOrEqual(content.y);
      const actions = await page.locator('.status-buttons').boundingBox();
      expect(status.y + status.height).toBeLessThan(actions.y);
      await expect(page.locator('.toast-info')).toHaveCount(0);
      await page.context().setOffline(false);
    });
  });
}

test.describe('family overview', () => {
  test.use({ storageState: storageStateFor(ACCOUNTS.parent) });
  test('child forms precede general actions and the settings control clears the greeting', async ({ page }) => {
    await openScreen(page, '/parent-dashboard');
    const children = await page.locator('.parent-dashboard__participants').boundingBox();
    const actions = await page.locator('.parent-dashboard__actions').boundingBox();
    expect(children.y).toBeLessThan(actions.y);
    const heading = await page.locator('h1').boundingBox();
    const settings = await page.locator('#global-settings-icon').boundingBox();
    expect(settings.y + settings.height).toBeLessThanOrEqual(heading.y);
  });
});
