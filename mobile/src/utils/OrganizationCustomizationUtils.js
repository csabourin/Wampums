import { getOrganizationSettings } from '../api/api-endpoints';
import StorageUtils from './StorageUtils';
import { configureUnitVocabulary } from './UnitVocabularyUtils';
import { debugError } from './DebugUtils';

export const ORGANIZATION_SETTINGS_KEY = 'organizationSettings';

/** Apply settings to process-wide organization customization consumers. */
export function applyOrganizationCustomization(settings = {}) {
  configureUnitVocabulary(settings);
}

/** Clear process-wide values when authentication or organization scope changes. */
export function clearOrganizationCustomization() {
  configureUnitVocabulary({});
}

/**
 * Initialize customization before the permission router chooses a dashboard.
 * Cached settings provide offline support; authenticated settings replace them
 * whenever the organization API is reachable.
 *
 * @returns {Promise<object|null>} Effective organization settings.
 */
export async function initializeOrganizationCustomization() {
  clearOrganizationCustomization();

  const cachedSettings = await StorageUtils.getItem(ORGANIZATION_SETTINGS_KEY);
  if (cachedSettings) applyOrganizationCustomization(cachedSettings);

  try {
    const response = await getOrganizationSettings();
    if (response?.success && response.data) {
      applyOrganizationCustomization(response.data);
      await StorageUtils.setItem(ORGANIZATION_SETTINGS_KEY, response.data);
      return response.data;
    }
  } catch (error) {
    debugError('Failed to refresh organization customization:', error);
  }

  return cachedSettings || null;
}

