/**
 * Debug Config Values
 * Logs all CONFIG values to help identify string/boolean issues
 */
import CONFIG from '../config';
import { debugLog } from './DebugUtils.js';

export const logConfigValues = () => {
  debugLog('🔍 [Config] Checking all CONFIG values for type issues...');
  
  // Log UI config
  debugLog('🔍 [Config] UI.TOUCH_TARGET_SIZE:', CONFIG.UI.TOUCH_TARGET_SIZE, 'type:', typeof CONFIG.UI.TOUCH_TARGET_SIZE);
  debugLog('🔍 [Config] UI.ANIMATION_DURATION:', CONFIG.UI.ANIMATION_DURATION, 'type:', typeof CONFIG.UI.ANIMATION_DURATION);
  
  // Log Features
  debugLog('🔍 [Config] FEATURES.DEBUG_LOGGING:', CONFIG.FEATURES.DEBUG_LOGGING, 'type:', typeof CONFIG.FEATURES.DEBUG_LOGGING);
  debugLog('🔍 [Config] FEATURES.OFFLINE_MODE:', CONFIG.FEATURES.OFFLINE_MODE, 'type:', typeof CONFIG.FEATURES.OFFLINE_MODE);
  debugLog('🔍 [Config] FEATURES.PUSH_NOTIFICATIONS:', CONFIG.FEATURES.PUSH_NOTIFICATIONS, 'type:', typeof CONFIG.FEATURES.PUSH_NOTIFICATIONS);
  debugLog('🔍 [Config] FEATURES.BIOMETRIC_AUTH:', CONFIG.FEATURES.BIOMETRIC_AUTH, 'type:', typeof CONFIG.FEATURES.BIOMETRIC_AUTH);
  
  debugLog('🔍 [Config] Done checking CONFIG values');
};

export default { logConfigValues };
