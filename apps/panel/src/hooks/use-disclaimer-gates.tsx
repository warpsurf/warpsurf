import { useCallback, useEffect, useRef, useState } from 'react';
import { warningsSettingsStore } from '@extension/storage';
import {
  FIRST_RUN_DISCLAIMER_MESSAGE,
  PER_CHAT_DISCLAIMER_MESSAGE,
  PER_CHAT_DISCLAIMER_EXTRA_NOTE,
} from '@extension/shared';
import DisclaimerModal from '../components/modals/disclaimer-modal';
import LivePricingModal from '../components/modals/live-pricing-modal';

export function useDisclaimerGates(isDarkMode: boolean) {
  const [firstRunAccepted, setFirstRunAccepted] = useState<boolean | null>(null);
  const [disablePerChatWarnings, setDisablePerChatWarnings] = useState<boolean>(false);
  const [hasAcceptedPerChat, setHasAcceptedPerChat] = useState<boolean>(false);
  const [perChatOpen, setPerChatOpen] = useState<boolean>(false);
  const [hasRespondedToLivePricing, setHasRespondedToLivePricing] = useState<boolean | null>(null);

  const perChatResolveRef = useRef<(() => void) | null>(null);
  // Track per-chat acceptance for immediate access (local session state, not persisted)
  const hasAcceptedPerChatRef = useRef(false);

  // Load settings and subscribe for changes
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const w = await warningsSettingsStore.getWarnings();
        if (!mounted) return;
        setFirstRunAccepted(!!w.hasAcceptedFirstRun);
        setDisablePerChatWarnings(!!w.disablePerChatWarnings);
        setHasRespondedToLivePricing(!!w.hasRespondedToLivePricingPrompt);
      } catch {}
    };
    load();
    const unsubscribe = warningsSettingsStore.subscribe(load);
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const resetPerChatAcceptance = useCallback(() => {
    setHasAcceptedPerChat(false);
    hasAcceptedPerChatRef.current = false;
  }, []);

  /**
   * Prompt per-chat warning if enabled. Reads from storage to ensure latest value.
   */
  const promptPerChatIfEnabled = useCallback(async (): Promise<boolean> => {
    try {
      const settings = await warningsSettingsStore.getWarnings();
      if (settings.disablePerChatWarnings) return false;
      setPerChatOpen(true);
      return true;
    } catch {
      // Fail-safe: show warning on error
      setPerChatOpen(true);
      return true;
    }
  }, []);

  /**
   * Ensure per-chat warning is accepted before new session.
   * Reads from storage to ensure latest setting value.
   */
  const ensurePerChatBeforeNewSession = useCallback(async (isFollowUpMode: boolean, hasSessionId: boolean) => {
    if (isFollowUpMode || hasSessionId || hasAcceptedPerChatRef.current) return;

    try {
      const settings = await warningsSettingsStore.getWarnings();
      if (settings.disablePerChatWarnings) return;
    } catch {
      // Fail-safe: show warning on error
    }

    setPerChatOpen(true);
    await new Promise<void>(resolve => {
      perChatResolveRef.current = resolve;
    });
  }, []);

  const firstRunModal =
    firstRunAccepted !== true ? (
      <DisclaimerModal
        isDarkMode={isDarkMode}
        message={FIRST_RUN_DISCLAIMER_MESSAGE}
        onAccept={async () => {
          try {
            await warningsSettingsStore.updateWarnings({ hasAcceptedFirstRun: true });
          } catch {}
          setFirstRunAccepted(true);
        }}
      />
    ) : null;

  const perChatModal =
    perChatOpen && firstRunAccepted === true && hasRespondedToLivePricing === true ? (
      <DisclaimerModal
        isDarkMode={isDarkMode}
        message={PER_CHAT_DISCLAIMER_MESSAGE}
        extraNote={PER_CHAT_DISCLAIMER_EXTRA_NOTE}
        onAccept={() => {
          setHasAcceptedPerChat(true);
          hasAcceptedPerChatRef.current = true;
          setPerChatOpen(false);
          perChatResolveRef.current?.();
          perChatResolveRef.current = null;
        }}
      />
    ) : null;

  // Live pricing modal - shown after first run, before per-chat
  const handleLivePricingChoice = async (useLive: boolean) => {
    try {
      await warningsSettingsStore.updateWarnings({
        hasRespondedToLivePricingPrompt: true,
        useLivePricingData: useLive,
      });
      // Trigger model registry reinitialization
      chrome.runtime.sendMessage({ type: 'reinitialize_model_registry' }).catch(() => {});
    } catch {}
    setHasRespondedToLivePricing(true);
  };

  const livePricingModal =
    firstRunAccepted === true && hasRespondedToLivePricing === false ? (
      <LivePricingModal
        isDarkMode={isDarkMode}
        onChooseLive={() => handleLivePricingChoice(true)}
        onChooseCached={() => handleLivePricingChoice(false)}
      />
    ) : null;

  return {
    firstRunAccepted,
    disablePerChatWarnings,
    resetPerChatAcceptance,
    promptPerChatIfEnabled,
    ensurePerChatBeforeNewSession,
    firstRunModal,
    livePricingModal,
    perChatModal,
  } as const;
}
