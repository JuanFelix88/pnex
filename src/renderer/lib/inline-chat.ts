import { Terminal } from "@xterm/xterm";

declare const pnex: import("../../preload/preload").PnexApi;

type ChatMode = "command" | "chat";

interface ChatElements {
  overlay: HTMLElement;
  box: HTMLElement;
  input: HTMLInputElement;
  response: HTMLElement;
  modeLabel: HTMLElement;
  closeBtn: HTMLElement;
  sendBtn: HTMLElement;
}

interface ChatPosition {
  left: number;
  top: number;
}

const CHAT_OFFSET_Y = 5;
const CHAT_EDGE_PADDING = 16;

/**
 * Set up the inline chat overlay and keyboard shortcuts.
 * Ctrl+I opens command mode, Ctrl+Shift+I opens chat mode.
 */
export function initInlineChat(terminal: Terminal): void {
  const elements = getElements();
  if (!elements) return;

  let mode: ChatMode = "command";

  interceptTerminalKeys(terminal, elements, (m) => {
    mode = m;
  });
  registerChatActions(elements, terminal, () => mode);
}

function getElements(): ChatElements | null {
  const overlay = document.getElementById("chat-overlay");
  const box = document.getElementById("chat-box");
  const input = document.getElementById("chat-input");
  const response = document.getElementById("chat-response");
  const modeLabel = document.getElementById("chat-mode-label");
  const closeBtn = document.getElementById("chat-close");
  const sendBtn = document.getElementById("chat-send");

  if (
    !overlay ||
    !box ||
    !input ||
    !response ||
    !modeLabel ||
    !closeBtn ||
    !sendBtn
  ) {
    return null;
  }

  return {
    overlay,
    box,
    input: input as HTMLInputElement,
    response,
    modeLabel,
    closeBtn,
    sendBtn,
  };
}

function interceptTerminalKeys(
  terminal: Terminal,
  elements: ChatElements,
  setMode: (m: ChatMode) => void,
): void {
  terminal.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;

    const key = e.key.toLowerCase();

    if (key === "i" && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      setMode("chat");
      openChat(elements, terminal, "chat");
      return false;
    }

    if (key === "i" && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      setMode("command");
      openChat(elements, terminal, "command");
      return false;
    }

    return true;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeChat(elements, terminal);
    }
  });
}

function registerChatActions(
  elements: ChatElements,
  terminal: Terminal,
  getMode: () => ChatMode,
): void {
  elements.closeBtn.addEventListener("click", () => {
    closeChat(elements, terminal);
  });

  elements.sendBtn.addEventListener("click", () => {
    submitChat(elements, terminal, getMode());
  });

  elements.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitChat(elements, terminal, getMode());
    }
  });
}

function openChat(
  elements: ChatElements,
  terminal: Terminal,
  mode: ChatMode,
): void {
  elements.modeLabel.textContent =
    mode === "command" ? "AI Command" : "AI Chat";
  elements.input.placeholder =
    mode === "command" ? "Ask about commands" : "Ask anything...";
  elements.response.style.display = "none";
  elements.response.textContent = "";
  elements.overlay.style.display = "block";
  elements.input.value = "";
  positionChatOverlay(elements, terminal);
  elements.input.focus();
}

function closeChat(elements: ChatElements, terminal: Terminal): void {
  elements.overlay.style.display = "none";
  elements.input.value = "";
  elements.response.style.display = "none";
  terminal.focus();
}

async function submitChat(
  elements: ChatElements,
  terminal: Terminal,
  mode: ChatMode,
): Promise<void> {
  const prompt = elements.input.value.trim();
  if (!prompt) return;

  elements.input.disabled = true;
  elements.response.textContent = "Thinking...";
  elements.response.style.display = "block";

  try {
    if (mode === "command") {
      const command = await pnex.aiCommand(prompt);
      closeChat(elements, terminal);
      pnex.sendTerminalInput(command + "\n");
    } else {
      const reply = await pnex.aiChat(prompt);
      elements.response.textContent = reply;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    elements.response.textContent = `Error: ${message}`;
  } finally {
    elements.input.disabled = false;
    elements.input.focus();
  }
}

function positionChatOverlay(elements: ChatElements, terminal: Terminal): void {
  const box = elements.box;
  const previousVisibility = box.style.visibility;

  box.style.visibility = "hidden";
  box.style.left = `${CHAT_EDGE_PADDING}px`;
  box.style.top = `${CHAT_EDGE_PADDING}px`;

  const anchor =
    getCursorAnchorPosition(terminal) ?? getTerminalFallbackPosition(terminal);
  const boxRect = box.getBoundingClientRect();
  const maxLeft = Math.max(
    CHAT_EDGE_PADDING,
    window.innerWidth - boxRect.width - CHAT_EDGE_PADDING,
  );
  const maxTop = Math.max(
    CHAT_EDGE_PADDING,
    window.innerHeight - boxRect.height - CHAT_EDGE_PADDING,
  );

  const preferredTop = anchor.top + CHAT_OFFSET_Y;
  const opensAbove = preferredTop > maxTop;
  const top = opensAbove
    ? Math.max(CHAT_EDGE_PADDING, anchor.top - boxRect.height - CHAT_OFFSET_Y)
    : Math.min(preferredTop, maxTop);
  const left = clamp(anchor.left, CHAT_EDGE_PADDING, maxLeft);

  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.visibility = previousVisibility;
}

function getCursorAnchorPosition(terminal: Terminal): ChatPosition | null {
  const terminalElement = terminal.element;
  if (!terminalElement) return null;

  const cursorElement = terminalElement.querySelector(".xterm-cursor");
  if (!(cursorElement instanceof HTMLElement)) {
    return null;
  }

  const cursorRect = cursorElement.getBoundingClientRect();
  if (cursorRect.width === 0 && cursorRect.height === 0) {
    return null;
  }

  return {
    left: cursorRect.left,
    top: cursorRect.bottom,
  };
}

function getTerminalFallbackPosition(terminal: Terminal): ChatPosition {
  const terminalElement = terminal.element;
  const rect = terminalElement?.getBoundingClientRect();

  if (!rect) {
    return {
      left: CHAT_EDGE_PADDING,
      top: CHAT_EDGE_PADDING,
    };
  }

  return {
    left: rect.left + CHAT_EDGE_PADDING,
    top: rect.bottom - 80,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
