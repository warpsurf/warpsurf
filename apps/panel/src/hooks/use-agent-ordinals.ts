import { useRef, useCallback } from 'react';

/**
 * Hook for managing stable ordinal mapping for agent/task IDs → Crew N labels
 * @returns Function to ensure an agent gets a consistent ordinal number
 */
export const useAgentOrdinals = () => {
  // Stable ordinal mapping for agent/task IDs → Crew N labels
  const agentOrdinalRef = useRef<Map<string, number>>(new Map());

  /**
   * Get or assign a 1-based ordinal for an agent ID.
   * @param id - The agent/task ID
   * @param hint - Optional 0-based workerIndex from backend (converted to 1-based)
   */
  const ensureAgentOrdinal = useCallback((id: string, hint?: number): number => {
    const map = agentOrdinalRef.current;
    if (map.has(id)) return map.get(id)!;
    if (typeof hint === 'number' && hint >= 0) {
      const ordinal = hint + 1;
      map.set(id, ordinal);
      return ordinal;
    }
    const next = map.size + 1;
    map.set(id, next);
    return next;
  }, []);

  return {
    ensureAgentOrdinal,
  };
};
