/** Packing state is device-only, scoped by account/unit/year, camp and child. */
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
const PREFIX = 'personal-equipment-checks';

/** A captured scope cannot write into an account selected after navigation. */
export function packingKey(meetingId, childId) {
  return buildScopedCacheKey(`${PREFIX}:${/^activity-[1-9]\d*$/.test(String(meetingId)) ? meetingId : Number(meetingId)}:${Number(childId)}`);
}

/** Corrupt/blocked storage never prevents opening the published list. */
export function readPacking(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []);
  } catch { return new Set(); }
}

/** Store the latest state for just one item, preserving changes from another tab. */
export function writePacking(key, itemKey, checked) {
  const keys = readPacking(key);
  if (checked) { keys.add(itemKey); } else { keys.delete(itemKey); }
  localStorage.setItem(key, JSON.stringify([...keys]));
  return keys;
}

/** Blank lines are ignored; quantities and meaningful text stay on their own row. */
export function bulkPackingLines(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}

/** The dashboard reads local packing progress once for each child/camp. */
export function hasUnpackedItems(row) {
  const checked = readPacking(packingKey(row.meeting_id, row.participant_id));
  return (row.item_keys || []).some((key) => !checked.has(key));
}
