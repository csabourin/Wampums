/**
 * @jest-environment jsdom
 *
 * Campaign form payload building and finance terminology.
 *
 * The reported HTTP 400 came from the form itself: `form.name` resolves to
 * HTMLFormElement's own `name` property (a string), not to the input named
 * "name", so the campaign name was sent as `undefined` and the API rejected the
 * request. Reading controls through `form.elements` fixes it.
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

jest.mock('../../spa/utils/NumberUtils.js', () => ({
  formatCurrency: (value) => `$${Number(value || 0).toFixed(2)}`,
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => { element.innerHTML = html; },
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirmDestructive: jest.fn() }));
jest.mock('../../spa/indexedDB.js', () => ({ clearFundraiserRelatedCaches: jest.fn() }));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canManageFundraisers: () => true,
  canViewFundraisers: () => true,
}));

const mockCreateFundraiser = jest.fn();
const mockUpdateFundraiser = jest.fn();

jest.mock('../../spa/ajax-functions.js', () => ({
  getFundraisers: jest.fn(),
  createFundraiser: (...args) => mockCreateFundraiser(...args),
  updateFundraiser: (...args) => mockUpdateFundraiser(...args),
  archiveFundraiser: jest.fn(),
}));

import { Fundraisers } from '../../spa/fundraisers.js';

/**
 * Render the campaign screen and open its modal.
 * @param {Object|null} [campaign] - Campaign to edit, or null to create
 * @returns {{module: Fundraisers, app: Object}}
 */
function setup(campaign = null) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = { lang: 'fr', router: { navigate: jest.fn() }, showMessage: jest.fn() };
  const module = new Fundraisers(app);
  module.fundraisers = campaign ? [campaign] : [];
  module.render();
  module.initEventListeners();
  module.showModal(campaign);
  return { module, app };
}

/**
 * Fill the campaign form.
 * @param {Object} values - Field name to value
 * @returns {void}
 */
function fill(values) {
  const form = document.getElementById('fundraiser-form');
  Object.entries(values).forEach(([name, value]) => {
    const field = form.elements.namedItem(name);
    if (field) { field.value = value; }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateFundraiser.mockResolvedValue({ success: true, data: { fundraiser: { id: 1 } } });
  mockUpdateFundraiser.mockResolvedValue({ success: true, data: { fundraiser: { id: 1 } } });
});

describe('campaign payload', () => {
  test('sends the campaign name instead of undefined', async () => {
    const { module } = setup();
    fill({
      name: 'Campagne de calendriers',
      campaign_type: 'fixed_price_sale',
      start_date: '2026-09-01',
      end_date: '2026-10-31',
      unit_price: '12.50',
      unit_label: 'calendriers',
      objective: '2500',
    });

    await module.saveFundraiser();

    expect(mockCreateFundraiser).toHaveBeenCalledTimes(1);
    const payload = mockCreateFundraiser.mock.calls[0][0];
    // The regression: this used to be undefined and the API answered 400.
    expect(payload.name).toBe('Campagne de calendriers');
    expect(payload).toEqual({
      name: 'Campagne de calendriers',
      campaign_type: 'fixed_price_sale',
      start_date: '2026-09-01',
      end_date: '2026-10-31',
      objective: 2500,
      unit_price: 12.5,
      unit_label: 'calendriers',
    });
  });

  test('a form field named "name" is not shadowed by HTMLFormElement.name', () => {
    setup();
    const form = document.getElementById('fundraiser-form');
    form.elements.namedItem('name').value = 'Vente de pains';

    // Documents the trap this bug came from.
    expect(typeof form.name).toBe('string');
    expect(form.name).not.toBe('Vente de pains');
    expect(form.elements.namedItem('name').value).toBe('Vente de pains');
  });

  test('populates every field when editing an existing campaign', () => {
    setup({
      id: 7,
      name: 'Collecte de canettes',
      campaign_type: 'container_deposit',
      start_date: '2026-03-01T00:00:00.000Z',
      end_date: '2026-04-30T00:00:00.000Z',
      unit_price: 0.1,
      unit_label: 'contenants',
      objective: 400,
    });

    const form = document.getElementById('fundraiser-form');
    expect(form.elements.namedItem('name').value).toBe('Collecte de canettes');
    expect(form.elements.namedItem('campaign_type').value).toBe('container_deposit');
    expect(form.elements.namedItem('start_date').value).toBe('2026-03-01');
    expect(form.elements.namedItem('unit_price').value).toBe('0.1');
  });
});

describe('validation feedback', () => {
  test('a failed request is never reported as a success', async () => {
    const { module, app } = setup();
    mockCreateFundraiser.mockResolvedValue({
      success: false,
      message: 'Invalid campaign data',
      errors: [{ field: 'name', message: 'Name is required' }],
    });
    fill({ name: 'X', campaign_type: 'direct_amount', start_date: '2026-09-01', end_date: '2026-09-30' });

    await module.saveFundraiser();

    expect(app.showMessage).toHaveBeenCalledWith('error_saving_fundraiser', 'error');
    expect(app.showMessage).not.toHaveBeenCalledWith('fundraiser_created', 'success');
    // The modal stays open so the user can correct the input.
    expect(document.getElementById('fundraiser-modal').classList.contains('show')).toBe(true);
  });

  test('server field errors are shown next to the field they belong to', async () => {
    const { module } = setup();
    mockCreateFundraiser.mockResolvedValue({
      success: false,
      message: 'Invalid campaign data',
      errors: [{ field: 'end_date', message: 'end_date must be on or after start_date' }],
    });
    fill({ name: 'X', campaign_type: 'direct_amount', start_date: '2026-09-01', end_date: '2026-09-30' });

    await module.saveFundraiser();

    const target = document.querySelector('[data-field-error="end_date"]');
    expect(target.textContent).toBe('end_date must be on or after start_date');
    expect(document.getElementById('fundraiser-end-date').getAttribute('aria-invalid')).toBe('true');
  });

  test('obvious problems are caught before a request is made', async () => {
    const { module } = setup();
    fill({ name: '', campaign_type: 'direct_amount', start_date: '2026-09-30', end_date: '2026-09-01' });

    await module.saveFundraiser();

    expect(mockCreateFundraiser).not.toHaveBeenCalled();
    expect(document.querySelector('[data-field-error="name"]').textContent).toBe('field_required');
    expect(document.querySelector('[data-field-error="end_date"]').textContent)
      .toBe('end_date_before_start_date');
  });

  test('errors are cleared when the modal is reopened', async () => {
    const { module } = setup();
    fill({ name: '', campaign_type: 'direct_amount', start_date: '2026-09-01', end_date: '2026-09-30' });
    await module.saveFundraiser();
    expect(document.querySelector('[data-field-error="name"]').textContent).not.toBe('');

    module.hideModal();
    module.showModal();

    expect(document.querySelector('[data-field-error="name"]').textContent).toBe('');
    expect(document.getElementById('fundraiser-form-error').hidden).toBe(true);
  });
});

describe('campaign type driven inputs', () => {
  test('a unit price is offered for unit based campaigns', () => {
    const { module } = setup();
    fill({ campaign_type: 'fixed_price_sale' });
    module.syncCampaignTypeFields();

    expect(document.querySelector('[data-campaign-field="unit_price"]').hidden).toBe(false);
    expect(document.querySelector('[data-campaign-field="unit_label"]').hidden).toBe(false);
  });

  test('a donation campaign is not asked for a unit price', () => {
    const { module } = setup();
    fill({ campaign_type: 'donation' });
    module.syncCampaignTypeFields();

    expect(document.querySelector('[data-campaign-field="unit_price"]').hidden).toBe(true);
    expect(document.querySelector('[data-campaign-field="unit_label"]').hidden).toBe(true);
  });

  test('an hours based campaign asks for an hourly rate but no unit label', () => {
    const { module } = setup();
    fill({ campaign_type: 'hours_worked' });
    module.syncCampaignTypeFields();

    expect(document.querySelector('[data-campaign-field="unit_price"]').hidden).toBe(false);
    expect(document.querySelector('[data-campaign-field="unit_label"]').hidden).toBe(true);
  });

  test('a unit price typed for a campaign that does not use one is not sent', async () => {
    const { module } = setup();
    fill({
      name: 'Dons',
      campaign_type: 'fixed_price_sale',
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      unit_price: '9.99',
    });
    // The user switches to a type with no unit price after typing one.
    fill({ campaign_type: 'donation' });

    await module.saveFundraiser();

    expect(mockCreateFundraiser.mock.calls[0][0].unit_price).toBeNull();
  });
});

describe('accessibility of the campaign modal', () => {
  test('every input has a label and error messages are programmatically associated', () => {
    setup();
    const form = document.getElementById('fundraiser-form');

    ['name', 'campaign_type', 'start_date', 'end_date', 'unit_price', 'objective'].forEach((fieldName) => {
      const control = form.elements.namedItem(fieldName);
      expect(document.querySelector(`label[for="${control.id}"]`)).not.toBeNull();
      expect(control.getAttribute('aria-describedby')).toBeTruthy();
    });
  });

  test('the error summary is announced', () => {
    setup();
    expect(document.getElementById('fundraiser-form-error').getAttribute('role')).toBe('alert');
  });

  test('closing the modal hands focus back to the trigger', () => {
    const { module } = setup();
    const trigger = document.getElementById('add-fundraiser-btn');
    trigger.focus();
    module.showModal();

    module.hideModal();

    expect(document.activeElement).toBe(trigger);
  });

  test('Escape closes the modal', () => {
    setup();
    const modal = document.getElementById('fundraiser-modal');
    expect(modal.classList.contains('show')).toBe(true);

    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(modal.classList.contains('show')).toBe(false);
  });
});

describe('finance terminology', () => {
  test('"amount" reads as money in both languages', () => {
    const en = require('../../lang/en.json');
    const fr = require('../../lang/fr.json');

    // The French label used to read "Quantité" for a monetary field, which is
    // what the finance screens render through translate("amount").
    expect(fr.amount).toBe('Montant');
    expect(en.amount).toBe('Amount');
  });

  test('a separate key carries unit counts', () => {
    const en = require('../../lang/en.json');
    const fr = require('../../lang/fr.json');

    expect(fr.quantity).toBe('Quantité');
    expect(en.quantity).toBe('Quantity');
    // Money keys never say "quantité".
    ['amount', 'amount_paid', 'amount_raised', 'total_raised'].forEach((key) => {
      expect(fr[key].toLowerCase()).not.toContain('quantit');
    });
    // Unit keys never say "montant".
    ['quantity', 'total_quantity', 'quantity_column'].forEach((key) => {
      expect(fr[key].toLowerCase()).not.toContain('montant');
    });
  });
});

describe('validation messages do not outlive the problem', () => {
  /**
   * The reported symptom: after a failed submit, the user corrects the field
   * but "this field is required" stays under the now-filled input.
   */
  test('typing into a flagged field clears its message', async () => {
    const { module } = setup();
    fill({ name: '', campaign_type: 'container_deposit', start_date: '2026-08-09', end_date: '2026-08-10' });
    await module.saveFundraiser();
    expect(document.querySelector('[data-field-error="name"]').textContent).toBe('field_required');

    const input = document.getElementById('fundraiser-name');
    input.value = 'Test';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelector('[data-field-error="name"]').textContent).toBe('');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  test('correcting a select clears its message too', async () => {
    const { module } = setup();
    fill({ name: 'Test', campaign_type: 'container_deposit', start_date: '2026-08-10', end_date: '2026-08-09' });
    await module.saveFundraiser();
    expect(document.querySelector('[data-field-error="end_date"]').textContent)
      .toBe('end_date_before_start_date');

    const endDate = document.getElementById('fundraiser-end-date');
    endDate.value = '2026-08-11';
    endDate.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('[data-field-error="end_date"]').textContent).toBe('');
  });

  test('the summary disappears once nothing is flagged', async () => {
    const { module } = setup();
    fill({ name: '', campaign_type: 'container_deposit', start_date: '', end_date: '' });
    await module.saveFundraiser();
    const summary = document.getElementById('fundraiser-form-error');
    expect(summary.hidden).toBe(false);

    // Correct the fields one by one; the summary must survive until the last.
    const name = document.getElementById('fundraiser-name');
    name.value = 'Test';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(summary.hidden).toBe(false);

    const start = document.getElementById('fundraiser-start-date');
    start.value = '2026-08-09';
    start.dispatchEvent(new Event('change', { bubbles: true }));
    const end = document.getElementById('fundraiser-end-date');
    end.value = '2026-08-10';
    end.dispatchEvent(new Event('change', { bubbles: true }));

    expect(summary.hidden).toBe(true);
    expect(summary.textContent).toBe('');
  });

  test('editing one field leaves other fields still flagged', async () => {
    const { module } = setup();
    fill({ name: '', campaign_type: 'container_deposit', start_date: '', end_date: '2026-08-10' });
    await module.saveFundraiser();

    const name = document.getElementById('fundraiser-name');
    name.value = 'Test';
    name.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelector('[data-field-error="name"]').textContent).toBe('');
    // start_date is still empty, so its message must remain.
    expect(document.querySelector('[data-field-error="start_date"]').textContent)
      .toBe('field_required');
  });

  test('the exact reported payload submits without a validation error', async () => {
    const { module } = setup();
    fill({
      name: 'Test',
      campaign_type: 'container_deposit',
      start_date: '2026-08-09',
      end_date: '2026-08-10',
      unit_price: '.10',
      unit_label: 'Canette',
    });
    module.syncCampaignTypeFields();

    await module.saveFundraiser();

    expect(mockCreateFundraiser).toHaveBeenCalledTimes(1);
    expect(mockCreateFundraiser.mock.calls[0][0]).toEqual({
      name: 'Test',
      campaign_type: 'container_deposit',
      start_date: '2026-08-09',
      end_date: '2026-08-10',
      objective: null,
      unit_price: 0.1,
      unit_label: 'Canette',
    });
  });
});
