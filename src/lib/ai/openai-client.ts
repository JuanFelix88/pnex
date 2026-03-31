import OpenAI from 'openai';
import { AiConfig } from '../../shared/types';

/** Lazy-initialized OpenAI client */
let client: OpenAI | null = null;
let currentConfig: AiConfig | null = null;

/**
 * Get or create an OpenAI-compatible API client.
 * Recreates client if config changes.
 */
export function getClient(config: AiConfig): OpenAI {
  const configChanged =
    !currentConfig ||
    currentConfig.baseUrl !== config.baseUrl ||
    currentConfig.apiKey !== config.apiKey;

  if (!client || configChanged) {
    client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    currentConfig = { ...config };
  }

  return client;
}
