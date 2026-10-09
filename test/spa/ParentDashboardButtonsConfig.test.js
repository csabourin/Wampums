/**
 * The buttons Unit settings offers to hide are exactly the ones the server
 * accepts: a key missing on either side could never be saved, or saved and
 * never shown in the settings.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugError: jest.fn() }));

import customizationConfig from '../../config/unit_customization.json';
import {
  PARENT_DASHBOARD_BUTTONS,
  PARENT_DASHBOARD_BUTTON_SECTIONS,
  getHiddenParentDashboardButtons,
} from '../../spa/config/parent-dashboard-buttons.js';
import en from '../../lang/en.json';
import fr from '../../lang/fr.json';

describe('parent dashboard button catalogue', () => {
  test('matches the keys the server validates', () => {
    expect(PARENT_DASHBOARD_BUTTONS.map((button) => button.key).sort())
      .toEqual([...customizationConfig.parentDashboardButtonKeys].sort());
  });

  test('every button has a section and a label in both languages', () => {
    PARENT_DASHBOARD_BUTTONS.forEach((button) => {
      expect(PARENT_DASHBOARD_BUTTON_SECTIONS).toContain(button.section);
      expect(en[button.label]).toBeTruthy();
      expect(fr[button.label]).toBeTruthy();
    });
  });

  test('reads hidden keys defensively', () => {
    expect(getHiddenParentDashboardButtons(undefined).size).toBe(0);
    expect(getHiddenParentDashboardButtons({ parent_dashboard_configuration: { hidden_button_keys: 'x' } }).size).toBe(0);
    expect([...getHiddenParentDashboardButtons({
      parent_dashboard_configuration: { hidden_button_keys: ['request_badge'] },
    })]).toEqual(['request_badge']);
  });
});
