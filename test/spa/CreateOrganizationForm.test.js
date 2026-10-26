/**
 * @jest-environment jsdom
 */

/**
 * Creating a unit through the real form: the template's organization_info
 * format drawn by the dynamic form, sanitized by the real DOMPurify, and
 * filled in the way a person would. DOMPurify strips a control named `name`
 * (a property of every form), so a fully filled form used to reach the server
 * without the unit's name and every creation was refused as incomplete.
 *
 * @module test/spa/CreateOrganizationForm
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ app: { lang: 'fr' }, translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ canCreateOrganization: () => true }));
jest.mock('../../spa/ajax-functions.js', () => ({
  createOrganization: jest.fn(),
  getOrganizationFormFormats: jest.fn(),
  getFormSubmission: jest.fn(),
  saveFormSubmission: jest.fn(),
}));

import * as ajax from '../../spa/ajax-functions.js';
import { CreateOrganization } from '../../spa/modules/organizations/CreateOrganization.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

/** The format an older template unit still holds: the logo asked as a file. */
const TEMPLATE_FORMAT = {
  fields: [
    { name: 'logo', type: 'file', label: 'Logo' },
    { name: 'name', type: 'text', label: 'Name', required: true },
    { name: 'unit', type: 'text', label: 'Unit', required: true },
    { name: 'endroit', type: 'text', label: 'Location', required: true },
    { name: 'district', type: 'text', label: 'District', required: true },
    {
      name: 'meeting_day',
      type: 'select',
      label: 'Meeting Day',
      required: true,
      options: [{ label: 'Monday', value: 'Monday' }, { label: 'Tuesday', value: 'Tuesday' }],
    },
    { name: 'animateur_responsable', type: 'text', label: 'Responsible Animator', required: true },
  ],
};

const page = () => document.getElementById('app');
const form = () => document.getElementById('create-organization-form');
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * @param {string} label - The field's visible label
 * @returns {HTMLElement} The control that label names
 */
function field(label) {
  const element = Array.from(page().querySelectorAll('label')).find((item) => item.textContent.trim() === label);
  return document.getElementById(element.getAttribute('for'));
}

/** Type a value into a field, the way a person would. */
function type(label, value) {
  const control = field(label);
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit() {
  form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  await flush();
}

async function openScreen() {
  const app = { showMessage: jest.fn(), router: { navigate: jest.fn() } };
  const screen = new CreateOrganization(app);
  await screen.init();
  return { app, screen };
}

function fillEverything() {
  type('Name', 'Éclaireurs 6E Lac-aux-Castors');
  type('Unit', 'Éclaireurs 6E');
  type('Location', 'Salle Ada-Lovelace');
  type('District', 'District des Trois-Rivières');
  type('Responsible Animator', 'Léa Tremblay');
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  ajax.getOrganizationFormFormats.mockResolvedValue({ organization_info: TEMPLATE_FORMAT });
});

describe('creating a unit from the filled form', () => {
  test('a fully filled form creates the unit, with its name', async () => {
    ajax.createOrganization.mockResolvedValue({ success: true, organization_id: 9 });
    const { app } = await openScreen();
    fillEverything();
    type('unit_settings_logo_url', 'https://example.test/logo.png');

    await submit();

    expect(ajax.createOrganization).toHaveBeenCalledWith({
      logo: 'https://example.test/logo.png',
      name: 'Éclaireurs 6E Lac-aux-Castors',
      unit: 'Éclaireurs 6E',
      endroit: 'Salle Ada-Lovelace',
      district: 'District des Trois-Rivières',
      meeting_day: 'Monday',
      animateur_responsable: 'Léa Tremblay',
    });
    expect(app.showMessage).toHaveBeenCalledWith('unit_created_successfully', 'success');
  });

  test('the logo is asked as a web address, even where the template asked for a file', async () => {
    await openScreen();

    expect(page().querySelector('input[type="file"]')).toBeNull();
    expect(field('unit_settings_logo_url').getAttribute('type')).toBe('url');
  });

  test('a missing name is tied to its field before anything is sent, and goes once it is typed', async () => {
    const { app } = await openScreen();
    fillEverything();
    type('Name', '   ');

    await submit();

    expect(ajax.createOrganization).not.toHaveBeenCalled();
    const name = field('Name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby')).textContent).toBe('field_required');
    expect(document.activeElement).toBe(name);
    expect(app.showMessage).toHaveBeenCalledWith('api_error_invalid', 'error');

    type('Name', 'Meute Ada');
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    expect(page().querySelector('.field-error')).toBeNull();
  });

  test('a logo that is not a web address is explained on its field, not sent', async () => {
    await openScreen();
    fillEverything();
    type('unit_settings_logo_url', 'C:\\fakepath\\logo.jpg');

    await submit();

    expect(ajax.createOrganization).not.toHaveBeenCalled();
    const logo = field('unit_settings_logo_url');
    expect(document.getElementById(logo.getAttribute('aria-describedby')).textContent).toBe('create_unit_logo_invalid');
  });

  test('a field the server refuses is marked on the form', async () => {
    ajax.createOrganization.mockRejectedValue(Object.assign(new Error('Invalid organization settings'), {
      status: 400,
      errors: [{ field: 'district', msg: 'Must be 255 characters or fewer' }],
    }));
    const { app } = await openScreen();
    fillEverything();

    await submit();

    const district = field('District');
    expect(district.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(district.getAttribute('aria-describedby')).textContent).toBe('create_unit_field_invalid');
    expect(app.showMessage).toHaveBeenCalledWith('api_error_invalid', 'error');
    expect(app.showMessage).not.toHaveBeenCalledWith('unit_created_successfully', 'success');
  });

  test('no other standard form has a field DOMPurify would strip', () => {
    const { forms } = require('../../config/default-form-formats.json');
    const formElement = document.createElement('form');
    const stripped = forms.flatMap((format) => (format.form_structure.fields || [])
      .filter((item) => item.name && (item.name in document || item.name in formElement))
      .map((item) => `${format.form_type}.${item.name}`));

    // The unit's name is drawn under another field name by this screen.
    expect(stripped).toEqual(['organization_info.name']);
  });

  test('the form and its error messages have no accessibility violations', async () => {
    await openScreen();
    expect((await axe.run(page(), AXE_OPTIONS)).violations).toEqual([]);

    await submit();
    expect(page().querySelectorAll('.field-error').length).toBeGreaterThan(0);
    expect((await axe.run(page(), AXE_OPTIONS)).violations).toEqual([]);
  });
});
