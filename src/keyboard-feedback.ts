export interface KeyboardFeedbackSettings {
  enabled: boolean;
  level: number;
  color: string;
  fadeInMs: number;
  fadeOutMs: number;
}

const DEFAULT_SETTINGS: KeyboardFeedbackSettings = {
  enabled: false,
  level: 2,
  color: "#78dce8",
  fadeInMs: 45,
  fadeOutMs: 320,
};

const LEVELS = [
  { strength: 18, depth: 0 },
  { strength: 30, depth: 3 },
  { strength: 46, depth: 6 },
  { strength: 66, depth: 10 },
  { strength: 88, depth: 16 },
] as const;

function boundedInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function configuredKeyboardFeedbackSettings(value?: Partial<KeyboardFeedbackSettings>): KeyboardFeedbackSettings {
  return {
    enabled: value?.enabled === true,
    level: boundedInteger(value?.level, 1, 5, DEFAULT_SETTINGS.level),
    color: typeof value?.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color)
      ? value.color.toLowerCase()
      : DEFAULT_SETTINGS.color,
    fadeInMs: boundedInteger(value?.fadeInMs, 0, 2000, DEFAULT_SETTINGS.fadeInMs),
    fadeOutMs: boundedInteger(value?.fadeOutMs, 0, 2000, DEFAULT_SETTINGS.fadeOutMs),
  };
}

export class KeyboardFeedback {
  private settings = DEFAULT_SETTINGS;
  private active?: { animation: Animation; fadeIn: number; fadeOut: number };
  private readonly events = new AbortController();

  constructor(container: HTMLElement, private readonly layer: HTMLElement) {
    const { signal } = this.events;
    // Observe physical keys before app shortcuts or xterm consume them.
    window.addEventListener("keydown", (event) => {
      if (this.settings.enabled && event.target instanceof Node && container.contains(event.target)) this.preview();
    }, { capture: true, signal });
    window.addEventListener("blur", () => this.clear(), { signal });
  }

  setSettings(settings: KeyboardFeedbackSettings): void {
    if ((this.settings.enabled && !settings.enabled)
      || this.settings.fadeInMs !== settings.fadeInMs
      || this.settings.fadeOutMs !== settings.fadeOutMs) this.clear();
    this.settings = settings;
    const { strength, depth } = LEVELS[settings.level - 1]!;
    this.layer.style.setProperty("--keyboard-feedback-color", settings.color);
    this.layer.style.setProperty("--keyboard-feedback-strength", `${strength}%`);
    this.layer.style.setProperty("--keyboard-feedback-depth", `${depth}px`);
  }

  preview(): void {
    const { fadeInMs, fadeOutMs } = this.settings;
    if (fadeInMs + fadeOutMs === 0) return;

    let opacity = 0;
    const active = this.active;
    if (active && active.animation.playState !== "finished") {
      const time = Number(active.animation.currentTime);
      // Let a rising pulse reach its peak even when keys arrive faster than the fade-in.
      if (time < active.fadeIn) return;
      if (active.fadeOut > 0) opacity = Math.max(0, 1 - (time - active.fadeIn) / active.fadeOut);
    }

    this.clear();
    const fadeIn = fadeInMs * (1 - opacity);
    const duration = fadeIn + fadeOutMs;
    if (duration === 0) return;

    const keyframes = fadeIn > 0 ? [{ opacity, offset: 0 }] : [];
    keyframes.push({ opacity: 1, offset: fadeIn / duration });
    if (fadeOutMs > 0) keyframes.push({ opacity: 0, offset: 1 });

    const animation = this.layer.animate(keyframes, { duration, easing: "linear" });
    this.active = { animation, fadeIn, fadeOut: fadeOutMs };
  }

  dispose(): void {
    this.events.abort();
    this.clear();
  }

  private clear(): void {
    this.active?.animation.cancel();
    this.active = undefined;
  }
}
