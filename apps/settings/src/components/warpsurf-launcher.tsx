export function WarpSurfLauncher({ isDarkMode }: { isDarkMode: boolean }) {
  const handleOpenWarpsurf = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await (chrome.sidePanel as any)?.open?.({ tabId: tab.id });
      }
    } catch (e) {
      console.error('Failed to open side panel:', e);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <img 
        src="/warpsurflogo_tagline.png" 
        alt="warpsurf Logo" 
        className="mb-8 h-24 w-auto" 
      />
      <p className={`mb-6 text-center text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
        Click the button below to open the warpsurf side panel
      </p>
      <button
        type="button"
        onClick={handleOpenWarpsurf}
        className={`rounded-lg px-6 py-3 text-lg font-medium transition-colors ${
          isDarkMode 
            ? 'bg-blue-600 text-white hover:bg-blue-500' 
            : 'bg-blue-600 text-white hover:bg-blue-500'
        }`}
      >
        Open warpsurf
      </button>
      
      <div className={`mt-8 text-center text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        <p className="font-medium mb-1">📌 Pin warpsurf for quick access:</p>
        <p>Click the puzzle piece icon in your toolbar, then click the pin icon next to warpsurf</p>
      </div>
    </div>
  );
}
