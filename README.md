<p align="center">
  <img src="apps/background/public/warpsurflogo_tagline.png" alt="warpsurf" width="300"/>
</p>

<p align="center">
  <em><b>Working towards</b> rapid browser automation with an AI copilot that lives in your browser!</em>
</p>

<p align="center">
  <a href="#installation"><img src="https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Extension"/></a>
  <a href="#license"><img src="https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge" alt="License"/></a>
</p>

---

> [!WARNING]
> 
> **Please carefully read this disclaimer before using warpsurf.**
> 
> Warpsurf is an open source research project under development. This is a community effort to find and fix bugs, and grow the browser automation ecosystem. You should assume there are still vulnerabilities.
> 
> Browser automation represents a new regime of web interaction, with new and unknown risks and challenges. The web is inherently dangerous: your personal details are at risk, scams are prevalent and jailbreaks are not a solved problem. Please monitor the warpsurf agents while they are working as they may make mistakes. Prompt injection and malicious pages may cause unintended actions. Warpsurf might have bugs and security implications. 
> 
> **You should use warpsurf at your own risk.  We accept no liability.**
> 
> We recommend using capped API keys where possible, with spending limits set to an amount you are comfortable losing. Additionally, we assume no liability for the use of any projects derived from this codebase. We encourage open-source innovation but urge cautiousness. 
> 
> **Please ensure you understand the risks before using warpsurf or any software or service built upon it.**


## <img src="apps/background/public/warpsurf_logo.png" alt="warpsurf" height="50" align="center"/> What is warpsurf?

**warpsurf**...
<br>
is a browser extension that brings AI-powered web automation directly into Chrome<br>
runs locally in your browser ensuring your data and authentication stays in your browser<br>
can chat, search, and autonomously navigate pages using single or multi-agent workflows<br>
agents can operate in parallel in their own tab groups, which are streamed for real-time monitoring<br>
<br>
**We know a browser copilot needs to operate quickly to be useful. References to "warpspeed" and fast browser automation are aspirational. We aren't there yet but this is the goal!**


## The warpsurf vision
<figure style="text-align:center;"><img src="images/warpsurf_vision.png" alt="warpsurf vision" width="40%" style="display:block;margin:0 auto;"><figcaption><em>(GPT 5.1-generated)</em></figcaption></figure>
<br>

The browser is the door to the Internet. We believe this door should be open and accessible to everyone.

Using the web well is increasingly important for work and everyday life. AI-powered browser copilots can make complex, click-heavy workflows easier while keeping your data, sessions, and authentication in your browser. 

For browser automation to be useful, it needs to be fast and enable “warpsurfing” - **warpsurf represents an early step in this direction**. For speed, warpsurf uses intelligent routing and parallel execution. With real-time tab streaming, you can watch agents work and step in at critical moments.

We deliberately design for multi-agent, multi-step LLM usage (assuming intelligence per token will increase and token prices and latency will fall) and we’re building warpsurf as a model-agnostic open-source community tool, open to contributions, critique, and alternative visions. 

As we wait for models to get faster, our goals are to help grow the browser automation ecosystem and find bugs, useful features and use cases. 

~ J O S T

## Demos

These demos give a flavour of some of the features and capabilities of warpsurf. For some, playback speeds have been altered to make the demos more watchable, all playback speeds are clearly displayed.

### 🤖 Agent workflow
<img src="images/agent_2x.gif" alt="Agent workflow" width="100%"/>
<br/>
<em><strong>2x playback speed</strong> - Agent workflow using Gemini 2.5 Flash as the navigator (without vision/planner/validator/estimator/history summarization). The user selects the 'agent' workflow by typing '/agent' and initiates the task. The agent performs the task in its own tab group, with the active tab streamed to the chat interface, providing real-time monitoring.</em>
<br><br>

### 🤖🤖 Multi-agent workflow

#### 🤖🤖🤖🤖 Workers
<img src="images/magent_workers_1x.gif" alt="Multiagent workflow workers" width="100%"/>
<br/>
<em><strong>Realtime playback speed</strong> - Multiagent workflow parallel workers phase, using 5x Gemini 2.5 Flash worker agents (without vision/planner/validator/estimator/history summarization). The workers perform the subtasks allocated to them in their own tab groups. The workflow visualization displays the plan and status of each subtask.</em>
<br>

#### End-to-end: ♚ Planner + ✨ Refiner + 🤖 Workers
<img src="images/magent_2x.gif" alt="Multiagent workflow entire" width="100%"/>
<br/>
<em><strong>2x playback speed</strong> - Multiagent end-to-end workflow, using Gemini 2.5 Flash as the planner, refiner and worker agents. The longer output sequences for the planner and refiner stages currently pose a substantial bottleneck on speed.</em>
<br><br>

### 🧠 + 🔍 Chat and Search workflows
<img src="images/chat+searchx2.gif" alt="warpsurf chat" width="100%"/>
<br/>
<em><strong>2x playback speed</strong> - Chat and Search workflows using Gemini 2.5 Flash. Through a single chat session, users can interact with LLMs for simple chat workflows, search-grounded requests and the agentic workflows. Chat history is carried across different workflows in a session.</em>
<br><br>

### <img src="apps/background/public/warpsurf_logo.png" alt="warpsurf" height="20" align="center"/> Panel and Options menu
<img src="images/menu_2x.gif" alt="warpsurf interface" width="100%"/>
<br/>
<em><strong>2x playback speed</strong> - Users interact with warpsurf through a side panel. Settings are configured using the Options page, where users can add API keys, select models and model settings, configure web and live data settings.</em>

## Existing Features

| Feature | Description |
|---------|-------------|
| 🔑 **Model Agnostic** | Just add your own API keys (no extra costs) |
| 🔀 **Router** | Queries are automatically triaged to the right workflow |
| 🧠 **Chat** | Conversational interface powered by leading LLMs |
| 🔍 **Search** | Low latency search-grounded chat |
| 🤖 **Agent** | Navigates and interacts with any webpage |
| 🤖🤖 **Multi-Agent** | Orchestrate multiple agents for complex or parallelisable workflows |
| 📑 **Tab Management** | Agents operate using their own tab groups |
| 🔒 **Privacy** | Runs locally in your browser; your data stays with you |
| 👁️ **Monitor** | Watch agents work in real-time with tab streaming |
| 📈 **Usage Tracking** | Real-time token and cost statistics |
| 💰 **Live Pricing** | Incorporate live pricing data for accurate cost predictions |
| 🎮 **Take Control** | Agent workflows pass control back to you at critical junctures |
| 📜 **History** | Optionally use your browser history to improve performance |
| ⏱️ **Task Estimation** | Preview task duration and cost before initialisation |

## Possible Future Features

| Feature | Description |
|---------|-------------|
| 🪟 **Tab Context** | Add the current tab's content and metadata as context in chat and workflows |
| ♻️ **Trajectory Caching** | Cache past agent trajectories and use similarity search for in-context examples |
| ⏰ **Background Tasks** | Run recurring or scheduled automations in the background |
| 🧩 **Plan Editing** | Inspect and edit multi-agent task plans before and during execution |
| 🧬 **User Memory** | Maintain a persistent user memory file to personalise behaviour across sessions |
| ✍ **Prompts** | Improved systems prompts |

## Installation & Usage

### Chrome Web Store (Recommended)

warpsurf has only been tested in a Chrome browser.

1. Visit the [Chrome Web Store]()
2. Click **"Add to Chrome"**
3. Pin the extension for easy access

### Manual Installation (Developer Mode)

```bash
# Clone this repository
git clone https://github.com/warpsurf/warpsurf.git
cd warpsurf

# Install dependencies
pnpm install

# Build the extension (this creates a dist dir)
pnpm build:store

## In Chrome browser:
# 1. Navigate to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the dist folder
```

### Usage

Follow instruction in the extension to add API keys and select models. Then, you're ready!

### Model Compatibility

Warpsurf is compatible with leading LLM providers:

OpenAI, Anthropic, Google, xAI, OpenRouter, All OpenAI-compatible APIs

### Complimentary chrome extensions

Adding chrome extensions that reduce popups (ads, CAPTCHAs, cookie banners) can improve the performance of warpsurf agents. These are some available from the chrome store:
- [reCAPTCHA Solver](https://chromewebstore.google.com/detail/recaptcha-solver-auto-cap/infdcenbdoibcacogknkjleclhnjdmfh)
- [Ad Blocker](https://chromewebstore.google.com/detail/ad-blocker-stands-adblock/lgblnfidahcdcjddiepkckcfdhpknnjh)


## Architecture

<details>
  <summary><strong>Click to expand the architecture tree</strong></summary>

  <br>

  ```
  warpsurf/
├── package.json                    # Root package: build scripts + dependencies
├── pnpm-workspace.yaml             # Defines monorepo structure: apps/* and packages/*
├── pnpm-lock.yaml                  # Dependency lockfile for reproducible installs
├── turbo.json                      # Turborepo config: task orchestration (build, dev, clean)
├── vite-env.d.ts                   # Vite environment type declarations
│
├── apps/                           # Main application code
│   ├── background/                 # Service worker (extension brain)
│   │   ├── manifest.js             # Generates manifest.json with permissions, entry points
│   │   ├── package.json            # Background app dependencies
│   │   ├── vite.config.mts         # Vite build config: IIFE bundle output to dist/
│   │   ├── tsconfig.json           # TypeScript config for background
│   │   ├── public/                 # Static assets copied to dist/
│   │   │   ├── buildDomTree.js     # Injected script: extracts DOM tree from pages
│   │   │   ├── pageExtractors.js   # Injected script: extracts page content
│   │   │   ├── warpsurf_logo*.png  # Extension icons
│   │   │   ├── LICENSE.md          # License notice
│   │   │   └── THIRD-PARTY-LICENSES/ # Third-party attributions
│   │   ├── src/
│   │   │   ├── index.ts            # Entry: initializes service worker, message handlers
│   │   │   ├── log.ts              # Logging utility factory
│   │   │   ├── browser/            # Browser automation layer
│   │   │   │   ├── context.ts      # BrowserContext: manages page instances
│   │   │   │   ├── page.ts         # Page control: navigation, clicks, inputs
│   │   │   │   ├── views.ts        # Tab/page state views
│   │   │   │   ├── util.ts         # Browser utility functions
│   │   │   │   ├── dom/            # DOM interaction services
│   │   │   │   │   ├── service.ts  # DOM tree extraction service
│   │   │   │   │   ├── views.ts    # DOM element views/types
│   │   │   │   │   ├── clickable/  # Clickable element detection
│   │   │   │   │   └── history/    # DOM history tracking
│   │   │   │   ├── history/        # Browser history integration
│   │   │   │   │   ├── fetcher.ts  # Fetches chrome.history data
│   │   │   │   │   └── preprocessor.ts # Cleans/formats history data
│   │   │   │   └── page/           # Page state management
│   │   │   │       ├── screenshot-service.ts # Tab screenshots
│   │   │   │       ├── scroll-manager.ts     # Scroll control
│   │   │   │       ├── network-waiter.ts     # Wait for network idle
│   │   │   │       └── state-cache.ts        # Page state caching
│   │   │   ├── constants/          # Configuration constants
│   │   │   ├── crypto/             # API key encryption/decryption
│   │   │   ├── executor/           # Workflow execution engine
│   │   │   │   ├── executor.ts     # Orchestrates workflow steps
│   │   │   │   └── workflow-logger.ts # Logs workflow events
│   │   │   ├── init/               # Extension initialization
│   │   │   │   └── instrumentation.ts # Cost calc, registry init
│   │   │   ├── killswitch/         # Emergency stop functionality
│   │   │   ├── listeners/          # Chrome event listeners
│   │   │   │   └── runtime.ts      # Tab/storage/install listeners
│   │   │   ├── logs/               # Log management
│   │   │   ├── ports/              # Port-based messaging
│   │   │   │   ├── side-panel.ts   # Side panel connection handler
│   │   │   │   └── dashboard.ts    # Dashboard connection handler
│   │   │   ├── tabs/               # Tab management
│   │   │   │   └── cleanup.ts      # Close task tabs/groups
│   │   │   ├── task/               # Parallel task management
│   │   │   │   └── task-manager.ts # Manages concurrent agents
│   │   │   ├── utils/              # Utility functions
│   │   │   │   ├── cost-calculator.ts    # Token cost calculation
│   │   │   │   ├── latency-calculator.ts # Model latency lookup
│   │   │   │   ├── model-registry.ts     # Provider/model registry
│   │   │   │   ├── pricing-cache.ts      # Cached pricing data
│   │   │   │   ├── token-tracker.ts      # Token usage tracking
│   │   │   │   └── json.ts, schema.ts... # Various helpers
│   │   │   └── workflows/          # AI agent workflows
│   │   │       ├── index.ts        # Workflow exports
│   │   │       ├── models/         # LLM provider integrations
│   │   │       │   ├── factory.ts  # Creates model instances
│   │   │       │   ├── types.ts    # Model types/interfaces
│   │   │       │   ├── native-openai.ts     # OpenAI API
│   │   │       │   ├── native-anthropic.ts  # Anthropic/Claude API
│   │   │       │   ├── native-gemini.ts     # Google Gemini API
│   │   │       │   ├── native-grok.ts       # xAI Grok API
│   │   │       │   ├── native-openrouter.ts # OpenRouter API
│   │   │       │   └── native-custom-openai.ts # Custom OpenAI-compatible
│   │   │       ├── chat/           # Simple chat workflow
│   │   │       │   ├── chat-workflow.ts  # Chat conversation handler
│   │   │       │   └── chat-prompt.ts    # Chat system prompts
│   │   │       ├── search/         # Web search workflow
│   │   │       │   ├── search-workflow.ts # Search + summarize
│   │   │       │   └── search-prompt.ts   # Search prompts
│   │   │       ├── agent/          # Single web agent workflow
│   │   │       │   ├── agent-navigator.ts # Executes browser actions
│   │   │       │   ├── agent-planner.ts   # Plans action sequences
│   │   │       │   ├── agent-validator.ts # Validates results
│   │   │       │   └── *-prompt*.ts       # Agent system prompts
│   │   │       ├── auto/           # Auto-routing workflow
│   │   │       │   └── auto-workflow.ts   # Routes to chat/search/agent
│   │   │       ├── multiagent/     # Parallel multi-agent workflow
│   │   │       │   ├── multiagent-workflow.ts  # Orchestrates workers
│   │   │       │   ├── multiagent-planner.ts   # Decomposes tasks
│   │   │       │   ├── multiagent-worker.ts    # Individual worker agent
│   │   │       │   ├── multiagent-scheduler.ts # Coordinates workers
│   │   │       │   ├── multiagent-merging.ts   # Merges worker results
│   │   │       │   ├── multiagent-visualization.ts # Graph visualization
│   │   │       │   └── multiagent-types.ts     # Type definitions
│   │   │       ├── specialized/    # Special-purpose workflows
│   │   │       │   ├── estimator/  # Cost/token estimation
│   │   │       │   └── history-summarizer/ # Summarizes chat history
│   │   │       └── shared/         # Shared workflow utilities
│   │   │           ├── base-agent.ts     # Base agent class
│   │   │           ├── agent-types.ts    # Agent type definitions
│   │   │           ├── context/          # History context injection
│   │   │           ├── event/            # Workflow event bus
│   │   │           ├── messages/         # Message formatting
│   │   │           └── prompts/          # Common prompt utilities
│   │   └── utils/plugins/          # Vite plugins
│   │       └── make-manifest-plugin.ts # Generates manifest.json
│   │
│   ├── panel/                      # Side panel UI (React)
│   │   ├── index.html              # Panel HTML entry point
│   │   ├── package.json            # Panel dependencies
│   │   ├── vite.config.mts         # Vite config with React plugin
│   │   ├── tsconfig.json           # TypeScript config
│   │   ├── tailwind.config.ts      # Tailwind CSS config
│   │   ├── public/icons/           # UI icons (SVG, PNG)
│   │   └── src/
│   │       ├── index.tsx           # React app entry
│   │       ├── index.css           # Global styles
│   │       ├── SidePanel.tsx       # Main panel component
│   │       ├── SidePanel.css       # Panel-specific styles
│   │       ├── screens/            # Screen components
│   │       │   └── ChatScreen.tsx  # Main chat interface
│   │       ├── components/         # UI components
│   │       │   ├── chat-interface/ # Chat UI components
│   │       │   │   ├── chat-input.tsx      # Message input
│   │       │   │   ├── message-list.tsx    # Message display
│   │       │   │   ├── message-block.tsx   # Single message
│   │       │   │   ├── markdown-renderer.tsx # Renders markdown
│   │       │   │   ├── code-block.tsx      # Code syntax highlighting
│   │       │   │   └── preview-panel.tsx   # Tab preview panel
│   │       │   ├── header/         # Header components
│   │       │   │   ├── branding.tsx        # Logo/version
│   │       │   │   ├── header-actions.tsx  # Header buttons
│   │       │   │   └── command-palette.tsx # Command palette (Ctrl+K)
│   │       │   ├── footer/         # Footer controls
│   │       │   │   ├── session-controls.tsx # Stop/pause buttons
│   │       │   │   └── session-stats-bar.tsx # Token/cost stats
│   │       │   ├── history/        # Chat history UI
│   │       │   │   ├── chat-history-list.tsx # Session list
│   │       │   │   ├── agent-dashboard.tsx   # Agent analytics
│   │       │   │   └── bookmark-list.tsx     # Saved prompts
│   │       │   ├── modals/         # Modal dialogs
│   │       │   │   ├── disclaimer-modal.tsx  # First-run disclaimer
│   │       │   │   ├── estimation-popup.tsx  # Cost estimation
│   │       │   │   └── live-pricing-modal.tsx # Pricing warning
│   │       │   ├── multiagent-visualization/ # Workflow graphs
│   │       │   ├── fish/           # Easter egg: fish tank
│   │       │   ├── preview/        # Tab preview
│   │       │   └── setup/          # Setup checklist
│   │       ├── hooks/              # React hooks
│   │       │   ├── use-background-connection.ts # Port to background
│   │       │   ├── use-chat-history.ts   # Chat session management
│   │       │   ├── use-dark-mode.ts      # Theme detection
│   │       │   ├── use-toast.ts          # Toast notifications
│   │       │   └── use-panel-*.ts        # Panel state hooks
│   │       ├── logic/              # Business logic
│   │       │   └── message-sender.ts     # Sends messages to background
│   │       ├── types/              # TypeScript types
│   │       └── utils/              # Utility functions
│   │
│   └── settings/                   # Options page UI (React)
│       ├── index.html              # Options HTML entry
│       ├── package.json            # Settings dependencies
│       ├── vite.config.mts         # Vite config
│       ├── tsconfig.json           # TypeScript config
│       ├── tailwind.config.ts      # Tailwind config
│       └── src/
│           ├── index.tsx           # React app entry
│           ├── index.css           # Global styles
│           ├── options.tsx         # Main options component
│           ├── options.css         # Options page styles
│           └── components/         # Settings UI components
│               ├── api-keys-settings.tsx   # API key management
│               ├── agent-settings.tsx      # Workflow model config
│               ├── web-settings.tsx        # Web/firewall settings
│               ├── pricing-data-settings.tsx # Pricing data toggle
│               ├── warnings.tsx            # Warning toggles
│               ├── help.tsx                # Help/docs
│               └── warpsurf-launcher.tsx   # Quick launch
│
├── packages/                       # Shared packages (monorepo)
│   ├── shared/                     # Shared utilities/types
│   │   ├── package.json            # Package config
│   │   ├── index.ts                # Exports all shared modules
│   │   └── lib/
│   │       ├── hoc/                # Higher-order components
│   │       │   ├── withErrorBoundary.tsx # Error boundary wrapper
│   │       │   └── withSuspense.tsx      # Suspense wrapper
│   │       ├── hooks/useStorage.tsx      # Chrome storage hook
│   │       ├── utils/              # Utility functions
│   │       │   ├── disclaimers.ts  # First-run disclaimer text
│   │       │   ├── safe-operations.ts # Safe async operations
│   │       │   └── shared-types.ts # Shared type definitions
│   │       ├── messages/           # Message type definitions
│   │       └── workflows/          # Workflow type definitions
│   │
│   ├── storage/                    # Chrome storage abstraction
│   │   ├── package.json            # Package config
│   │   ├── index.ts                # Exports storage modules
│   │   └── lib/
│   │       ├── base/               # Base storage implementation
│   │       │   ├── base.ts         # StorageBase class
│   │       │   ├── types.ts        # Storage types
│   │       │   └── enums.ts        # Storage enums
│   │       ├── settings/           # Settings stores
│   │       │   ├── llmProviders.ts # LLM API key storage
│   │       │   ├── agentModels.ts  # Model selection storage
│   │       │   ├── generalSettings.ts # General settings
│   │       │   ├── firewall.ts     # Domain firewall rules
│   │       │   └── warnings.ts     # Warning dismissals
│   │       ├── chat/               # Chat history storage
│   │       │   ├── history.ts      # Session history store
│   │       │   └── types.ts        # Chat types
│   │       ├── profile/            # User profile storage
│   │       ├── prompt/favorites.ts # Saved prompts
│   │       └── crypto/             # Encryption helpers
│   │           ├── client.ts       # Crypto operations
│   │           └── encrypt.ts      # AES encryption
│   │
│   ├── ui/                         # Shared UI components
│   │   ├── package.json            # Package config
│   │   ├── index.ts                # Exports UI components
│   │   └── lib/
│   │       ├── components/Button.tsx # Shared button component
│   │       ├── global.css          # Global CSS variables
│   │       └── utils.ts            # UI utilities (cn, etc.)
│   │
│   ├── i18n/                       # Internationalization
│   │   ├── package.json            # Package config
│   │   ├── index.ts                # i18n exports
│   │   ├── locales/en/messages.json # English translations
│   │   └── lib/
│   │       ├── i18n.ts             # Message getter
│   │       └── type.ts             # i18n types
│   │
│   ├── tailwind-config/            # Shared Tailwind config
│   │   ├── package.json            # Package config
│   │   └── tailwind.config.ts      # Base Tailwind config
│   │
│   ├── tsconfig/                   # Shared TypeScript configs
│   │   ├── package.json            # Package config
│   │   ├── base.json               # Base tsconfig
│   │   ├── app.json                # App tsconfig (extends base)
│   │   └── utils.json              # Utils tsconfig
│   │
│   ├── vite-config/                # Shared Vite config
│   │   ├── package.json            # Package config
│   │   ├── index.mjs               # Config exports
│   │   └── lib/
│   │       ├── env.mjs             # Environment helpers (isDev, isStore)
│   │       └── withPageConfig.mjs  # Common page config
│   │
│   ├── hmr/                        # Hot Module Replacement
│   │   ├── package.json            # Package config
│   │   ├── index.ts                # HMR exports
│   │   └── lib/
│   │       ├── plugins/            # Vite HMR plugins
│   │       │   ├── watchPublicPlugin.ts   # Watch public folder
│   │       │   └── watchRebuildPlugin.ts  # Trigger rebuilds
│   │       ├── initializers/       # HMR initialization
│   │       └── injections/         # HMR script injections
│   │
│   ├── dev-utils/                  # Development utilities
│   │   ├── package.json            # Package config
│   │   ├── index.ts                # Exports
│   │   └── lib/
│   │       ├── logger.ts           # Dev logger
│   │       └── manifest-parser/    # Parses/validates manifest
│   │
│   ├── schema-utils/               # JSON schema utilities
│   │   ├── package.json            # Package config
│   │   └── lib/                    # Schema validation helpers
│   │
│   └── zipper/                     # Extension packaging
│       ├── package.json            # Package config
│       ├── index.ts                # Zip entry point
│       └── lib/zip-bundle/         # Creates dist.zip for Chrome store
│
├── live_data/                      # Live API data generators
│   ├── README.md                   # Documentation
│   ├── generate-pricing-cache.ts   # Fetches model pricing from APIs
│   └── generate-latency-cache.ts   # Generates latency estimates
│
├── dist/                           # Build output (extension files)
│   ├── manifest.json               # Chrome extension manifest
│   ├── background.iife.js          # Bundled service worker
│   ├── buildDomTree.js             # DOM extraction script
│   ├── pageExtractors.js           # Page content extraction
│   ├── warpsurf_logo*.png          # Extension icons
│   ├── _locales/en/messages.json   # Localized strings
│   ├── panel/                      # Built side panel app
│   │   ├── index.html
│   │   └── assets/                 # JS/CSS bundles
│   └── settings/                   # Built options page
│       ├── index.html
│       └── assets/                 # JS/CSS bundles
```


</details>

## Contributing

We welcome contributions, especially bug fixes, security concerns, feature requests and interesting use cases.

## License

This project is licensed under the Apache License 2.0—see the [LICENSE](LICENSE) file for details.

If you find warpsurf useful, please consider giving it a star! It might help others discover the project.

## Acknowledgements

We thank the creators and maintainers of the [browser-use](https://github.com/browser-use/browser-use) and [nanobrowser](https://github.com/nanobrowser/nanobrowser) repositories, which this work is built on and inspired by.

---

<p align="center">
  <strong>Released for the open source community</strong>
</p>

<p align="center">
  <a href="#disclaimer">Disclaimer</a> •
  <a href="#installation">Get Started</a> •
  <a href="#existing-features">Features</a> •
  <a href="#contributing">Contribute</a>

</p>
