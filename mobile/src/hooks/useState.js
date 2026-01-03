/**
 * Deprecated: useSafeState should be used instead of this alias.
 *
 * This file exists to prevent module resolution errors if any screens still
 * import from ../hooks/useState. Prefer importing `useSafeState` directly.
 */
export { useSafeState as useState } from './useSafeState';
