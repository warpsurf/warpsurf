import { useEffect, useState } from 'react';

export function useVersionInfo() {
  const [extensionVersion, setExtensionVersion] = useState<string>('');
  const releaseNotes =
    'Added role-based multi-agent architecture (Commodore, Captain, Quartermaster, Crew), captain oversight with pause/resume and deadlock detection, live plan visualization, shared cross-crew tab registry, universal thinking-level controls, and session persistence and deduplication improvements.';

  useEffect(() => {
    try {
      const manifest = chrome?.runtime?.getManifest?.() as { version?: string } | undefined;
      setExtensionVersion(manifest?.version || '');
    } catch {}
  }, []);

  return { extensionVersion, releaseNotes } as const;
}
