/**
 * @jest-environment jsdom
 */

/**
 * The finance screens moved out of the spa/ root, held to CLAUDE.md §7.
 *
 * Money is where "nothing here" does the most harm: a load that failed must
 * never read as no fees, no expenses, zero revenue or a balance paid. Each
 * screen shows the way back, a loading state, and on failure an alert with a
 * retry; a refused action reads as a refusal; and a write the server accepted
 * is never reported as failed because the reload after it did not arrive.
 *
 * @module test/spa/FinanceScreens
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { DEFAULT_CURRENCY: 'CAD', DEFAULT_LANG: 'fr', PAYMENTS: { STRIPE_PUBLISHABLE_KEY: '' }, STORAGE_KEYS: {}, UI: {} },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/utils/PerformanceUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/PerformanceUtils.js');
  // One attempt: the screens' retries are not what these tests are about.
  return { ...actual, retryWithBackoff: (load) => load() };
});
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewFinance: () => true,
  canManageFinance: () => true,
  canApproveFinance: () => true,
  canViewBudget: () => true,
  isParent: () => true,
}));
jest.mock('../../spa/indexedDB.js', () => ({
  clearFinanceRelatedCaches: jest.fn(),
  clearBudgetCaches: jest.fn(),
  clearExternalRevenueCaches: jest.fn(),
  deleteCachedData: jest.fn(),
}));
jest.mock('../../spa/modules/AI.js', () => ({ aiParseReceipt: jest.fn() }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirmDestructive: jest.fn() }));
jest.mock('../../spa/ajax-functions.js', () => ({
  getFeeDefinitions: jest.fn(),
  createFeeDefinition: jest.fn(),
  updateFeeDefinition: jest.fn(),
  deleteFeeDefinition: jest.fn(),
  getParticipantFees: jest.fn(),
  createParticipantFee: jest.fn(),
  updateParticipantFee: jest.fn(),
  getParticipantPayments: jest.fn(),
  createParticipantPayment: jest.fn(),
  updatePayment: jest.fn(),
  getPaymentPlans: jest.fn(),
  createPaymentPlan: jest.fn(),
  updatePaymentPlan: jest.fn(),
  deletePaymentPlan: jest.fn(),
  getFinanceReport: jest.fn(),
  getParticipants: jest.fn(),
  getCurrentOrganizationId: () => '1',
  fetchParticipants: jest.fn(),
  getParticipantStatement: jest.fn(),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getBudgetCategories: jest.fn(),
  createBudgetCategory: jest.fn(),
  updateBudgetCategory: jest.fn(),
  deleteBudgetCategory: jest.fn(),
  getBudgetItems: jest.fn(),
  createBudgetItem: jest.fn(),
  updateBudgetItem: jest.fn(),
  deleteBudgetItem: jest.fn(),
  getBudgetExpenses: jest.fn(),
  createBudgetExpense: jest.fn(),
  updateBudgetExpense: jest.fn(),
  deleteBudgetExpense: jest.fn(),
  getBudgetSummaryReport: jest.fn(),
  getBudgetRevenueBreakdown: jest.fn(),
  getBudgetPlans: jest.fn(),
  createBudgetPlan: jest.fn(),
  updateBudgetPlan: jest.fn(),
  deleteBudgetPlan: jest.fn(),
  createExpensesBulk: jest.fn(),
  getExpenseSummary: jest.fn(),
  getExpensesMonthly: jest.fn(),
  getExternalRevenue: jest.fn(),
  createExternalRevenue: jest.fn(),
  updateExternalRevenue: jest.fn(),
  deleteExternalRevenue: jest.fn(),
  getExternalRevenueSummary: jest.fn(),
  getRevenueDashboard: jest.fn(),
  getRevenueBySource: jest.fn(),
  getRevenueByCategory: jest.fn(),
  getRevenueComparison: jest.fn(),
  createStripePaymentIntent: jest.fn(),
  getStripePaymentStatus: jest.fn(),
}));

import * as ajax from '../../spa/ajax-functions.js';
import * as api from '../../spa/api/api-endpoints.js';
import { confirmDestructive } from '../../spa/utils/DialogUtils.js';
import { Finance } from '../../spa/modules/finance/Finance.js';
import { Budgets } from '../../spa/modules/finance/Budgets.js';
import { Expenses } from '../../spa/modules/finance/Expenses.js';
import { ExternalRevenue } from '../../spa/modules/finance/ExternalRevenue.js';
import { RevenueDashboard } from '../../spa/modules/finance/RevenueDashboard.js';
import { ParentFinance } from '../../spa/modules/finance/ParentFinance.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const FORBIDDEN = Object.assign(new Error('Forbidden'), { status: 403 });

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const page = () => document.getElementById('app');

function makeApp() {
  return {
    lang: 'fr',
    showMessage: jest.fn(),
    router: { navigate: jest.fn() },
    organizationSettings: {},
    waitForOrganizationSettings: jest.fn().mockResolvedValue(),
  };
}

/** @returns {Promise<Array>} axe violations inside #app */
async function violations() {
  return (await axe.run(page(), AXE_OPTIONS)).violations;
}

/** A failed load is the error state: way back, title, alert and retry. */
function expectErrorState(title) {
  expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
  expect(page().querySelector('h1').textContent).toBe(title);
  expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_data');
  expect(page().querySelector('#page-retry')).not.toBeNull();
}

/** Every call of an API module mock resolves to `{ success: true, data }`. */
function answer(mock, data) {
  mock.mockResolvedValue({ success: true, data });
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  history.replaceState(null, '', '/');
});

describe('finance centre', () => {
  function loaded() {
    answer(ajax.getParticipantFees, [{
      id: 5, participant_id: 1, first_name: HOSTILE, last_name: 'Roy', fee_definition_id: 2,
      total_amount: 100, total_paid: 40, status: 'partial',
    }]);
    answer(ajax.getFeeDefinitions, [{ id: 2, year_start: '2026-09-01', year_end: '2027-08-31', registration_fee: 50, membership_fee: 50 }]);
    answer(ajax.getParticipants, [{ id: 1, first_name: HOSTILE, last_name: 'Roy' }]);
    answer(ajax.getFinanceReport, { totals: {} });
  }

  test('says it is loading until the fees arrive', async () => {
    loaded();
    const screen = new Finance(makeApp());
    const done = screen.init();

    expect(page().querySelector('[aria-busy="true"] [role="status"]').textContent).toBe('loading');
    await done;
  });

  test('shows names as text and passes axe', async () => {
    loaded();
    await new Finance(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('img')).toBeNull();
    expect(page().textContent).toContain(HOSTILE);
    expect(await violations()).toEqual([]);
  });

  test('a fee list that did not load is an error with a retry, never an empty list', async () => {
    loaded();
    ajax.getParticipantFees.mockRejectedValueOnce(new Error('offline'));
    const screen = new Finance(makeApp());
    await screen.init();

    expectErrorState('finance_center_title');

    page().querySelector('#page-retry').click();
    await flush();
    expect(page().textContent).toContain(HOSTILE);
  });

  test('a refused deletion says it was refused', async () => {
    loaded();
    const app = makeApp();
    const screen = new Finance(app);
    screen.activeTab = 'definitions';
    await screen.init();
    history.replaceState(null, '', '/finance?tab=definitions');
    screen.activeTab = 'definitions';
    screen.render();
    screen.attachEventListeners();
    confirmDestructive.mockResolvedValue(true);
    ajax.deleteFeeDefinition.mockRejectedValue(FORBIDDEN);

    page().querySelector('[data-action="delete-definition"]').click();
    await flush();
    await flush();

    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
  });
});

describe('budgets', () => {
  function loaded() {
    answer(api.getBudgetCategories, [{ id: 1, name: HOSTILE, description: HOSTILE }]);
    answer(api.getBudgetItems, []);
    answer(api.getBudgetExpenses, []);
    answer(api.getBudgetSummaryReport, null);
    answer(api.getBudgetPlans, []);
  }

  test('says which tab is open in words, not by colour, and passes axe', async () => {
    loaded();
    await new Budgets(makeApp()).init();

    const tabs = [...page().querySelectorAll('.tab-btn')];
    expect(tabs.filter((tab) => tab.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(page().querySelector('img')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  test('a budget that did not load is an error with a retry, never an empty budget', async () => {
    loaded();
    api.getBudgetExpenses.mockRejectedValueOnce(new Error('offline'));
    await new Budgets(makeApp()).init();

    expectErrorState('budget_management');
  });

  test('a fiscal year that did not load leaves the selector on the year still shown', async () => {
    loaded();
    const app = makeApp();
    const screen = new Budgets(app);
    await screen.init();
    const select = page().querySelector('#fiscal-year-select');
    const shown = select.value;
    const other = [...select.options].find((option) => option.value !== shown).value;
    api.getBudgetPlans.mockRejectedValueOnce(new Error('offline'));

    select.value = other;
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(select.value).toBe(shown);
    expect(String(screen.selectedFiscalYear)).toBe(shown);
    expect(app.showMessage).toHaveBeenCalledWith('error_loading_data', 'error');
  });
});

describe('expenses', () => {
  function loaded() {
    answer(api.getBudgetCategories, [{ id: 1, name: HOSTILE }]);
    answer(api.getBudgetItems, []);
    answer(api.getBudgetExpenses, [{ id: 9, description: HOSTILE, amount: 12, expense_date: '2026-10-01', budget_category_id: 1 }]);
    answer(api.getExpenseSummary, null);
    answer(api.getExpensesMonthly, []);
  }

  test('shows descriptions as text and passes axe', async () => {
    loaded();
    await new Expenses(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('img')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  test('expenses that did not load are an error with a retry, never an empty list', async () => {
    loaded();
    api.getBudgetExpenses.mockRejectedValueOnce(new Error('offline'));
    await new Expenses(makeApp()).init();

    expectErrorState('expense_tracking');
  });

  test('a refresh that fails keeps the expenses shown and says so', async () => {
    loaded();
    const app = makeApp();
    const screen = new Expenses(app);
    await screen.init();
    api.getBudgetExpenses.mockRejectedValueOnce(new Error('offline'));

    await screen.refreshExpenseData();

    expect(screen.expenses).toHaveLength(1);
    expect(app.showMessage).toHaveBeenCalledWith('error_loading_data', 'error');
  });
});

describe('external revenue', () => {
  function loaded() {
    answer(api.getBudgetCategories, []);
    answer(api.getExternalRevenue, [{ id: 4, description: HOSTILE, amount: 20, revenue_date: '2026-10-01', revenue_type: 'donation' }]);
    answer(api.getExternalRevenueSummary, null);
  }

  test('shows descriptions as text and passes axe', async () => {
    loaded();
    await new ExternalRevenue(makeApp()).init();

    expect(page().querySelector('img')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  test('revenues that did not load are an error with a retry, never an empty list', async () => {
    loaded();
    api.getExternalRevenue.mockRejectedValueOnce(new Error('offline'));
    await new ExternalRevenue(makeApp()).init();

    expectErrorState('external_revenue');
  });

  test('a deletion the server accepted is not reported as failed when the reload after it fails', async () => {
    loaded();
    const app = makeApp();
    const screen = new ExternalRevenue(app);
    await screen.init();
    api.deleteExternalRevenue.mockResolvedValue({ success: true });
    api.getExternalRevenue.mockRejectedValueOnce(new Error('offline'));

    await screen.deleteRevenue(4);

    const messages = app.showMessage.mock.calls.map(([message]) => message);
    expect(messages).toContain('external_revenue_deleted');
    expect(messages).not.toContain('error_deleting_external_revenue');
    expect(messages).toContain('error_loading_data');
  });

  test('a refused deletion says it was refused and keeps the revenue', async () => {
    loaded();
    const app = makeApp();
    const screen = new ExternalRevenue(app);
    await screen.init();
    api.deleteExternalRevenue.mockRejectedValue(FORBIDDEN);

    await screen.deleteRevenue(4);

    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
    expect(screen.revenues).toHaveLength(1);
  });
});

describe('revenue dashboard', () => {
  function loaded() {
    answer(api.getBudgetCategories, []);
    answer(api.getRevenueDashboard, { totals: {} });
    answer(api.getRevenueBySource, []);
    answer(api.getRevenueByCategory, []);
    answer(api.getRevenueComparison, null);
  }

  test('passes axe once loaded', async () => {
    loaded();
    await new RevenueDashboard(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(await violations()).toEqual([]);
  });

  test('revenue that did not load is an error with a retry, never zero', async () => {
    loaded();
    api.getRevenueDashboard.mockRejectedValueOnce(new Error('offline'));
    await new RevenueDashboard(makeApp()).init();

    expectErrorState('revenue_dashboard');
  });
});

describe('a parent\'s finances', () => {
  const CHILDREN = [{ id: 1, first_name: HOSTILE, last_name: 'Roy' }, { id: 2, first_name: 'Ana', last_name: 'Roy' }];
  const statement = (owed) => ({ success: true, data: { totals: { total_billed: 100, total_paid: 100 - owed, total_outstanding: owed }, fees: [] } });

  test('shows each child as text and passes axe', async () => {
    ajax.fetchParticipants.mockResolvedValue(CHILDREN);
    ajax.getParticipantStatement.mockImplementation((id) => Promise.resolve(statement(id === 1 ? 0 : 30)));
    await new ParentFinance(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('h1').textContent).toBe('my_finances');
    expect(page().querySelector('img')).toBeNull();
    expect(page().textContent).toContain(HOSTILE);
    expect(await violations()).toEqual([]);
  });

  test('a statement that did not load is an error, never "paid"', async () => {
    ajax.fetchParticipants.mockResolvedValue(CHILDREN);
    ajax.getParticipantStatement.mockImplementation((id) => (id === 2
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(statement(0))));
    await new ParentFinance(makeApp()).init();

    expect(page().querySelector('.finance-pill')).toBeNull();
    expect(page().querySelector('h1').textContent).toBe('my_finances');
    expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_data');
    expect(page().querySelector('#page-retry')).not.toBeNull();
  });
});
