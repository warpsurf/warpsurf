import React from 'react';
import ExampleUses from './example-uses';
import BookmarkList from '../history/bookmark-list';
import type { FavoritePrompt } from '@extension/storage/lib/prompt/favorites';
import { AgentType } from './chat-input';

type Props = {
  isDarkMode: boolean;
  onExampleSelect: (content: string, agentType: AgentType) => void;
  favoritePrompts: FavoritePrompt[];
  onBookmarkSelect: (content: string, agentType?: AgentType) => void;
  onBookmarkAdd: (title: string, content: string, agentType?: AgentType, tags?: string[]) => Promise<void> | void;
  onBookmarkUpdate: (
    id: number,
    title: string,
    content: string,
    agentType?: AgentType,
    tags?: string[],
  ) => Promise<void> | void;
  onBookmarkDelete: (id: number) => void;
  onBookmarkReorder: (draggedId: number, targetId: number) => void;
};

const AvailableChatSection: React.FC<Props> = ({
  isDarkMode,
  onExampleSelect,
  favoritePrompts,
  onBookmarkSelect,
  onBookmarkAdd,
  onBookmarkUpdate,
  onBookmarkDelete,
  onBookmarkReorder,
}) => {
  return (
    <>
      <div className="h-full overflow-y-auto">
        <div className="p-2">
          <ExampleUses isDarkMode={isDarkMode} onSelect={onExampleSelect} defaultExpanded={false} />
        </div>
        <BookmarkList
          bookmarks={favoritePrompts}
          onBookmarkSelect={onBookmarkSelect}
          onBookmarkAdd={onBookmarkAdd}
          onBookmarkUpdate={onBookmarkUpdate}
          onBookmarkDelete={onBookmarkDelete}
          onBookmarkReorder={onBookmarkReorder}
          isDarkMode={isDarkMode}
          defaultExpanded={false}
        />
      </div>
    </>
  );
};

export default AvailableChatSection;
