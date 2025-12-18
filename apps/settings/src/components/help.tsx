import React from 'react';

interface HelpProps {
  isDarkMode?: boolean;
}

export const Help: React.FC<HelpProps> = ({ isDarkMode = false }) => {
  const textMuted = isDarkMode ? 'text-gray-300' : 'text-gray-700';
  const textSubtle = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const card = isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50';
  const chip = isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-gray-200 text-gray-700';

  return (
    <section className="space-y-6">
      {/* Overview */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h2 className={`mb-2 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          warpsurf: an AI-powered copilot for your browser
        </h2>
        <p className={textSubtle}>
          warpsurf adds a side panel that you can chat with and perform tasks in your browser for you. First add an API key for a model provider, 
          then start a conversation, choose a mode, and the copilot will answer or browse for you.
        </p>
      </div>

      {/* Chat modes */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Chat options</h3>
        <ul className={`space-y-2 ${textMuted}`}>
          <li>
            <span className={`mr-2 inline-flex h-5 items-center justify-center rounded px-2 text-xs ${chip}`}>Auto</span>
            Let warpsurf choose the best mode (simple chat, search-grounded chat, agent or multi-agent) based on your prompt.
          </li>
          <li>
            <span className={`mr-2 inline-flex h-5 items-center justify-center rounded px-2 text-xs ${chip}`}>Chat</span>
            Fast Q&A with your selected model. No search, browsing, or page actions.
          </li>
          <li>
            <span className={`mr-2 inline-flex h-5 items-center justify-center rounded px-2 text-xs ${chip}`}>Search</span>
            Quick search-grounded answers that require current information or easily retrievable web content. Uses model-native 
            /integrated web search.
          </li>
          <li>
            <span className={`mr-2 inline-flex h-5 items-center justify-center rounded px-2 text-xs ${chip}`}>Agent</span>
            Performs browser automation. The agent plans, navigates, clicks, and extracts content, operating in its own labelled
            tab group.
          </li>
          <li>
            <span className={`mr-2 inline-flex h-5 items-center justify-center rounded px-2 text-xs ${chip}`}>Multi-Agent</span>
            Performs browser automation using multiple agents. Initially, a planner makes a rough plan which is then refined.
            Subtasks are then allocated to worker agents, which perform the browser interactions. Each worker operates in its own
            tab group.
          </li>
          
        </ul>
      </div>

      {/* Agent settings */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Agent workflow settings at a glance
        </h3>

        <h4 className={`mt-5 mb-2 text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          🤖 Agent Workflow
        </h4>

        <ul className={`list-disc space-y-1 pl-5 ${textSubtle}`}>
          <li>
            <strong>Models:</strong> Pick provider and model per role (Planner, Navigator, Validator). Use Global
            Model to set all at once.
          </li>
          <li><strong>Parameters:</strong> Adjust temperature for each role.</li>
          <li><strong>Vision:</strong> Enable screenshot-based context - can improve performance at the cost of latency.</li>
          <li><strong>Limits:</strong> Maximum steps, actions per step, failures, planning interval, min page-load wait.</li>
          <li><strong>Planner toggle:</strong> Enable a dedicated planning step before navigation begins.</li>
          <li><strong>Validator toggle:</strong> Enable a validation step to verify task completion.</li>
        </ul>

        <h4 className={`mt-5 mb-2 text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          🤖🤖 Multi-Agent Workflow
        </h4>

        <ul className={`list-disc space-y-1 pl-5 ${textSubtle}`}>
          <li>
            <strong>Models:</strong> Pick provider and model per role (Multi-Agent Planner, Refiner, Worker). 
            Workers share the same model configuration.
          </li>
          <li><strong>Max Workers:</strong> Set the maximum number of parallel worker agents. A large number of workers can cause performance issues. Each worker operates in its own tab group.</li>
          <li><strong>Planner:</strong> Creates an initial high-level plan and decomposes the user task into subtasks with dependencies.</li>
          <li><strong>Refiner:</strong> Improves and optimizes the initial plan before execution begins.</li>
          <li><strong>Workers:</strong> Execute individual subtasks in parallel, each with their own browser context.</li>
          <li><strong>Planner toggle:</strong> Enable per-worker planning before each subtask.</li>
          <li><strong>Validator toggle:</strong> Enable per-worker validation after each subtask completes.</li>
          <li><strong>Visualization:</strong> View the task graph showing subtask dependencies and worker assignments.</li>
        </ul>
      </div>

      {/* Other functionality */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Other features
        </h3>
        <ul className={`list-disc space-y-1 pl-5 ${textSubtle}`}>
          <li><strong>Chat history:</strong> Reopen, rename, delete, export, and bookmark prompts for reuse.</li>
          <li><strong>Costs:</strong> Where cost data is available, per-message and per-session token, latency, and USD totals are shown in the UI.</li>
          <li><strong>Firewall:</strong> Control which domains agents can access with allow/deny lists. Deny list takes priority; empty allow list permits all non-denied domains.</li>
          <li><strong>Inline preview:</strong> See the agent's page context inside the side panel when available. Can be collapsed or expanded.</li>
          <li><strong>Keyboard shortcuts:</strong> Type "/" in the input to quickly select workflow modes (/chat, /search, /agent).</li>
          <li><strong>History summarization:</strong> Analyzes your recent browser history to provide context-aware assistance. Summarizes key topics, notable URLs, and browsing patterns from the last 24 hours.</li>
          <li><strong>Task estimation:</strong> Before running agent tasks, view estimated completion time (agent vs human), token usage, and cost breakdown. You can also switch models to compare estimates.</li>
          <li><strong>Agent dashboard:</strong> View all currently running and recently completed agent tasks. Monitor status, duration, and costs. Jump directly to any session or remove completed entries.</li>
          <li><strong>Fish:</strong> A relaxing aquarium overlay for the side panel. Add fish, sharks, and food pellets. Fish eat pellets, sharks hunt fish (and die if unfed for 60 seconds), and both species can breed. Toggle the population chart to visualize ecosystem dynamics.</li>
        </ul>
      </div>

      {/* Getting started */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Getting started
        </h3>
        <ul className={`list-disc space-y-1 pl-5 ${textSubtle}`}>
          <li><strong>API Keys:</strong> Add at least one LLM provider API key in the API Keys tab. Supported providers: OpenAI, Anthropic (Claude), Google Gemini, Grok (xAI), OpenRouter, and any OpenAI-compatible API.</li>
          <li><strong>Model selection:</strong> After adding a provider, configure which model to use for each workflow role. Use the "Global Model" button to quickly set the same model for all roles.</li>
          <li><strong>Tab groups:</strong> Agent and Multi-Agent workflows operate in dedicated, color-coded Chrome tab groups to keep automated browsing organized and separate from your personal tabs.</li>
        </ul>
      </div>

      {/* Advanced settings */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Advanced settings
        </h3>
        <ul className={`list-disc space-y-1 pl-5 ${textSubtle}`}>
          <li><strong>Model parameters:</strong> Temperature controls creativity (lower = more focused). Adjust per role in Agent Settings.</li>
          <li><strong>History context:</strong> Enable to give agents awareness of your recent browsing history. Configure the time window (default: 24 hours) in settings.</li>
          <li><strong>Tab previews:</strong> Toggle low-FPS tab mirroring in the chat UI to see what agents are doing without switching tabs.</li>
          <li><strong>Emergency stop:</strong> Click the stop button or use the killswitch to immediately halt all agent activity across all sessions.</li>
        </ul>
      </div>

      {/* Tips */}
      <div className={`rounded-lg border ${card} p-6 text-left shadow-sm`}>
        <h3 className={`mb-3 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Tips for best results
        </h3>
        <ul className={`list-disc space-y-1 pl-5 ${textSubtle}`}>
          <li><strong>Multi-agent for complex tasks:</strong> Use Multi-Agent for tasks requiring parallel research, comparison shopping, or gathering information from multiple sources.</li>
          <li><strong>Set spending limits:</strong> Configure API spending limits with your provider to avoid unexpected costs. Uncapped keys are risky.</li>
          <li><strong>Review costs:</strong> Check the session stats bar to monitor token usage and costs in real-time.</li>
          <li><strong>Bookmark useful prompts:</strong> Save frequently-used prompts for quick reuse from the chat history panel.</li>
          <li><strong>Monitoring:</strong>Carefully and closely monitor the agent's activity. They may make mistakes and you should keep track of what they are doing.</li>
        </ul>
      </div>
    </section>
  );
};


