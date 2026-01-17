import { useCallback, useEffect, useRef, useState } from 'react';
import { warningsSettingsStore } from '@extension/storage';
import AutoTabContextPrivacyModal from '../components/modals/auto-tab-context-privacy-modal';

export function useAutoTabContextPrivacyGate(isDarkMode: boolean) {
  const [hasAcceptedAutoTabContextPrivacy, setHasAcceptedAutoTabContextPrivacy] = useState<boolean | null>(null);
  const [showModal, setShowModal] = useState(false);
  const resolveRef = useRef<((accepted: boolean) => void) | null>(null);

  // Load from storage on mount and subscribe
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const warnings = await warningsSettingsStore.getWarnings();
        if (!mounted) return;
        setHasAcceptedAutoTabContextPrivacy(!!warnings.hasAcceptedAutoTabContextPrivacyWarning);
      } catch {}
    };
    load();
    let unsub: (() => void) | undefined;
    try {
      unsub = warningsSettingsStore.subscribe(load);
    } catch {}
    return () => {
      mounted = false;
      try {
        unsub?.();
      } catch {}
    };
  }, []);

  const promptAutoTabContextPrivacy = useCallback(async (): Promise<boolean> => {
    setShowModal(true);
    return new Promise(resolve => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleAccept = useCallback(async () => {
    try {
      await warningsSettingsStore.updateWarnings({ hasAcceptedAutoTabContextPrivacyWarning: true });
    } catch {}
    setHasAcceptedAutoTabContextPrivacy(true);
    setShowModal(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleDecline = useCallback(() => {
    setShowModal(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const resetAutoTabContextPrivacy = useCallback(async () => {
    try {
      await warningsSettingsStore.updateWarnings({ hasAcceptedAutoTabContextPrivacyWarning: false });
    } catch {}
    setHasAcceptedAutoTabContextPrivacy(false);
  }, []);

  const autoTabContextPrivacyModal = showModal ? (
    <AutoTabContextPrivacyModal isDarkMode={isDarkMode} onAccept={handleAccept} onDecline={handleDecline} />
  ) : null;

  return {
    hasAcceptedAutoTabContextPrivacy,
    promptAutoTabContextPrivacy,
    resetAutoTabContextPrivacy,
    autoTabContextPrivacyModal,
  } as const;
}
