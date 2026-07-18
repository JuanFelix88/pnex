import type { Terminal } from "@xterm/xterm";

export interface InputShadowSettings {
  inputShadow: boolean;
  inputShadowOpacity: number;
}

const INPUT_SHADOW_TIMEOUT_MS = 160;

export class InputShadow {
  private readonly layer = document.createElement("div");
  private readonly text = document.createElement("span");
  private readonly screen: HTMLElement;
  private settings: InputShadowSettings;
  private clearTimer: number | null = null;
  private pendingText = "";
  private revision = 0;

  constructor(
    private readonly terminal: Terminal,
    settings: InputShadowSettings,
  ) {
    const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) throw new Error("The xterm screen is unavailable for the input shadow.");

    this.screen = screen;
    this.settings = settings;
    this.layer.className = "input-shadow";
    this.layer.hidden = true;
    this.layer.setAttribute("aria-hidden", "true");
    this.text.className = "input-shadow-text";
    this.layer.append(this.text);
    this.screen.append(this.layer);

    terminal.onScroll(() => this.clear());
    terminal.onResize(() => this.clear());
    terminal.buffer.onBufferChange(() => this.clear());
    terminal.textarea?.addEventListener("blur", () => this.clear());
  }

  setSettings(settings: InputShadowSettings): void {
    this.settings = settings;
    if (!settings.inputShadow) {
      this.clear();
      return;
    }
    this.text.style.opacity = String(settings.inputShadowOpacity / 100);
  }

  show(data: string): void {
    if (!this.settings.inputShadow || !this.isPrintableInput(data)) return;

    if (!this.pendingText && !this.positionAtCursor()) return;
    this.pendingText += data;
    this.revision += 1;
    this.text.textContent = this.pendingText;
    this.text.style.opacity = String(this.settings.inputShadowOpacity / 100);
    this.layer.hidden = false;

    if (this.clearTimer !== null) window.clearTimeout(this.clearTimer);
    this.clearTimer = window.setTimeout(() => this.clear(), INPUT_SHADOW_TIMEOUT_MS);
  }

  currentRevision(): number {
    return this.revision;
  }

  clearIfRevision(revision: number): void {
    if (revision === this.revision) this.clear();
  }

  clear(): void {
    if (this.clearTimer !== null) {
      window.clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.pendingText = "";
    this.text.textContent = "";
    this.layer.hidden = true;
  }

  private positionAtCursor(): boolean {
    const bounds = this.screen.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;

    const buffer = this.terminal.buffer.active;
    const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
    if (row < 0 || row >= this.terminal.rows) return false;
    const column = Math.min(buffer.cursorX, Math.max(this.terminal.cols - 1, 0));
    const cellWidth = bounds.width / Math.max(this.terminal.cols, 1);
    const cellHeight = bounds.height / Math.max(this.terminal.rows, 1);

    this.text.style.left = `${column * cellWidth}px`;
    this.text.style.top = `${row * cellHeight}px`;
    this.text.style.height = `${cellHeight}px`;
    this.text.style.lineHeight = `${cellHeight}px`;
    this.text.style.maxWidth = `${Math.max(bounds.width - column * cellWidth, 0)}px`;
    return true;
  }

  private isPrintableInput(data: string): boolean {
    if (!data) return false;
    return Array.from(data).every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    });
  }
}
