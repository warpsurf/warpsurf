import { useCallback, useEffect, useRef, useState } from 'react';
import { warningsSettingsStore, generalSettingsStore } from '@extension/storage';
import HistoryPrivacyModal from '../components/modals/history-privacy-modal';

interface HistorySettings {
  windowHours: number;
  maxRawItems: number;
  maxProcessedItems: number;
}

export function useHistoryPrivacyGate(isDarkMode: boolean) {
  const [hasAcceptedHistoryPrivacy, setHasAcceptedHistoryPrivacy] = useState<boolean | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [historySettings, setHistorySettings] = useState<HistorySettings>({
    windowHours: 24,
    maxRawItems: 1000,
    maxProcessedItems: 50,
  });
  const resolveRef = useRef<((accepted: boolean) => void) | null>(null);

  // Load from storage on mount and subscribe
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const warnings = await warningsSettingsStore.getWarnings();
        if (!mounted) return;
        setHasAcceptedHistoryPrivacy(!!warnings.hasAcceptedHistoryPrivacyWarning);

        const settings = await generalSettingsStore.getSettings();
        if (!mounted) return;
        setHistorySettings({
          windowHours: settings.historySummaryWindowHours || 24,
          maxRawItems: settings.historySummaryMaxRawItems || 1000,
          maxProcessedItems: settings.historySummaryMaxProcessedItems || 50,
        });
      } catch {}
    };
    load();
    let unsubWarnings: (() => void) | undefined;
    let unsubGeneral: (() => void) | undefined;
    try { unsubWarnings = warningsSettingsStore.subscribe(load); } catch {}
    try { unsubGeneral = generalSettingsStore.subscribe(load); } catch {}
    return () => {
      mounted = false;
      try { unsubWarnings?.(); } catch {}
      try { unsubGeneral?.(); } catch {}
    };
  }, []);

  const promptHistoryPrivacy = useCallback(async (): Promise<boolean> => {
    // Reload settings to show latest values in modal
    try {
      const settings = await generalSettingsStore.getSettings();
      setHistorySettings({
        windowHours: settings.historySummaryWindowHours || 24,
        maxRawItems: settings.historySummaryMaxRawItems || 1000,
        maxProcessedItems: settings.historySummaryMaxProcessedItems || 50,
      });
    } catch {}

    setShowModal(true);
    return new Promise(resolve => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleAccept = useCallback(async () => {
    try {
      await warningsSettingsStore.updateWarnings({ hasAcceptedHistoryPrivacyWarning: true });
    } catch {}
    setHasAcceptedHistoryPrivacy(true);
    setShowModal(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleDecline = useCallback(() => {
    setShowModal(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const resetHistoryPrivacy = useCallback(async () => {
    try {
      await warningsSettingsStore.updateWarnings({ hasAcceptedHistoryPrivacyWarning: false });
    } catch {}
    setHasAcceptedHistoryPrivacy(false);
  }, []);

  const historyPrivacyModal = showModal ? (
    <HistoryPrivacyModal
      isDarkMode={isDarkMode}
      onAccept={handleAccept}
      onDecline={handleDecline}
      windowHours={historySettings.windowHours}
      maxRawItems={historySettings.maxRawItems}
      maxProcessedItems={historySettings.maxProcessedItems}
    />
  ) : null;

  return {
    hasAcceptedHistoryPrivacy,
    promptHistoryPrivacy,
    resetHistoryPrivacy,
    historyPrivacyModal,
  } as const;
}
