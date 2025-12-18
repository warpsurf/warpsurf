import React from 'react';
import { FiHelpCircle } from 'react-icons/fi';
import { RxDiscordLogo } from 'react-icons/rx';
import { RxGithubLogo } from 'react-icons/rx';

interface FeedbackMenuProps {
  isDarkMode: boolean;
  open: boolean;
  onToggleOpen: () => void;
}

const FeedbackMenu: React.FC<FeedbackMenuProps> = ({ isDarkMode, open, onToggleOpen }) => {
  return (
    <div className="relative inline-block flex-shrink-0" data-dropdown>
      <div
        role="menu"
        aria-label="Feedback menu"
        className={`absolute right-0 top-full mt-0 ${open ? 'block' : 'hidden'} w-64 rounded-md border p-2 text-sm shadow-lg pointer-events-auto ${isDarkMode ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-gray-200 bg-white text-gray-800'} z-50`}
      >
        <a><span>Feedback is greatly appreciated</span></a>
        <br></br>
        <a href="https://github.com/warpsurf/warpsurf" target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 rounded px-3 py-2 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
          <RxDiscordLogo className="h-3.5 w-3.5" />
          <span>Join discord community</span>
        </a>
        <a href="https://github.com/warpsurf/warpsurf" target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 rounded px-3 py-2 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
          <RxGithubLogo className="h-3.5 w-3.5" />
          <span>GitHub</span>
        </a>
      </div>
    </div>
  );
};

export default FeedbackMenu;


