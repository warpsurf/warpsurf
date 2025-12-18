import { useState, useEffect, useCallback, useRef } from 'react';

export type ActionKey = 'newChat' | 'history' | 'dashboard' | 'agentSettings' | 'feedback' | 'fish' | 'settings';

interface UseHeaderOverflowProps {
  pauseRecalculation?: boolean;
}

export function useHeaderOverflow({ pauseRecalculation }: UseHeaderOverflowProps = {}) {
  const actionsContainerRef = useRef<HTMLDivElement>(null);
  const moreButtonMeasureRef = useRef<HTMLButtonElement>(null);
  const actionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const measureRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const internalKeys: readonly ActionKey[] = ['newChat','history','dashboard','agentSettings','feedback','fish','settings'];
  const [visibleActionsCount, setVisibleActionsCount] = useState<number>(internalKeys.length);
  const [moreMenuOpen, setMoreMenuOpen] = useState<boolean>(false);

  const setActionRef = (key: ActionKey) => (el: HTMLDivElement | null) => {
    actionRefs.current[key] = el;
  };
  const setMeasureRef = (key: ActionKey) => (el: HTMLDivElement | null) => {
    (measureRefs.current as any)[key] = el;
  };

  const measurementInProgress = useRef(false);

  const recalcVisibleActions = useCallback(() => {
    const container = actionsContainerRef.current;
    if (!container || measurementInProgress.current || pauseRecalculation || moreMenuOpen) return;

    measurementInProgress.current = true;

    requestAnimationFrame(() => {
      if (!container) {
        measurementInProgress.current = false;
        return;
      }

      const available = container.clientWidth;
      if (available <= 60) {
        setVisibleActionsCount(0);
        measurementInProgress.current = false;
        return;
      }

      const computed = getComputedStyle(container);
      const gapStr = (computed as any).columnGap || (computed as any).gap || '8px';
      const gapPx = Number.parseFloat(gapStr) || 8;

      const widths = internalKeys.map(key => {
        const el = (measureRefs.current as any)[key] || actionRefs.current[key];
        if (el && el.offsetWidth) {
          return Math.ceil(el.offsetWidth);
        }
        return 0;
      });

      const n = widths.length;
      const moreWidth = moreButtonMeasureRef.current?.offsetWidth || 100;

      let visibleCount = 0;
      for (let k = n; k >= 0; k--) {
        let totalWidth = 0;
        for (let i = 0; i < k; i++) {
          if (i > 0) totalWidth += gapPx;
          totalWidth += widths[i];
        }
        if (k < n) {
          if (k > 0) totalWidth += gapPx;
          totalWidth += moreWidth;
        }
        if (totalWidth <= available) {
          visibleCount = k;
          break;
        }
      }

      setVisibleActionsCount(prev => {
        if (visibleCount === prev) {
          measurementInProgress.current = false;
          return prev;
        }
        const BUFFER = 12;
        if (Math.abs(visibleCount - prev) === 1) {
          let currentWidth = 0;
          for (let i = 0; i < prev; i++) {
            if (i > 0) currentWidth += gapPx;
            currentWidth += widths[i];
          }
          if (prev < n) {
            if (prev > 0) currentWidth += gapPx;
            currentWidth += moreWidth;
          }
          const spaceDiff = available - currentWidth;
          if (visibleCount > prev) {
            if (spaceDiff < widths[prev] + gapPx + BUFFER) {
              measurementInProgress.current = false;
              return prev;
            }
          } else {
            if (Math.abs(spaceDiff) < BUFFER) {
              measurementInProgress.current = false;
              return prev;
            }
          }
        }
        measurementInProgress.current = false;
        return visibleCount;
      });
    });
  }, [pauseRecalculation, moreMenuOpen]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let ro: ResizeObserver | null = null;

    const debouncedRecalc = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (pauseRecalculation || moreMenuOpen) return;
        recalcVisibleActions();
      }, 120);
    };

    if (actionsContainerRef.current) {
      ro = new ResizeObserver(debouncedRecalc);
      ro.observe(actionsContainerRef.current);
    }

    recalcVisibleActions();
    setTimeout(recalcVisibleActions, 50);
    setTimeout(recalcVisibleActions, 150);

    window.addEventListener('resize', debouncedRecalc);

    if ((document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => {
        setTimeout(recalcVisibleActions, 50);
      });
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('resize', debouncedRecalc);
      if (ro) ro.disconnect();
    };
  }, [recalcVisibleActions, pauseRecalculation, moreMenuOpen]);

  return {
    actionsContainerRef,
    moreButtonMeasureRef,
    setActionRef,
    setMeasureRef,
    visibleActionsCount,
    moreMenuOpen,
    setMoreMenuOpen,
  } as const;
}
