import React from 'react';
import { FaRobot } from 'react-icons/fa';
import { FiChevronDown } from 'react-icons/fi';

interface SettingsMenuProps {
  isDarkMode: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onToggleIncognito: () => void;
  onToggleVision: () => Promise<void> | void;
  onToggleTabPreviews: () => Promise<void> | void;
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({
  isDarkMode,
  open,
  onToggleOpen,
  onToggleIncognito,
  onToggleVision,
  onToggleTabPreviews,
}) => {
  return (
    <div className="relative inline-block flex-shrink-0 group" data-dropdown>
      <button
        type="button"
        onClick={onToggleOpen}
        className={`liquid-chip flex items-center gap-2 rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${isDarkMode ? 'text-gray-200 hover:text-white hover:bg-white/10' : 'text-gray-700 hover:text-gray-900 hover:bg-black/5'}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <FaRobot className="h-4 w-4" />
        <span>Agent Settings</span>
        <FiChevronDown className="h-3.5 w-3.5" />
      </button>
      <div role="menu" aria-label="Agent settings menu" className={`absolute right-0 top-full mt-0 ${open ? 'block' : 'hidden'} group-hover:block hover:block focus-within:block w-64 rounded-md border p-2 text-sm shadow-lg pointer-events-auto ${isDarkMode ? 'border-slate-700 bg-slate-800/95 text-slate-200' : 'border-gray-200 bg-white/95 text-gray-800'} backdrop-blur-sm z-50`}>
        <button type="button" onClick={onToggleIncognito} className={`flex w-full items-center justify-between rounded px-3 py-2 ${isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>Incognito</button>
        <button type="button" onClick={onToggleVision} className={`flex w-full items-center justify-between rounded px-3 py-2 ${isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>Vision</button>
        <button type="button" onClick={onToggleTabPreviews} className={`flex w-full items-center justify-between rounded px-3 py-2 ${isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>Show tab</button>
      </div>
    </div>
  );
};

export default SettingsMenu;


