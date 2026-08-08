/**
 * @jest-environment jsdom
 *
 * Budget overview and the budget vs actual comparison.
 *
 * Reported problems covered here:
 *   * the overview collapsed to a greyed-out "no data" placeholder instead of
 *     rendering an active table;
 *   * headers and value cells disagreed on alignment;
 *   * the comparison showed only two of the three series it reports on, and a
 *     zero value could be dropped because it is falsy.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
}));

jest.mock('../../spa/utils/SecurityUtils.js', () => ({
  escapeHTML: (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'),
}));

jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDateShort: (date) => `DATE(${date})`,
  getTodayISO: () => '2026-08-08',
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({ canViewBudget: () => true }));
jest.mock('../../spa/indexedDB.js', () => ({ clearBudgetCaches: jest.fn() }));
jest.mock('../../spa/api/api-endpoints.js', () => new Proxy({}, {
  get: () => jest.fn().mockResolvedValue({ data: [] }),
}));

import { Budgets } from '../../spa/budgets.js';

/**
 * @returns {Budgets} A budgets module bound to a stub app
 */
function createBudgets() {
  return new Budgets({ lang: 'fr', router: { navigate: jest.fn() }, showMessage: jest.fn() });
}

/**
 * Parse an HTML fragment into a document fragment for structural assertions.
 * @param {string} html - HTML fragment
 * @returns {Document} Parsed document
 */
function parse(html) {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

describe('overview tab', () => {
  test('renders an active table with data instead of a placeholder', () => {
    const budgets = createBudgets();
    budgets.summaryReport = {
      categories: [
        { category_name: 'Camps', total_revenue: 1200, total_expense: 800, net_amount: 400 },
        { category_name: 'Matériel', total_revenue: 0, total_expense: 250, net_amount: -250 },
      ],
      totals: { total_revenue: 1200, total_expense: 1050, net_amount: 150 },
    };

    const doc = parse(budgets.renderOverview());

    expect(doc.querySelector('.no-data')).toBeNull();
    expect(doc.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(doc.querySelector('tfoot')).not.toBeNull();
    expect(doc.body.textContent).toContain('Camps');
    expect(doc.body.textContent).toContain('Matériel');
  });

  test('keeps the table active when the fiscal year has no movements yet', () => {
    const budgets = createBudgets();
    budgets.summaryReport = { categories: [], totals: { total_revenue: 0, total_expense: 0, net_amount: 0 } };

    const doc = parse(budgets.renderOverview());

    // Header, totals row and an inline empty message — not a greyed-out block
    // replacing the whole tab.
    expect(doc.querySelectorAll('thead th')).toHaveLength(4);
    expect(doc.querySelector('tfoot')).not.toBeNull();
    expect(doc.querySelector('.empty-row')).not.toBeNull();
  });

  test('distinguishes a failed load from an empty fiscal year', () => {
    const budgets = createBudgets();
    budgets.summaryReport = null;

    const doc = parse(budgets.renderOverview());

    expect(doc.querySelector('.empty-row').textContent).toContain('error_loading_data');
  });

  test('every numeric header and its cells share the same alignment class', () => {
    const budgets = createBudgets();
    budgets.summaryReport = {
      categories: [{ category_name: 'Camps', total_revenue: 1200, total_expense: 800, net_amount: 400 }],
      totals: { total_revenue: 1200, total_expense: 800, net_amount: 400 },
    };

    const doc = parse(budgets.renderOverview());
    const headers = [...doc.querySelectorAll('thead th')];
    const bodyCells = [...doc.querySelectorAll('tbody tr:first-child > *')];
    const footCells = [...doc.querySelectorAll('tfoot tr > *')];

    expect(bodyCells).toHaveLength(headers.length);
    expect(footCells).toHaveLength(headers.length);

    headers.forEach((header, index) => {
      const rightAligned = header.classList.contains('text-right');
      expect(bodyCells[index].classList.contains('text-right')).toBe(rightAligned);
      expect(footCells[index].classList.contains('text-right')).toBe(rightAligned);
    });
  });

  test('the table sits in a scroll container so narrow screens do not break the layout', () => {
    const budgets = createBudgets();
    budgets.summaryReport = { categories: [], totals: {} };

    const doc = parse(budgets.renderOverview());
    expect(doc.querySelector('.table-scroll table')).not.toBeNull();
  });

  test('summary cards render even before the summary report loads', () => {
    const budgets = createBudgets();
    budgets.summaryReport = null;

    const doc = parse(budgets.renderSummaryCards());
    expect(doc.querySelectorAll('.summary-card')).toHaveLength(3);
  });
});

describe('budget vs actual', () => {
  /**
   * @param {Object} [overrides] - Summary/plan overrides
   * @returns {Budgets} Budgets module with planning data loaded
   */
  function withPlans(overrides = {}) {
    const budgets = createBudgets();
    budgets.budgetPlans = overrides.budgetPlans || [
      { budgeted_revenue: 1000, budgeted_expense: 600 },
      { budgeted_revenue: 500, budgeted_expense: 400 },
    ];
    budgets.summaryReport = overrides.summaryReport || {
      categories: [],
      totals: { total_revenue: 1400, total_expense: 900, net_amount: 500 },
    };
    return budgets;
  }

  test('shows all three series: revenue, expenses and net position', () => {
    const doc = parse(withPlans().renderBudgetVsActual());
    const rowLabels = [...doc.querySelectorAll('tbody tr th')].map((th) => th.textContent.trim());

    expect(rowLabels).toEqual(['revenue', 'expenses', 'net_position']);
  });

  test('each series is distinguishable by its own row header', () => {
    const doc = parse(withPlans().renderBudgetVsActual());

    doc.querySelectorAll('tbody tr th').forEach((th) => {
      expect(th.getAttribute('scope')).toBe('row');
    });
  });

  test('a net position of exactly 0 is still displayed', () => {
    const budgets = withPlans({
      summaryReport: { categories: [], totals: { total_revenue: 900, total_expense: 900, net_amount: 0 } },
    });

    const doc = parse(budgets.renderBudgetVsActual());
    const netRow = [...doc.querySelectorAll('tbody tr')].at(-1);

    expect(netRow.textContent).toContain('net_position');
    // 0 must not be treated as "missing" and fall back to something else.
    expect(netRow.querySelectorAll('td')[1].textContent).toMatch(/0[.,]00/);
  });

  test('figures match the underlying budget data', () => {
    const doc = parse(withPlans().renderBudgetVsActual());
    const rows = [...doc.querySelectorAll('tbody tr')];

    // Planned revenue 1000 + 500 = 1500, actual 1400.
    expect(rows[0].querySelectorAll('td')[0].textContent).toMatch(/1[\s,. ]?500/);
    expect(rows[0].querySelectorAll('td')[1].textContent).toMatch(/1[\s,. ]?400/);
    // Planned net 1500 - 1000 = 500, actual net 500.
    expect(rows[2].querySelectorAll('td')[0].textContent).toMatch(/500/);
  });

  test('a zero planned baseline renders a dash instead of dividing by zero', () => {
    const budgets = withPlans({
      budgetPlans: [{ budgeted_revenue: 0, budgeted_expense: 0 }],
      summaryReport: { categories: [], totals: { total_revenue: 250, total_expense: 0, net_amount: 250 } },
    });

    const doc = parse(budgets.renderBudgetVsActual());
    const revenuePct = doc.querySelectorAll('tbody tr')[0].querySelectorAll('td')[3].textContent.trim();

    expect(revenuePct).toBe('—');
    expect(revenuePct).not.toContain('NaN');
    expect(revenuePct).not.toContain('Infinity');
  });

  test('over/under budget is stated in words, not by colour alone', () => {
    const doc = parse(withPlans().renderBudgetVsActual());
    expect(doc.body.textContent).toMatch(/under_budget|over_budget/);
  });
});
