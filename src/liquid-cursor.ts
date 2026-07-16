import type { Terminal } from "@xterm/xterm";

export type CursorAnimation = "disabled" | "liquid";

export interface LiquidCursorSettings {
  response: number;
  fluidity: number;
}

export const DEFAULT_LIQUID_CURSOR_SETTINGS: LiquidCursorSettings = {
  response: 70,
  fluidity: 42,
};

interface Point {
  x: number;
  y: number;
}

interface AnimatedPoint extends Point {
  velocityX: number;
  velocityY: number;
}

const BLINK_DELAY_MS = 170;
const BLINK_INTERVAL_MS = 140;
const CORNER_COUNT = 4;
const MINIMUM_SPRING_STIFFNESS = 2_000;
const MAXIMUM_SPRING_STIFFNESS = 18_000;
const MINIMUM_DIRECTIONAL_STRETCH = 0.02;
const MAXIMUM_DIRECTIONAL_STRETCH = 0.26;
const MINIMUM_TRAIL_CELLS = 1.5;
const MAXIMUM_TRAIL_CELLS = 5;
const MAXIMUM_FRAME_GAP_SECONDS = 0.25;
const MAXIMUM_DEVICE_PIXEL_RATIO = 2;
const TYPING_PULSE_SCALE = 0.05;
const TYPING_PULSE_DECAY = 36;
const CURSOR_OPACITY = 0.88;

export class LiquidCursor {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly screen: HTMLElement;
  private readonly corners: AnimatedPoint[] = [];
  private targetCorners: Point[] = [];
  private mode: CursorAnimation;
  private color: string;
  private settings: LiquidCursorSettings;
  private cellWidth = 0;
  private cellHeight = 0;
  private targetCenter: Point | null = null;
  private direction: Point = { x: 0, y: 0 };
  private animationFrame: number | null = null;
  private targetUpdateFrame: number | null = null;
  private targetUpdateNeedsSnap = false;
  private lastFrameAt = 0;
  private lastActivityAt = performance.now();
  private pulse = 0;
  private focused = false;
  private terminalCursorVisible = true;
  private cursorInsideViewport = false;

  constructor(
    private readonly terminal: Terminal,
    mode: CursorAnimation,
    color: string,
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
    } else if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  setColor(color: string): void {
    this.color = color;
    this.draw();
  }

  setSettings(settings: LiquidCursorSettings): void {
    this.settings = settings;
    this.updateTarget();
  }

  wake(): void {
    if (this.mode === "disabled") return;
    this.lastActivityAt = performance.now();
    this.pulse = 1;
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
    const moved = !this.targetCenter
      || Math.abs(nextCenter.x - this.targetCenter.x) > 0.01
      || Math.abs(nextCenter.y - this.targetCenter.y) > 0.01;

    if (this.targetCenter && moved) {
      const deltaX = nextCenter.x - this.targetCenter.x;
      const deltaY = nextCenter.y - this.targetCenter.y;
      const length = Math.hypot(deltaX, deltaY) || 1;
      this.direction = { x: deltaX / length, y: deltaY / length };
    }

    this.targetCenter = nextCenter;
    this.targetCorners = [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];
    this.resizeCanvas(left, top, right, bottom);

    if (!this.terminalCursorVisible) {
      if (this.corners.length !== CORNER_COUNT) this.snapToTarget();
      this.draw();
      return;
    }

    if (this.corners.length !== CORNER_COUNT || snap || !this.focused) {
      this.snapToTarget();
    } else if (moved) {
      this.limitTrail();
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

    this.direction = { x: deltaX / distance, y: deltaY / distance };
    this.limitTrail();
    this.draw();
    this.lastActivityAt = performance.now();
    this.startAnimation();
  }

  private resizeCanvas(left: number, top: number, right: number, bottom: number): void {
    const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAXIMUM_DEVICE_PIXEL_RATIO);
    const pulsePadding = Math.max(this.cellWidth, this.cellHeight) * TYPING_PULSE_SCALE + 2;
    const padding = Math.ceil(this.maximumTrailDistance() + pulsePadding);
    const originX = left - padding;
    const originY = top - padding;
    const width = right - left + padding * 2;
    const height = bottom - top + padding * 2;
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
      this.corners.push({ ...point, velocityX: 0, velocityY: 0 });
    }
  }

  private springStiffness(): number {
    const ratio = this.settings.response / 100;
    return MINIMUM_SPRING_STIFFNESS
      * Math.pow(MAXIMUM_SPRING_STIFFNESS / MINIMUM_SPRING_STIFFNESS, ratio);
  }

  private directionalStretch(): number {
    return MINIMUM_DIRECTIONAL_STRETCH
      + (MAXIMUM_DIRECTIONAL_STRETCH - MINIMUM_DIRECTIONAL_STRETCH)
      * (this.settings.fluidity / 100);
  }

  private maximumTrailDistance(): number {
    const trailCells = MINIMUM_TRAIL_CELLS
      + (MAXIMUM_TRAIL_CELLS - MINIMUM_TRAIL_CELLS) * (this.settings.fluidity / 100);
    const distance = Math.hypot(this.cellWidth, this.cellHeight) * trailCells;
    return Number.isFinite(distance) ? Math.max(distance, 1) : 1;
  }

  private constrainCorner(corner: AnimatedPoint, target: Point): boolean {
    if (![corner.x, corner.y, corner.velocityX, corner.velocityY, target.x, target.y]
      .every(Number.isFinite)) return false;

    const maximumTrail = this.maximumTrailDistance();
    const deltaX = corner.x - target.x;
    const deltaY = corner.y - target.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(distance)) return false;
    if (distance > maximumTrail) {
      const scale = maximumTrail / distance;
      corner.x = target.x + deltaX * scale;
      corner.y = target.y + deltaY * scale;
    }

    const speed = Math.hypot(corner.velocityX, corner.velocityY);
    const maximumSpeed = maximumTrail
      * Math.sqrt(this.springStiffness() * (1 + this.directionalStretch()));
    if (!Number.isFinite(speed)) return false;
    if (speed > maximumSpeed) {
      const scale = maximumSpeed / speed;
      corner.velocityX *= scale;
      corner.velocityY *= scale;
    }
    return true;
  }

  private limitTrail(): void {
    if (this.corners.length !== CORNER_COUNT || this.targetCorners.length !== CORNER_COUNT) return;
    for (let index = 0; index < CORNER_COUNT; index += 1) {
      if (!this.constrainCorner(this.corners[index], this.targetCorners[index])) {
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

  private advanceCorner(
    corner: AnimatedPoint,
    target: Point,
    stiffness: number,
    deltaTime: number,
  ): void {
    // Exact critically damped spring solution. Unlike Euler integration, this remains
    // stable regardless of frame pacing and converges without simulation substeps.
    const angularFrequency = Math.sqrt(stiffness);
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
      const relativeX = target.x - this.targetCenter!.x;
      const relativeY = target.y - this.targetCenter!.y;
      const projection = (relativeX * this.direction.x + relativeY * this.direction.y)
        / Math.max(Math.hypot(relativeX, relativeY), 1);
      const stiffness = this.springStiffness()
        * (1 + projection * this.directionalStretch());

      this.advanceCorner(corner, target, stiffness, deltaTime);
      if (!this.constrainCorner(corner, target)) {
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
      this.snapToTarget();
      moving = false;
    } else {
      this.pulse *= Math.exp(-deltaTime * TYPING_PULSE_DECAY);
      if (!Number.isFinite(this.pulse)) this.pulse = 0;
      if (this.pulse > 0.01) moving = true;
    }

    this.draw();
    if (moving) this.animationFrame = requestAnimationFrame((nextTime) => this.animate(nextTime));
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

    this.limitTrail();
    const points = this.scaledCorners();
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

  private scaledCorners(): Point[] {
    if (this.pulse <= 0.01) return this.corners;
    const center = this.cornerCenter();
    const scale = 1 + this.pulse * TYPING_PULSE_SCALE;
    return this.corners.map((corner) => ({
      x: center.x + (corner.x - center.x) * scale,
      y: center.y + (corner.y - center.y) * scale,
    }));
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
