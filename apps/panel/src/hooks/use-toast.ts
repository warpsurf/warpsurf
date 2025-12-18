import { useState, useCallback } from 'react';

export interface Toast {
  id: number;
  text: string;
}

/**
 * Hook for managing toast notifications
 * @returns Object containing toasts array and showToast function
 */
export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((text: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  return {
    toasts,
    showToast,
  };
};
