export const ACTOR_PROFILES = {
  user: {
    name: 'User',
    icon: 'icons/user.svg',
    iconBackground: '#4CAF50',
  },
  system: {
    name: 'System',
    icon: 'icons/system.svg',
    iconBackground: '#2196F3',
  },
  // Single-agent workflow components
  agent_planner: {
    name: 'Planner',
    icon: 'icons/planner.svg',
    iconBackground: '#FF9800',
  },
  agent_navigator: {
    name: 'Navigator',
    icon: 'icons/navigator.svg',
    iconBackground: '#40A9FF',
  },
  agent_validator: {
    name: 'Validator',
    icon: 'icons/validator.svg',
    iconBackground: '#EC407A',
  },
  // Workflow-level actors
  chat: {
    name: 'Chat',
    icon: 'icons/LLM.png',
    iconBackground: '#8b5cf6',
  },
  search: {
    name: 'Search',
    icon: 'icons/LLM_w_search.png',
    iconBackground: '#14b8a6',
  },
  auto: {
    name: 'Auto',
    icon: 'icons/Triage.png',
    iconBackground: '#000000',
  },
  multiagent: {
    name: 'Multi-Agent',
    icon: '',
    iconBackground: '#A78BFA',
  },
  estimator: {
    name: 'Estimator',
    icon: 'icons/system.svg',
    iconBackground: '#7c3aed',
  },
  // Multiagent workflow sub-roles (used in trace items)
  planner: {
    name: 'Planner',
    icon: 'icons/planner.svg',
    iconBackground: '#fb923c',
  },
  refiner: {
    name: 'Refiner',
    icon: '',
    iconBackground: '#fb923c',
  },
} as const;
