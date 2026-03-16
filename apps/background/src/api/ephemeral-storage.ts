/**
 * In-memory credential storage for API mode.
 * Credentials are ephemeral and cleared when browser closes.
 */

export class EphemeralStore {
  private providers = new Map<string, any>();
  private agentModels = new Map<string, any>();

  setProvider(providerId: string, config: any): void {
    this.providers.set(providerId, config);
  }

  setAgentModel(agentName: string, config: any): void {
    this.agentModels.set(agentName, config);
  }

  getProviders(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [id, config] of this.providers) {
      result[id] = config;
    }
    return result;
  }

  getAgentModels(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [name, config] of this.agentModels) {
      result[name] = config;
    }
    return result;
  }

  hasData(): boolean {
    return this.providers.size > 0;
  }

  clear(): void {
    this.providers.clear();
    this.agentModels.clear();
  }
}

// Singleton instance
export const ephemeralStore = new EphemeralStore();
