import { useEffect, useState } from 'react';

export function useVersionInfo() {
  const [extensionVersion, setExtensionVersion] = useState<string>('');
  const releaseNotes = 'Added agent manager & tab context to model responses.';

  useEffect(() => {
    try {
      const manifest = chrome?.runtime?.getManifest?.() as { version?: string } | undefined;
      setExtensionVersion(manifest?.version || '');
    } catch {}
  }, []);

  return { extensionVersion, releaseNotes } as const;
}
