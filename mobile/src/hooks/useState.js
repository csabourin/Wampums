import { useSafeState } from './useSafeState';

/**
 * useState hook that delegates to useSafeState.
 *
 * This wrapper exists to maintain compatibility with modules that still
 * import from "./useState". New code should import `useSafeState` directly
 * from "./useSafeState" and this wrapper can be removed once all callers
 * are updated.
 *
 * @template T
 * @param {T} initialValue - Initial state value.
 * @returns {[T, (value: T | ((prev: T) => T)) => void]} State tuple.
 */
export function useState(initialValue) {
  return useSafeState(initialValue);
}
