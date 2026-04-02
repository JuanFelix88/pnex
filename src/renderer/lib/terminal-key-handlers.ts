import { Terminal } from "@xterm/xterm";

type KeyHandler = (event: KeyboardEvent) => boolean;

const handlers: KeyHandler[] = [];
let bound = false;

/**
 * Register a keyboard handler for the terminal.
 * Return `false` from the handler to suppress the key event; `true` to pass through.
 * All registered handlers are evaluated in order — the first `false` wins.
 */
export function registerTerminalKeyHandler(handler: KeyHandler): void {
  handlers.push(handler);
}

/**
 * Bind all registered handlers to the terminal via a single `attachCustomKeyEventHandler`.
 * Must be called once after all handlers are registered.
 */
export function bindTerminalKeyHandlers(terminal: Terminal): void {
  if (bound) return;
  bound = true;

  terminal.attachCustomKeyEventHandler((event) => {
    for (const handler of handlers) {
      if (!handler(event)) {
        return false;
      }
    }
    return true;
  });
}
