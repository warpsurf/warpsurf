import { useCallback, useEffect, useRef, useState } from 'react';
import { warningsSettingsStore } from '@extension/storage';
import { FIRST_RUN_DISCLAIMER_MESSAGE, PER_CHAT_DISCLAIMER_MESSAGE, PER_CHAT_DISCLAIMER_EXTRA_NOTE } from '@extension/shared';
import DisclaimerModal from '../components/modals/disclaimer-modal';
import LivePricingModal from '../components/modals/live-pricing-modal';

export function useDisclaimerGates(isDarkMode: boolean) {
  const [firstRunAccepted, setFirstRunAccepted] = useState<boolean | null>(null);
  const [disablePerChatWarnings, setDisablePerChatWarnings] = useState<boolean>(false);
  const [hasAcceptedPerChat, setHasAcceptedPerChat] = useState<boolean>(false);
  const [perChatOpen, setPerChatOpen] = useState<boolean>(false);
  const perChatResolveRef = useRef<(() => void) | null>(null);
  
  // Live pricing data opt-in state
  const [hasRespondedToLivePricing, setHasRespondedToLivePricing] = useState<boolean | null>(null);

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
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = warningsSettingsStore.subscribe(load); } catch {}
    return () => { mounted = false; try { unsubscribe && unsubscribe(); } catch {} };
  }, []);

  const resetPerChatAcceptance = useCallback(() => {
    setHasAcceptedPerChat(false);
  }, []);

  const promptPerChatIfEnabled = useCallback(() => {
    if (!disablePerChatWarnings) {
      setPerChatOpen(true);
    }
  }, [disablePerChatWarnings]);

  const ensurePerChatBeforeNewSession = useCallback(async (isFollowUpMode: boolean, hasSessionId: boolean) => {
    if (isFollowUpMode || hasSessionId || disablePerChatWarnings || hasAcceptedPerChat) {
      return;
    }
    // Open modal and await acceptance
    setPerChatOpen(true);
    await new Promise<void>(resolve => {
      perChatResolveRef.current = resolve;
    });
  }, [disablePerChatWarnings, hasAcceptedPerChat]);

  const firstRunModal = (firstRunAccepted !== true) ? (
    <DisclaimerModal
      isDarkMode={isDarkMode}
      message={FIRST_RUN_DISCLAIMER_MESSAGE}
      onAccept={async () => {
        try { await warningsSettingsStore.updateWarnings({ hasAcceptedFirstRun: true }); } catch {}
        setFirstRunAccepted(true);
      }}
    />
  ) : null;

  const perChatModal = (perChatOpen && firstRunAccepted === true && hasRespondedToLivePricing === true) ? (
    <DisclaimerModal
      isDarkMode={isDarkMode}
      message={PER_CHAT_DISCLAIMER_MESSAGE}
      extraNote={PER_CHAT_DISCLAIMER_EXTRA_NOTE}
      onAccept={() => {
        setHasAcceptedPerChat(true);
        setPerChatOpen(false);
        try { perChatResolveRef.current?.(); } finally { perChatResolveRef.current = null; }
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

  const livePricingModal = (firstRunAccepted === true && hasRespondedToLivePricing === false) ? (
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


