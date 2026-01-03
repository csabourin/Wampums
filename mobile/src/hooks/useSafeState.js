/**
 * useSafeState Hook
 *
 * Wraps React.useState with an isMounted guard to prevent updates on unmounted components.
 *
 * @template T
 * @param {T} initialState - Initial state value.
 * @returns {[T, function(T | function(T): T): void]} State value and guarded setter.
 */
import { useCallback, useState } from 'react';

import { useIsMounted } from './useIsMounted';

export const useSafeState = (initialState) => {
  const isMounted = useIsMounted();
  const [state, setState] = useState(initialState);

  const safeSetState = useCallback(
    (value) => {
      if (isMounted()) {
        setState(value);
      }
    },
    [isMounted]
  );

  return [state, safeSetState];
};
