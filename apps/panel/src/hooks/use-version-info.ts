import { useEffect, useState } from 'react';

export function useVersionInfo() {
  const [extensionVersion, setExtensionVersion] = useState<string>('');
  const releaseNotes =
    'Added context tabs to all workflows, improved agent trajectories, fixed agent previews, improved agent prompting.';

  useEffect(() => {
    try {
      const manifest = chrome?.runtime?.getManifest?.() as { version?: string } | undefined;
      setExtensionVersion(manifest?.version || '');
    } catch {}
  }, []);

  return { extensionVersion, releaseNotes } as const;
}
