import { encrypt, decrypt, isEncryptedData, type EncryptedData } from '@extension/storage';

const apiKeyCache = new Map<string, string>();

export async function encryptApiKey(apiKey: string): Promise<EncryptedData> {
  return encrypt(apiKey);
}

export async function decryptApiKey(encrypted: EncryptedData): Promise<string> {
  return decrypt(encrypted);
}

export async function getProviderApiKey(providerId: string): Promise<string | null> {
  if (apiKeyCache.has(providerId)) {
    return apiKeyCache.get(providerId)!;
  }

  const result = await chrome.storage.local.get('llm-api-keys');
  const providers = result['llm-api-keys']?.providers || {};
  const config = providers[providerId];

  if (!config) {
    return null;
  }

  if (config._k && isEncryptedData(config._k)) {
    try {
      const decrypted = await decryptApiKey(config._k);
      apiKeyCache.set(providerId, decrypted);
      return decrypted;
    } catch {
      return null;
    }
  }

  return null;
}

export async function getAllProviderApiKeys(): Promise<Map<string, string>> {
  const result = await chrome.storage.local.get('llm-api-keys');
  const providers = result['llm-api-keys']?.providers || {};
  const keys = new Map<string, string>();

  for (const [providerId, config] of Object.entries(providers)) {
    const providerConfig = config as any;

    if (apiKeyCache.has(providerId)) {
      keys.set(providerId, apiKeyCache.get(providerId)!);
      continue;
    }

    if (providerConfig._k && isEncryptedData(providerConfig._k)) {
      try {
        const decrypted = await decryptApiKey(providerConfig._k);
        apiKeyCache.set(providerId, decrypted);
        keys.set(providerId, decrypted);
      } catch {
        // Skip on error
      }
    }
  }

  return keys;
}

export async function getAllProvidersDecrypted(): Promise<Record<string, any>> {
  const result = await chrome.storage.local.get('llm-api-keys');
  const providers = result['llm-api-keys']?.providers || {};
  const decrypted: Record<string, any> = {};

  for (const [providerId, config] of Object.entries(providers)) {
    const providerConfig = config as any;

    if (providerConfig._k && isEncryptedData(providerConfig._k)) {
      try {
        let apiKey: string;

        if (apiKeyCache.has(providerId)) {
          apiKey = apiKeyCache.get(providerId)!;
        } else {
          apiKey = await decryptApiKey(providerConfig._k);
          apiKeyCache.set(providerId, apiKey);
        }

        const { _k, ...rest } = providerConfig;
        decrypted[providerId] = { ...rest, apiKey };
      } catch {
        const { _k, ...rest } = providerConfig;
        decrypted[providerId] = { ...rest, apiKey: '' };
      }
    } else {
      decrypted[providerId] = providerConfig;
    }
  }

  return decrypted;
}

export function clearApiKeyCache(): void {
  apiKeyCache.clear();
}

export function invalidateProviderCache(providerId: string): void {
  apiKeyCache.delete(providerId);
}
