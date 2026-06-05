import { useState, useCallback } from 'react';

interface UseMenuOpen {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

export function useMenuOpen(): UseMenuOpen {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { isOpen, toggle, open, close };
}
