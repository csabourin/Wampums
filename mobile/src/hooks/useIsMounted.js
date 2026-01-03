/**
 * useIsMounted Hook
 *
 * Tracks whether component is currently mounted
 * Use this to prevent setState calls on unmounted components
 *
 * @returns {Function} isMounted - Returns true if component is mounted
 */
import { useRef, useEffect } from 'react';

export const useIsMounted = () => {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return () => isMountedRef.current;
};
