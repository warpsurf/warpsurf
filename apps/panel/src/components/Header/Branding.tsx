import { FiHelpCircle } from 'react-icons/fi';
import React from 'react';

interface BrandingProps {
  isDarkMode: boolean;
  extensionVersion: string;
  releaseNotes: string;
}

const Branding: React.FC<BrandingProps> = ({ isDarkMode, extensionVersion, releaseNotes }) => {
  return (
    <div className="flex items-center gap-3">
      {extensionVersion ? (
        <div className={`flex items-center gap-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          <span>warpsurf {extensionVersion}</span>
          <div className="relative inline-flex items-center group">
            <FiHelpCircle
              size={14}
              aria-label="Version release notes"
              className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'} cursor-help`}
            />
            <div
              className={`absolute left-0 top-full z-50 mt-1 hidden whitespace-normal break-words rounded-md px-2 py-1 text-[10px] shadow-md group-hover:block ${isDarkMode ? 'bg-slate-900 text-slate-100 border border-slate-700' : 'bg-gray-900 text-white border border-gray-800'}`}>
              {releaseNotes}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Branding;
