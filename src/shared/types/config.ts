import { PnexTheme } from './theme';

/** AI provider configuration */
export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Full pnex-config.json shape */
export interface PnexConfig {
  ai: AiConfig;
  theme: PnexTheme;
  shell?: string;
  fontSize?: number;
  fontFamily?: string;
}
