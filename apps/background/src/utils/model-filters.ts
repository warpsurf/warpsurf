// Provider-specific model filtering rules

export interface FilterOptions {
  keepDatedVersions?: boolean;
  keepPreviewVersions?: boolean;
}

export function filterModelsForProvider(
  provider: string,
  models: string[],
  options: FilterOptions = {}
): string[] {
  const filter = PROVIDER_FILTERS[provider.toLowerCase()];
  return filter ? filter(models, options) : genericFilter(models);
}

const PROVIDER_FILTERS: Record<string, (models: string[], options: FilterOptions) => string[]> = {
  openai: filterOpenAI,
  anthropic: filterAnthropic,
  gemini: filterGoogle,
  google: filterGoogle,
  grok: filterXAI,
  x: filterXAI,
};

function filterOpenAI(models: string[], options: FilterOptions): string[] {
  const basicFiltered = models.filter(m => {
    if (m.includes('-batch')) return false;
    if (m.startsWith('ft:')) return false;
    if (m.includes('.ft-')) return false; // Fine-tuning variants
    if (m.includes('-realtime')) return false;
    if (/^(ada|babbage|curie|davinci)(-|$)/.test(m)) return false;
    if (m.startsWith('text-')) return false;
    if (m.startsWith('chatgpt-')) return false;
    if (m.startsWith('whisper')) return false;
    if (m.startsWith('tts')) return false;
    if (m.startsWith('dall-e')) return false;
    if (m.startsWith('openai/')) return false; // Remove prefixed duplicates
    if (m.includes('-vision-preview')) return false; // Vision previews
    if (m.includes('-16k-')) return false; // Old 16k context variants
    return true;
  });

  if (!options.keepDatedVersions) {
    const nonDatedModels = new Set(basicFiltered.filter(m => !hasDateSuffix(m)));
    return basicFiltered.filter(m => {
      if (!hasDateSuffix(m)) return true;
      const baseModel = stripDateSuffix(m);
      // Also check if base without -preview exists
      const baseWithoutPreview = baseModel.replace(/-preview$/, '');
      return !nonDatedModels.has(baseModel) && !nonDatedModels.has(baseWithoutPreview);
    });
  }

  return basicFiltered;
}

function filterAnthropic(models: string[]): string[] {
  return models.filter(m => {
    if (m.startsWith('claude-v')) return false;
    if (m.startsWith('claude-2')) return false;
    if (m.startsWith('claude-instant')) return false;
    return true;
  });
}

function filterGoogle(models: string[], options: FilterOptions): string[] {
  // Dedupe first
  const unique = [...new Set(models)];
  const geminiOnly = unique.filter(m => m.startsWith('gemini'));
  
  const filtered = geminiOnly.filter(m => {
    if (m.includes('1.0')) return false;
    if (m === 'gemini-pro') return false;
    if (/\d{2}-\d{2}$/.test(m)) return false;
    return true;
  });

  if (!options.keepPreviewVersions) {
    return filtered.filter(m => {
      if (m.endsWith('-preview')) {
        const stableVersion = m.replace('-preview', '');
        if (filtered.includes(stableVersion)) return false;
      }
      return true;
    });
  }

  return filtered;
}

function filterXAI(models: string[]): string[] {
  return models.filter(m => {
    // Exclude dated versions (e.g., grok-2-1212)
    if (/-\d{4}$/.test(m)) return false;
    // Exclude beta versions
    if (m.includes('-beta')) return false;
    // Exclude vision variants (specialized)
    if (m.includes('-vision')) return false;
    return true;
  });
}

function genericFilter(models: string[]): string[] {
  return models.filter(m => {
    if (m.includes('-batch')) return false;
    if (m.startsWith('ft:')) return false;
    return true;
  });
}

function hasDateSuffix(model: string): boolean {
  // Match YYYY-MM-DD (full date like 2024-05-13) or common OpenAI short codes (MMDD like 0125, 0613)
  if (/\d{4}-\d{2}-\d{2}$/.test(model)) return true;
  // Short date codes: typically 4 digits at end after a hyphen (but not -16k, -32k, -8b etc)
  if (/-\d{4}$/.test(model) && !/-\d+k$/.test(model) && !/-\d+b$/.test(model)) return true;
  return false;
}

function stripDateSuffix(model: string): string {
  return model
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')  // Full date
    .replace(/-\d{4}$/, '');              // Short code
}

