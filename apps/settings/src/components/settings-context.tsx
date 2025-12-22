/**
 * Settings Context
 * Provides shared settings state and helpers to avoid prop drilling.
 * Components can incrementally adopt this context.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { type ProviderConfig, type AgentNameEnum } from '@extension/storage';
import { getAgentDisplayName, getAgentDescription, getAgentSectionColor } from './agent-helpers';
import { hasModelPricing } from '../../../background/src/utils/cost-calculator';

interface SettingsContextValue {
  isDarkMode: boolean;
  providers: Record<string, ProviderConfig>;
  // Helper functions
  getAgentDisplayName: typeof getAgentDisplayName;
  getAgentDescription: typeof getAgentDescription;
  getSectionColor: (agent: AgentNameEnum) => string;
  hasModelPricing: typeof hasModelPricing;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

interface SettingsProviderProps {
  children: ReactNode;
  isDarkMode: boolean;
  providers: Record<string, ProviderConfig>;
}

export function SettingsProvider({ children, isDarkMode, providers }: SettingsProviderProps) {
  const value = useMemo<SettingsContextValue>(
    () => ({
      isDarkMode,
      providers,
      getAgentDisplayName,
      getAgentDescription,
      getSectionColor: (agent: AgentNameEnum) => getAgentSectionColor(agent, isDarkMode),
      hasModelPricing,
    }),
    [isDarkMode, providers],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/**
 * Hook to access settings context.
 * Throws if used outside SettingsProvider.
 */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return ctx;
}

/**
 * Hook to optionally access settings context.
 * Returns null if used outside SettingsProvider (useful during migration).
 */
export function useSettingsOptional(): SettingsContextValue | null {
  return useContext(SettingsContext);
}
