import BrowserContext from '../browser/context';
import { Executor } from './executor';
import { createChatModel } from '../workflows/models/factory';
import {
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  getDefaultDisplayNameFromProviderId,
} from '@extension/storage';
import { getAllProvidersDecrypted, getAllAgentModelsDecrypted } from '../crypto';
type BaseChatModel = any;
import { globalTokenTracker } from '../utils/token-tracker';
import { createLogger } from '@src/log';

const logger = createLogger('SetupExecutor');

// Returns the agents required for a specific workflow type
function getRequiredAgentsForWorkflow(agentType?: string): AgentNameEnum[] {
  const type = (agentType || '').toLowerCase();
  if (type === 'chat') return [AgentNameEnum.Chat];
  if (type === 'search') return [AgentNameEnum.Search];
  return [AgentNameEnum.AgentNavigator]; // 'agent' or default
}

export async function setupExecutor(
  taskId: string,
  task: string,
  browserContext: BrowserContext,
  agentType?: string,
  contextTabIds?: number[],
) {
  const providers = await getAllProvidersDecrypted();
  if (Object.keys(providers).length === 0) {
    throw new Error('Please configure API keys in the settings first');
  }
  const agentModels = await getAllAgentModelsDecrypted();

  // Validate only the agents required for this workflow
  for (const agentName of getRequiredAgentsForWorkflow(agentType)) {
    const agentModel = agentModels[agentName];
    if (!agentModel) {
      throw new Error(`Please configure a model for ${agentName} in Settings.`);
    }
    if (!providers[agentModel.provider]) {
      const name = getDefaultDisplayNameFromProviderId(agentModel.provider);
      throw new Error(`Provider '${name}' not found for ${agentName}. Please add an API key in Settings.`);
    }
  }

  const navigatorModel = agentModels[AgentNameEnum.AgentNavigator];
  if (!navigatorModel) {
    throw new Error('Please choose a model for the navigator in the settings first');
  }
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.AgentPlanner];
  if (plannerModel && providers[plannerModel.provider]) {
    plannerLLM = createChatModel(providers[plannerModel.provider], plannerModel);
  }

  let validatorLLM: BaseChatModel | null = null;
  const validatorModel = agentModels[AgentNameEnum.AgentValidator];
  if (validatorModel && providers[validatorModel.provider]) {
    validatorLLM = createChatModel(providers[validatorModel.provider], validatorModel);
  }

  let chatLLM: BaseChatModel | null = null;
  const chatModel = agentModels[AgentNameEnum.Chat];
  if (chatModel && providers[chatModel.provider]) {
    chatLLM = createChatModel(providers[chatModel.provider], chatModel);
  }

  let searchLLM: BaseChatModel | null = null;
  const searchModel = agentModels[AgentNameEnum.Search];
  if (searchModel && providers[searchModel.provider]) {
    searchLLM = createChatModel(providers[searchModel.provider], { ...searchModel, webSearch: true });
  }

  const firewall = await firewallStore.getFirewall();
  if (firewall.enabled) {
    browserContext.updateConfig({
      allowedUrls: firewall.allowList,
      deniedUrls: firewall.denyList,
    });
  } else {
    browserContext.updateConfig({
      allowedUrls: [],
      deniedUrls: [],
    });
  }

  const generalSettings = await generalSettingsStore.getSettings();

  // Debug: Log planner/validator settings to diagnose activation issues
  logger.info('[Settings] Planner/Validator config:', {
    enablePlanner: generalSettings.enablePlanner,
    enableValidator: generalSettings.enableValidator,
    useFullPlanningPipeline: generalSettings.useFullPlanningPipeline,
    planningInterval: generalSettings.planningInterval,
    hasPlannerModel: !!plannerModel,
    hasValidatorModel: !!validatorModel,
    agentType,
  });

  browserContext.updateConfig({
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000.0,
    displayHighlights: (generalSettings as any).displayHighlights ?? generalSettings.useVision,
    viewportExpansion: generalSettings.fullPageWindow ? -1 : 0,
  });

  globalTokenTracker.setCurrentTaskId(taskId);

  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    validatorLLM: validatorLLM ?? navigatorLLM,
    chatLLM: chatLLM ?? navigatorLLM,
    searchLLM: searchLLM ?? navigatorLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      maxValidatorFailures: generalSettings.maxValidatorFailures,
      retryDelay: generalSettings.retryDelay,
      maxInputTokens: generalSettings.maxInputTokens,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
    generalSettings: generalSettings,
    agentType: agentType,
    retainTokenLogs: true,
  });

  // Set context tabs BEFORE initialize() so they're available for injection
  if (contextTabIds?.length) {
    executor.setContextTabIds(contextTabIds);
  }

  await executor.initialize();
  return executor;
}
