import { useState, useCallback, useMemo } from 'react';

interface MicrophoneButtonProps {
  isRecording: boolean;
  isProcessing: boolean;
  recordingDurationMs: number;
  audioLevel: number;
  onClick: () => void;
  onStopClick: () => void;
  isDarkMode?: boolean;
  disabled?: boolean;
  disabledTooltip?: string;
  onOpenSettings?: () => void;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BAR_MULTIPLIERS = [0.6, 0.8, 1.0, 0.9, 0.7];

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" strokeLinecap="round" />
      <line x1="8" y1="23" x2="16" y2="23" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function MicrophoneButton({
  isRecording,
  isProcessing,
  recordingDurationMs,
  audioLevel,
  onClick,
  onStopClick,
  isDarkMode = false,
  disabled = false,
  disabledTooltip,
  onOpenSettings,
}: MicrophoneButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled || isProcessing) return;
      onClick();
    },
    [disabled, isProcessing, onClick],
  );

  const handleStop = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onStopClick();
    },
    [onStopClick],
  );

  const bars = useMemo(
    () =>
      BAR_MULTIPLIERS.map((mult, i) => ({
        key: i,
        height: Math.max(3, 3 + audioLevel * mult * 14),
      })),
    [audioLevel],
  );

  // Processing state
  if (isProcessing) {
    return (
      <div
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs
        ${isDarkMode ? 'bg-violet-950/40 text-violet-300' : 'bg-violet-50 text-violet-600'}`}>
        <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
        <span className="font-medium">Transcribing</span>
      </div>
    );
  }

  // Recording state
  if (isRecording) {
    return (
      <div
        className={`flex items-center gap-2 rounded-full px-2.5 py-1 ring-1
        ${isDarkMode ? 'bg-rose-950/30 ring-rose-500/30 text-rose-300' : 'bg-rose-50 ring-rose-300/50 text-rose-600'}`}>
        <div className="flex items-center gap-0.5 h-4">
          {bars.map(b => (
            <div
              key={b.key}
              className={`w-[3px] rounded-full transition-all duration-75
                ${isDarkMode ? 'bg-rose-400' : 'bg-rose-500'}`}
              style={{ height: `${b.height}px` }}
            />
          ))}
        </div>
        <span className="font-mono text-xs font-medium tabular-nums w-8 text-center">
          {formatDuration(recordingDurationMs)}
        </span>
        <button
          type="button"
          onClick={handleStop}
          className={`flex items-center justify-center h-5 w-5 rounded-full transition-colors
            ${
              isDarkMode
                ? 'bg-rose-500/20 hover:bg-rose-500/40 text-rose-300'
                : 'bg-rose-200 hover:bg-rose-300 text-rose-600'
            }`}
          aria-label="Stop recording">
          <StopIcon className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  // Idle state
  return (
    <div
      className="relative"
      onMouseEnter={() => disabled && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label="Record voice input"
        className={`p-1.5 rounded-lg transition-colors
          ${
            disabled
              ? 'opacity-40 cursor-not-allowed'
              : isDarkMode
                ? 'text-slate-400 hover:text-violet-400 hover:bg-slate-700/50'
                : 'text-gray-400 hover:text-violet-500 hover:bg-gray-100'
          }`}>
        <MicIcon className="h-4 w-4" />
      </button>
      {showTooltip && disabled && (
        <div
          className={`absolute bottom-full left-0 mb-1.5 w-44 rounded-md border px-2.5 py-2 text-xs shadow-md z-20
          ${isDarkMode ? 'border-slate-600 bg-slate-800 text-slate-300' : 'border-gray-200 bg-white text-gray-600'}`}>
          <p className="leading-snug">{disabledTooltip || 'Voice input unavailable'}</p>
          {onOpenSettings && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onOpenSettings();
                setShowTooltip(false);
              }}
              className="mt-1.5 text-violet-400 hover:text-violet-300 font-medium">
              Open Voice Settings →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
