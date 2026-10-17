/**
 * @jest-environment jsdom
 *
 * Medication doses keep the time the leader chose.
 *
 * Leaders type a local date and time; the server stores an instant and reads a
 * time without an offset in its own (UTC) zone. Jest runs in Gatineau's zone
 * (test/globalSetup.js), where UTC is 5 hours ahead in winter, so any UTC/local
 * mix-up shows.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn()
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { DEFAULT_LANG: 'en', CACHE_DURATION: {}, UI: {} },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/indexedDB.js', () => ({}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => {
    element.innerHTML = html;
  }
}));
jest.mock('../../spa/utils/OptimisticUpdateManager.js', () => ({
  OptimisticUpdateManager: jest.fn()
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  recordMedicationDistribution: jest.fn(() => Promise.resolve({ success: true }))
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canManageMedication: () => true,
  canViewMedication: () => true
}));
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildApiCacheKey: jest.fn() }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));

const { recordMedicationDistribution } = require('../../spa/api/api-endpoints.js');
const { MedicationManagement } = require('../../spa/modules/medication/MedicationManagement.js');

/**
 * The scheduling form, with the fields a leader fills in.
 *
 * @returns {HTMLFormElement} The form
 */
function buildScheduleForm() {
  document.body.innerHTML = `
    <form id="medicationDistributionForm">
      <select id="medicationRequirementSelect" name="medication_requirement_id">
        <option value=""></option>
        <option value="3">Ventolin</option>
      </select>
      <select id="distributionParticipant" name="distribution_participant_id">
        <option value=""></option>
        <option value="7">Maxime</option>
      </select>
      <input type="date" name="scheduled_date" />
      <input type="time" name="scheduled_time" />
    </form>`;
  return document.getElementById('medicationDistributionForm');
}

describe('Medication schedule time zone', () => {
  let screen;

  beforeEach(() => {
    recordMedicationDistribution.mockClear();
    screen = new MedicationManagement({ showMessage: jest.fn(), lang: 'en' }, { view: 'dispensing' });
    screen.requirements = [{ id: 3, medication_name: 'Ventolin' }];
    // Redrawing the rest of the page is not what these tests are about.
    ['renderAlertArea', 'updateUpcomingTable', 'updateSplitCards', 'reloadAfterWrite', 'updateScheduleFrequencyHelper']
      .forEach((method) => jest.spyOn(screen, method).mockImplementation(() => {}));
  });

  it('a dose planned at 8:00 is sent as 8:00 local time, not 8:00 UTC', async () => {
    const form = buildScheduleForm();
    form.elements.medication_requirement_id.value = '3';
    form.elements.distribution_participant_id.value = '7';
    form.elements.scheduled_date.value = '2026-01-15';
    form.elements.scheduled_time.value = '08:00';

    await screen.handleScheduleSubmit({ preventDefault: () => {}, target: form });

    expect(recordMedicationDistribution).toHaveBeenCalledTimes(1);
    expect(recordMedicationDistribution.mock.calls[0][0].scheduled_for).toBe('2026-01-15T13:00:00.000Z');
  });

  it('the dose times offered for a requirement are the local times it names', () => {
    const slots = screen.buildSlotsForRequirement(
      { id: 3, frequency_preset_type: 'time_of_day', frequency_times: ['08:00', '20:00'] },
      '2026-01-15',
      '08:00'
    );

    expect(slots.map((slot) => slot.iso)).toEqual(['2026-01-15T13:00:00.000Z', '2026-01-16T01:00:00.000Z']);
  });

  it('an evening dose opened from an alert fills in its own local date and time', () => {
    buildScheduleForm();
    const time = new Date('2026-01-16T02:30:00.000Z');
    jest.spyOn(screen, 'getAggregatedAlerts').mockReturnValue([
      { slotKey: 'evening', time, items: [{ participant_id: 7 }] }
    ]);

    screen.prefillFromSlot('evening', '3');

    expect(document.querySelector("input[name='scheduled_date']").value).toBe('2026-01-15');
    expect(document.querySelector("input[name='scheduled_time']").value).toBe('21:30');
    expect(document.getElementById('distributionParticipant').value).toBe('7');
  });

  it('an evening dose is listed on the day it is given', () => {
    screen.distributions = [{
      id: 1,
      medication_requirement_id: 3,
      participant_id: 7,
      scheduled_for: '2026-01-16T02:30:00.000Z',
      status: 'scheduled'
    }];
    document.body.innerHTML = `<table><tbody>${screen.renderUpcomingRows()}</tbody></table>`;

    const dateCell = document.querySelector('tbody tr td');
    expect(dateCell.textContent).toContain('Jan 15, 2026');
    expect(dateCell.textContent).not.toContain('16');
  });
});
