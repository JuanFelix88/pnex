import { PnexConfig } from '../../shared/types';
import { defaultTheme } from './default-theme';

/** Default configuration written on first launch */
export const defaultConfig: PnexConfig = {
  ai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  theme: defaultTheme,
  shell: '',
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
};
