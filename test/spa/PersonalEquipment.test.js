/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/config.js', () => ({ CONFIG: { TIME_FORMAT: { DEFAULT: '24h' } }, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirm: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ isDemoUser: () => false, hasPermission: () => true, hasOrganizationScope: () => true }));
let mockScope = 'account-a';
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildScopedCacheKey: (key) => `${mockScope}:${key}` }));
jest.mock('../../spa/api/api-personal-equipment.js', () => ({ getPersonalEquipment: jest.fn(), getPersonalEquipmentTasks: jest.fn(), savePersonalEquipment: jest.fn(), translatePersonalEquipment: jest.fn() }));
const { PersonalEquipment } = require('../../spa/modules/personal-equipment/PersonalEquipment.js');
const api = require('../../spa/api/api-personal-equipment.js');
const { packingKey, readPacking, bulkPackingLines } = require('../../spa/modules/personal-equipment/packingStorage.js');
const AXE_OPTIONS = { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } };
const items = [{ key: 'bag', label_fr: '<img src=x>', label_en: 'Bag', quantity: 1 }, { key: 'socks', label_fr: 'Bas', label_en: 'Socks', quantity: 3 }];
const fixture = () => ({ camp: { id: 7, theme: 'Camp', meeting_date: '2026-12-01' }, list: { version: 1, season: 'winter', stay_type: 'tent', nights: 2, notes_fr: '', notes_en: '', published: true, items: structuredClone(items) }, children: [{ id: 2, first_name: 'Léa', last_name: 'Example' }, { id: 3, first_name: 'Alex', last_name: 'Example' }], catalog: [] });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let app;
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); mockScope = 'account-a';
  document.body.innerHTML = '<main id="app"></main>';
  app = { lang: 'fr', showMessage: jest.fn() };
  api.getPersonalEquipment.mockImplementation(() => Promise.resolve({ data: fixture() }));
  api.savePersonalEquipment.mockResolvedValue({ success: true });
});

test('each child keeps separate local checkmarks after reload with no server write', async () => {
  await new PersonalEquipment(app, { meetingId: 7 }).init();
  const checkbox = document.querySelector('[data-child="2"][data-key="bag"]');
  checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  expect(readPacking(packingKey(7, 2)).has('bag')).toBe(true);
  expect(readPacking(packingKey(7, 3)).has('bag')).toBe(false);
  await new PersonalEquipment(app, { meetingId: 7 }).init();
  expect(document.querySelector('[data-child="2"][data-key="bag"]').checked).toBe(true);
  expect(api.savePersonalEquipment).not.toHaveBeenCalled();
  expect(api.translatePersonalEquipment).not.toHaveBeenCalled();
});

test('family checklists escape item text and meet WCAG A and AA', async () => {
  await new PersonalEquipment(app, { meetingId: 7 }).init();
  expect(document.querySelector('#app img')).toBeNull();
  expect(document.body.textContent).toContain('<img src=x>');
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('a parent selects a published translation without any AI call and retains local checkmarks', async () => {
  const data = fixture(); data.translations = { es: { notes: '', items: [{ key: 'bag', label: 'Mochila' }, { key: 'socks', label: 'Calcetines' }] } };
  api.getPersonalEquipment.mockResolvedValue({ data });
  await new PersonalEquipment(app, { meetingId: 7 }).init();
  const checkbox = document.querySelector('[data-child="2"][data-key="bag"]'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  const language = document.getElementById('personal-language'); language.value = 'es'; language.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.getElementById('personal-translate')).toBeNull();
  expect(document.body.textContent).toContain('Mochila');
  expect(document.querySelector('[data-child="2"][data-key="bag"]').checked).toBe(true);
  expect(api.translatePersonalEquipment).not.toHaveBeenCalled();
});

test('new items and changes to labels preserve the keys already checked locally', async () => {
  localStorage.setItem(packingKey(7, 2), JSON.stringify(['bag']));
  const next = fixture(); next.list.version = 2; next.list.items[0].label_fr = 'Nouveau texte'; next.list.items.push({ key: 'hat', label_fr: 'Tuque', label_en: 'Hat', quantity: 1 });
  api.getPersonalEquipment.mockResolvedValue({ data: next });
  await new PersonalEquipment(app, { meetingId: 7 }).init();
  expect(document.querySelector('[data-child="2"][data-key="bag"]').checked).toBe(true);
  expect(document.querySelector('[data-child="2"][data-key="hat"]').checked).toBe(false);
});

test('a multiline addition creates editable rows and allows one authored language', async () => {
  await new PersonalEquipment(app, { meetingId: 7, manage: true }).init();
  document.getElementById('personal-bulk').value = 'Sac étanche\n\n- Tuque';
  document.getElementById('personal-add-bulk').click();
  expect(document.querySelectorAll('[data-item-key]')).toHaveLength(4);
  expect(document.querySelectorAll('[data-field="label_fr"]')[2].value).toBe('Sac étanche');
  const form = document.getElementById('personal-equipment-form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
  expect(api.savePersonalEquipment).toHaveBeenCalledWith(7, expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ label_fr: 'Tuque', label_en: '' })]) }));
});

test('the editor has labelled seasonal, bulk and publication controls with no WCAG violations', async () => {
  await new PersonalEquipment(app, { meetingId: 7, manage: true }).init();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('a storage failure restores the visible checkbox and reports that it was not saved', async () => {
  await new PersonalEquipment(app, { meetingId: 7 }).init();
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
  const checkbox = document.querySelector('[data-child="2"][data-key="bag"]'); checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  expect(checkbox.checked).toBe(false);
  expect(document.body.textContent).toContain('personal_equipment_local_failed'); spy.mockRestore();
});

test('parent views never offer unprepared languages or an AI action', async () => {
  await new PersonalEquipment(app, { meetingId: 7 }).init();
  expect([...document.querySelectorAll('#personal-language option')].map((option) => option.value)).toEqual(['fr', 'en']);
  expect(document.getElementById('personal-translate')).toBeNull();
  expect(document.getElementById('packing-translate-all')).toBeNull();
  expect(api.translatePersonalEquipment).not.toHaveBeenCalled();
});

test('a late list cannot redraw another account or the next screen', async () => {
  let resolve; api.getPersonalEquipment.mockReturnValue(new Promise((done) => { resolve = done; }));
  const screen = new PersonalEquipment(app, { meetingId: 7 }); const pending = screen.init();
  mockScope = 'account-b'; document.getElementById('app').textContent = 'Next account'; resolve({ data: fixture() }); await pending;
  expect(document.getElementById('app').textContent).toBe('Next account');
});

test('bulk lines keep quantities and ignore blanks and pasted list bullets', () => {
  expect(bulkPackingLines('2 paires de bas\r\n\n• Tuque\n1. Gourde')).toEqual(['2 paires de bas', 'Tuque', 'Gourde']);
});


test('activity checkmarks do not collide with another activity or a camp of the same number', () => {
  expect(packingKey('activity-7', 2)).not.toBe(packingKey('activity-8', 2));
  expect(packingKey('activity-7', 2)).not.toBe(packingKey(7, 2));
});

test('opening a camp from its activity retains the camp checkmarks', async () => {
  localStorage.setItem(packingKey(7, 2), JSON.stringify(['bag']));
  api.getPersonalEquipment.mockResolvedValue({ data: { ...fixture(), packing_id: 7 } });
  await new PersonalEquipment(app, { meetingId: 'activity-44' }).init();
  expect(document.querySelector('[data-child="2"][data-key="bag"]').checked).toBe(true);
});


test('saving does not silently discard bulk text awaiting addition', async () => {
  const screen = new PersonalEquipment(app, { meetingId: 7, manage: true }); await screen.init();
  document.getElementById('personal-bulk').value = 'Tuque';
  await screen.save(false);
  expect(api.savePersonalEquipment).not.toHaveBeenCalled();
  expect(document.activeElement.id).toBe('personal-bulk');
  expect(document.body.textContent).toContain('packing_bulk_pending');
  screen.destroy();
});
test('adding suggestions retains personalized items and their stable keys', async () => {
  const screen = new PersonalEquipment(app, { meetingId: 7, manage: true }); await screen.init();
  document.querySelector('[data-item-key="bag"] [data-field="label_fr"]').value = 'Mon sac personnalisé';
  document.getElementById('personal-apply-template').click(); await settle();
  expect(document.querySelector('[data-item-key="bag"] textarea').value).toBe('Mon sac personnalisé');
  screen.destroy();
});
test('invalid items are identified and focused instead of silently failing to save', async () => {
  const screen = new PersonalEquipment(app, { meetingId: 7, manage: true }); await screen.init();
  const field = document.querySelector('[data-field="quantity"]'); field.value = '0';
  await screen.save(false);
  expect(api.savePersonalEquipment).not.toHaveBeenCalled(); expect(document.activeElement).toBe(field);
  expect(field.getAttribute('aria-invalid')).toBe('true'); screen.destroy();
});
test('an editor with unsaved changes protects navigation and prepares translations in one action', async () => {
  const screen = new PersonalEquipment(app, { meetingId: 7, manage: true }); await screen.init();
  const field = document.querySelector('[data-field="label_fr"]'); field.value = 'Sac'; field.dispatchEvent(new Event('input', { bubbles: true }));
  expect(screen.dirty).toBe(true); expect(screen.beforeLeave({ refresh: true })).toBe(false);
  screen.dirty = false;
  api.translatePersonalEquipment.mockResolvedValue({ data: { notes: '', items } });
  await screen.translateAll();
  // The list is written in French: English is suggested, French is not offered at all.
  expect(api.translatePersonalEquipment.mock.calls.map((args) => args[1])).toEqual(['en']);
  expect(document.querySelector('[data-language="fr"]')).toBeNull();
  expect(document.getElementById('packing-translate-all').textContent).toContain('ai_label');
  screen.destroy();
});


test('the bulk preview shows parsed quantities before any rows are added', async () => {
  const screen = new PersonalEquipment(app, { meetingId: 7, manage: true }); await screen.init();
  const bulk = document.getElementById('personal-bulk'); bulk.value = '2 paires de bas\nTuque';
  bulk.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.getElementById('packing-bulk-preview').textContent).toContain('2 × paires de bas');
  expect(document.querySelectorAll('[data-item-key]')).toHaveLength(2);
  document.getElementById('personal-add-bulk').click();
  expect(document.querySelectorAll('[data-item-key]')).toHaveLength(4);
  const row = document.querySelectorAll('[data-item-key]')[2];
  expect(row.querySelector('[data-field="quantity"]').value).toBe('2');
  expect(row.querySelector('[data-field="label_fr"]').value).toBe('paires de bas');
  screen.destroy();
});


test('declining the discard prompt keeps unsaved translation corrections open', async () => {
  const { confirm } = require('../../spa/utils/DialogUtils.js');
  const screen = new PersonalEquipment(app, { meetingId: 7, manage: true }); await screen.init();
  screen.translations.set('es', { notes: 'Original', items: [{ key: 'bag', label: 'Saco' }, { key: 'socks', label: 'Calcetines' }] });
  await screen.editTranslation('es');
  const overlay = screen.modal.overlay;
  const notes = overlay.querySelector('textarea'); notes.value = 'Correction à conserver'; notes.dispatchEvent(new Event('input', { bubbles: true }));
  confirm.mockResolvedValueOnce(false);
  overlay.querySelector('[data-modal-close]').click(); await settle();
  expect(overlay.isConnected).toBe(true); expect(notes.value).toBe('Correction à conserver');
  confirm.mockResolvedValueOnce(true);
  overlay.querySelector('[data-modal-close]').click(); await settle();
  expect(overlay.isConnected).toBe(false); screen.destroy();
});

describe('translations and publication status in the editor', () => {
  const prepared = () => {
    const data = fixture();
    data.translations = { es: { notes: '', items: [{ key: 'bag', label: 'Mochila' }, { key: 'socks', label: 'Calcetines' }] },
      de: { notes: '', items: [{ key: 'bag', label: 'Rucksack' }], partial: true } };
    data.publication = { published_at: '2026-10-20T14:00:00Z', version: 1 };
    return data;
  };
  test('fixing an item label keeps the prepared translations on screen', async () => {
    api.getPersonalEquipment.mockResolvedValue({ data: prepared() });
    await new PersonalEquipment(app, { meetingId: 7, manage: true }).init();
    const label = document.querySelector('[data-item-key="socks"] textarea');
    label.value = 'Bas de laine'; label.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('packing-translation-preview').textContent).toContain('Calcetines');
    expect(document.getElementById('packing-translation-status').textContent).toBe('packing_translations_stale');
  });
  test('a partly translated language says what is left and cannot be edited by hand', async () => {
    api.getPersonalEquipment.mockResolvedValue({ data: prepared() });
    await new PersonalEquipment(app, { meetingId: 7, manage: true }).init();
    expect(document.getElementById('packing-translation-preview').textContent).toContain('packing_translation_partial');
    expect(document.querySelector('[data-edit-translation="de"]')).toBeNull();
    expect(document.querySelector('[data-edit-translation="es"]')).not.toBeNull();
  });
  test('translating again requests only languages that are missing something', async () => {
    jest.spyOn(require('../../spa/utils/AIUtils.js'), 'canUseAI').mockReturnValue(true);
    api.getPersonalEquipment.mockResolvedValue({ data: prepared() });
    api.translatePersonalEquipment.mockResolvedValue({ data: { notes: '', items: [{ key: 'bag', label: 'Rucksack' }, { key: 'socks', label: 'Socken' }] } });
    await new PersonalEquipment(app, { meetingId: 7, manage: true }).init();
    document.querySelectorAll('[data-language]').forEach((box) => { box.checked = ['es', 'de'].includes(box.dataset.language); });
    document.getElementById('packing-translate-all').click(); await settle(); await settle();
    expect(api.translatePersonalEquipment.mock.calls).toEqual([[7, 'de']]);
  });
  test('staff see whether families have the current version', async () => {
    const published = prepared();
    api.getPersonalEquipment.mockResolvedValue({ data: published });
    await new PersonalEquipment(app, { meetingId: 7, manage: true }).init();
    expect(document.getElementById('packing-publication-status').textContent).toBe('packing_status_published');
    const pending = prepared(); pending.list.published = false;
    api.getPersonalEquipment.mockResolvedValue({ data: pending });
    await new PersonalEquipment(app, { meetingId: 7, manage: true }).init();
    expect(document.getElementById('packing-publication-status').textContent).toBe('packing_status_changes_pending');
    expect(document.querySelector('button[value="publish"]').textContent).toBe('packing_publish_changes');
    const never = fixture(); never.list.published = false;
    api.getPersonalEquipment.mockResolvedValue({ data: never });
    await new PersonalEquipment(app, { meetingId: 7, manage: true }).init();
    expect(document.getElementById('packing-publication-status').textContent).toBe('packing_status_never_published');
  });
  test('families are offered only complete translations', async () => {
    api.getPersonalEquipment.mockResolvedValue({ data: prepared() });
    await new PersonalEquipment(app, { meetingId: 7 }).init();
    const offered = [...document.querySelectorAll('#personal-language option')].map((option) => option.value);
    expect(offered).toContain('es'); expect(offered).not.toContain('de');
  });
});

describe('editing items in compact rows', () => {
  const editor = async () => { const screen = new PersonalEquipment(app, { meetingId: 7, manage: true }); await screen.init(); return screen; };
  test('items are grouped under translated category headings', async () => {
    const screen = await editor();
    const headings = [...document.querySelectorAll('.packing-group h3')].map((heading) => heading.textContent);
    expect(headings).toEqual(['packing_category_clothing', 'packing_category_other']);
    screen.destroy();
  });
  test('the options button reveals category, catalogue, order and removal, and reports its state', async () => {
    const screen = await editor();
    const toggle = document.querySelector('[data-item-key="bag"] [data-toggle-panel]');
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(panel.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true'); expect(panel.hidden).toBe(false);
    expect(panel.querySelector('[data-field="category"]')).not.toBeNull();
    expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
    screen.destroy();
  });
  test('moving an item down keeps focus on the button used and saves the new order', async () => {
    const data = fixture(); data.list.items = [
      { key: 'a', label_fr: 'Premier', label_en: '', quantity: 1, category: 'gear' },
      { key: 'b', label_fr: 'Deuxième', label_en: '', quantity: 1, category: 'gear' },
      { key: 'c', label_fr: 'Troisième', label_en: '', quantity: 1, category: 'gear' }];
    api.getPersonalEquipment.mockResolvedValue({ data });
    const screen = await editor();
    document.querySelector('[data-item-key="a"] [data-toggle-panel]').click();
    document.querySelector('[data-item-key="a"] [data-move="1"]').click();
    expect([...document.querySelectorAll('[data-item-key]')].map((row) => row.dataset.itemKey)).toEqual(['b', 'a', 'c']);
    expect(document.activeElement).toBe(document.querySelector('[data-item-key="a"] [data-move="1"]'));
    document.activeElement.click();
    expect(document.querySelector('[data-item-key="a"] [data-move="1"]').disabled).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[data-item-key="a"] [data-move="-1"]'));
    document.getElementById('personal-equipment-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
    expect(api.savePersonalEquipment.mock.calls[0][1].items.map((item) => item.key)).toEqual(['b', 'c', 'a']);
    screen.destroy();
  });
  test('changing an item\'s category moves it to that group and is saved', async () => {
    const screen = await editor();
    const select = document.querySelector('[data-item-key="bag"] [data-field="category"]');
    select.value = 'sleep'; select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.querySelector('[data-item-key="bag"]').closest('.packing-group').querySelector('h3').textContent).toBe('packing_category_sleep');
    expect(document.activeElement).toBe(document.querySelector('[data-item-key="bag"] [data-field="category"]'));
    document.getElementById('personal-equipment-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
    expect(api.savePersonalEquipment.mock.calls[0][1].items.find((item) => item.key === 'bag').category).toBe('sleep');
    screen.destroy();
  });
  test('pasting a list is one visible button away and its panel reports whether it is open', async () => {
    const screen = await editor();
    const toggle = document.getElementById('packing-bulk-toggle');
    expect(document.getElementById('packing-bulk-panel').hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement.id).toBe('personal-bulk');
    screen.destroy();
  });
  test('the preview shows the family view with categories and checkboxes', async () => {
    const screen = await editor();
    document.getElementById('packing-preview').click();
    const dialog = screen.modal.overlay;
    expect(dialog.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(dialog.textContent).toContain('packing_category_clothing');
    expect(dialog.querySelector('img')).toBeNull();
    screen.destroy();
  });
  test('a new list opens on its season, stay and nights', async () => {
    const data = fixture(); data.list = null;
    api.getPersonalEquipment.mockResolvedValue({ data });
    const screen = await editor();
    expect(document.querySelector('.packing-context').open).toBe(true);
    screen.destroy();
  });
});

describe('a family packing for several children', () => {
  test('each child shows how much is packed, updated as items are ticked', async () => {
    await new PersonalEquipment(app, { meetingId: 7 }).init();
    const section = document.querySelector('[data-child-section="2"]');
    expect(section.querySelector('progress').value).toBe(0);
    const box = section.querySelector('[data-key="bag"]'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(section.querySelector('progress').value).toBe(1);
    expect(document.querySelector('[data-child-section="3"] progress').value).toBe(0);
    expect(section.querySelector('[data-all-packed]').hidden).toBe(true);
    const socks = section.querySelector('[data-key="socks"]'); socks.checked = true; socks.dispatchEvent(new Event('change', { bubbles: true }));
    expect(section.querySelector('[data-all-packed]').hidden).toBe(false);
  });
  test('ticking an item announces nothing unless the device refuses to keep it', async () => {
    await new PersonalEquipment(app, { meetingId: 7 }).init();
    expect(document.querySelectorAll('#app [role="status"]')).toHaveLength(1);
    const box = document.querySelector('[data-child="2"][data-key="bag"]'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('personal-equipment-storage-status').textContent).toBe('');
  });
  test('hiding packed items is remembered on this device and keeps the ticked item while it has focus', async () => {
    await new PersonalEquipment(app, { meetingId: 7 }).init();
    const hide = document.getElementById('personal-hide-packed'); hide.checked = true; hide.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.querySelector('.personal-equipment').classList.contains('personal-equipment--hide-packed')).toBe(true);
    const box = document.querySelector('[data-child="2"][data-key="bag"]'); box.focus(); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(box.closest('li').classList.contains('is-packed')).toBe(true);
    expect(document.activeElement).toBe(box);
    await new PersonalEquipment(app, { meetingId: 7 }).init();
    expect(document.getElementById('personal-hide-packed').checked).toBe(true);
  });
  test('the family view with progress and categories meets WCAG A and AA', async () => {
    await new PersonalEquipment(app, { meetingId: 7 }).init();
    expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
  });
});

test('a hand-corrected English translation is what families read, even where English was authored', async () => {
  const data = fixture();
  data.translations = { en: { notes: '', items: [{ key: 'bag', label: 'Sleeping bag (labelled)' }, { key: 'socks', label: 'Socks' }] } };
  api.getPersonalEquipment.mockResolvedValue({ data });
  await new PersonalEquipment({ ...app, lang: 'en' }, { meetingId: 7 }).init();
  const language = document.getElementById('personal-language'); language.value = 'en'; language.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.body.textContent).toContain('Sleeping bag (labelled)');
});

test('text waiting in the bulk area survives moving an item or changing its category', async () => {
  const screen = new PersonalEquipment(app, { meetingId: 7, manage: true }); await screen.init();
  document.getElementById('packing-bulk-toggle').click();
  const bulk = document.getElementById('personal-bulk'); bulk.value = 'Tuque\nGourde'; bulk.dispatchEvent(new Event('input', { bubbles: true }));
  const select = document.querySelector('[data-item-key="bag"] [data-field="category"]');
  select.value = 'sleep'; select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.getElementById('personal-bulk').value).toBe('Tuque\nGourde');
  expect(document.getElementById('packing-bulk-panel').hidden).toBe(false);
  await screen.save(false);
  expect(api.savePersonalEquipment).not.toHaveBeenCalled();
  screen.destroy();
});
