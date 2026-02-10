interface MicrophonePermissionOverlayProps {
  permissionState: 'prompt' | 'denied' | 'waiting' | null;
  isDarkMode?: boolean;
  onRequestPermission: () => void;
  onDismiss: () => void;
}

export function MicrophonePermissionOverlay({
  permissionState,
  isDarkMode = false,
  onRequestPermission,
  onDismiss,
}: MicrophonePermissionOverlayProps) {
  if (!permissionState) return null;

  const isDenied = permissionState === 'denied';
  const isWaiting = permissionState === 'waiting';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
      <div
        className={`mx-3 w-64 rounded-lg border p-4 shadow-lg text-center
        ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'}`}>
        {/* Icon */}
        <div
          className={`mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full
          ${isDarkMode ? 'bg-violet-900/30' : 'bg-violet-50'}`}>
          <svg
            className={`h-4 w-4 ${isDarkMode ? 'text-violet-400' : 'text-violet-500'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" strokeLinecap="round" />
            <line x1="8" y1="23" x2="16" y2="23" strokeLinecap="round" />
          </svg>
        </div>

        {/* Title */}
        <h3 className={`mb-1.5 text-sm font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          {isDenied ? 'Microphone Blocked' : 'Microphone Required'}
        </h3>

        {/* Description */}
        <p className={`mb-3 text-xs leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
          {isDenied
            ? 'Permission was denied. Click the lock icon in the address bar to re-enable microphone access.'
            : isWaiting
              ? 'Waiting for browser permission...'
              : 'Voice input requires microphone access. Audio is only used for transcription.'}
        </p>

        {/* Actions */}
        {!isDenied && !isWaiting && (
          <button
            type="button"
            onClick={onRequestPermission}
            className="mb-2 w-full rounded-md bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-600">
            Enable Microphone
          </button>
        )}

        {isWaiting && (
          <div className="mb-2 flex items-center justify-center gap-1.5">
            <svg className="h-3 w-3 animate-spin text-violet-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
              Waiting for permission...
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className={`text-xs transition-colors
            ${isDarkMode ? 'text-slate-500 hover:text-slate-300' : 'text-gray-400 hover:text-gray-600'}`}>
          {isDenied ? 'Dismiss' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
