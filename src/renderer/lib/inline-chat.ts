import { Terminal } from "@xterm/xterm";

declare const pnex: import("../../preload/preload").PnexApi;

type ChatMode = "command" | "chat";

interface ChatElements {
  overlay: HTMLElement;
  input: HTMLInputElement;
  response: HTMLElement;
  modeLabel: HTMLElement;
  closeBtn: HTMLElement;
  sendBtn: HTMLElement;
}

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
  const input = document.getElementById("chat-input");
  const response = document.getElementById("chat-response");
  const modeLabel = document.getElementById("chat-mode-label");
  const closeBtn = document.getElementById("chat-close");
  const sendBtn = document.getElementById("chat-send");

  if (!overlay || !input || !response || !modeLabel || !closeBtn || !sendBtn) {
    return null;
  }

  return {
    overlay,
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
      openChat(elements, "chat");
      return false;
    }

    if (key === "i" && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      setMode("command");
      openChat(elements, "command");
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

function openChat(elements: ChatElements, mode: ChatMode): void {
  elements.modeLabel.textContent =
    mode === "command" ? "AI Command" : "AI Chat";
  elements.input.placeholder =
    mode === "command" ? "Ask about commands" : "Ask anything...";
  elements.response.style.display = "none";
  elements.response.textContent = "";
  elements.overlay.style.display = "flex";
  elements.input.value = "";
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
