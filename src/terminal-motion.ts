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
const SHIMMER_DURATION = 500;

interface ShimmerText {
  text: string;
  font: string;
  row: number;
  x: number;
  width: number;
}

interface ShimmerEffect {
  target: ShimmerText | HTMLElement;
  cancel: () => void;
}

export function createHudMotionGlow(content: HTMLElement): HTMLElement {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text && node.textContent?.trim()
      && !node.parentElement?.closest(".prompt-hud-icon, .hud-motion-ink")) texts.push(node);
  }
  for (const node of texts) {
    const ink = document.createElement("span");
    ink.className = "hud-motion-ink";
    node.replaceWith(ink);
    ink.append(node);
  }
  const glow = document.createElement("div");
  glow.className = "prompt-hud prompt-hud-glow";
  glow.dataset.status = content.dataset.status;
  glow.setAttribute("aria-hidden", "true");
  glow.append(...Array.from(content.childNodes, (node) => node.cloneNode(true)));
  glow.querySelector(".prompt-hud-separator")?.remove();
  return glow;
}

export class TerminalMotion {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly shimmerTexts = new Map<number, ShimmerText[]>();
  private readonly shimmerEffects = new Set<ShimmerEffect>();
  private readonly shimmerDelays = new Set<number>();
  private shimmerTimer?: number;
  private readonly syncShimmer = (): void => {
    this.stopShimmer();
    this.scheduleShimmer();
  };
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
    window.addEventListener("blur", this.stopPulse);
    document.addEventListener("visibilitychange", this.stopPulse);
    window.addEventListener("blur", this.syncShimmer);
    window.addEventListener("focus", this.syncShimmer);
    document.addEventListener("visibilitychange", this.syncShimmer);
    this.setSettings(configuredTerminalMotionSettings(settings));
  }

  setSettings(settings: TerminalMotionSettings): void {
    this.stopPulse();
    this.settings = settings;
    this.syncShimmer();
    this.canvas.hidden = !settings.enabled;
    this.canvas.style.opacity = String(INTENSITY[settings.motion - 1]);
    this.screen.dataset.terminalMotion = String(settings.enabled);
    this.screen.style.setProperty("--terminal-hud-motion-intensity", String(HUD_INTENSITY[settings.motion - 1]));
    this.screen.style.setProperty("--terminal-shimmer-opacity", String(0.16 + settings.motion * 0.025));
    if (!settings.enabled) {
      this.renderListener?.dispose();
      this.renderListener = undefined;
      this.shimmerTexts.clear();
      return;
    }
    if (!this.renderListener) {
      this.renderListener = this.terminal.onRender(({ start, end }) => this.render(start, end));
      this.resize();
      this.render(0, this.terminal.rows - 1);
    }
  }

  pulseTyping(data: string, hudGlow: HTMLElement | null): void {
    if (!this.settings.enabled || !this.settings.reactiveGlow
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
    this.stopShimmer();
    window.removeEventListener("blur", this.syncShimmer);
    window.removeEventListener("focus", this.syncShimmer);
    document.removeEventListener("visibilitychange", this.syncShimmer);
    window.removeEventListener("blur", this.stopPulse);
    document.removeEventListener("visibilitychange", this.stopPulse);
    this.renderListener?.dispose();
    this.observer.disconnect();
    this.canvas.remove();
    this.shimmerTexts.clear();
  }

  private stopShimmer(): void {
    window.clearTimeout(this.shimmerTimer);
    this.shimmerTimer = undefined;
    for (const timer of this.shimmerDelays) window.clearTimeout(timer);
    this.shimmerDelays.clear();
    for (const effect of this.shimmerEffects) effect.cancel();
  }

  private isShimmerTargetVisible(target: ShimmerText | HTMLElement): boolean {
    if (target instanceof HTMLElement) {
      if (!target.isConnected) return false;
      const bounds = this.screen.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= bounds.top && rect.bottom <= bounds.bottom
        && rect.left >= bounds.left && rect.right <= bounds.right;
    }
    return this.shimmerTexts.get(target.row)?.some((run) =>
      run.text === target.text && run.x === target.x && run.width === target.width && run.font === target.font) ?? false;
  }

  private scheduleShimmer(): void {
    // Motion is explicitly controlled in-app, independently of OS animation preferences.
    if (!this.settings.enabled || document.hidden || !document.hasFocus()) return;
    // No animation frames run between bursts; each sweep has its own finite lifetime.
    this.shimmerTimer = window.setTimeout(() => {
      this.shimmerTimer = undefined;
      const hudTexts = [...this.screen.querySelectorAll<HTMLElement>(
        ".prompt-hud:not(.prompt-hud-glow) :is(.prompt-hud-cwd, .prompt-hud-git, .prompt-hud-git-user) > .hud-motion-ink",
      )].filter((ink) => /[\p{L}\p{N}]/u.test(ink.textContent ?? "") && this.isShimmerTargetVisible(ink)
        && this.colorStyle(this.readColor(getComputedStyle(ink).color, this.foreground)).alpha >= 0.18);
      this.startShimmerBurst([...this.shimmerTexts.values()].flat(), hudTexts);
      this.scheduleShimmer();
    }, 6000 + Math.random() * 4000);
  }

  private startShimmerBurst(terminalTexts: ShimmerText[], hudTexts: HTMLElement[]): void {
    const texts: (ShimmerText | HTMLElement)[] = [...terminalTexts, ...hudTexts];
    const count = Math.min(texts.length, 1 + Math.floor(Math.random() * 7));
    let delay = 0;
    for (let i = 0; i < count; i++) {
      // Sample without replacement so concurrent sweeps never restart the same text.
      const target = texts.splice(Math.floor(Math.random() * texts.length), 1)[0];
      if (i > 0) delay += Math.floor(Math.random() * 151);
      const start = (): void => {
        if (!this.isShimmerTargetVisible(target)) return;
        if (target instanceof HTMLElement) this.startHudShimmer(target);
        else this.startShimmer(target);
      };
      if (delay === 0) start();
      else {
        const timer = window.setTimeout(() => {
          this.shimmerDelays.delete(timer);
          start();
        }, delay);
        this.shimmerDelays.add(timer);
      }
    }
  }

  private startHudShimmer(element: HTMLElement): void {
    element.classList.add("hud-motion-shimmer");
    const animation = element.animate([
      { backgroundPosition: "100% 0, 0 0" },
      { backgroundPosition: "0% 0, 0 0" },
    ], { duration: SHIMMER_DURATION, easing: "linear" });
    const effect: ShimmerEffect = {
      target: element,
      cancel: () => {
        animation.cancel();
        element.classList.remove("hud-motion-shimmer");
        this.shimmerEffects.delete(effect);
      },
    };
    this.shimmerEffects.add(effect);
    void animation.finished.then(effect.cancel, effect.cancel);
  }

  private startShimmer(target: ShimmerText): void {
    const height = this.height / this.terminal.rows;
    const width = Math.min(target.width, this.width - target.x);
    if (width <= 0 || height <= 0) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.className = "terminal-motion-shimmer";
    canvas.setAttribute("aria-hidden", "true");
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${target.x}px`;
    canvas.style.top = `${target.row * height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.font = target.font;
    context.textBaseline = "middle";
    this.screen.append(canvas);
    let frameId: number | undefined;
    const effect: ShimmerEffect = {
      target,
      cancel: () => {
        if (frameId !== undefined) cancelAnimationFrame(frameId);
        canvas.remove();
        this.shimmerEffects.delete(effect);
      },
    };
    this.shimmerEffects.add(effect);
    const startedAt = performance.now();
    const frame = (now: number): void => {
      const progress = (now - startedAt) / SHIMMER_DURATION;
      if (progress >= 1) {
        effect.cancel();
        return;
      }
      const band = Math.max(12, Math.min(80, width * 0.3));
      const center = -band + (width + 2 * band) * progress;
      const gradient = context.createLinearGradient(center - band, 0, center + band, 0);
      gradient.addColorStop(0, "transparent");
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${0.16 + this.settings.motion * 0.025})`);
      gradient.addColorStop(1, "transparent");
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "white";
      context.fillText(target.text, 0, height / 2);
      context.globalCompositeOperation = "source-in";
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
  }

  private resize(): boolean {
    const width = this.screen.clientWidth;
    const height = this.screen.clientHeight;
    if (!width || !height || (width === this.width && height === this.height)) return false;
    this.stopShimmer();
    this.scheduleShimmer();
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
      this.stopShimmer();
      this.scheduleShimmer();
      start = 0;
      end = terminal.rows - 1;
      this.buffer = buffer;
      this.viewportY = buffer.viewportY;
    }
    if (start === 0 && end === terminal.rows - 1) this.shimmerTexts.clear();
    const context = this.context;
    const cellWidth = this.width / terminal.cols;
    const cellHeight = this.height / terminal.rows;
    context.clearRect(0, start * cellHeight, this.width, (end - start + 1) * cellHeight);
    // Only dirty visible rows are scanned; runs share a draw call and a cached color.
    for (let row = start; row <= end; row++) {
      const shimmerTexts: ShimmerText[] = [];
      this.shimmerTexts.set(row, shimmerTexts);
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
        const trimmed = text.trim();
        if (style.alpha >= 0.18 && !(runFlags & 1) && /[\p{L}\p{N}]/u.test(trimmed)) {
          shimmerTexts.push({
            text: trimmed, font: context.font, row,
            x: (runX + text.length - text.trimStart().length) * cellWidth,
            width: context.measureText(trimmed).width,
          });
        }
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
    for (const effect of this.shimmerEffects) {
      if (!this.isShimmerTargetVisible(effect.target)) effect.cancel();
    }
  }
}
