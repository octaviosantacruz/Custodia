import { useEffect, useRef } from 'react';

export function useHotkey(onActivate: () => void) {
  const callbackRef = useRef(onActivate);
  callbackRef.current = onActivate;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        callbackRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
