import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { PnexConfig } from "../../shared/types";
import { toXtermTheme } from "./theme-applier";
import { extractPnexOscPayload, registerAgentHandlers } from "./agent-stream";
import { markCommandRunning } from "./terminal-command-state";
import { trackInput, onCommandSubmit } from "./input-tracker";
import { registerTerminalKeyHandler } from "./terminal-key-handlers";

declare const pnex: import("../../preload/preload").PnexApi;

/**
 * Initialize xterm.js terminal in the given container.
 * Connects to the main-process pty via IPC bridge.
 */
export function initTerminal(
  container: HTMLElement,
  config: PnexConfig,
): { terminal: Terminal; fitAddon: FitAddon } {
  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon();

  const terminal = new Terminal({
    theme: toXtermTheme(config.theme),
    fontSize: config.fontSize || 14,
    fontFamily: config.fontFamily || 'Consolas, "Courier New", monospace',
    cursorBlink: true,
    cursorStyle: "bar",
    allowProposedApi: true,
  });

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  terminal.open(container);

  registerAgentHandlers(terminal, config.uiThemeName);
  connectToPty(terminal, fitAddon);
  observeResize(container, fitAddon);
  registerPasteHandler();
  registerCommandHistory();

  // Fit after resize handlers are attached so the initial size is sent to the PTY.
  fitAddon.fit();

  return { terminal, fitAddon };
}

function connectToPty(terminal: Terminal, fitAddon: FitAddon): void {
  pnex.onTerminalData((data: string) => {
    const sanitized = extractPnexOscPayload(data);
    if (sanitized.length > 0) {
      terminal.write(sanitized);
    }
  });

  terminal.onData((data: string) => {
    trackInput(data);

    if (containsCommandSubmission(data)) {
      markCommandRunning();
    }

    pnex.sendTerminalInput(data);
  });

  terminal.onResize(({ cols, rows }) => {
    pnex.sendTerminalResize(cols, rows);
  });
}

function containsCommandSubmission(data: string): boolean {
  return data.includes("\r") || data.includes("\n");
}

function observeResize(container: HTMLElement, fitAddon: FitAddon): void {
  const observer = new ResizeObserver(() => {
    fitAddon.fit();
  });
  observer.observe(container);
}

function registerPasteHandler(): void {
  registerTerminalKeyHandler((event) => {
    if (event.type === "keydown" && event.ctrlKey && event.key === "v") {
      navigator.clipboard.readText().then((text) => {
        trackInput(text);
        pnex.sendTerminalInput(text);
      });
      return false;
    }
    return true;
  });
}

function registerCommandHistory(): void {
  onCommandSubmit((command) => {
    pnex.appendCommandHistory(command);
  });
}
