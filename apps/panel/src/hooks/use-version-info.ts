import { useEffect, useState } from 'react';

export function useVersionInfo() {
  const [extensionVersion, setExtensionVersion] = useState<string>('');
  const releaseNotes =
    'Python SDK for programmatic browser agent control, tab preview performance improvements, and refreshed data caches.';

  useEffect(() => {
    try {
      const manifest = chrome?.runtime?.getManifest?.() as { version?: string } | undefined;
      setExtensionVersion(manifest?.version || '');
    } catch {}
  }, []);

  return { extensionVersion, releaseNotes } as const;
}
