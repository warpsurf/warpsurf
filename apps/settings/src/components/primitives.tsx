import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const cn = (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(' ');

/**
 * @deprecated Thinking level is now always shown in the UI regardless of model.
 * The backend handles unsupported models by ignoring the thinking param.
 * Users can set thinking to "Default" for models that don't support it.
 */
export function isThinkingCapableModel(_modelName: string): boolean {
  return true;
}

/** @deprecated Use isThinkingCapableModel instead */
export function isOpenAIOModel(modelName: string): boolean {
  return isThinkingCapableModel(modelName);
}

export function LabelWithTooltip({
  isDarkMode,
  label,
  tooltip,
  htmlFor,
  width = 'w-24',
}: {
  isDarkMode: boolean;
  label: string;
  tooltip?: string;
  htmlFor?: string;
  width?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(width, 'text-sm font-medium', isDarkMode ? 'text-gray-300' : 'text-gray-700')}>
      <span className="group relative inline-flex items-center gap-1 pb-1">
        {label}
        {tooltip && (
          <>
            <span
              className={cn(
                'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
                isDarkMode ? 'bg-[#3a3a34] text-gray-400' : 'bg-[#e5e4de] text-gray-600',
              )}>
              ?
            </span>
            <span
              className={cn(
                'pointer-events-none absolute bottom-full left-0 z-[9999] mb-1 hidden w-48 whitespace-normal rounded-lg px-2 py-1 text-[10px] group-hover:block',
                isDarkMode
                  ? 'bg-[#252522] text-gray-300 border border-[#3a3a34]'
                  : 'bg-white text-gray-700 border border-[#dddcd5]',
              )}>
              {tooltip}
            </span>
          </>
        )}
      </span>
    </label>
  );
}

export function SectionCard({
  isDarkMode,
  title,
  icon,
  toneClass,
  children,
}: {
  isDarkMode: boolean;
  title: string;
  icon?: React.ReactNode;
  toneClass?: string;
  children: React.ReactNode;
}) {
  const defaultClass = isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]';
  return (
    <div className={cn('rounded-xl border p-5 text-left', toneClass || defaultClass)}>
      <h2
        className={cn(
          'mb-4 flex items-center gap-2 text-base font-semibold',
          isDarkMode ? 'text-gray-100' : 'text-gray-900',
        )}>
        {icon}
        <span>{title}</span>
      </h2>
      {children}
    </div>
  );
}

export function SliderWithNumber({
  isDarkMode,
  id,
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
}: {
  isDarkMode: boolean;
  id: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const trackColor = isDarkMode ? '#3a3a34' : '#dddcd5';
  const fillColor = isDarkMode ? '#6b7280' : '#9ca3af';
  return (
    <div className="flex flex-1 items-center space-x-2">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number.parseFloat(e.target.value))}
        style={{
          background: `linear-gradient(to right, ${fillColor} 0%, ${fillColor} ${pct}%, ${trackColor} ${pct}%, ${trackColor} 100%)`,
        }}
        className="h-1 flex-1 appearance-none rounded-full"
      />
      <div className="flex items-center space-x-2">
        <span className={cn('w-12 text-sm', isDarkMode ? 'text-gray-400' : 'text-gray-500')}>
          {value.toFixed(step <= 0.01 ? 1 : 2)}
        </span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => {
            const v = Number.parseFloat(e.target.value);
            if (!Number.isNaN(v) && v >= min && v <= max) onChange(v);
          }}
          className={cn(
            'w-20 rounded-lg border px-2 py-1 text-sm outline-none',
            isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700',
          )}
          aria-label={ariaLabel}
        />
      </div>
    </div>
  );
}

/**
 * Temperature control with support for "provider default" (undefined) state.
 * When value is undefined, shows "Default" and a button to set custom temperature.
 * When value is set, shows slider with a reset button to return to default.
 */
export function TemperatureControl({
  isDarkMode,
  id,
  value,
  onChange,
  ariaLabel,
}: {
  isDarkMode: boolean;
  id: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  ariaLabel: string;
}) {
  const min = 0;
  const max = 2;
  const step = 0.01;
  const displayValue = value ?? 1.0; // Default display value when switching from default

  const btnClass = cn(
    'rounded-lg px-3 py-1 text-xs font-medium',
    isDarkMode ? 'bg-[#2a2a26] text-gray-300 hover:bg-[#33332e]' : 'bg-[#ecebe5] text-gray-600 hover:bg-[#dfddd4]',
  );

  if (value === undefined) {
    return (
      <div className="flex flex-1 items-center justify-end space-x-3">
        <span className={cn('text-sm', isDarkMode ? 'text-gray-500' : 'text-gray-500')}>Provider default</span>
        <button type="button" onClick={() => onChange(1.0)} className={btnClass}>
          Customize
        </button>
      </div>
    );
  }

  const pct = ((displayValue - min) / (max - min)) * 100;
  const trackColor = isDarkMode ? '#3a3a34' : '#dddcd5';
  const fillColor = isDarkMode ? '#6b7280' : '#9ca3af';

  return (
    <div className="flex flex-1 items-center space-x-2">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={e => onChange(Number.parseFloat(e.target.value))}
        style={{
          background: `linear-gradient(to right, ${fillColor} 0%, ${fillColor} ${pct}%, ${trackColor} ${pct}%, ${trackColor} 100%)`,
        }}
        className="h-1 flex-1 appearance-none rounded-full"
      />
      <div className="flex items-center space-x-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          onChange={e => {
            const v = Number.parseFloat(e.target.value);
            if (!Number.isNaN(v) && v >= min && v <= max) onChange(v);
          }}
          className={cn(
            'w-16 rounded-lg border px-2 py-1 text-sm outline-none',
            isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700',
          )}
          aria-label={ariaLabel}
        />
        <button type="button" onClick={() => onChange(undefined)} className={btnClass}>
          Reset
        </button>
      </div>
    </div>
  );
}

/**
 * Animated save indicator that shows briefly after settings are saved.
 */
export function SaveIndicator({
  show,
  isDarkMode,
  message = 'Saved',
}: {
  show: boolean;
  isDarkMode: boolean;
  message?: string;
}) {
  if (!show) return null;
  return (
    <span
      className={cn(
        'ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium animate-in fade-in slide-in-from-left-2 duration-200 shrink-0',
        isDarkMode ? 'bg-green-900/60 text-green-300' : 'bg-green-100 text-green-700',
      )}>
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      {message}
    </span>
  );
}

/**
 * Hook to manage save indicator visibility with auto-hide.
 */
export function useSaveIndicator(duration = 2000) {
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShow(true);
    timeoutRef.current = setTimeout(() => setShow(false), duration);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { show, trigger };
}

/**
 * Confirms a storage write by listening for chrome.storage.onChanged.
 * Call markPending() before writing; confirmed becomes true once the
 * change event fires, proving the background can see the new value.
 */
export function useStorageConfirmation(storageKey: string, duration = 2000) {
  const [confirmed, setConfirmed] = useState(false);
  const pendingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[storageKey] && pendingRef.current) {
        pendingRef.current = false;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setConfirmed(true);
        timeoutRef.current = setTimeout(() => setConfirmed(false), duration);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [storageKey, duration]);

  const markPending = () => {
    pendingRef.current = true;
  };
  return { confirmed, markPending };
}

/**
 * Apply button with integrated save confirmation indicator.
 * Disabled when there are no pending changes.
 */
export function SectionApplyButton({
  isDarkMode,
  isDirty,
  isApplying,
  confirmed,
  onApply,
  message = 'Saved',
}: {
  isDarkMode: boolean;
  isDirty: boolean;
  isApplying?: boolean;
  confirmed: boolean;
  onApply: () => void;
  message?: string;
}) {
  const disabled = !isDirty || isApplying;
  return (
    <div className="flex items-center gap-2 pt-3">
      <button
        type="button"
        onClick={onApply}
        disabled={disabled}
        className={cn(
          'rounded-lg px-3 py-2 text-sm font-medium',
          isDarkMode
            ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]'
            : 'bg-[#ecebe5] text-gray-800 hover:bg-[#dfddd4]',
          disabled && 'opacity-50 cursor-not-allowed',
        )}>
        {isApplying ? 'Applying...' : 'Apply'}
      </button>
      <SaveIndicator show={confirmed} isDarkMode={isDarkMode} message={message} />
    </div>
  );
}

export function ModelComboBox({
  isDarkMode,
  id,
  value,
  options,
  onChange,
}: {
  isDarkMode: boolean;
  id: string;
  value: string;
  options: Array<{ value: string; label: string; isRecommended?: boolean }>;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; width: number }>({
    left: 0,
    top: 0,
    width: 0,
  });
  const filtered = useMemo(
    () => options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const computeMenuPosition = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const gap = 4;
    const menuH = menuRef.current?.offsetHeight || 224;
    let top = rect.bottom + gap;
    if (top + menuH > viewportH && rect.top - gap - menuH >= 0) top = rect.top - gap - menuH;
    setMenuStyle({ left: rect.left, top: Math.max(8, Math.min(top, viewportH - 8)), width: rect.width });
  };

  useEffect(() => {
    if (!open) return;
    computeMenuPosition();
    const raf = requestAnimationFrame(computeMenuPosition);
    window.addEventListener('scroll', computeMenuPosition, true);
    window.addEventListener('resize', computeMenuPosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', computeMenuPosition, true);
      window.removeEventListener('resize', computeMenuPosition);
    };
  }, [open, query, options.length]);

  const selectedLabel = (() => {
    const match = options.find(o => o.value === value);
    if (match) return match.label;
    if (!value) return 'Choose model';
    const modelName = value.includes('>') ? value.split('>')[1] : value;
    return `${modelName} (unavailable)`;
  })();

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen(o => !o);
          setTimeout(() => {
            computeMenuPosition();
            inputRef.current?.focus();
          }, 0);
        }}
        className={cn(
          'w-full rounded-lg border px-3 py-2 text-left text-sm',
          isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}>
        {selectedLabel}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={cn(
              'fixed rounded-xl border p-2',
              isDarkMode ? 'border-[#3a3a34] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-white',
            )}
            style={{ left: menuStyle.left, top: menuStyle.top, width: menuStyle.width, zIndex: 2147483647 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search..."
              className={cn(
                'mb-2 w-full rounded-lg border px-2 py-1.5 text-sm outline-none',
                isDarkMode
                  ? 'border-[#3a3a34] bg-[#252522] text-gray-200 placeholder-gray-600'
                  : 'border-[#dddcd5] bg-white text-gray-700 placeholder-gray-400',
              )}
            />
            <ul role="listbox" className="max-h-56 overflow-auto">
              {filtered.length === 0 && (
                <li className={cn('px-2 py-1 text-sm', isDarkMode ? 'text-gray-500' : 'text-gray-500')}>No matches</li>
              )}
              {filtered.map(opt => (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={cn(
                      'w-full rounded-lg px-2 py-1.5 text-left text-sm',
                      isDarkMode ? 'text-gray-300 hover:bg-[#252522]' : 'text-gray-700 hover:bg-[#f3f2ee]',
                    )}
                    role="option"
                    aria-selected={opt.value === value}>
                    {opt.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
