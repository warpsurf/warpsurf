import React, { useEffect, useMemo, useState } from 'react';
import { AgentType } from '../chat-interface/chat-input';

export type PaletteAction =
  | { type: 'switch-agent'; agent: AgentType; label: string }
  | { type: 'open-options'; label: string };

interface CommandPaletteProps {
  isOpen: boolean;
  isDarkMode?: boolean;
  onClose: () => void;
  onSelect: (action: PaletteAction) => void;
}

const DEFAULT_ACTIONS: PaletteAction[] = [
  { type: 'switch-agent', agent: AgentType.AUTO, label: 'Switch to Auto' },
  { type: 'switch-agent', agent: AgentType.CHAT, label: 'Switch to Chat' },
  { type: 'switch-agent', agent: AgentType.SEARCH, label: 'Switch to Search' },
  { type: 'switch-agent', agent: AgentType.AGENT, label: 'Switch to Agent' },
  { type: 'open-options', label: 'Open Options' },
];

export default function CommandPalette({ isOpen, isDarkMode = false, onClose, onSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const items = useMemo(
    () => DEFAULT_ACTIONS.filter(a => a.label.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, Math.max(items.length - 1, 0))); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') { e.preventDefault(); const sel = items[index]; if (sel) { onSelect(sel); } }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, items, index, onClose, onSelect]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/30 p-8" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className={`w-full max-w-lg rounded-xl border shadow-xl ${isDarkMode ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-gray-200 bg-white text-gray-800'}`}>
        <div className={`border-b ${isDarkMode ? 'border-slate-700' : 'border-gray-200'} p-2`}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command..."
            className={`w-full bg-transparent outline-none ${isDarkMode ? 'placeholder-slate-500' : 'placeholder-gray-400'}`}
          />
        </div>
        <ul className="max-h-60 overflow-auto p-1" role="menu">
          {items.length === 0 && (
            <li className={`px-2 py-2 text-sm ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>No results</li>
          )}
          {items.map((item, i) => (
            <li key={i}>
              <button
                role="menuitem"
                type="button"
                onClick={() => onSelect(item)}
                className={`w-full rounded px-2 py-2 text-left text-sm ${i === index ? (isDarkMode ? 'bg-slate-800' : 'bg-gray-100') : ''}`}
              >{item.label}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}


