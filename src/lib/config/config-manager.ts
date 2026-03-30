import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PnexConfig } from '../../shared/types';
import { defaultConfig } from './default-config';

const CONFIG_PATH = path.join(
  os.homedir(),
  'pnex-config.json'
);

/** Read config from ~/pnex-config.json */
export function loadConfig(): PnexConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(defaultConfig);
    return defaultConfig;
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return { ...defaultConfig, ...JSON.parse(raw) };
}

/** Write config to ~/pnex-config.json */
export function saveConfig(config: PnexConfig): void {
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify(config, null, 2),
    'utf-8'
  );
}

/** Get the absolute path to config file */
export function getConfigPath(): string {
  return CONFIG_PATH;
}
