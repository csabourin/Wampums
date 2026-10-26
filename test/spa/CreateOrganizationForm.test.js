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
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canCreateOrganization: () => true,
  canSwitchUnits: () => true,
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    PROGRAM_SECTIONS: {
      DEFAULT: ['general', 'beavers', 'cubs', 'scouts', 'pioneers', 'rovers']
        .map((key) => ({ key, labelKey: `program_section_${key}` })),
    },
  },
}));
jest.mock('../../spa/modules/session/UnitSwitch.js', () => ({ switchActiveUnit: jest.fn() }));
jest.mock('../../spa/ajax-functions.js', () => ({
  createOrganization: jest.fn(),
  getOrganizationFormFormats: jest.fn(),
  getFormSubmission: jest.fn(),
  saveFormSubmission: jest.fn(),
}));

import * as ajax from '../../spa/ajax-functions.js';
import { switchActiveUnit } from '../../spa/modules/session/UnitSwitch.js';
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

/** Choose an option, the way a person would. */
function choose(label) {
  const control = field(label);
  control.checked = true;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillEverything() {
  type('Name', 'Éclaireurs 6E Lac-aux-Castors');
  type('Unit', 'Éclaireurs 6E');
  type('Location', 'Salle Ada-Lovelace');
  type('District', 'District des Trois-Rivières');
  type('Responsible Animator', 'Léa Tremblay');
  choose('program_section_scouts');
  type('create_unit_leader_email_label', 'lea.tremblay@example.test');
}

/** What the server answers once the unit exists. */
function created(invitation = {}) {
  return {
    success: true,
    data: {
      organization_id: 9,
      domain: 'eclaireurs-6e-lac-aux-castors.wampums.app',
      leader_invitation: { email: 'lea.tremblay@example.test', invited: true, email_sent: true, ...invitation },
    },
  };
}

/** @param {string} label - Label of a field */
function errorOf(label) {
  const ids = (field(label).getAttribute('aria-describedby') || '').split(' ');
  return ids.map((id) => document.getElementById(id)).find((element) => element?.classList.contains('field-error'));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  ajax.getOrganizationFormFormats.mockResolvedValue({ organization_info: TEMPLATE_FORMAT });
});

describe('creating a unit from the filled form', () => {
  test('a fully filled form creates the unit, with its name, branch, address and administrator', async () => {
    ajax.createOrganization.mockResolvedValue(created());
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
      program_section: 'scouts',
      subdomain: 'eclaireurs-6e-lac-aux-castors',
      leader_email: 'lea.tremblay@example.test',
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

  test('a required field hidden by its condition does not block the creation', async () => {
    ajax.getOrganizationFormFormats.mockResolvedValue({
      organization_info: {
        fields: [
          ...TEMPLATE_FORMAT.fields,
          { name: 'has_second_site', type: 'radio', label: 'Second site', options: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }] },
          { name: 'second_site', type: 'text', label: 'Second site address', required: true, dependsOn: { field: 'has_second_site', value: 'yes' } },
        ],
      },
    });
    ajax.createOrganization.mockResolvedValue(created());
    await openScreen();
    fillEverything();
    expect(field('Second site address').disabled).toBe(true);

    await submit();

    expect(ajax.createOrganization).toHaveBeenCalled();
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

describe('the branch, address and administrator of a new unit', () => {
  test('the address follows the unit\'s name until the person writes their own, and again once they empty it', async () => {
    await openScreen();
    const subdomain = field('create_unit_subdomain_label');

    type('Name', 'Meute Ada-Lovelace');
    expect(subdomain.value).toBe('meute-ada-lovelace');

    type('create_unit_subdomain_label', 'meute-ada');
    type('Name', 'Meute Ada Lovelace de Hull');
    expect(subdomain.value).toBe('meute-ada');

    type('create_unit_subdomain_label', '');
    type('Name', 'Colonie Léa');
    expect(subdomain.value).toBe('colonie-lea');
  });

  test('the address names the domain it sits under, read along with the field', async () => {
    await openScreen();
    const subdomain = field('create_unit_subdomain_label');

    expect(subdomain.required).toBe(true);
    expect(document.getElementById(subdomain.getAttribute('aria-describedby')).textContent)
      .toBe('create_unit_subdomain_hint');
    expect(page().querySelector('.create-unit-subdomain__suffix').textContent).toBe('.wampums.app');
  });

  test('a missing branch, a reserved address and an unusable email are tied to their fields before anything is sent', async () => {
    const { app } = await openScreen();
    fillEverything();
    field('program_section_scouts').checked = false;
    type('create_unit_subdomain_label', 'www');
    type('create_unit_leader_email_label', 'lea.tremblay');

    await submit();

    expect(ajax.createOrganization).not.toHaveBeenCalled();
    expect(app.showMessage).toHaveBeenCalledWith('api_error_invalid', 'error');

    const branch = page().querySelector('[role="radiogroup"]');
    expect(branch.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(branch.getAttribute('aria-describedby')).textContent).toBe('create_unit_branch_required');
    expect(document.activeElement).toBe(field('program_section_general'));

    const subdomain = field('create_unit_subdomain_label');
    expect(errorOf('create_unit_subdomain_label').textContent).toBe('subdomain_reserved');
    // The hint is still read with the error.
    expect(subdomain.getAttribute('aria-describedby')).toContain('create-unit-subdomain-hint');
    expect(errorOf('create_unit_leader_email_label').textContent).toBe('leader_email_invalid');

    choose('program_section_cubs');
    expect(branch.hasAttribute('aria-invalid')).toBe(false);
    type('create_unit_subdomain_label', 'meute-ada');
    expect(subdomain.hasAttribute('aria-invalid')).toBe(false);
    expect(subdomain.getAttribute('aria-describedby')).toBe('create-unit-subdomain-hint');
  });

  test('a branch the server found missing is explained in the screen\'s own words', async () => {
    ajax.createOrganization.mockRejectedValue(Object.assign(new Error('Invalid organization settings'), {
      status: 400,
      errors: [{ field: 'program_section', msg: 'program_section_required' }],
    }));
    await openScreen();
    fillEverything();

    await submit();

    const branch = page().querySelector('[role="radiogroup"]');
    expect(document.getElementById(branch.getAttribute('aria-describedby')).textContent).toBe('create_unit_branch_required');
  });

  test('an address another unit holds is explained on its field', async () => {
    ajax.createOrganization.mockRejectedValue(Object.assign(new Error('subdomain_taken'), {
      status: 409,
      errors: [{ field: 'subdomain', msg: 'subdomain_taken' }],
    }));
    const { app } = await openScreen();
    fillEverything();

    await submit();

    expect(errorOf('create_unit_subdomain_label').textContent).toBe('subdomain_taken');
    expect(document.activeElement).toBe(field('create_unit_subdomain_label'));
    expect(app.showMessage).not.toHaveBeenCalledWith('unit_created_successfully', 'success');
  });
});

describe('once the unit exists', () => {
  async function createUnit(invitation) {
    ajax.createOrganization.mockResolvedValue(created(invitation));
    const opened = await openScreen();
    fillEverything();
    await submit();
    return opened;
  }

  test('the person is told where it answers and that its administrator was invited, with focus on the news', async () => {
    await createUnit();

    const title = page().querySelector('h1');
    expect(title.textContent).toBe('create_unit_done_title');
    expect(document.activeElement).toBe(title);
    expect(page().querySelector('a[href="https://eclaireurs-6e-lac-aux-castors.wampums.app"]')).not.toBeNull();
    expect(page().textContent).toContain('create_unit_done_invitation_sent');
    expect(page().querySelector('section').firstElementChild.textContent).toContain('back');
  });

  test('an invitation whose email could not be sent says so, rather than claiming it went', async () => {
    await createUnit({ email_sent: false });

    expect(page().querySelector('.create-unit-notice').textContent).toBe('create_unit_done_invitation_not_sent');
    expect(page().textContent).not.toContain('create_unit_done_invitation_sent');
  });

  test('a creator who named their own address is told no invitation was needed', async () => {
    await createUnit({ invited: false, email_sent: false });

    expect(page().textContent).toContain('create_unit_done_creator_is_admin');
  });

  test('the address a person typed is shown as text', async () => {
    await createUnit({ email: '<img src=x onerror=alert(1)>@example.test', email_sent: false });

    expect(page().querySelector('img')).toBeNull();
  });

  test('opening the new unit makes it the active one, then shows its dashboard', async () => {
    switchActiveUnit.mockResolvedValue();
    const { app } = await createUnit();

    const open = Array.from(page().querySelectorAll('button')).find((button) => button.textContent === 'create_unit_open_new_unit');
    open.click();
    expect(open.disabled).toBe(true);
    await flush();

    expect(switchActiveUnit).toHaveBeenCalledWith(app, 9);
    expect(app.router.navigate).toHaveBeenCalledWith('/dashboard');
  });

  test('a unit that cannot be opened leaves the person where they are, able to try again', async () => {
    switchActiveUnit.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    const { app } = await createUnit();

    const open = Array.from(page().querySelectorAll('button')).find((button) => button.textContent === 'create_unit_open_new_unit');
    open.click();
    await flush();

    expect(app.router.navigate).not.toHaveBeenCalled();
    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
    expect(open.disabled).toBe(false);
  });

  test('staying needs no click handler: it is a link back to the district tools', async () => {
    await createUnit();

    const stay = Array.from(page().querySelectorAll('a')).find((link) => link.textContent === 'create_unit_stay_here');
    expect(stay.getAttribute('href')).toBe('/district?tab=outils');
  });

  test('the confirmation has no accessibility violations', async () => {
    await createUnit({ email_sent: false });
    expect((await axe.run(page(), AXE_OPTIONS)).violations).toEqual([]);
  });
});

