import { FaRobot } from 'react-icons/fa';
import type { AgentStatus } from '@src/types';

interface LivePreviewProps {
  screenshot?: string;
  url?: string;
  title?: string;
  status: AgentStatus;
  isDarkMode: boolean;
  className?: string;
}

export function LivePreview({ screenshot, url, title, status, isDarkMode, className = '' }: LivePreviewProps) {
  const isInactive = status === 'completed' || status === 'failed' || status === 'cancelled';

  return (
    <div
      className={`relative w-full aspect-video rounded-lg overflow-hidden ${
        isDarkMode ? 'bg-slate-800' : 'bg-gray-100'
      } ${className}`}>
      {screenshot ? (
        <img
          src={screenshot}
          alt={title || url || 'Preview'}
          className={`w-full h-full object-cover transition-opacity ${isInactive ? 'opacity-50' : ''}`}
        />
      ) : (
        <div
          className={`flex flex-col items-center justify-center h-full ${
            isDarkMode ? 'text-slate-500' : 'text-gray-400'
          }`}>
          <FaRobot className="h-8 w-8 mb-2" />
          <span className="text-xs">{title || url || 'No preview'}</span>
        </div>
      )}
      {isInactive && <div className="absolute inset-0 bg-black/20 pointer-events-none" />}
    </div>
  );
}
