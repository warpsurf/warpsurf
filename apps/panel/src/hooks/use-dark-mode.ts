import { useState, useEffect } from 'react';
import { generalSettingsStore } from '@extension/storage';

/**
 * Hook for detecting and tracking dark mode preference
 * Checks user's manual theme preference first, then falls back to system preference
 * @returns Boolean indicating whether dark mode is active
 */
export const useDarkMode = () => {
  // Initialize with system preference to avoid flash
  const getSystemPreference = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const [isDarkMode, setIsDarkMode] = useState(getSystemPreference);

  useEffect(() => {
    const checkDarkMode = async () => {
      try {
        const settings = await generalSettingsStore.getSettings();
        const themeMode = settings.themeMode || 'auto';

        setIsDarkMode(themeMode === 'dark' ? true : themeMode === 'light' ? false : getSystemPreference());
      } catch {
        setIsDarkMode(getSystemPreference());
      }
    };

    checkDarkMode();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = generalSettingsStore.subscribe(checkDarkMode);
    } catch {}

    return () => {
      mediaQuery.removeEventListener('change', checkDarkMode);
      unsubscribe?.();
    };
  }, []);

  return isDarkMode;
};
