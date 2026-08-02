import { getOrganizationSettings } from '../../api/api-endpoints';
import StorageUtils from '../StorageUtils';
import { configureUnitVocabulary } from '../UnitVocabularyUtils';
import {
  clearOrganizationCustomization,
  initializeOrganizationCustomization,
} from '../OrganizationCustomizationUtils';

jest.mock('../../api/api-endpoints', () => ({
  getOrganizationSettings: jest.fn(),
}));
jest.mock('../StorageUtils', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('../UnitVocabularyUtils', () => ({
  configureUnitVocabulary: jest.fn(),
}));
jest.mock('../DebugUtils', () => ({
  debugError: jest.fn(),
}));

describe('shared organization customization initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    StorageUtils.getItem.mockResolvedValue(null);
    StorageUtils.setItem.mockResolvedValue(true);
  });

  it('clears stale state and applies fresh settings before dashboard routing', async () => {
    const fresh = { unit_vocabulary: { profile: 'beavers' } };
    getOrganizationSettings.mockResolvedValue({ success: true, data: fresh });

    await expect(initializeOrganizationCustomization()).resolves.toBe(fresh);

    expect(configureUnitVocabulary.mock.calls).toEqual([
      [{}],
      [fresh],
    ]);
    expect(StorageUtils.setItem).toHaveBeenCalledWith('organizationSettings', fresh);
  });

  it('uses cached vocabulary offline after first clearing the previous organization', async () => {
    const cached = { unit_vocabulary: { profile: 'generic' } };
    StorageUtils.getItem.mockResolvedValue(cached);
    getOrganizationSettings.mockRejectedValue(new Error('offline'));

    await expect(initializeOrganizationCustomization()).resolves.toBe(cached);

    expect(configureUnitVocabulary.mock.calls).toEqual([
      [{}],
      [cached],
    ]);
  });

  it('can explicitly clear process-wide customization on logout', () => {
    clearOrganizationCustomization();
    expect(configureUnitVocabulary).toHaveBeenCalledWith({});
  });
});

