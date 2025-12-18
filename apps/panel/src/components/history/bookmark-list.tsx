/* eslint-disable react/prop-types */
import { useState, useRef, useEffect } from 'react';
import { FaTrash, FaPen, FaCheck, FaTimes } from 'react-icons/fa';
import { AgentType } from '../chat-interface/chat-input';
import { FaBrain, FaSearch, FaRobot, FaRandom } from 'react-icons/fa';

interface Bookmark {
  id: number;
  title: string;
  content: string;
  agentType?: AgentType | 'auto' | 'chat' | 'search' | 'agent' | 'multiagent';
  tags?: string[];
}

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onBookmarkSelect: (content: string, agentType?: AgentType) => void;
  onBookmarkUpdate?: (id: number, title: string, content: string, agentType?: AgentType, tags?: string[]) => void;
  onBookmarkDelete?: (id: number) => void;
  onBookmarkReorder?: (draggedId: number, targetId: number) => void;
  isDarkMode?: boolean;
  onBookmarkAdd?: (title: string, content: string, agentType?: AgentType, tags?: string[]) => void;
  // Optional: tags and import/export
  onImportJson?: (items: Array<{ title: string; content: string; agentType?: AgentType; tags?: string[] }>) => void;
}

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
  onBookmarkUpdate,
  onBookmarkDelete,
  onBookmarkReorder,
  isDarkMode = false,
  onBookmarkAdd,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editContent, setEditContent] = useState<string>('');
  const [editAgentType, setEditAgentType] = useState<AgentType>(AgentType.AUTO);
  const [editTags, setEditTags] = useState<string>('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEditClick = (bookmark: Bookmark) => {
    setEditingId(bookmark.id);
    setEditTitle(bookmark.title);
    setEditContent(bookmark.content);
    setEditAgentType((bookmark.agentType as AgentType) || AgentType.AUTO);
    setEditTags((bookmark.tags || []).join(', '));
  };

  const handleSaveEdit = (id: number) => {
    if (onBookmarkUpdate && editTitle.trim() && editContent.trim()) {
      const tags = editTags.split(',').map(t => t.trim()).filter(Boolean);
      onBookmarkUpdate(id, editTitle, editContent, editAgentType, tags);
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    // Add more transparent effect
    e.currentTarget.classList.add('opacity-25');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-25');
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    if (onBookmarkReorder) {
      onBookmarkReorder(draggedId, targetId);
    }
  };

  // Focus the input field when entering edit mode
  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  const inferType = (bookmark: Bookmark): AgentType => {
    const explicit = (bookmark.agentType as AgentType) || null;
    if (explicit) return explicit;
    return AgentType.AUTO;
  };
  const visibleBookmarks = bookmarks.filter(b => !activeTag || (b.tags || []).includes(activeTag));

  return (
    <div className="p-2">
      <div className="mb-1 flex items-center justify-between">
        <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>Frequently Used</h3>
        <div />
      </div>

      {bookmarks.length > 8 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`text-[12px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>Filter:</span>
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${activeTag === null ? (isDarkMode ? 'bg-slate-700 text-white border-slate-600' : 'bg-gray-800 text-white border-gray-800') : (isDarkMode ? 'border-slate-700 text-slate-300' : 'border-gray-300 text-gray-700')}`}
          >All</button>
          {[...new Set((bookmarks.flatMap(b => b.tags || []) as string[]))].slice(0, 12).map((tag, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${activeTag === tag ? (isDarkMode ? 'bg-slate-700 text-white border-slate-600' : 'bg-gray-800 text-white border-gray-800') : (isDarkMode ? 'border-slate-700 text-slate-300' : 'border-gray-300 text-gray-700')}`}
            >{tag}</button>
          ))}
        </div>
      )}
      <div className="mb-2">
        <button
          type="button"
          onClick={() => {
            setEditingId(0);
            setEditTitle('');
            setEditContent('');
            setEditAgentType(AgentType.AUTO);
            setEditTags('');
          }}
          className={`rounded-md px-2 py-1 text-xs font-medium ${isDarkMode ? 'bg-slate-700 text-gray-200 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          + Add frequently used
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {editingId === 0 && (
          <div className={`rounded-lg p-3 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-sky-100'} border`}>
            <div className="flex w-full flex-col gap-2">
              <input
                ref={inputRef}
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                className={`rounded px-2 py-1 text-sm ${
                  isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'
                } border`}
                placeholder="Title"
              />
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className={`rounded px-2 py-1 text-sm ${
                  isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'
                } border`}
                placeholder="Message"
                rows={3}
              />
              <div className="flex items-center gap-2">
                <label className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Mode:</label>
                <select
                  value={editAgentType}
                  onChange={e => setEditAgentType(e.target.value as AgentType)}
                  className={`rounded px-2 py-1 text-sm ${
                    isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'
                  } border`}
                >
                  <option value={AgentType.AUTO}>Auto</option>
                  <option value={AgentType.CHAT}>Chat</option>
                  <option value={AgentType.SEARCH}>Search</option>
                  <option value={AgentType.AGENT}>Agent</option>
                  <option value={AgentType.MULTIAGENT}>Multi-Agent</option>
                </select>
                <input
                  type="text"
                  value={editTags}
                  onChange={e => setEditTags(e.target.value)}
                  placeholder="tags (comma-separated)"
                  className={`rounded px-2 py-1 text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'} border`}
                />
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (onBookmarkAdd && editTitle.trim() && editContent.trim()) {
                        const tags = editTags.split(',').map(t => t.trim()).filter(Boolean);
                        onBookmarkAdd(editTitle, editContent, editAgentType, tags);
                      }
                      setEditingId(null);
                    }}
                    className={`rounded p-1 ${
                      isDarkMode
                        ? 'bg-slate-700 text-green-400 hover:bg-slate-600'
                        : 'bg-white text-green-500 hover:bg-gray-100'
                    }`}
                    aria-label="Save new"
                    type="button">
                    <FaCheck size={14} />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className={`rounded p-1 ${
                      isDarkMode
                        ? 'bg-slate-700 text-red-400 hover:bg-slate-600'
                        : 'bg-white text-red-500 hover:bg-gray-100'
                    }`}
                    aria-label="Cancel new"
                    type="button">
                    <FaTimes size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {visibleBookmarks.map(bookmark => (
          <div
            key={bookmark.id}
            draggable={editingId !== bookmark.id}
            onDragStart={e => handleDragStart(e, bookmark.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, bookmark.id)}
            className={`group relative p-1`}
          >
            {editingId === bookmark.id ? (
              <div className="flex w-full flex-col gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className={`rounded px-2 py-1 text-sm ${
                    isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'
                  } border`}
                  placeholder="Title"
                />
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className={`rounded px-2 py-1 text-sm ${
                    isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'
                  } border`}
                  placeholder="Message"
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <label className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Mode:</label>
                  <select
                    value={editAgentType}
                    onChange={e => setEditAgentType(e.target.value as AgentType)}
                    className={`rounded px-2 py-1 text-sm ${
                      isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'
                    } border`}
                  >
                    <option value={AgentType.AUTO}>Auto</option>
                    <option value={AgentType.CHAT}>Chat</option>
                    <option value={AgentType.SEARCH}>Search</option>
                    <option value={AgentType.AGENT}>Agent</option>
                    <option value={AgentType.MULTIAGENT}>Multi-Agent</option>
                  </select>
                  <input
                    type="text"
                    value={editTags}
                    onChange={e => setEditTags(e.target.value)}
                    placeholder="tags (comma-separated)"
                    className={`rounded px-2 py-1 text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'} border`}
                  />
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => handleSaveEdit(bookmark.id)}
                      className={`rounded p-1 ${
                        isDarkMode
                          ? 'bg-slate-700 text-green-400 hover:bg-slate-600'
                          : 'bg-white text-green-500 hover:bg-gray-100'
                      }`}
                      aria-label="Save edit"
                      type="button">
                      <FaCheck size={14} />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className={`rounded p-1 ${
                        isDarkMode
                          ? 'bg-slate-700 text-red-400 hover:bg-slate-600'
                          : 'bg-white text-red-500 hover:bg-gray-100'
                      }`}
                      aria-label="Cancel edit"
                      type="button">
                      <FaTimes size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => onBookmarkSelect(bookmark.content, bookmark.agentType as AgentType)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        onBookmarkSelect(bookmark.content, bookmark.agentType as AgentType);
                      }
                    }}
                    className="w-full text-left">
                    {(() => {
                      const type = inferType(bookmark);
                      const colorClasses = isDarkMode
                        ? type === AgentType.AUTO
                          ? 'bg-black/70 hover:bg-black/60 text-white'
                          : type === AgentType.CHAT
                            ? 'bg-violet-400 hover:bg-violet-300 text-white'
                            : type === AgentType.SEARCH
                              ? 'bg-teal-400 hover:bg-teal-300 text-white'
                              : type === AgentType.MULTIAGENT
                                ? 'bg-orange-400 hover:bg-orange-300 text-white'
                                : 'bg-amber-400 hover:bg-amber-300 text-white'
                        : type === AgentType.AUTO
                          ? 'bg-black/80 hover:bg-black/70 text-white'
                          : type === AgentType.CHAT
                            ? 'bg-violet-300 hover:bg-violet-400 text-white'
                            : type === AgentType.SEARCH
                              ? 'bg-teal-300 hover:bg-teal-400 text-white'
                              : type === AgentType.MULTIAGENT
                                ? 'bg-orange-300 hover:bg-orange-400 text-white'
                              : 'bg-amber-300 hover:bg-amber-400 text-white';
                      const icon = type === AgentType.AUTO
                        ? <FaRandom className="h-3.5 w-3.5" />
                        : type === AgentType.CHAT
                          ? <FaBrain className="h-3.5 w-3.5" />
                          : type === AgentType.SEARCH
                            ? <FaSearch className="h-3.5 w-3.5" />
                            : type === AgentType.MULTIAGENT
                              ? <><FaRobot className="h-3.5 w-3.5" /> <FaRobot className="h-3.5 w-3.5" /></>
                              : <FaRobot className="h-3.5 w-3.5" />;
                      return (
                        <span className={`inline-flex max-w-full items-center justify-between gap-2 rounded-full px-2 py-1 text-xs font-medium shadow-sm ${colorClasses}`}>
                          <span className="inline-flex items-center gap-1 min-w-0">
                            <span className="inline-flex items-center gap-0.5">{icon}</span>
                            <span className="truncate">{bookmark.title}</span>
                          </span>
                          {/* Reserve space for edit/delete; show on hover */}
                          <span className="flex w-10 items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={e => { e.preventDefault(); e.stopPropagation(); handleEditClick(bookmark); }}
                              className="rounded p-0.5 bg-black/10 hover:bg-black/20 text-white"
                              aria-label="Edit bookmark"
                            >
                              <FaPen size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={e => { e.preventDefault(); e.stopPropagation(); onBookmarkDelete && onBookmarkDelete(bookmark.id); }}
                              className="rounded p-0.5 bg-black/10 hover:bg-black/20 text-white"
                              aria-label="Delete bookmark"
                            >
                              <FaTrash size={12} />
                            </button>
                          </span>
                        </span>
                      );
                    })()}
                  </button>
                </div>
              </>
            )}

            {/* External edit/delete removed; now shown inside pill */}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookmarkList;
