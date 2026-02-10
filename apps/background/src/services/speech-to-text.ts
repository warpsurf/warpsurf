/**
 * Speech-to-Text service supporting OpenAI Transcription API and Gemini multimodal.
 */
import { speechToTextModelStore, type SpeechToTextModelConfig, ProviderTypeEnum } from '@extension/storage';
import { getAllProvidersDecrypted } from '../crypto';

export class SpeechToTextService {
  private constructor(
    private readonly providerType: 'openai' | 'gemini',
    private readonly apiKey: string,
    private readonly modelName: string,
    private readonly language?: string,
  ) {}

  static async create(): Promise<SpeechToTextService> {
    const config = await speechToTextModelStore.getConfig();
    if (!config?.provider || !config?.modelName) {
      throw new Error('No speech-to-text model configured. Please select one in Settings → Voice.');
    }

    const providers = await getAllProvidersDecrypted();
    const provider = providers[config.provider];
    if (!provider?.apiKey) {
      throw new Error(`No API key found for provider "${config.provider}". Add one in Settings → API Keys.`);
    }

    const providerType =
      config.provider === ProviderTypeEnum.OpenAI
        ? 'openai'
        : config.provider === ProviderTypeEnum.Gemini
          ? 'gemini'
          : null;

    if (!providerType) {
      throw new Error('Speech-to-text is only supported for OpenAI and Google Gemini providers.');
    }

    return new SpeechToTextService(providerType, provider.apiKey, config.modelName, config.language);
  }

  async transcribe(base64Audio: string, mimeType = 'audio/webm'): Promise<string> {
    return this.providerType === 'openai'
      ? this.transcribeOpenAI(base64Audio, mimeType)
      : this.transcribeGemini(base64Audio, mimeType);
  }

  private async transcribeOpenAI(base64Audio: string, mimeType: string): Promise<string> {
    const binaryStr = atob(base64Audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('wav') ? 'wav' : 'webm';
    const blob = new Blob([bytes], { type: mimeType });
    const file = new File([blob], `audio.${ext}`, { type: mimeType });

    const form = new FormData();
    form.append('file', file);
    form.append('model', this.modelName);
    if (this.language) form.append('language', this.language);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI transcription failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    return (data.text ?? '').trim();
  }

  private async transcribeGemini(base64Audio: string, mimeType: string): Promise<string> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const client = new GoogleGenerativeAI(this.apiKey);
    const model = client.getGenerativeModel({ model: this.modelName });

    const result = await model.generateContent([
      {
        text: 'Transcribe this audio. Return only the transcribed text without any additional formatting or explanations.',
      },
      { inlineData: { data: base64Audio, mimeType } },
    ]);

    const response = result.response;
    return (response.text?.() ?? '').trim();
  }
}
