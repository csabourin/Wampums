import rules from '../../config/camp_equipment_lots.json';
import { OFFLINE_CAMPS } from './offline-camps.js';
/** Shared domain rules plus translated labels and the device retention policy. */
export const CAMP_LOTS = Object.freeze({
  ...rules,
  STATUS_KEYS: { to_prepare: 'camp_lot_to_prepare', loaded: 'camp_lot_loaded', returned: 'camp_lot_returned' },
  ROLE_KEYS: { prepare: 'camp_lot_prepare', transport: 'camp_lot_transport', return: 'camp_lot_return' },
  SNAPSHOT_VERSION: 1,
  CACHE_MS: (OFFLINE_CAMPS.MAX_DAYS + OFFLINE_CAMPS.EXPIRY_BUFFER_DAYS) * OFFLINE_CAMPS.DAY_MS,
  QUANTITY_STEP: 0.01,
  QUANTITY_DECIMALS: 2,
});
