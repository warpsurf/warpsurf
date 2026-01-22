import { FaRobot } from 'react-icons/fa';
import { AgentTile } from './AgentTile';
import { MultiAgentTile } from './MultiAgentTile';
import { CompactAgentRow } from './CompactAgentRow';
import type { AgentData } from '@src/types';

interface AgentGalleryProps {
  activeAgents: AgentData[];
  recentAgents: AgentData[];
  olderAgents: AgentData[];
  isDarkMode: boolean;
  onSelectAgent: (agent: AgentData) => void;
  onDeleteAgent?: (agent: AgentData) => void;
  searchQuery?: string;
}

interface SectionProps {
  title: string;
  agents: AgentData[];
  isDarkMode: boolean;
  onSelectAgent: (agent: AgentData) => void;
  onDeleteAgent?: (agent: AgentData) => void;
  showPreview: boolean;
}

function Section({ title, agents, isDarkMode, onSelectAgent, onDeleteAgent, showPreview }: SectionProps) {
  if (agents.length === 0) return null;

  return (
    <div className="mb-6">
      <h2
        className={`text-sm font-semibold mb-3 uppercase tracking-wide ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
        {title} ({agents.length})
      </h2>
      {showPreview ? (
        <div className="grid grid-cols-3 gap-4">
          {agents.map(agent =>
            agent.agentType === 'multiagent' ? (
              <MultiAgentTile
                key={agent.sessionId}
                agent={agent}
                isDarkMode={isDarkMode}
                onClick={() => onSelectAgent(agent)}
                onDelete={onDeleteAgent ? () => onDeleteAgent(agent) : undefined}
              />
            ) : (
              <AgentTile
                key={agent.sessionId}
                agent={agent}
                isDarkMode={isDarkMode}
                onClick={() => onSelectAgent(agent)}
                onDelete={onDeleteAgent ? () => onDeleteAgent(agent) : undefined}
              />
            ),
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {agents.map(agent => (
            <CompactAgentRow
              key={agent.sessionId}
              agent={agent}
              isDarkMode={isDarkMode}
              onClick={() => onSelectAgent(agent)}
              onDelete={onDeleteAgent ? () => onDeleteAgent(agent) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentGallery({
  activeAgents,
  recentAgents,
  olderAgents,
  isDarkMode,
  onSelectAgent,
  onDeleteAgent,
  searchQuery,
}: AgentGalleryProps) {
  const hasNoAgents = activeAgents.length === 0 && recentAgents.length === 0 && olderAgents.length === 0;

  if (hasNoAgents) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-20 ${
          isDarkMode ? 'text-slate-400' : 'text-gray-500'
        }`}>
        <FaRobot className="h-16 w-16 mb-4 opacity-50" />
        <h2 className="text-lg font-medium mb-2">{searchQuery ? 'No matching workflows' : 'No agents running'}</h2>
        <p className="text-sm opacity-75">
          {searchQuery ? 'Try a different search term' : 'Start a new task using the input above'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <Section
        title="Active"
        agents={activeAgents}
        isDarkMode={isDarkMode}
        onSelectAgent={onSelectAgent}
        onDeleteAgent={onDeleteAgent}
        showPreview={true}
      />
      <Section
        title="Recent"
        agents={recentAgents}
        isDarkMode={isDarkMode}
        onSelectAgent={onSelectAgent}
        onDeleteAgent={onDeleteAgent}
        showPreview={false}
      />
      <Section
        title="Older"
        agents={olderAgents}
        isDarkMode={isDarkMode}
        onSelectAgent={onSelectAgent}
        onDeleteAgent={onDeleteAgent}
        showPreview={false}
      />
    </div>
  );
}
