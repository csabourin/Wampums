/**
 * Debug Config Values
 * Logs all CONFIG values to help identify string/boolean issues
 */
import CONFIG from '../config';

export const logConfigValues = () => {
  console.log('🔍 [Config] Checking all CONFIG values for type issues...');
  
  // Log UI config
  console.log('🔍 [Config] UI.TOUCH_TARGET_SIZE:', CONFIG.UI.TOUCH_TARGET_SIZE, 'type:', typeof CONFIG.UI.TOUCH_TARGET_SIZE);
  console.log('🔍 [Config] UI.ANIMATION_DURATION:', CONFIG.UI.ANIMATION_DURATION, 'type:', typeof CONFIG.UI.ANIMATION_DURATION);
  
  // Log Features
  console.log('🔍 [Config] FEATURES.DEBUG_LOGGING:', CONFIG.FEATURES.DEBUG_LOGGING, 'type:', typeof CONFIG.FEATURES.DEBUG_LOGGING);
  console.log('🔍 [Config] FEATURES.OFFLINE_MODE:', CONFIG.FEATURES.OFFLINE_MODE, 'type:', typeof CONFIG.FEATURES.OFFLINE_MODE);
  console.log('🔍 [Config] FEATURES.PUSH_NOTIFICATIONS:', CONFIG.FEATURES.PUSH_NOTIFICATIONS, 'type:', typeof CONFIG.FEATURES.PUSH_NOTIFICATIONS);
  console.log('🔍 [Config] FEATURES.BIOMETRIC_AUTH:', CONFIG.FEATURES.BIOMETRIC_AUTH, 'type:', typeof CONFIG.FEATURES.BIOMETRIC_AUTH);
  
  console.log('🔍 [Config] Done checking CONFIG values');
};

export default { logConfigValues };
