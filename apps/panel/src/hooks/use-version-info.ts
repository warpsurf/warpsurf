import { useEffect, useState } from 'react';

export function useVersionInfo() {
  const [extensionVersion, setExtensionVersion] = useState<string>('');
  const releaseNotes =
    'Added Microsoft Edge browser compatibility with Edge-specific URL handling, script injection guards, and updated documentation.';

  useEffect(() => {
    try {
      const manifest = chrome?.runtime?.getManifest?.() as { version?: string } | undefined;
      setExtensionVersion(manifest?.version || '');
    } catch {}
  }, []);

  return { extensionVersion, releaseNotes } as const;
}
