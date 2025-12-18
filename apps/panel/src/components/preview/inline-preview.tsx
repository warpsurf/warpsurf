import React from 'react';

export interface MirrorPreview {
  url?: string;
  title?: string;
  screenshot?: string;
  tabId?: number;
  color?: string;
}

interface InlinePreviewProps {
  preview: MirrorPreview | null;
  isDarkMode: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const InlinePreview: React.FC<InlinePreviewProps> = ({ preview, isDarkMode, collapsed, onToggleCollapsed }) => {
  if (!preview) return null;
  return (
    <div className={`rounded-md border ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between px-2 py-1 text-xs">
        <div className="truncate">
          {preview.title || preview.url || 'Preview'}
        </div>
        <button type="button" onClick={onToggleCollapsed} className={`${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && preview.screenshot && (
        <img src={preview.screenshot} alt={preview.title || 'preview'} className="block w-full" />
      )}
    </div>
  );
};

export default InlinePreview;


