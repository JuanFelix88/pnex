import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { PnexConfig } from "../../shared/types";
import { toXtermTheme } from "./theme-applier";
import { registerAgentHandlers } from "./agent-stream";
import { markCommandRunning } from "./terminal-command-state";
import { trackInput, onCommandSubmit } from "./input-tracker";
import { registerTerminalKeyHandler } from "./terminal-key-handlers";
import { PtyFlowControl } from "./pty-flow-control";

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
    cursorStyle: "block",
    allowProposedApi: true,
    scrollback: 1000,
  });

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  terminal.open(container);

  registerAgentHandlers(terminal, config.uiThemeName);
  connectToPty(terminal, fitAddon);
  observeResize(container, fitAddon);
  registerPasteHandler();
  registerCommandHistory();
  addTerminalBottomPadding(terminal);

  // Fit after resize handlers are attached so the initial size is sent to the PTY.
  fitAddon.fit();

  return { terminal, fitAddon };
}

/**
 * Add bottom padding to terminal by adding blank lines.
 * This prevents content from sticking to the bottom, similar to VS Code.
 */
function addTerminalBottomPadding(terminal: Terminal): void {
  // Write blank lines to create visual padding at the bottom
  // Number of lines is roughly 1/3 of terminal height for a nice balance
  const paddingLines = 8;
  for (let i = 0; i < paddingLines; i++) {
    terminal.write("\n");
  }
}

function connectToPty(terminal: Terminal, fitAddon: FitAddon): void {
  let dataId = 0;

  const flowControl = new PtyFlowControl((data: string) => {
    terminal.write(data);
  });

  pnex.onTerminalData((data: string) => {
    console.log(dataId++, "Received data from PTY:", data);
    flowControl.feed(data);
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
