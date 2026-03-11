import { initializeCostCalculator, getCachedPricingCount } from '../utils/cost-calculator';
import { initializeLatencyCalculator, getCachedLatencyCount } from '../utils/latency-calculator';
import { initializeModelRegistry, getModelRegistryCachedCount } from '../utils/model-registry';
import { setupLLMApiLogging } from '../utils/llm-fetch-logger';
import { setupXHRLogging } from '../utils/xhrLogger';
import { setupLLMInterceptor } from '../test/llm-interceptor';

export async function initInstrumentation(logger: {
  info: Function;
  error: Function;
}): Promise<{ pricedModels: number; latencyModels: number; registryModels: number; errors: number }> {
  let errors = 0;

  try {
    await initializeCostCalculator();
  } catch (error) {
    logger.error('Failed to initialize cost calculator:', error);
    errors++;
  }

  try {
    await initializeLatencyCalculator();
  } catch (error) {
    logger.error('Failed to initialize latency calculator:', error);
    errors++;
  }

  try {
    await initializeModelRegistry();
  } catch (error) {
    logger.error('Failed to initialize model registry:', error);
    errors++;
  }

  try {
    setupLLMApiLogging();
  } catch (e) {
    logger.error('Failed to initialize LLM API logging', e);
    errors++;
  }

  // Setup LLM interceptor for testing (only in test mode)
  // Always call setupLLMInterceptor - it has its own guard
  try {
    setupLLMInterceptor();
    if (process.env.__TEST__ === 'true') {
      logger.info('LLM interceptor enabled for testing');
    }
  } catch (e) {
    if (process.env.__TEST__ === 'true') {
      logger.error('Failed to setup LLM interceptor', e);
      errors++;
    }
  }

  try {
    setupXHRLogging(logger);
  } catch {}

  return {
    pricedModels: getCachedPricingCount(),
    latencyModels: getCachedLatencyCount(),
    registryModels: getModelRegistryCachedCount(),
    errors,
  };
}
