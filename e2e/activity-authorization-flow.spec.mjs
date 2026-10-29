/** One activity form reaches an honest, durable permission result on phone and desktop. */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, storageStateFor, openScreen, axeViolations } from './helpers.mjs';
test.use({ storageState: storageStateFor(ACCOUNTS.admin) });

const ID = 2000000001;
const ACTIVITY = {
  id: ID, name: 'Soirée des lanternes', invites_everyone: true, authorization_required: true, transport_required: false,
  activity_start_date: '2026-11-20', activity_end_date: '2026-11-20', activity_date: '2026-11-20',
  activity_start_time: '18:30', activity_end_time: '20:30', meeting_location_going: 'Salle fictive',
  authorization_text: 'J’autorise mon enfant à participer à la soirée.',
};
const RESULT = { state: 'sent', participants: 2, requests: 2, to_create: 0, addresses: 3, sent: 3, failed: 0, unknown: 0, unsent: 0, missing: [], problems: [], signed: 0, declined: 0, pending: 2 };

async function installMocks(page, outcome) {
  const writes = { activities: [], sends: 0 };
  let result = { ...RESULT, state: 'not_created', requests: 0, to_create: 2, sent: 0, unsent: 3 };
  await page.route(/\/api\/v1\/activity-authorizations\/preview(?:\?.*)?$/, (route) => route.fulfill({ json: { success: true, data: { participants: 2, addresses: 3, missing: [] } } }));
  await page.route(new RegExp(`/api/v1/activity-authorizations/${ID}(?:\\?.*)?$`), (route) => {
    if (route.request().method() === 'POST') {
      writes.sends++;
      if (outcome === 'lost') {return route.abort('failed');}
      result = outcome === 'partial' ? { ...RESULT, state: 'incomplete', sent: 2, failed: 1,
        problems: [{ participant_id: 2, first_name: 'Ada', last_name: 'Fictive', email: 'adult@example.test', status: 'failed' }] } : RESULT;
    }
    return route.fulfill({ json: { success: true, data: result } });
  });
  await page.route(/\/api\/v1\/activities(?:\?.*)?$/, (route) => {
    if (route.request().method() !== 'POST') {return route.continue();}
    writes.activities.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, data: ACTIVITY } });
  });
  await page.route(new RegExp(`/api/v1/activities/${ID}(?:\\?.*)?$`), (route) => route.fulfill({ json: { success: true, data: ACTIVITY } }));
  return writes;
}
async function openForm(page) {
  await openScreen(page, '/permission-slips');
  await page.locator('#createActivityBtn').click();
  const form = page.locator('#activity-form');
  await expect(form.locator('#activity-authorization-required')).toBeChecked();
  await form.locator('#activity-name').fill(ACTIVITY.name);
  await form.locator('#activity-start-date').fill(ACTIVITY.activity_start_date);
  await form.locator('#activity-end-date').fill(ACTIVITY.activity_end_date);
  await form.locator('#activity-start-time').fill(ACTIVITY.activity_start_time);
  await form.locator('#activity-end-time').fill(ACTIVITY.activity_end_time);
  await form.locator('#meeting-location-going').fill(ACTIVITY.meeting_location_going);
  await form.locator('#activity-authorization-text').fill(ACTIVITY.authorization_text);
  await expect(form.locator('#activity-authorization-audience')).toContainText('2 jeunes');
  return form;
}

test('one form creates the activity and sends its permission requests without selecting the children twice', async ({ page }, testInfo) => {
  const writes = await installMocks(page, 'success');
  const form = await openForm(page);
  await testInfo.attach('activity-permission-form', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  expect(await axeViolations(page)).toEqual([]);
  await expect(form.locator('#activity-transport-fields')).toBeHidden();
  await expect(form.locator('#groupSelect')).toHaveCount(0);
  await form.locator('[data-activity-send]').click();
  await expect(page).toHaveURL(new RegExp(`/permission-slips/${ID}$`));
  await expect(page.locator('#activity-authorization-panel')).toContainText('Demandes envoyées aux parents');
  expect(writes.activities).toHaveLength(1);
  expect(writes.activities[0]).toMatchObject({ invites_everyone: true, authorization_required: true, transport_required: false });
  expect(writes.sends).toBe(1);
  expect(await axeViolations(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('saving without sending shows that no request has been sent', async ({ page }) => {
  const writes = await installMocks(page, 'success');
  const form = await openForm(page);
  await form.locator('[data-activity-save]').click();
  await expect(page.locator('#activity-authorization-panel')).toContainText('Demandes à créer et envoyer');
  expect(writes.activities).toHaveLength(1);
  expect(writes.sends).toBe(0);
});

test('pressing Enter in an activity field saves without sending to families', async ({ page }) => {
  const writes = await installMocks(page, 'success');
  const form = await openForm(page);
  await form.locator('#activity-name').press('Enter');
  await expect(page.locator('#activity-authorization-panel')).toContainText('Demandes à créer et envoyer');
  expect(writes.activities).toHaveLength(1);
  expect(writes.sends).toBe(0);
});

for (const outcome of ['partial', 'lost']) {
  test(`a ${outcome} sending result preserves the activity and consent text`, async ({ page }) => {
    const writes = await installMocks(page, outcome);
    const form = await openForm(page);
    await form.locator('[data-activity-send]').click();
    const feedback = form.locator('#activity-save-result');
    await expect(feedback).toContainText(outcome === 'partial' ? 'Envoi incomplet' : 'n’a pas pu être confirmé');
    await expect(feedback).toBeFocused();
    await expect(feedback).toBeInViewport();
    await expect(form.locator('#activity-authorization-text')).toHaveValue(ACTIVITY.authorization_text);
    await expect(feedback.locator('a')).toHaveAttribute('href', `/permission-slips/${ID}`);
    expect(writes.activities).toHaveLength(1);
    expect(writes.sends).toBe(1);
    expect(await axeViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (outcome === 'partial') {
      await feedback.locator('a').click();
      await expect(page.locator('#activity-authorization-panel')).toContainText('Envoi incomplet');
      await page.reload();
      await expect(page.locator('#activity-authorization-panel')).toContainText('En échec : 1');
    }
  });
}

test('previewing the email and consent text creates no requests and sends nothing', async ({ page }) => {
  const writes = await installMocks(page, 'success');
  const form = await openForm(page);
  await form.locator('#activity-authorization-preview').click();
  const preview = page.locator('#activity-authorization-preview-modal');
  await expect(preview).toContainText(ACTIVITY.authorization_text);
  await expect(preview).toContainText('Aperçu seulement');
  expect(writes.activities).toHaveLength(0);
  expect(writes.sends).toBe(0);
  await preview.evaluate(async (overlay) => {
    await Promise.all(overlay.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  expect(await axeViolations(page)).toEqual([]);
});

test('creating a one-day activity opens its packing list without a planner camp or authorization send', async ({ page }, testInfo) => {
  const writes = await installMocks(page, 'success');
  await page.route(new RegExp(`/api/v1/personal-equipment/activities/${ID}/manage(?:\\?.*)?$`), (route) => route.fulfill({ json: {
    success: true, data: { camp: { id: ID, activity_id: ID, theme: ACTIVITY.name, meeting_date: ACTIVITY.activity_date, is_cancelled: false },
      packing_id: `activity-${ID}`, list: null, catalog: [] },
  } }));
  const form = await openForm(page);
  await expect(form.getByRole('button', { name: 'Enregistrer et préparer les effets personnels' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await form.getByRole('button', { name: 'Enregistrer et préparer les effets personnels' }).click();
  await expect(page).toHaveURL(new RegExp(`/personal-equipment/activity-${ID}/manage$`));
  await expect(page.locator('.packing-bulk > summary')).toBeVisible();
  expect(writes.activities).toHaveLength(1);
  expect(writes.sends).toBe(0);
  expect(await axeViolations(page)).toEqual([]);
  await testInfo.attach('activity-packing-editor', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
