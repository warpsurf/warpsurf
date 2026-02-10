import { createChatModel } from '../workflows/models/factory';
import {
  generalSettingsStore,
  agentModelStore,
  AgentNameEnum,
  getDefaultDisplayNameFromProviderId,
} from '@extension/storage';
import { Executor } from '../executor/executor';
import BrowserContext from '../browser/context';
import { getAllProvidersDecrypted, getAllAgentModelsDecrypted } from '../crypto';

type BaseChatModel = any;

export type SingleAgentFactoryInput = {
  prompt: string;
  sessionId: string;
  manualAgentType?: string;
};

export async function createSingleAgentExecutor(input: SingleAgentFactoryInput): Promise<Executor> {
  const { prompt, sessionId, manualAgentType } = input;

  const providers = await getAllProvidersDecrypted();
  const agentModels = await getAllAgentModelsDecrypted();

  const navigatorCfg = agentModels[AgentNameEnum.AgentNavigator];
  if (!navigatorCfg) throw new Error('Please choose a model for the navigator in the settings first');
  if (!providers[navigatorCfg.provider]) {
    const name = getDefaultDisplayNameFromProviderId(navigatorCfg.provider);
    throw new Error(`Provider '${name}' not found. Please add an API key for ${name} in Settings.`);
  }
  const navigatorLLM: BaseChatModel = createChatModel(providers[navigatorCfg.provider], navigatorCfg);

  // Planner and validator are optional - only create if provider exists
  const plannerCfg = agentModels[AgentNameEnum.AgentPlanner] || null;
  const validatorCfg = agentModels[AgentNameEnum.AgentValidator] || null;
  const plannerLLM: BaseChatModel | null =
    plannerCfg && providers[plannerCfg.provider] ? createChatModel(providers[plannerCfg.provider], plannerCfg) : null;
  const validatorLLM: BaseChatModel | null =
    validatorCfg && providers[validatorCfg.provider]
      ? createChatModel(providers[validatorCfg.provider], validatorCfg)
      : null;

  const generalSettings = await generalSettingsStore.getSettings();
  const effectiveSettings: any = { ...generalSettings };
  try {
    (effectiveSettings as any).useFullPlanningPipeline = false;
  } catch {}

  const browserCtx = new BrowserContext({});
  const executor = new Executor(prompt, sessionId, browserCtx, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    validatorLLM: validatorLLM ?? navigatorLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
    generalSettings: effectiveSettings,
    agentType: manualAgentType,
  });
  return executor;
}

export type WorkerExecutorFactoryInput = {
  prompt: string;
  sessionId: string;
  workerModelPrefers?: AgentNameEnum; // optionally prefer MultiagentWorker/AgentPlanner/AgentNavigator override
};

export async function createWorkerExecutor(input: WorkerExecutorFactoryInput): Promise<Executor> {
  const { prompt, sessionId, workerModelPrefers } = input;

  const providers = await getAllProvidersDecrypted();
  const agentModels = await agentModelStore.getAllAgentModels();

  const workerCfg =
    agentModels[workerModelPrefers || AgentNameEnum.AgentNavigator] || agentModels[AgentNameEnum.AgentNavigator];
  if (!workerCfg) throw new Error('No worker-capable model configured');
  if (!providers[workerCfg.provider]) {
    const name = getDefaultDisplayNameFromProviderId(workerCfg.provider);
    throw new Error(`Provider '${name}' not found. Please add an API key for ${name} in Settings.`);
  }
  const navigatorLLM: BaseChatModel = createChatModel(providers[workerCfg.provider], workerCfg);

  // Get planner/validator LLMs if multi-agent planner/validator is enabled
  const plannerCfg = agentModels[AgentNameEnum.AgentPlanner] || null;
  const validatorCfg = agentModels[AgentNameEnum.AgentValidator] || null;
  const plannerLLM: BaseChatModel | null =
    plannerCfg && providers[plannerCfg.provider] ? createChatModel(providers[plannerCfg.provider], plannerCfg) : null;
  const validatorLLM: BaseChatModel | null =
    validatorCfg && providers[validatorCfg.provider]
      ? createChatModel(providers[validatorCfg.provider], validatorCfg)
      : null;

  const generalSettings = await generalSettingsStore.getSettings();

  // Map multi-agent settings to the single-agent executor settings
  // Workers use enableMultiagentPlanner/enableMultiagentValidator instead of enablePlanner/enableValidator
  const workerSettings = {
    ...generalSettings,
    enablePlanner: generalSettings.enableMultiagentPlanner ?? false,
    enableValidator: generalSettings.enableMultiagentValidator ?? false,
  };

  // Workers require isolated tabs/groups. Use worker-mode BrowserContext so first navigation opens a new tab
  // and emits TAB_CREATED for proper grouping/mirroring.
  const browserCtx = new BrowserContext({ forceNewTab: true });
  const executor = new Executor(prompt, sessionId, browserCtx, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    validatorLLM: validatorLLM ?? navigatorLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
    generalSettings: workerSettings,
    agentType: 'agent',
    retainTokenLogs: true, // Workers must retain tokens for session log aggregation
  });
  return executor;
}
