import { useState } from 'react';
import { AgentType } from './chat-input';
import { FaBrain, FaSearch, FaRobot, FaRandom, FaChevronRight } from 'react-icons/fa';

interface ExampleUsesProps {
  onSelect: (content: string, agentType: AgentType, title?: string) => void;
  isDarkMode?: boolean;
  defaultExpanded?: boolean;
}

const examples: Array<{
  title: string;
  content: string;
  agentType: AgentType;
  tint: 'violet' | 'teal' | 'amber' | 'black' | 'orange';
  icon: JSX.Element;
}> = [
  {
    title: 'Let Auto Decide',
    content: "Navigate to the English Wikipedia homepage and open the today's featured article.",
    agentType: AgentType.AUTO,
    tint: 'black',
    icon: <FaRandom className="h-3.5 w-3.5" />,
  },
  {
    title: 'Basic Chat',
    content: 'What is the largest animal on earth?',
    agentType: AgentType.CHAT,
    tint: 'violet',
    icon: <FaBrain className="h-3.5 w-3.5" />,
  },
  {
    title: 'Rapid Search',
    content: 'What are the current BBC news headlines?',
    agentType: AgentType.SEARCH,
    tint: 'teal',
    icon: <FaSearch className="h-3.5 w-3.5" />,
  },
  {
    title: 'Agentic Web Browsing',
    content: 'Find a recipe for blueberry muffins and save it to a Google doc',
    agentType: AgentType.AGENT,
    tint: 'amber',
    icon: <FaRobot className="h-3.5 w-3.5" />,
  },
  {
    title: 'Multi-Agent Browsing',
    content:
      "I want to go on a trip to Scandinavia. I don't know what the entry requirements for a British citizen are. Please open the UK government visa requirement websites for all relevant countries. Summarize the findings.",
    agentType: AgentType.MULTIAGENT,
    tint: 'orange',
    // two robots icons side by side not on separate lines
    icon: (
      <>
        <FaRobot className="h-3.5 w-3.5" /> <FaRobot className="h-3.5 w-3.5" />
      </>
    ),
  },
];

export default function ExampleUses({ onSelect, isDarkMode = false, defaultExpanded = true }: ExampleUsesProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`mb-2 flex w-full items-center gap-1.5 text-sm font-medium ${isDarkMode ? 'text-gray-200 hover:text-white' : 'text-gray-700 hover:text-gray-900'}`}>
        <FaChevronRight className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
        Example uses
      </button>
      {isExpanded && (
        <>
          <div className="flex flex-wrap gap-2">
            {examples.map((ex, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onSelect(ex.content, ex.agentType, ex.title)}
                className={
                  `inline-flex items-center rounded-full px-2 py-1 text-xs font-medium shadow-sm transition-colors duration-150 ` +
                  (isDarkMode
                    ? ex.tint === 'violet'
                      ? 'bg-violet-400 text-white hover:bg-violet-300'
                      : ex.tint === 'teal'
                        ? 'bg-teal-400 text-white hover:bg-teal-300'
                        : ex.tint === 'amber'
                          ? 'bg-amber-400 text-white hover:bg-amber-300'
                          : ex.tint === 'orange'
                            ? 'bg-orange-400 text-white hover:bg-orange-300'
                            : 'bg-black/70 text-white hover:bg-black/60'
                    : ex.tint === 'violet'
                      ? 'bg-violet-300 text-white hover:bg-violet-400'
                      : ex.tint === 'teal'
                        ? 'bg-teal-300 text-white hover:bg-teal-400'
                        : ex.tint === 'amber'
                          ? 'bg-amber-300 text-white hover:bg-amber-400'
                          : ex.tint === 'orange'
                            ? 'bg-orange-300 text-white hover:bg-orange-400'
                            : 'bg-black/80 text-white hover:bg-black/70')
                }>
                <span className="mr-1 inline-flex items-center gap-0.5">{ex.icon}</span>
                <span>{ex.title}</span>
              </button>
            ))}
          </div>
          <p className={`mt-2 text-[12px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
            Click to pre-fill; press Send to run.
          </p>
        </>
      )}
    </div>
  );
}
