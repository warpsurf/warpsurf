/* eslint-disable react/prop-types */
import { useState } from 'react';
import { FaTrash } from 'react-icons/fa';
import { FaPen, FaCheck, FaTimes, FaDownload, FaSearch } from 'react-icons/fa';
import { BsBookmark } from 'react-icons/bs';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
}

interface ChatHistoryListProps {
  sessions: ChatSession[];
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionBookmark: (sessionId: string) => void;
  visible: boolean;
  isDarkMode?: boolean;
  onRenameSession?: (sessionId: string, newTitle: string) => void;
}

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  visible,
  isDarkMode = false,
  onRenameSession,
}) => {
  if (!visible) return null;

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [query, setQuery] = useState<string>('');

  const filtered = sessions.filter(s =>
    s.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className={`mb-4 text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Chat History</h2>
      <div className="mb-3 flex items-center gap-2">
        <div className={`flex items-center gap-2 rounded-md px-2 py-1 ${isDarkMode ? 'bg-slate-800 border border-slate-700' : 'bg-white/50 border border-gray-200'}`}>
          <FaSearch className={`${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`} />
          <input
            type="text"
            placeholder="Search sessions"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className={`bg-transparent outline-none text-sm ${isDarkMode ? 'text-gray-200 placeholder-gray-500' : 'text-gray-700 placeholder-gray-500'}`}
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <div
          className={`rounded-lg ${isDarkMode ? 'bg-slate-800 text-gray-400' : 'bg-white/30 text-gray-500'} p-4 text-center backdrop-blur-sm`}>
          No chat history available
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(session => (
            <div
              key={session.id}
              className={`group relative rounded-lg ${
                isDarkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-white/50 hover:bg-white/70'
              } p-3 backdrop-blur-sm transition-all`}>
              {editingId === session.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className={`flex-1 rounded px-2 py-1 text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} border`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (onRenameSession && editTitle.trim()) onRenameSession(session.id, editTitle.trim());
                      setEditingId(null);
                      setEditTitle('');
                    }}
                    className={`rounded p-1 ${isDarkMode ? 'bg-slate-700 text-green-400 hover:bg-slate-600' : 'bg-white text-green-600 hover:bg-gray-100'}`}
                    aria-label="Save title"
                  >
                    <FaCheck size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingId(null); setEditTitle(''); }}
                    className={`rounded p-1 ${isDarkMode ? 'bg-slate-700 text-red-400 hover:bg-slate-600' : 'bg-white text-red-500 hover:bg-gray-100'}`}
                    aria-label="Cancel edit"
                  >
                    <FaTimes size={14} />
                  </button>
                </div>
              ) : (
                <button onClick={() => onSessionSelect(session.id)} className="w-full text-left" type="button">
                  <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                    {session.title}
                  </h3>
                  <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {formatDate(session.createdAt)}
                  </p>
                </button>
              )}

              {/* Bookmark button - top right */}
              {onSessionBookmark && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onSessionBookmark(session.id);
                  }}
                  className={`absolute right-2 top-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${
                    isDarkMode
                      ? 'bg-slate-700 text-sky-400 hover:bg-slate-600'
                      : 'bg-white text-sky-500 hover:bg-gray-100'
                  }`}
                  aria-label="Bookmark session"
                  type="button">
                  <BsBookmark size={14} />
                </button>
              )}

              {/* Rename button - top right next to bookmark */}
              {onRenameSession && editingId !== session.id && (
                <button
                  onClick={e => { e.stopPropagation(); setEditingId(session.id); setEditTitle(session.title); }}
                  className={`absolute right-9 top-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${isDarkMode ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                  aria-label="Rename session"
                  type="button"
                >
                  <FaPen size={14} />
                </button>
              )}

              {/* Export button - bottom left */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  // Emit a custom event the parent can pick up to export (parent holds messages)
                  document.dispatchEvent(new CustomEvent('export-session-markdown', { detail: { sessionId: session.id } }));
                }}
                className={`absolute bottom-2 left-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${isDarkMode ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                aria-label="Export session"
                type="button">
                <FaDownload size={14} />
              </button>

              {/* Delete button - bottom right */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  onSessionDelete(session.id);
                }}
                className={`absolute bottom-2 right-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${
                  isDarkMode
                    ? 'bg-slate-700 text-gray-400 hover:bg-slate-600'
                    : 'bg-white text-gray-500 hover:bg-gray-100'
                }`}
                aria-label="Delete session"
                type="button">
                <FaTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatHistoryList;
