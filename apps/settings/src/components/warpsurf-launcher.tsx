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

  const btnClass = `rounded-lg px-6 py-3 text-base font-medium ${
    isDarkMode ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]' : 'bg-[#ecebe5] text-gray-800 hover:bg-[#dfddd4]'
  }`;

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <img src="/warpsurflogo_tagline.png" alt="warpsurf Logo" className="mb-6 h-20 w-auto" />
      <p className={`mb-5 text-center text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        Open the warpsurf side panel to get started
      </p>
      <button type="button" onClick={handleOpenWarpsurf} className={btnClass}>
        Open warpsurf
      </button>
      <p className={`mt-6 text-center text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
        Pin warpsurf for quick access: click the puzzle piece icon, then pin.
      </p>
    </div>
  );
}
