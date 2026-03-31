import { Terminal } from '@xterm/xterm';

/**
 * Show/hide the "Ctrl + I for AI" hint based on
 * whether the terminal has user-typed input on
 * the current line.
 */
export function initAiHint(terminal: Terminal): void {
  const hint = document.getElementById('ai-hint');
  if (!hint) return;

  let hasInput = false;

  terminal.onData((data: string) => {
    if (data === '\r' || data === '\n') {
      hasInput = false;
    } else if (data === '\x7f') {
      /* backspace - simplified heuristic */
      hasInput = false;
    } else if (data.length > 0 && !isControlChar(data)) {
      hasInput = true;
    }

    hint.style.display = hasInput ? 'none' : 'block';
  });
}

function isControlChar(data: string): boolean {
  const code = data.charCodeAt(0);
  return code < 32 && code !== 13 && code !== 10;
}
