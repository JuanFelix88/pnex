import { PnexTheme } from "./theme";

/** AI provider configuration */
export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Terminal context sent alongside AI prompts */
export interface TerminalContext {
  cwd: string;
  bufferLines: string[];
}

/** Full pnex-config.json shape */
export interface PnexConfig {
  ai: AiConfig;
  theme: PnexTheme;
  uiThemeName?: string;
  shell?: string;
  startDirectory?: string;
  fontSize?: number;
  fontFamily?: string;
}
