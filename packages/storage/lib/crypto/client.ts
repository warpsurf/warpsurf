import type { ProviderConfig } from '../settings/llmProviders';

interface CryptoResponse<T = any> {
  success?: boolean;
  data?: T;
  error?: string;
}

async function sendMessage<T>(type: string, data?: Record<string, any>): Promise<T> {
  try {
    const response: CryptoResponse<T> = await chrome.runtime.sendMessage({ type, ...data });

    if (response.error) {
      throw new Error(response.error);
    }

    return response.data as T;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Receiving end does not exist')) {
      throw new Error('Background script not ready. Please try again.');
    }
    throw error;
  }
}

export const secureProviderClient = {
  async setProvider(providerId: string, config: ProviderConfig): Promise<void> {
    await sendMessage('crypto_set_provider', { providerId, config });
  },

  async getProvider(providerId: string): Promise<ProviderConfig | undefined> {
    return sendMessage<ProviderConfig | undefined>('crypto_get_provider', { providerId });
  },

  async getAllProviders(): Promise<Record<string, ProviderConfig>> {
    return sendMessage<Record<string, ProviderConfig>>('crypto_get_all_providers', {});
  },

  async removeProvider(providerId: string): Promise<void> {
    await sendMessage('crypto_remove_provider', { providerId });
  },

  async hasProvider(providerId: string): Promise<boolean> {
    return sendMessage<boolean>('crypto_has_provider', { providerId });
  },
};
