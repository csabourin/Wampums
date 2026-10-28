/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/app.js', () => ({ translate: jest.fn((key) => key) }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/api/api-camp-readiness.js', () => ({ getCampReadiness: jest.fn() }));
import { getCampReadiness } from '../../spa/api/api-camp-readiness.js';
import { CampReadiness, READINESS_LABELS } from '../../spa/modules/camp-readiness/CampReadiness.js';
import { translate } from '../../spa/app.js';
import en from '../../lang/en.json';
import fr from '../../lang/fr.json';
let screen;
const data = () => ({ camp: { id: 3, activity_id: 8, theme: '<img src=x onerror=alert(1)>', date_from: '2026-11-14', date_to: '2026-11-16' }, sections: {
  material: { items: [{ name: 'Tent', quantity: 3, inventory: { status: 'missing' } }], free_text: [], inventory_compared: true },
  permissions: [{ status: 'pending', count: 2, deadline: '2026-11-10' }],
  lots: [{ name: 'Kitchen', status: 'to_prepare', roles: [{ role: 'prepare', name: 'Fictional helper', due_date: '2026-11-14' }] }],
  tasks: [{ title: 'Pack tent', status: 'todo', assignee_name: 'Fictional helper', due_date: '2026-11-14' }],
} });
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); document.body.innerHTML = '<main id="app"></main>';
  translate.mockImplementation((key) => key);
  getCampReadiness.mockResolvedValue({ data: data() }); screen = new CampReadiness({ lang: 'fr' }, { meetingId: 3 });
});
test.each([
  ['fr', 'kg', '2,5 kg', '1\u00a0234'],
  ['en', 'l', '2.5 L', '1,234'],
])('camp quantities and consent counts use the %s locale without adding an equipment unit to counts', async (lang, unit, quantity, count) => {
  const messages = lang === 'fr' ? fr : en;
  translate.mockImplementation((key) => messages[key] || key);
  screen.app.lang = lang;
  const payload = data();
  payload.sections.material.items = [{ name: 'Supplies', quantity: 2.5, unit_of_measure: unit, inventory: { status: 'missing' } }];
  payload.sections.permissions[0].count = 1234;
  getCampReadiness.mockResolvedValue({ data: payload });

  await screen.init();

  const materialRow = document.querySelector('a[href="/camp-material/3"]').closest('li');
  expect(materialRow.querySelector('p').textContent).toContain(quantity);
  const consentRow = document.querySelector('a[href="/permission-slips/8"]').closest('li');
  expect(consentRow.querySelector('p').textContent).toBe(count);
});
afterEach(() => screen.destroy());
test('the team can see camp needs, responsible people and deadlines with working action links', async () => {
  await screen.init();
  expect(document.body.textContent).toContain('Fictional helper'); expect(document.body.textContent).toContain('camp_material_status_missing');
  expect(document.querySelector('a[href="/permission-slips/8"]')).not.toBeNull();
  expect(document.querySelector('a[href="/camp-material/3"]')).not.toBeNull();
  expect(document.querySelector('a[href="/camp-lots/3"]')).not.toBeNull();
  expect(document.body.textContent).toContain('camp_readiness_explanation');
  expect(document.querySelector('img')).toBeNull(); expect(document.body.textContent).toContain('<img');
  expect((await axe.run(document.getElementById('app'), { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
});
test('unauthorized and not yet implemented sections do not appear', async () => {
  const payload = data(); delete payload.sections.permissions; delete payload.sections.lots; delete payload.sections.tasks;
  getCampReadiness.mockResolvedValue({ data: payload }); await screen.init();
  expect(document.querySelector('a[href="/permission-slips/8"]')).toBeNull(); expect(document.querySelector('a[href="/camp-lots/3"]')).toBeNull();
  expect(document.body.textContent).not.toContain('camp_readiness_payments');
});
test('a failed load shows an error with retry, and empty sections do not claim the camp is ready', async () => {
  getCampReadiness.mockRejectedValueOnce(new Error('fictional failure')); await screen.init();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  getCampReadiness.mockResolvedValue({ data: { camp: data().camp, sections: { lots: [] } } });
  document.querySelector('#camp-readiness-retry').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.body.textContent).toContain('camp_readiness_unconfigured');
});
test('leaving the screen while loading does not replace the next page', async () => {
  let release; getCampReadiness.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const loading = screen.init(); screen.destroy(); document.getElementById('app').textContent = 'Next page';
  release({ data: data() }); await loading; expect(document.body.textContent).toBe('Next page');
});
test('all status and section labels exist in French and English', () => {
  for (const key of [...Object.values(READINESS_LABELS), ...['permissions', 'material', 'lots', 'tasks'].map((section) => `camp_readiness_${section}`)]) {
    expect(en[key]).toBeDefined(); expect(fr[key]).toBeDefined();
  }
});
