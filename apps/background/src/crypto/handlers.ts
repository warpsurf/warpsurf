import { encrypt, decrypt, isEncryptedData } from '@extension/storage';
import { invalidateProviderCache } from './service';

export type CryptoMessageType =
  | 'crypto_set_provider'
  | 'crypto_get_provider'
  | 'crypto_get_all_providers'
  | 'crypto_remove_provider'
  | 'crypto_has_provider';

interface CryptoMessage {
  type: CryptoMessageType;
  providerId?: string;
  config?: any;
}

interface CryptoResponse {
  success?: boolean;
  data?: any;
  error?: string;
}

export function registerCryptoHandlers(): void {
  chrome.runtime.onMessage.addListener(
    (message: CryptoMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: CryptoResponse) => void) => {
      if (!message?.type?.startsWith('crypto_')) {
        return false;
      }

      if (sender.id !== chrome.runtime.id) {
        sendResponse({ error: 'Unauthorized' });
        return true;
      }

      handleCryptoMessage(message)
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ error: err.message || 'Unknown error' }));

      return true;
    },
  );
}

async function handleCryptoMessage(message: CryptoMessage): Promise<any> {
  switch (message.type) {
    case 'crypto_set_provider':
      if (!message.providerId) throw new Error('providerId is required');
      return handleSetProvider(message.providerId, message.config);

    case 'crypto_get_provider':
      if (!message.providerId) throw new Error('providerId is required');
      return handleGetProvider(message.providerId);

    case 'crypto_get_all_providers':
      return handleGetAllProviders();

    case 'crypto_remove_provider':
      if (!message.providerId) throw new Error('providerId is required');
      return handleRemoveProvider(message.providerId);

    case 'crypto_has_provider':
      if (!message.providerId) throw new Error('providerId is required');
      return handleHasProvider(message.providerId);

    default:
      throw new Error('Unknown message type');
  }
}

async function handleSetProvider(providerId: string, config: any): Promise<void> {
  if (!config) {
    throw new Error('config is required');
  }

  const result = await chrome.storage.local.get('llm-api-keys');
  const current = result['llm-api-keys'] || { providers: {} };

  let encryptedKey = undefined;
  if (config.apiKey && typeof config.apiKey === 'string' && config.apiKey.trim() !== '') {
    encryptedKey = await encrypt(config.apiKey);
  }

  const secureConfig = {
    ...config,
    _k: encryptedKey,
  };

  delete secureConfig.apiKey;

  await chrome.storage.local.set({
    'llm-api-keys': {
      providers: {
        ...current.providers,
        [providerId]: secureConfig,
      },
    },
  });

  invalidateProviderCache(providerId);
}

async function handleGetProvider(providerId: string): Promise<any> {
  const result = await chrome.storage.local.get('llm-api-keys');
  const providers = result['llm-api-keys']?.providers || {};
  const config = providers[providerId];

  if (!config) {
    return undefined;
  }

  if (config._k && isEncryptedData(config._k)) {
    try {
      const decryptedKey = await decrypt(config._k);
      const { _k, ...rest } = config;
      return { ...rest, apiKey: decryptedKey };
    } catch {
      const { _k, ...rest } = config;
      return { ...rest, apiKey: '' };
    }
  }

  return config;
}

async function handleGetAllProviders(): Promise<Record<string, any>> {
  const result = await chrome.storage.local.get('llm-api-keys');
  const providers = result['llm-api-keys']?.providers || {};
  const decryptedProviders: Record<string, any> = {};

  for (const [providerId, config] of Object.entries(providers)) {
    const providerConfig = config as any;

    if (providerConfig._k && isEncryptedData(providerConfig._k)) {
      try {
        const decryptedKey = await decrypt(providerConfig._k);
        const { _k, ...rest } = providerConfig;
        decryptedProviders[providerId] = { ...rest, apiKey: decryptedKey };
      } catch {
        const { _k, ...rest } = providerConfig;
        decryptedProviders[providerId] = { ...rest, apiKey: '' };
      }
    } else {
      decryptedProviders[providerId] = providerConfig;
    }
  }

  return decryptedProviders;
}

async function handleRemoveProvider(providerId: string): Promise<void> {
  const result = await chrome.storage.local.get('llm-api-keys');
  const current = result['llm-api-keys'] || { providers: {} };

  const newProviders = { ...current.providers };
  delete newProviders[providerId];

  await chrome.storage.local.set({
    'llm-api-keys': { providers: newProviders },
  });

  invalidateProviderCache(providerId);
}

async function handleHasProvider(providerId: string): Promise<boolean> {
  const result = await chrome.storage.local.get('llm-api-keys');
  const providers = result['llm-api-keys']?.providers || {};
  return providerId in providers;
}
