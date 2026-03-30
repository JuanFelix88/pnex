import { PnexConfig } from '../shared/types';
import { initTerminal } from './lib/terminal-setup';
import { initInlineChat } from './lib/inline-chat';
import { initAiHint } from './lib/ai-hint';
import { applyTheme } from './lib/theme-applier';

declare const pnex: import('../preload/preload').PnexApi;

async function main(): Promise<void> {
  const config: PnexConfig = await pnex.getConfig();

  applyTheme(config.theme);

  const container = document.getElementById('terminal');
  if (!container) {
    throw new Error('Terminal container not found');
  }

  const { terminal } = initTerminal(container, config);

  initInlineChat(terminal);
  initAiHint(terminal);

  pnex.onNewChat(() => {
    pnex.newChat();
  });

  terminal.focus();
}

main();
