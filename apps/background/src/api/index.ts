// Conditional API initialization - only included when built with __API__=true

import type { TaskManager } from '../task/task-manager';
import { localAPI } from './local-api';

export function initializeAPI(taskManager: TaskManager): void {
  if (import.meta.env.API) {
    console.log('[WarpSurf API] Initializing local API...');
    try {
      localAPI.setTaskManager(taskManager);

      // Set on all possible global objects for maximum compatibility
      (globalThis as any).__warpsurf = localAPI;
      (globalThis as any).__warpsurf_apiVersion = '1';
      if (typeof self !== 'undefined') {
        (self as any).__warpsurf = localAPI;
        (self as any).__warpsurf_apiVersion = '1';
      }
      if (typeof window !== 'undefined') {
        (window as any).__warpsurf = localAPI;
        (window as any).__warpsurf_apiVersion = '1';
      }

      console.log('[WarpSurf API] Local API initialized successfully');
      console.log('[WarpSurf API] globalThis.__warpsurf =', typeof (globalThis as any).__warpsurf);
      console.log(
        '[WarpSurf API] self.__warpsurf =',
        typeof self !== 'undefined' ? typeof (self as any).__warpsurf : 'N/A',
      );
    } catch (err) {
      console.error('[WarpSurf API] Failed to initialize local API:', err);
    }
  } else {
    console.log('[WarpSurf API] API mode not enabled');
  }
}
