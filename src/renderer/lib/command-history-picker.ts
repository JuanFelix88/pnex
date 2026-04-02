import { Terminal } from "@xterm/xterm";
import { createFrameLoop, FrameLoop } from "./frame-loop";
import { isCursorVisibleInContainer } from "./cursor-visibility";
import { isCommandRunning } from "./terminal-command-state";
import { markCommandRunning } from "./terminal-command-state";
import { trackInput } from "./input-tracker";
import { registerTerminalKeyHandler } from "./terminal-key-handlers";

declare const pnex: import("../../preload/preload").PnexApi;

const EDGE_PADDING = 16;

interface PickerElements {
  overlay: HTMLElement;
  box: HTMLElement;
  input: HTMLInputElement;
  suggestions: HTMLElement;
  closeBtn: HTMLElement;
}

/**
 * Set up the command-history picker overlay (Ctrl+H).
 * Opens a search box near the cursor and shows matching history entries.
 */
export function initCommandHistoryPicker(terminal: Terminal): void {
  const elements = getElements();
  if (!elements) return;

  let history: string[] = [];
  let selectedIndex = -1;
  const followLoop = createFollowLoop(elements, terminal);

  const close = (): void => closePicker(elements, terminal, followLoop);
  const selectCommand = (command: string): void => {
    close();
    executeCommand(command);
  };

  interceptTerminalKey(terminal, elements, followLoop, async () => {
    history = await pnex.getCommandHistory();
    selectedIndex = -1;
  });

  elements.input.addEventListener("input", () => {
    selectedIndex = -1;
    renderSuggestions(
      elements,
      filterHistory(history, elements.input.value),
      selectedIndex,
      selectCommand,
    );
  });

  elements.input.addEventListener("keydown", (e) => {
    const filtered = filterHistory(history, elements.input.value);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
      renderSuggestions(elements, filtered, selectedIndex, selectCommand);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      renderSuggestions(elements, filtered, selectedIndex, selectCommand);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const command =
        selectedIndex >= 0
          ? filtered[selectedIndex]
          : elements.input.value.trim();
      if (command) {
        selectCommand(command);
      }
      return;
    }
  });

  elements.closeBtn.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && elements.overlay.style.display === "block") {
      close();
    }
  });
}

function getElements(): PickerElements | null {
  const overlay = document.getElementById("history-overlay");
  const box = document.getElementById("history-box");
  const input = document.getElementById("history-input");
  const suggestions = document.getElementById("history-suggestions");
  const closeBtn = document.getElementById("history-close");

  if (!overlay || !box || !input || !suggestions || !closeBtn) return null;

  return {
    overlay,
    box,
    input: input as HTMLInputElement,
    suggestions,
    closeBtn,
  };
}

function interceptTerminalKey(
  terminal: Terminal,
  elements: PickerElements,
  followLoop: FrameLoop,
  loadHistory: () => Promise<void>,
): void {
  registerTerminalKeyHandler((e) => {
    if (e.type !== "keydown") return true;
    if (e.key.toLowerCase() === "h" && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      openPicker(elements, terminal, followLoop, loadHistory);
      return false;
    }
    return true;
  });
}

async function openPicker(
  elements: PickerElements,
  terminal: Terminal,
  followLoop: FrameLoop,
  loadHistory: () => Promise<void>,
): Promise<void> {
  elements.box.classList.add("pnex-hud-fade");
  elements.overlay.style.display = "block";
  elements.input.value = "";
  elements.suggestions.style.display = "none";
  elements.suggestions.innerHTML = "";
  applyTerminalFont(elements, terminal);
  positionBox(elements, terminal);
  followLoop.start();
  elements.input.focus();
  await loadHistory();
}

function closePicker(
  elements: PickerElements,
  terminal: Terminal,
  followLoop: FrameLoop,
): void {
  followLoop.stop();
  elements.overlay.style.display = "none";
  elements.input.value = "";
  elements.suggestions.style.display = "none";
  terminal.focus();
}

function executeCommand(command: string): void {
  trackInput(command + "\r");
  markCommandRunning();
  pnex.sendTerminalInput(command + "\n");
}

function filterHistory(history: string[], query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return history.slice(0, 50);

  return history
    .filter((cmd) => cmd.toLowerCase().includes(normalizedQuery))
    .slice(0, 50);
}

function renderSuggestions(
  elements: PickerElements,
  filtered: string[],
  selectedIndex: number,
  onSelect: (command: string) => void,
): void {
  const container = elements.suggestions;

  if (filtered.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  container.style.display = "block";
  container.innerHTML = "";

  filtered.forEach((command, index) => {
    const item = document.createElement("div");
    item.className = "pnex-history-item";
    item.textContent = command;
    if (index === selectedIndex) {
      item.classList.add("pnex-history-item--selected");
    }
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    item.addEventListener("click", () => {
      onSelect(command);
    });
    container.appendChild(item);
  });

  // Scroll selected into view
  const selectedEl = container.querySelector(".pnex-history-item--selected");
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: "nearest" });
  }

  // Decide render direction: up or down based on remaining space
  applySuggestionsDirection(elements);
}

function applySuggestionsDirection(elements: PickerElements): void {
  const boxRect = elements.box.getBoundingClientRect();
  const spaceBelow = window.innerHeight - boxRect.bottom;
  const spaceAbove = boxRect.top;
  const suggestionsHeight = elements.suggestions.scrollHeight;

  const renderAbove = spaceBelow < suggestionsHeight && spaceAbove > spaceBelow;

  if (renderAbove) {
    elements.box.classList.add("pnex-history-box--above");
  } else {
    elements.box.classList.remove("pnex-history-box--above");
  }
}

function applyTerminalFont(elements: PickerElements, terminal: Terminal): void {
  const fontFamily =
    (terminal.options.fontFamily as string | undefined) || "monospace";
  const fontSize =
    ((terminal.options.fontSize as number | undefined) || 14) - 1;
  elements.input.style.fontFamily = fontFamily;
  elements.input.style.fontSize = `${fontSize}px`;
  elements.suggestions.style.fontFamily = fontFamily;
  elements.suggestions.style.fontSize = `${fontSize}px`;
}

function positionBox(elements: PickerElements, terminal: Terminal): void {
  const box = elements.box;
  const prevVisibility = box.style.visibility;

  const terminalContainer = terminal.element?.parentElement;
  let isCursorVisible = true;
  if (terminalContainer instanceof HTMLElement) {
    isCursorVisible =
      !isCommandRunning() &&
      isCursorVisibleInContainer(terminal, terminalContainer);
  }

  box.style.visibility = "hidden";
  box.style.left = `${EDGE_PADDING}px`;
  box.style.top = `${EDGE_PADDING}px`;

  const anchor = getCursorAnchor(terminal) ?? getTerminalFallback(terminal);
  const boxRect = box.getBoundingClientRect();
  const maxLeft = Math.max(
    EDGE_PADDING,
    window.innerWidth - boxRect.width - EDGE_PADDING,
  );
  const maxTop = Math.max(
    EDGE_PADDING,
    window.innerHeight - boxRect.height - EDGE_PADDING,
  );

  const left = clamp(anchor.left - 1, EDGE_PADDING, maxLeft);
  const top = clamp(anchor.top - 2, EDGE_PADDING, maxTop);

  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.classList.toggle("pnex-hud-hidden", !isCursorVisible);
  box.style.visibility = prevVisibility;
}

function getCursorAnchor(
  terminal: Terminal,
): { left: number; top: number } | null {
  const cursor = terminal.element?.querySelector(".xterm-cursor");
  if (!(cursor instanceof HTMLElement)) return null;
  const rect = cursor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { left: rect.left, top: rect.top };
}

function getTerminalFallback(terminal: Terminal): {
  left: number;
  top: number;
} {
  const rect = terminal.element?.getBoundingClientRect();
  if (!rect) return { left: EDGE_PADDING, top: EDGE_PADDING };
  return { left: rect.left + EDGE_PADDING, top: rect.bottom - 80 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createFollowLoop(
  elements: PickerElements,
  terminal: Terminal,
): FrameLoop {
  return createFrameLoop(() => {
    if (elements.overlay.style.display !== "block") return;
    positionBox(elements, terminal);
  });
}
