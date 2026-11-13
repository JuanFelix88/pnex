import type { IBufferCell, IDisposable, ITheme, Terminal } from "@xterm/xterm";

export interface TerminalMotionSettings {
  enabled: boolean;
  motion: number;
  reactiveGlow: boolean;
}

export function configuredTerminalMotionSettings(
  value?: Partial<TerminalMotionSettings>,
): TerminalMotionSettings {
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
    motion: typeof value?.motion === "number" && Number.isFinite(value.motion)
      ? Math.min(5, Math.max(1, Math.round(value.motion))) : 2,
    reactiveGlow: typeof value?.reactiveGlow === "boolean" ? value.reactiveGlow : true,
  };
}

const ANSI_COLORS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue",
  "brightMagenta", "brightCyan", "brightWhite",
] as const;
const INTENSITY = [0.18, 0.3, 0.45, 0.65, 0.9];
const HUD_INTENSITY = [0.3, 0.48, 0.64, 0.8, 0.95];
const SCALE = 0.5;

export function createHudMotionGlow(content: HTMLElement): HTMLElement {
  const glow = document.createElement("div");
  glow.className = "prompt-hud prompt-hud-glow";
  glow.dataset.status = content.dataset.status;
  glow.setAttribute("aria-hidden", "true");
  glow.append(...Array.from(content.childNodes, (node) => node.cloneNode(true)));
  glow.querySelector(".prompt-hud-separator")?.remove();
  const walker = document.createTreeWalker(glow, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text && node.textContent?.trim()
      && !node.parentElement?.closest(".prompt-hud-icon")) texts.push(node);
  }
  for (const node of texts) {
    const ink = document.createElement("span");
    ink.className = "hud-motion-ink";
    node.replaceWith(ink);
    ink.append(node);
  }
  return glow;
}

export class TerminalMotion {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly screen: HTMLElement;
  private readonly observer: ResizeObserver;
  private readonly cell: IBufferCell;
  private readonly colors = new Map<number, { css: string; alpha: number }>();
  private palette: number[] = [];
  private theme: ITheme | undefined;
  private foreground = 0xffffff;
  private background = 0;
  private settings: TerminalMotionSettings = { enabled: false, motion: 2, reactiveGlow: true };
  private renderListener?: IDisposable;
  private viewportY = -1;
  private buffer?: Terminal["buffer"]["active"];
  private width = 0;
  private height = 0;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private pulses: Animation[] = [];
  private lastPulseAt = Number.NEGATIVE_INFINITY;
  private readonly stopPulse = (): void => {
    for (const animation of this.pulses) animation.cancel();
    this.pulses = [];
  };

  constructor(private readonly terminal: Terminal, settings?: Partial<TerminalMotionSettings>) {
    const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    const context = this.canvas.getContext("2d");
    if (!screen || !context) throw new Error("Terminal Motion canvas unavailable.");
    this.screen = screen;
    this.context = context;
    this.cell = terminal.buffer.active.getNullCell();
    this.canvas.className = "terminal-motion";
    this.canvas.setAttribute("aria-hidden", "true");
    screen.append(this.canvas);
    this.observer = new ResizeObserver(() => {
      if (this.settings.enabled && this.resize()) this.render(0, terminal.rows - 1);
    });
    this.observer.observe(screen);
    this.reducedMotion.addEventListener("change", this.stopPulse);
    window.addEventListener("blur", this.stopPulse);
    document.addEventListener("visibilitychange", this.stopPulse);
    this.setSettings(configuredTerminalMotionSettings(settings));
  }

  setSettings(settings: TerminalMotionSettings): void {
    this.stopPulse();
    this.settings = settings;
    this.canvas.hidden = !settings.enabled;
    this.canvas.style.opacity = String(INTENSITY[settings.motion - 1]);
    this.screen.dataset.terminalMotion = String(settings.enabled);
    this.screen.style.setProperty("--terminal-hud-motion-intensity", String(HUD_INTENSITY[settings.motion - 1]));
    if (!settings.enabled) {
      this.renderListener?.dispose();
      this.renderListener = undefined;
      return;
    }
    if (!this.renderListener) {
      this.renderListener = this.terminal.onRender(({ start, end }) => this.render(start, end));
      this.resize();
      this.render(0, this.terminal.rows - 1);
    }
  }

  pulseTyping(data: string, hudGlow: HTMLElement | null): void {
    if (!this.settings.enabled || !this.settings.reactiveGlow || this.reducedMotion.matches
      || document.hidden || !document.hasFocus() || data.includes("\x1b")
      || !/[^\x00-\x1f\x7f]/.test(data)) return;
    const now = performance.now();
    // Group rapid keystrokes into one finite pulse; output/render events never trigger it.
    if (now - this.lastPulseAt < 240) return;
    this.lastPulseAt = now;
    this.stopPulse();
    const frames = (opacity: number): Keyframe[] => [
      { opacity },
      { opacity: Math.min(1, opacity * 1.12), offset: 0.2 },
      { opacity },
    ];
    const timing = { duration: 240, easing: "ease-out" };
    this.pulses.push(this.canvas.animate(frames(INTENSITY[this.settings.motion - 1]), timing));
    if (hudGlow?.isConnected) {
      this.pulses.push(hudGlow.animate(frames(HUD_INTENSITY[this.settings.motion - 1]), timing));
    }
  }

  dispose(): void {
    this.stopPulse();
    this.reducedMotion.removeEventListener("change", this.stopPulse);
    window.removeEventListener("blur", this.stopPulse);
    document.removeEventListener("visibilitychange", this.stopPulse);
    this.renderListener?.dispose();
    this.observer.disconnect();
    this.canvas.remove();
  }

  private resize(): boolean {
    const width = this.screen.clientWidth;
    const height = this.screen.clientHeight;
    if (!width || !height || (width === this.width && height === this.height)) return false;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.ceil(width * SCALE);
    this.canvas.height = Math.ceil(height * SCALE);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(this.canvas.width / width, 0, 0, this.canvas.height / height, 0, 0);
    this.context.textBaseline = "middle";
    return true;
  }

  private readColor(css: string | undefined, fallback: number): number {
    this.context.fillStyle = `#${fallback.toString(16).padStart(6, "0")}`;
    if (css) this.context.fillStyle = css;
    const normalized = String(this.context.fillStyle);
    if (/^#[\da-f]{6}$/i.test(normalized)) return Number.parseInt(normalized.slice(1), 16);
    const channels = normalized.match(/[\d.]+/g);
    return channels && channels.length >= 3
      ? (Number(channels[0]) << 16) | (Number(channels[1]) << 8) | Number(channels[2]) : fallback;
  }

  private updatePalette(): void {
    this.theme = this.terminal.options.theme;
    this.foreground = this.readColor(this.theme?.foreground, 0xffffff);
    this.background = this.readColor(this.theme?.background, 0);
    this.palette = ANSI_COLORS.map((key) => this.readColor(this.theme?.[key], this.foreground));
    const cube = [0, 95, 135, 175, 215, 255];
    for (let i = 16; i < 256; i++) {
      const n = i - 16;
      const gray = 8 + (i - 232) * 10;
      this.palette[i] = i >= 232 ? (gray << 16) | (gray << 8) | gray
        : (cube[Math.floor(n / 36)] << 16) | (cube[Math.floor(n / 6) % 6] << 8) | cube[n % 6];
    }
    this.colors.clear();
    const hudColors = {
      foreground: this.foreground, border: this.palette[8], yellow: this.palette[3],
      green: this.palette[10], red: this.palette[9], cyan: this.palette[6], blue: this.palette[4],
    };
    for (const [name, rgb] of Object.entries(hudColors)) {
      this.screen.style.setProperty(`--motion-${name}-strength`, String(this.colorStyle(rgb).alpha));
    }
  }

  private cellColor(cell: IBufferCell): number {
    const inverse = cell.isInverse();
    if (inverse ? cell.isBgRGB() : cell.isFgRGB()) return inverse ? cell.getBgColor() : cell.getFgColor();
    if (inverse ? cell.isBgPalette() : cell.isFgPalette()) {
      let index = inverse ? cell.getBgColor() : cell.getFgColor();
      if (!inverse && cell.isBold() && this.terminal.options.drawBoldTextInBrightColors && index < 8) index += 8;
      return this.palette[index];
    }
    return inverse ? this.background : this.foreground;
  }

  private colorStyle(rgb: number): { css: string; alpha: number } {
    const cached = this.colors.get(rgb);
    if (cached) return cached;
    const r = rgb >>> 16 & 255;
    const g = rgb >>> 8 & 255;
    const b = rgb & 255;
    const maximum = Math.max(r, g, b);
    // Low saturation suppresses whites/grays; brightness attenuates dark colors.
    const saturation = maximum ? (maximum - Math.min(r, g, b)) / maximum : 0;
    const chroma = Math.max(0, Math.min(1, (saturation - 0.1) / 0.3));
    const style = {
      css: `#${rgb.toString(16).padStart(6, "0")}`,
      alpha: (0.025 + 0.975 * chroma * chroma * (3 - 2 * chroma)) * maximum / 255,
    };
    if (this.colors.size >= 4096) this.colors.clear();
    this.colors.set(rgb, style);
    return style;
  }

  private render(start: number, end: number): void {
    if (!this.width || !this.height || !this.settings.enabled) return;
    const terminal = this.terminal;
    const buffer = terminal.buffer.active;
    if (this.theme !== terminal.options.theme || this.palette.length === 0) {
      this.updatePalette();
      start = 0;
      end = terminal.rows - 1;
    }
    if (buffer !== this.buffer || buffer.viewportY !== this.viewportY) {
      start = 0;
      end = terminal.rows - 1;
      this.buffer = buffer;
      this.viewportY = buffer.viewportY;
    }
    const context = this.context;
    const cellWidth = this.width / terminal.cols;
    const cellHeight = this.height / terminal.rows;
    context.clearRect(0, start * cellHeight, this.width, (end - start + 1) * cellHeight);
    // Only dirty visible rows are scanned; runs share a draw call and a cached color.
    for (let row = start; row <= end; row++) {
      const line = buffer.getLine(buffer.viewportY + row);
      if (!line) continue;
      context.save();
      context.beginPath();
      context.rect(0, row * cellHeight, this.width, cellHeight);
      context.clip();
      let text = "";
      let runX = 0;
      let runColor = -1;
      let runFlags = -1;
      const flush = (): void => {
        if (!text.trim()) return;
        const style = this.colorStyle(runColor);
        context.fillStyle = style.css;
        context.globalAlpha = style.alpha * (runFlags & 1 ? 0.5 : 1);
        context.font = `${runFlags & 2 ? "italic " : ""}${runFlags & 4 ? "bold " : ""}${terminal.options.fontSize}px ${terminal.options.fontFamily}`;
        context.fillText(text, runX * cellWidth, (row + 0.5) * cellHeight);
      };
      for (let column = 0; column < terminal.cols; column++) {
        const cell = line.getCell(column, this.cell);
        if (!cell || cell.getWidth() === 0) continue;
        const chars = cell.isInvisible() ? " " : cell.getChars() || " ";
        const rgb = this.cellColor(cell);
        const flags = (cell.isDim() ? 1 : 0) | (cell.isItalic() ? 2 : 0) | (cell.isBold() ? 4 : 0);
        if (rgb !== runColor || flags !== runFlags || cell.getWidth() !== 1) {
          flush();
          text = "";
          runX = column;
          runColor = rgb;
          runFlags = flags;
        }
        text += chars;
        if (cell.getWidth() !== 1) {
          flush();
          text = "";
          runX = column + cell.getWidth();
        }
      }
      flush();
      context.restore();
    }
  }
}
