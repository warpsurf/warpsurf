import { useState, useEffect } from 'react';

/**
 * Hook for detecting and tracking dark mode preference
 * @returns Boolean indicating whether dark mode is active
 */
export const useDarkMode = () => {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDarkMode(isDark);
    };

    checkDarkMode();
    
    // Listen for changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);
    
    return () => {
      mediaQuery.removeEventListener('change', checkDarkMode);
    };
  }, []);

  return isDarkMode;
};
