import type { Terminal } from "@xterm/xterm";

export type CursorAnimation = "disabled" | "liquid";

export interface LiquidCursorSettings {
  animationLength: number;
  shortAnimationLength: number;
  instantShortMoves: boolean;
  instantShortMoveDistance: number;
  instantShortMoveDelay: number;
  trailSize: number;
  typingOverlay: boolean;
  inputShadow: boolean;
  inputShadowOpacity: number;
}

export const DEFAULT_LIQUID_CURSOR_SETTINGS: LiquidCursorSettings = {
  animationLength: 125,
  shortAnimationLength: 10,
  instantShortMoves: false,
  instantShortMoveDistance: 2,
  instantShortMoveDelay: 30,
  trailSize: 95,
  typingOverlay: false,
  inputShadow: true,
  inputShadowOpacity: 45,
};

interface Point {
  x: number;
  y: number;
}

interface AnimatedPoint extends Point {
  velocityX: number;
  velocityY: number;
  animationLength: number;
  animationDelay: number;
}

const BLINK_DELAY_MS = 170;
const BLINK_INTERVAL_MS = 140;
const CORNER_COUNT = 4;
const INITIAL_FRAME_STEP_SECONDS = 1 / 60;
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
  private targetUpdatePending = false;
  private targetUpdateNeedsSnap = false;
  private lastFrameAt: number | null = null;
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
      this.lastActivityAt = performance.now();
      this.scheduleTargetUpdate(true);
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
  }

  setMode(mode: CursorAnimation): void {
    this.mode = mode;
    this.canvas.hidden = mode === "disabled";
    if (mode === "liquid") {
      this.lastActivityAt = performance.now();
      this.scheduleTargetUpdate(true);
    } else {
      this.pulse = 0;
      this.pulseStrength = 0;
      this.pulsePeakPending = false;
      this.cancelFrame();
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
    this.scheduleTargetUpdate();
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
    this.requestFrame();
  }

  private scheduleTargetUpdate(snap = false): void {
    this.targetUpdatePending = true;
    this.targetUpdateNeedsSnap ||= snap;
    this.requestFrame();
  }

  // Returns whether a configured instant-move trail should start at this paint.
  private updateTarget(snap: boolean): boolean {
    const { width, height } = this.screen.getBoundingClientRect();
    if (width <= 0 || height <= 0 || this.terminal.cols <= 0 || this.terminal.rows <= 0) {
      this.cursorInsideViewport = false;
      return false;
    }

    this.cellWidth = width / this.terminal.cols;
    this.cellHeight = height / this.terminal.rows;

    const buffer = this.terminal.buffer.active;
    const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
    const wasInsideViewport = this.cursorInsideViewport;
    this.cursorInsideViewport = row >= 0 && row < this.terminal.rows;
    if (!this.cursorInsideViewport) return false;

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
    let deferTrailStep = false;
    if (this.corners.length !== CORNER_COUNT || snap || !this.focused || !wasInsideViewport) {
      this.snapToTarget();
    } else if (moved) {
      this.lastActivityAt = performance.now();
      deferTrailStep = this.configureCornerAnimations(deltaX, deltaY);
    }

    this.resizeCanvas(left, top, right, bottom);
    return deferTrailStep;
  }

  private hideCursor(): void {
    if (!this.terminalCursorVisible) return;
    this.terminalCursorVisible = false;
    this.pulse = 0;
    this.pulsePeakPending = false;
    this.cancelFrame();
    for (const corner of this.corners) {
      corner.velocityX = 0;
      corner.velocityY = 0;
    }
    this.draw();
  }

  private restoreCursorVisibility(snap: boolean): void {
    if (this.terminalCursorVisible && !snap) return;
    this.terminalCursorVisible = true;
    this.scheduleTargetUpdate(snap);
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
      this.corners.push({
        ...point,
        velocityX: 0,
        velocityY: 0,
        animationLength: 0,
        animationDelay: 0,
      });
    }
  }

  private configureCornerAnimations(deltaX: number, deltaY: number): boolean {
    const targetCenter = this.targetCenter;
    if (!targetCenter) return false;

    const animationLength = this.settings.animationLength / 1_000;
    const horizontalCells = Math.abs(deltaX / this.cellWidth);
    const isHorizontal = horizontalCells > 0.001 && Math.abs(deltaY / this.cellHeight) <= 0.001;
    const instantShortMove = isHorizontal && this.settings.instantShortMoves
      && horizontalCells <= this.settings.instantShortMoveDistance + 0.001;
    if (isHorizontal && (horizontalCells <= 1.001 || instantShortMove)) {
      // Pin the front to the confirmed cell. Only the trailing edge needs to catch up.
      const direction = Math.sign(deltaX);
      const duration = instantShortMove
        ? Math.min(animationLength, this.settings.shortAnimationLength / 1_000)
        : animationLength;
      const trailDuration = duration * this.settings.trailSize / 100;
      for (let index = 0; index < CORNER_COUNT; index += 1) {
        const corner = this.corners[index];
        const target = this.targetCorners[index];
        const trailing = (target.x - targetCenter.x) * direction < 0;
        corner.animationLength = trailing ? trailDuration / (index < 2 ? 1 : 2) : 0;
        // Keep the target cell covered without growing the trail on key repeat or reversal.
        const lag = (target.x - corner.x) * direction;
        corner.x = corner.animationLength > 0
          ? target.x - Math.min(Math.max(lag, 0), Math.abs(deltaX)) * direction
          : target.x;
        corner.y = target.y;
        corner.velocityX = 0;
        corner.velocityY = 0;
        corner.animationDelay = instantShortMove && corner.x !== target.x
          ? this.settings.instantShortMoveDelay / 1_000
          : 0;
      }
      return instantShortMove;
    }
    const alignments = this.corners.map((corner, index) => {
      const target = this.targetCorners[index];
      const relativeX = target.x - targetCenter.x;
      const relativeY = target.y - targetCenter.y;
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
      corner.animationDelay = 0;
    }
    return false;
  }

  private validateCorners(): void {
    if (this.corners.length !== CORNER_COUNT || this.targetCorners.length !== CORNER_COUNT) return;
    for (let index = 0; index < CORNER_COUNT; index += 1) {
      const corner = this.corners[index];
      const target = this.targetCorners[index];
      if (![
        corner.x,
        corner.y,
        corner.velocityX,
        corner.velocityY,
        corner.animationDelay,
        target.x,
        target.y,
      ].every(Number.isFinite)) {
        this.snapToTarget();
        return;
      }
    }
  }

  private requestFrame(): void {
    if (this.animationFrame !== null || this.mode === "disabled" || !this.terminalCursorVisible) return;
    this.animationFrame = requestAnimationFrame((time) => this.animate(time));
  }

  private cancelFrame(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.lastFrameAt = null;
  }

  private advanceCorner(corner: AnimatedPoint, target: Point, deltaTime: number): void {
    const delay = Math.min(corner.animationDelay, deltaTime);
    corner.animationDelay -= delay;
    deltaTime -= delay;
    if (deltaTime <= 0) return;

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
    if (this.mode === "disabled" || !this.terminalCursorVisible) return;

    const deltaTime = this.lastFrameAt === null
      ? INITIAL_FRAME_STEP_SECONDS
      : (time - this.lastFrameAt) / 1_000;
    this.lastFrameAt = null;

    // Coalesce xterm notifications and update the geometry in the frame that will draw it.
    let deferTrailStep = false;
    if (this.targetUpdatePending) {
      const snap = this.targetUpdateNeedsSnap;
      this.targetUpdatePending = false;
      this.targetUpdateNeedsSnap = false;
      deferTrailStep = this.updateTarget(snap);
    }
    if (!this.cursorInsideViewport) {
      this.draw();
      return;
    }
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

      // The configured instant-move trail starts only after its front has been painted.
      if (!deferTrailStep) this.advanceCorner(corner, target, deltaTime);
      if (![
        corner.x,
        corner.y,
        corner.velocityX,
        corner.velocityY,
        corner.animationDelay,
      ].every(Number.isFinite)) {
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
    if (moving) {
      this.lastFrameAt = time;
      this.requestFrame();
    }
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

  private squarePolygon(points: Point[]): void {
    this.context.beginPath();
    this.context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      this.context.lineTo(points[index].x, points[index].y);
    }
    this.context.closePath();
  }
}
