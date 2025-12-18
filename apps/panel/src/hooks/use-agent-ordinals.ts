import { useRef, useCallback } from 'react';

/**
 * Hook for managing stable ordinal mapping for agent/task IDs → Web Agent N labels
 * @returns Function to ensure an agent gets a consistent ordinal number
 */
export const useAgentOrdinals = () => {
  // Stable ordinal mapping for agent/task IDs → Web Agent N labels
  const agentOrdinalRef = useRef<Map<string, number>>(new Map());

  /**
   * Get or assign an ordinal for an agent ID.
   * @param id - The agent/task ID
   * @param hint - Optional authoritative workerIndex from backend (takes precedence)
   */
  const ensureAgentOrdinal = useCallback((id: string, hint?: number): number => {
    const map = agentOrdinalRef.current;
    if (map.has(id)) return map.get(id)!;
    // Use backend's authoritative workerIndex if provided
    if (typeof hint === 'number' && hint > 0) {
      map.set(id, hint);
      return hint;
    }
    const next = map.size + 1;
    map.set(id, next);
    return next;
  }, []);

  return {
    ensureAgentOrdinal,
  };
};
