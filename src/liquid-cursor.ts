import type { Terminal } from "@xterm/xterm";

export type CursorAnimation = "disabled" | "liquid";

export interface LiquidCursorSettings {
  animationLength: number;
  shortAnimationLength: number;
  trailSize: number;
  typingOverlay: boolean;
}

export const DEFAULT_LIQUID_CURSOR_SETTINGS: LiquidCursorSettings = {
  animationLength: 150,
  shortAnimationLength: 40,
  trailSize: 100,
  typingOverlay: true,
};

interface Point {
  x: number;
  y: number;
}

interface AnimatedPoint extends Point {
  velocityX: number;
  velocityY: number;
  animationLength: number;
}

const BLINK_DELAY_MS = 170;
const BLINK_INTERVAL_MS = 140;
const CORNER_COUNT = 4;
const MAXIMUM_FRAME_GAP_SECONDS = 0.25;
const MAXIMUM_DEVICE_PIXEL_RATIO = 2;
const TYPING_PULSE_FADE_MS = 60;
const TYPING_PULSE_BURST_MS = 120;
const TYPING_PULSE_BASE_STRENGTH = 0.5;
const TYPING_PULSE_GAIN = 0.16;
const CURSOR_OPACITY = 0.88;

export class LiquidCursor {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly screen: HTMLElement;
  private readonly corners: AnimatedPoint[] = [];
  private targetCorners: Point[] = [];
  private mode: CursorAnimation;
  private color: string;
  private accentColor: string;
  private settings: LiquidCursorSettings;
  private cellWidth = 0;
  private cellHeight = 0;
  private targetCenter: Point | null = null;
  private animationFrame: number | null = null;
  private targetUpdateFrame: number | null = null;
  private targetUpdateNeedsSnap = false;
  private lastFrameAt = 0;
  private lastActivityAt = performance.now();
  private lastTypingAt = Number.NEGATIVE_INFINITY;
  private pulse = 0;
  private pulseStrength = 0;
  private pulseFadeStartAt = Number.NEGATIVE_INFINITY;
  private pulsePeakPending = false;
  private focused = false;
  private terminalCursorVisible = true;
  private cursorInsideViewport = false;

  constructor(
    private readonly terminal: Terminal,
    mode: CursorAnimation,
    color: string,
    accentColor: string,
    settings: LiquidCursorSettings,
  ) {
    const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    const context = this.canvas.getContext("2d");
    if (!screen || !context) {
      throw new Error("The xterm screen is unavailable for the liquid cursor.");
    }

    this.screen = screen;
    this.context = context;
    this.mode = mode;
    this.color = color;
    this.accentColor = accentColor;
    this.settings = settings;
    this.canvas.className = "liquid-cursor";
    this.canvas.setAttribute("aria-hidden", "true");
    this.screen.append(this.canvas);

    terminal.onCursorMove(() => this.scheduleTargetUpdate());
    terminal.onWriteParsed(() => this.scheduleTargetUpdate());
    terminal.onScroll(() => this.scheduleTargetUpdate(true));
    terminal.onResize(() => this.scheduleTargetUpdate(true));
    terminal.buffer.onBufferChange(() => this.scheduleTargetUpdate(true));

    terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
      if (params.includes(25)) this.restoreCursorVisibility(false);
      return false;
    });
    terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
      if (params.includes(25)) this.hideCursor();
      return false;
    });
    terminal.parser.registerEscHandler({ final: "c" }, () => {
      this.restoreCursorVisibility(true);
      return false;
    });
    terminal.parser.registerCsiHandler({ intermediates: "!", final: "p" }, () => {
      this.restoreCursorVisibility(true);
      return false;
    });

    terminal.textarea?.addEventListener("focus", () => {
      this.focused = true;
      this.wake();
      this.updateTarget(true);
    });
    terminal.textarea?.addEventListener("blur", () => {
      this.focused = false;
      this.snapToTarget();
      this.draw();
    });

    window.setInterval(() => {
      if (this.mode === "liquid" && this.animationFrame === null) this.draw();
    }, BLINK_INTERVAL_MS);

    this.setMode(mode);
    this.updateTarget(true);
  }

  setMode(mode: CursorAnimation): void {
    this.mode = mode;
    this.canvas.hidden = mode === "disabled";
    if (mode === "liquid") {
      this.wake();
      this.updateTarget(true);
    } else {
      this.pulse = 0;
      this.pulseStrength = 0;
      this.pulsePeakPending = false;
      if (this.animationFrame !== null) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
    }
  }

  setColors(color: string, accentColor: string): void {
    this.color = color;
    this.accentColor = accentColor;
    this.draw();
  }

  setSettings(settings: LiquidCursorSettings): void {
    this.settings = settings;
    if (!settings.typingOverlay) {
      this.pulse = 0;
      this.pulseStrength = 0;
      this.pulsePeakPending = false;
    }
    this.updateTarget();
  }

  pulseTyping(): void {
    if (this.mode === "disabled") return;
    const now = performance.now();
    this.lastActivityAt = now;
    if (!this.terminalCursorVisible) return;
    if (!this.settings.typingOverlay) {
      this.pulse = 0;
      this.draw();
      return;
    }

    this.pulseStrength = now - this.lastTypingAt <= TYPING_PULSE_BURST_MS
      ? Math.min(this.pulseStrength + TYPING_PULSE_GAIN, 1)
      : TYPING_PULSE_BASE_STRENGTH;
    this.pulse = this.pulseStrength;
    this.pulsePeakPending = true;
    this.lastTypingAt = now;
    this.draw();
    this.startAnimation();
  }

  private wake(): void {
    if (this.mode === "disabled") return;
    this.lastActivityAt = performance.now();
    if (this.terminalCursorVisible) this.startAnimation();
  }

  private scheduleTargetUpdate(snap = false): void {
    this.targetUpdateNeedsSnap ||= snap;
    if (this.targetUpdateFrame !== null) return;

    this.targetUpdateFrame = requestAnimationFrame(() => {
      this.targetUpdateFrame = null;
      const shouldSnap = this.targetUpdateNeedsSnap;
      this.targetUpdateNeedsSnap = false;
      this.updateTarget(shouldSnap);
    });
  }

  private updateTarget(snap = false): void {
    if (this.mode === "disabled") return;

    const bounds = this.screen.getBoundingClientRect();
    const { width, height } = bounds;
    if (width <= 0 || height <= 0 || this.terminal.cols <= 0 || this.terminal.rows <= 0) return;

    this.cellWidth = width / this.terminal.cols;
    this.cellHeight = height / this.terminal.rows;

    const buffer = this.terminal.buffer.active;
    const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
    this.cursorInsideViewport = row >= 0 && row < this.terminal.rows;
    if (!this.cursorInsideViewport) {
      this.draw();
      return;
    }

    const column = Math.min(buffer.cursorX, this.terminal.cols - 1);
    const left = column * this.cellWidth;
    const top = row * this.cellHeight;
    const right = left + this.cellWidth;
    const bottom = top + this.cellHeight;
    const nextCenter = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const deltaX = this.targetCenter ? nextCenter.x - this.targetCenter.x : 0;
    const deltaY = this.targetCenter ? nextCenter.y - this.targetCenter.y : 0;
    const moved = !this.targetCenter || Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01;

    this.targetCenter = nextCenter;
    this.targetCorners = [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];
    if (moved) this.configureCornerAnimations(deltaX, deltaY);
    this.resizeCanvas(left, top, right, bottom);

    if (!this.terminalCursorVisible) {
      if (this.corners.length !== CORNER_COUNT) this.snapToTarget();
      this.draw();
      return;
    }

    if (this.corners.length !== CORNER_COUNT || snap || !this.focused) {
      this.snapToTarget();
    } else if (moved) {
      this.lastActivityAt = performance.now();
      this.startAnimation();
    } else if (this.pulse > 0.01) {
      this.startAnimation();
    }

    this.draw();
  }

  private hideCursor(): void {
    if (!this.terminalCursorVisible) return;
    this.terminalCursorVisible = false;
    this.pulse = 0;
    this.pulsePeakPending = false;
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    for (const corner of this.corners) {
      corner.velocityX = 0;
      corner.velocityY = 0;
    }
    this.draw();
  }

  private restoreCursorVisibility(snap: boolean): void {
    if (this.terminalCursorVisible && !snap) return;
    this.terminalCursorVisible = true;
    if (this.targetUpdateFrame !== null) {
      cancelAnimationFrame(this.targetUpdateFrame);
      this.targetUpdateFrame = null;
    }
    const shouldSnap = snap || !this.focused || this.targetUpdateNeedsSnap;
    this.targetUpdateNeedsSnap = false;
    this.updateTarget(shouldSnap);
    if (
      shouldSnap
      || !this.focused
      || !this.cursorInsideViewport
      || !this.targetCenter
      || this.corners.length !== CORNER_COUNT
    ) return;

    const center = this.cornerCenter();
    const deltaX = this.targetCenter.x - center.x;
    const deltaY = this.targetCenter.y - center.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 0.01) {
      this.draw();
      return;
    }

    this.configureCornerAnimations(deltaX, deltaY);
    this.draw();
    this.lastActivityAt = performance.now();
    this.startAnimation();
  }

  private resizeCanvas(left: number, top: number, right: number, bottom: number): void {
    const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAXIMUM_DEVICE_PIXEL_RATIO);
    const boundsPoints = this.corners.length === CORNER_COUNT
      ? [...this.corners, ...this.targetCorners]
      : this.targetCorners;
    const finitePoints = boundsPoints.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    const padding = 2;
    const originX = Math.min(left, ...finitePoints.map((point) => point.x)) - padding;
    const originY = Math.min(top, ...finitePoints.map((point) => point.y)) - padding;
    const maximumX = Math.max(right, ...finitePoints.map((point) => point.x)) + padding;
    const maximumY = Math.max(bottom, ...finitePoints.map((point) => point.y)) + padding;
    const width = maximumX - originX;
    const height = maximumY - originY;
    const pixelWidth = Math.max(Math.round(width * ratio), 1);
    const pixelHeight = Math.max(Math.round(height * ratio), 1);

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.canvas.style.left = `${originX}px`;
    this.canvas.style.top = `${originY}px`;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, -originX * ratio, -originY * ratio);
  }

  private snapToTarget(): void {
    if (this.targetCorners.length !== CORNER_COUNT) return;
    this.corners.length = 0;
    for (const point of this.targetCorners) {
      this.corners.push({ ...point, velocityX: 0, velocityY: 0, animationLength: 0 });
    }
  }

  private configureCornerAnimations(deltaX: number, deltaY: number): void {
    if (
      this.corners.length !== CORNER_COUNT
      || this.targetCorners.length !== CORNER_COUNT
      || !this.targetCenter
    ) return;

    const animationLength = this.settings.animationLength / 1_000;
    const shortAnimationLength = this.settings.shortAnimationLength / 1_000;
    const isShortHorizontalMove = Math.abs(deltaX / this.cellWidth) <= 2.001
      && Math.abs(deltaY / this.cellHeight) <= 0.001;
    if (isShortHorizontalMove) {
      const duration = Math.min(animationLength, shortAnimationLength);
      for (const corner of this.corners) corner.animationLength = duration;
      return;
    }

    const alignments = this.corners.map((corner, index) => {
      const target = this.targetCorners[index];
      const relativeX = target.x - this.targetCenter!.x;
      const relativeY = target.y - this.targetCenter!.y;
      const relativeLength = Math.hypot(relativeX, relativeY) || 1;
      const travelX = target.x - corner.x;
      const travelY = target.y - corner.y;
      const travelLength = Math.hypot(travelX, travelY) || 1;
      return {
        index,
        alignment: (relativeX / relativeLength) * (travelX / travelLength)
          + (relativeY / relativeLength) * (travelY / travelLength),
      };
    }).sort((first, second) => first.alignment - second.alignment || first.index - second.index);

    const leading = animationLength * (1 - this.settings.trailSize / 100);
    const middle = (leading + animationLength) / 2;
    for (let rank = 0; rank < alignments.length; rank += 1) {
      const corner = this.corners[alignments[rank].index];
      corner.animationLength = rank === 0 ? animationLength : rank === 1 ? middle : leading;
    }
  }

  private validateCorners(): void {
    if (this.corners.length !== CORNER_COUNT || this.targetCorners.length !== CORNER_COUNT) return;
    for (let index = 0; index < CORNER_COUNT; index += 1) {
      const corner = this.corners[index];
      const target = this.targetCorners[index];
      if (![corner.x, corner.y, corner.velocityX, corner.velocityY, target.x, target.y]
        .every(Number.isFinite)) {
        this.snapToTarget();
        return;
      }
    }
  }

  private startAnimation(): void {
    if (
      this.animationFrame !== null
      || this.mode === "disabled"
      || !this.terminalCursorVisible
    ) return;
    this.lastFrameAt = performance.now();
    this.animationFrame = requestAnimationFrame((time) => this.animate(time));
  }

  private advanceCorner(corner: AnimatedPoint, target: Point, deltaTime: number): void {
    if (corner.animationLength <= deltaTime) {
      corner.x = target.x;
      corner.y = target.y;
      corner.velocityX = 0;
      corner.velocityY = 0;
      return;
    }

    // Neovide's critically damped spring reaches a 2% tolerance at animationLength.
    const angularFrequency = 4 / corner.animationLength;
    const decay = Math.exp(-angularFrequency * deltaTime);
    const offsetX = corner.x - target.x;
    const offsetY = corner.y - target.y;
    const factorX = corner.velocityX + angularFrequency * offsetX;
    const factorY = corner.velocityY + angularFrequency * offsetY;

    corner.x = target.x + (offsetX + factorX * deltaTime) * decay;
    corner.y = target.y + (offsetY + factorY * deltaTime) * decay;
    corner.velocityX = (corner.velocityX - angularFrequency * factorX * deltaTime) * decay;
    corner.velocityY = (corner.velocityY - angularFrequency * factorY * deltaTime) * decay;
  }

  private animate(time: number): void {
    this.animationFrame = null;
    if (this.mode === "disabled") return;

    const deltaTime = (time - this.lastFrameAt) / 1_000;
    this.lastFrameAt = time;
    if (!Number.isFinite(deltaTime) || deltaTime < 0 || deltaTime > MAXIMUM_FRAME_GAP_SECONDS) {
      this.pulse = 0;
      this.pulsePeakPending = false;
      this.snapToTarget();
      this.draw();
      return;
    }

    let moving = false;
    let invalid = this.corners.length !== CORNER_COUNT
      || this.targetCorners.length !== CORNER_COUNT
      || !this.targetCenter;

    for (let index = 0; !invalid && index < CORNER_COUNT; index += 1) {
      const corner = this.corners[index];
      const target = this.targetCorners[index];

      this.advanceCorner(corner, target, deltaTime);
      if (![corner.x, corner.y, corner.velocityX, corner.velocityY].every(Number.isFinite)) {
        invalid = true;
        break;
      }

      const remaining = Math.hypot(target.x - corner.x, target.y - corner.y);
      const speed = Math.hypot(corner.velocityX, corner.velocityY);
      if (remaining > 0.05 || speed > 0.5) {
        moving = true;
      } else {
        corner.x = target.x;
        corner.y = target.y;
        corner.velocityX = 0;
        corner.velocityY = 0;
      }
    }

    if (invalid) {
      this.pulse = 0;
      this.pulsePeakPending = false;
      this.snapToTarget();
      moving = false;
    } else {
      this.updateTypingPulse(time);
      if (this.pulse > 0.01) moving = true;
    }

    this.draw();
    if (moving) this.animationFrame = requestAnimationFrame((nextTime) => this.animate(nextTime));
  }

  private updateTypingPulse(time: number): void {
    if (this.pulsePeakPending) {
      this.pulse = this.pulseStrength;
      this.pulseFadeStartAt = time;
      this.pulsePeakPending = false;
      return;
    }

    const elapsed = time - this.pulseFadeStartAt;
    if (!Number.isFinite(elapsed)) {
      this.pulse = 0;
      return;
    }

    const remaining = 1 - Math.max(elapsed, 0) / TYPING_PULSE_FADE_MS;
    this.pulse = this.pulseStrength * Math.max(remaining, 0);
  }

  private clearCanvas(): void {
    this.context.save();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.restore();
  }

  private draw(): void {
    this.clearCanvas();
    if (
      this.mode === "disabled"
      || !this.terminalCursorVisible
      || !this.cursorInsideViewport
      || this.corners.length !== CORNER_COUNT
      || !this.isBlinkVisible()
    ) return;

    this.validateCorners();
    const points = this.corners;
    if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
      this.pulse = 0;
      this.snapToTarget();
      return;
    }
    this.context.save();
    this.context.fillStyle = this.color;
    this.context.strokeStyle = this.color;
    this.context.globalAlpha = this.focused ? CURSOR_OPACITY : 0.72;
    this.squarePolygon(points);
    if (this.focused) {
      this.context.fill();
      if (this.pulse > 0.01) {
        this.context.fillStyle = this.accentColor;
        this.context.globalAlpha = this.pulse;
        this.squarePolygon(points);
        this.context.fill();
      }
    } else {
      this.context.lineWidth = 1;
      this.context.stroke();
    }
    this.context.restore();
  }

  private isBlinkVisible(): boolean {
    if (!this.focused) return true;
    const elapsed = performance.now() - this.lastActivityAt;
    return elapsed < BLINK_DELAY_MS
      || Math.floor((elapsed - BLINK_DELAY_MS) / BLINK_INTERVAL_MS) % 2 === 0;
  }

  private cornerCenter(): Point {
    const total = this.corners.reduce(
      (result, corner) => ({ x: result.x + corner.x, y: result.y + corner.y }),
      { x: 0, y: 0 },
    );
    return { x: total.x / CORNER_COUNT, y: total.y / CORNER_COUNT };
  }

  private squarePolygon(points: Point[]): void {
    this.context.beginPath();
    this.context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      this.context.lineTo(points[index].x, points[index].y);
    }
    this.context.closePath();
  }
}
