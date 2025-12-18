// Logging utility that forwards logs to background script
export function createLogger(portRef: React.MutableRefObject<chrome.runtime.Port | null>) {
  const formatArgs = (args: any[]): string => {
    return args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          // For small objects, inline them
          const str = JSON.stringify(arg);
          if (str.length <= 100) {
            return str;
          }
          // For larger objects, pretty print
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          // Handle circular references
          return '[Complex Object]';
        }
      }
      return String(arg);
    }).join(' ');
  };

  const log = (...args: any[]) => {
    // Log to local console with original formatting
    console.log(...args);
    
    // Forward to background if port is available
    if (portRef.current?.name === 'side-panel-connection') {
      try {
        portRef.current.postMessage({
          type: 'panel_log',
          message: formatArgs(args)
        });
      } catch (error) {
        // Silently fail if port is disconnected
      }
    }
  };

  const error = (...args: any[]) => {
    // Log to local console with original formatting
    console.error(...args);
    
    // Forward to background if port is available
    if (portRef.current?.name === 'side-panel-connection') {
      try {
        portRef.current.postMessage({
          type: 'panel_error',
          message: formatArgs(args)
        });
      } catch (err) {
        // Silently fail if port is disconnected
      }
    }
  };

  return { log, error };
}

