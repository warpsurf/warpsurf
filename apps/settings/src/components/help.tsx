import React from 'react';
import { FiPlus, FiCommand, FiSettings, FiSun, FiMessageSquare } from 'react-icons/fi';
import { FaFish, FaRandom, FaBrain, FaSearch, FaRobot } from 'react-icons/fa';

interface HelpProps {
  isDarkMode?: boolean;
}

export const Help: React.FC<HelpProps> = ({ isDarkMode = false }) => {
  const textSubtle = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const card = isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50';
  const iconInline = 'inline-block align-text-bottom mx-0.5';

  const modeBadge = (bg: string) => `mr-2 inline-flex h-5 items-center gap-1 rounded px-2 text-xs text-white ${bg}`;

  return (
    <section className="space-y-6">
      {/* Overview & Getting started */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h2 className={`mb-2 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>warpsurf</h2>
        <p className={textSubtle}>
          An AI-powered browser copilot. Add an API key in the <strong>API Keys</strong> tab, pick a model in{' '}
          <strong>Workflow</strong>, and start chatting. Agent workflows run in dedicated tab groups to stay separate
          from your personal tabs.
        </p>
      </div>

      {/* Side panel UI */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Side panel</h3>
        <p className={`mb-3 text-sm ${textSubtle}`}>
          The side panel is the main interface. The version number is shown at the top left — hover over it to view
          release notes. The header bar contains the following controls:
        </p>
        <ul className={`list-disc space-y-1 pl-5 text-sm ${textSubtle}`}>
          <li>
            <FiPlus className={iconInline} /> <strong>New chat:</strong> Start a fresh conversation.
          </li>
          <li>
            <FiCommand className={iconInline} /> <strong>Agent manager:</strong> Open the agent dashboard in a new tab.
            A green badge shows running agent count.
          </li>
          <li>
            <FiSettings className={iconInline} /> <strong>Settings:</strong> Open the full settings page (this page).
          </li>
          <li>
            <FiSun className={iconInline} /> <strong>Theme:</strong> Cycle between auto, light, and dark themes.
          </li>
          <li>
            <FaFish className={iconInline} /> <strong>Fish:</strong> Toggle the aquarium overlay.
          </li>
          <li>
            <FiMessageSquare className={iconInline} /> <strong>Feedback:</strong> Links to the Chrome Web Store and
            GitHub.
          </li>
        </ul>
      </div>

      {/* Modes */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Modes</h3>
        <ul className={`space-y-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          <li>
            <span className={modeBadge(isDarkMode ? 'bg-black/70' : 'bg-black/80')}>
              <FaRandom className="h-3 w-3" /> Auto
            </span>
            Automatically selects the best mode for your prompt.
          </li>
          <li>
            <span className={modeBadge(isDarkMode ? 'bg-violet-400' : 'bg-violet-300')}>
              <FaBrain className="h-3 w-3" /> Chat
            </span>
            Direct Q&A with your model. No browsing.
          </li>
          <li>
            <span className={modeBadge(isDarkMode ? 'bg-teal-400' : 'bg-teal-300')}>
              <FaSearch className="h-3 w-3" /> Search
            </span>
            Search-grounded answers using model-native web search.
          </li>
          <li>
            <span className={modeBadge(isDarkMode ? 'bg-amber-400' : 'bg-amber-300')}>
              <FaRobot className="h-3 w-3" /> Agent
            </span>
            Single-agent browser automation: plans, navigates, and extracts content.
          </li>
          <li>
            <span className={modeBadge(isDarkMode ? 'bg-orange-400' : 'bg-orange-300')}>
              <FaRobot className="h-3 w-3" />
              <FaRobot className="h-3 w-3 -ml-1.5" /> Multi-Agent
            </span>
            <span className={`mr-1 text-xs italic ${textSubtle}`}>(experimental)</span>
            Parallel browser automation with a planner, refiner, and multiple workers.
          </li>
        </ul>
        <p className={`mt-3 text-xs ${textSubtle}`}>
          Type <strong>/</strong> in the chat input to quickly switch modes.
        </p>
      </div>

      {/* Key features */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Key features</h3>
        <ul className={`list-disc space-y-1 pl-5 ${textSubtle}`}>
          <li>
            <strong>Natural language configuration:</strong> Change models, adjust temperature, toggle vision, add tab
            context, and more — just ask in the chat. Auto mode detects configuration requests automatically.
          </li>
          <li>
            <strong>Chat history:</strong> Reopen, rename, delete, export, and bookmark prompts.
          </li>
          <li>
            <strong>Cost tracking:</strong> Per-message and per-session token/cost totals in the stats bar.
          </li>
          <li>
            <strong>Regional preferences:</strong> Set a preferred region so agents favour local versions of websites
            (e.g. amazon.de). Configure in <strong>Web</strong> settings.
          </li>
          <li>
            <strong>Web access control:</strong> Allow/deny lists to control which domains agents can visit. Configure
            in <strong>Web</strong> settings.
          </li>
          <li>
            <strong>Inline preview:</strong> See the agent's current page inside the side panel.
          </li>
          <li>
            <strong>Task estimation:</strong> Preview estimated time, tokens, and cost before running agent tasks.
          </li>
          <li>
            <strong>Voice input:</strong> Dictate prompts via speech-to-text (configure in <strong>Voice</strong>{' '}
            settings).
          </li>
          <li>
            <strong>Emergency stop:</strong> Immediately halt all agent activity via the stop button.
          </li>
        </ul>
      </div>

      {/* Tips */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Tips</h3>
        <ul className={`list-disc space-y-1 pl-5 ${textSubtle}`}>
          <li>Use Multi-Agent for tasks that benefit from parallel research or multi-site comparison.</li>
          <li>Set API spending limits with your provider — uncapped keys are risky.</li>
          <li>Monitor agents closely; they can make mistakes or take unexpected actions.</li>
          <li>
            Configure per-role models and parameters under <strong>Advanced &gt; Workflow (Advanced)</strong>.
          </li>
        </ul>
      </div>
    </section>
  );
};
