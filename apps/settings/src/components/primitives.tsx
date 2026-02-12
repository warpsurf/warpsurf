import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const cn = (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(' ');

/**
 * Determine whether a model supports configurable thinking/reasoning.
 * Returns true for any model where a thinking level dropdown is useful.
 * The value passed may be "provider>model" from the UI selector.
 */
export function isThinkingCapableModel(modelName: string): boolean {
  // Strip "provider>" prefix used in the settings UI value format
  const raw = modelName.includes('>') ? modelName.split('>')[1] : modelName;
  // Strip OpenRouter provider prefix (e.g. "openai/gpt-5" -> "gpt-5")
  const name = raw.includes('/') ? raw.split('/').pop()! : raw;
  const l = name.toLowerCase();

  // OpenAI reasoning models
  if (/^(o1|o3|o4|gpt-5)/.test(l)) return true;
  // Anthropic thinking-capable models (Opus 4+, Sonnet 4+, Sonnet 3.7, Haiku 4.5)
  if (/^claude-(opus-4|sonnet-4|sonnet-3-7|3-7-sonnet|haiku-4-5)/.test(l)) return true;
  // Gemini 2.5+ and 3 models
  if (/^gemini-(2\.5|3-)/.test(l)) return true;
  // Grok reasoning models
  if (/^grok-(4|3-mini)/.test(l)) return true;

  return false;
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
                isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-gray-200 text-gray-700',
              )}>
              ?
            </span>
            <span
              className={cn(
                'pointer-events-none absolute bottom-full left-0 z-[9999] mb-1 hidden w-48 whitespace-normal rounded px-2 py-1 text-[10px] shadow-lg group-hover:block',
                isDarkMode
                  ? 'bg-slate-900 text-slate-100 border border-slate-700'
                  : 'bg-gray-900 text-white border border-gray-800',
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
  toneClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-xl border p-5 text-left shadow-sm backdrop-blur-md', toneClass)}>
      <h2 className={cn('mb-4 text-lg font-semibold', isDarkMode ? 'text-gray-200' : 'text-gray-800')}>
        <span className="inline-flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </span>
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
          background: `linear-gradient(to right, ${isDarkMode ? '#3b82f6' : '#60a5fa'} 0%, ${isDarkMode ? '#3b82f6' : '#60a5fa'} ${((value - min) / (max - min)) * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} ${((value - min) / (max - min)) * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} 100%)`,
        }}
        className={cn('h-1 flex-1 appearance-none rounded-full', isDarkMode ? 'accent-blue-500' : 'accent-blue-400')}
      />
      <div className="flex items-center space-x-2">
        <span className={cn('w-12 text-sm', isDarkMode ? 'text-gray-300' : 'text-gray-600')}>
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
            'w-20 rounded-md border px-2 py-1 text-sm',
            isDarkMode
              ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800'
              : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200',
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

  if (value === undefined) {
    // Show "Default" state with button to customize
    return (
      <div className="flex flex-1 items-center justify-end space-x-3">
        <span className={cn('text-sm italic', isDarkMode ? 'text-gray-400' : 'text-gray-500')}>
          Using provider default
        </span>
        <button
          type="button"
          onClick={() => onChange(1.0)}
          className={cn(
            'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
            isDarkMode
              ? 'border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600'
              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
          )}
          aria-label="Set custom temperature">
          Customize
        </button>
      </div>
    );
  }

  // Show slider with reset button
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
          background: `linear-gradient(to right, ${isDarkMode ? '#3b82f6' : '#60a5fa'} 0%, ${isDarkMode ? '#3b82f6' : '#60a5fa'} ${((displayValue - min) / (max - min)) * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} ${((displayValue - min) / (max - min)) * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} 100%)`,
        }}
        className={cn('h-1 flex-1 appearance-none rounded-full', isDarkMode ? 'accent-blue-500' : 'accent-blue-400')}
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
            'w-16 rounded-md border px-2 py-1 text-sm',
            isDarkMode
              ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800'
              : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200',
          )}
          aria-label={ariaLabel}
        />
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className={cn(
            'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
            isDarkMode
              ? 'border-slate-600 bg-slate-700 text-gray-400 hover:bg-slate-600 hover:text-gray-300'
              : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-600',
          )}
          title="Reset to provider default"
          aria-label="Reset temperature to provider default">
          Reset to default
        </button>
      </div>
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
      const clickedInsideContainer = containerRef.current && containerRef.current.contains(target);
      const clickedInsideMenu = menuRef.current && menuRef.current.contains(target);
      if (!clickedInsideContainer && !clickedInsideMenu) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const computeMenuPosition = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const gap = 4;
    const menuH = menuRef.current?.offsetHeight || 224; // ~max-h-56 default

    let top = rect.bottom + gap; // try open downward first
    // Flip upward if clipped at bottom and there's more space above
    if (top + menuH > viewportH && rect.top - gap - menuH >= 0) {
      top = rect.top - gap - menuH;
    }

    let left = rect.left;
    const width = rect.width;
    // Clamp horizontally within viewport
    if (left + width > viewportW - 8) {
      left = Math.max(8, viewportW - width - 8);
    }
    if (left < 8) left = 8;

    // Ensure top within viewport
    if (top < 8) top = 8;
    if (top > viewportH - 8) top = viewportH - 8;

    setMenuStyle({ left, top, width });
  };

  useEffect(() => {
    if (!open) return;
    const update = () => computeMenuPosition();
    // Initial position, then re-measure after paint to get actual menu height
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, query, options.length]);

  const selectedLabel = (() => {
    const match = options.find(o => o.value === value);
    if (match) return match.label;
    if (!value) return 'Choose model';
    // Show stored model name when not in available options (e.g., provider changed)
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
          'w-full rounded-md border px-3 py-2 text-left text-sm',
          isDarkMode ? 'border-slate-600 bg-slate-800/70 text-gray-200' : 'border-white/20 bg-white/60 text-gray-800',
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
              'fixed rounded-md border p-2 shadow-lg',
              isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white',
            )}
            style={{ left: menuStyle.left, top: menuStyle.top, width: menuStyle.width, zIndex: 2147483647 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search models..."
              className={cn(
                'mb-2 w-full rounded border px-2 py-1 text-sm outline-none',
                isDarkMode
                  ? 'border-slate-600 bg-slate-700 text-gray-200 placeholder-slate-400'
                  : 'border-gray-300 bg-white text-gray-700 placeholder-gray-400',
              )}
            />
            <ul role="listbox" className="max-h-56 overflow-auto">
              {filtered.length === 0 && (
                <li className={cn('px-2 py-1 text-sm', isDarkMode ? 'text-slate-400' : 'text-gray-500')}>No matches</li>
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
                      'flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-black/5',
                      isDarkMode ? 'hover:bg-white/10 text-gray-200' : 'text-gray-800',
                    )}
                    role="option"
                    aria-selected={opt.value === value}>
                    <span>{opt.label}</span>
                    {/* Removed recommended badge */}
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
