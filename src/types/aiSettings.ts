export type AiProvider = 'gemini' | 'deepseek' | 'openai' | 'local';

export interface AiSettings {
  id: string;
  provider: AiProvider;
  api_key: string;
  model: string;
  endpoint?: string;
  temperature?: number;
  enabled: boolean;
  updated_at?: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  id: 'default',
  provider: 'gemini',
  api_key: '',
  model: 'gemini-3.8-flash',
  endpoint: '',
  temperature: 0.1,
  enabled: true,
};

export interface AiTestResult {
  success: boolean;
  provider: AiProvider;
  latencyMs: number;
  statusCode?: number;
  message: string;
}
