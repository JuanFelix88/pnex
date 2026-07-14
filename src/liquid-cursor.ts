import type { Terminal } from "@xterm/xterm";

export type CursorAnimation = "disabled" | "liquid";

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
const SPRING_STIFFNESS = 2_400;
const SPRING_DAMPING_RATIO = 1;
const DIRECTIONAL_STRETCH = 0.3;
const MAXIMUM_TRAIL_CELLS = 6;
const TYPING_PULSE_SCALE = 0.08;
const TYPING_PULSE_DECAY = 140;
const CURSOR_OPACITY = 0.88;

export class LiquidCursor {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly screen: HTMLElement;
  private readonly corners: AnimatedPoint[] = [];
  private targetCorners: Point[] = [];
  private mode: CursorAnimation;
  private color: string;
  private screenWidth = 0;
  private screenHeight = 0;
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

    this.screenWidth = width;
    this.screenHeight = height;
    this.resizeCanvas(width, height);
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

  private resizeCanvas(width: number, height: number): void {
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width === pixelWidth && this.canvas.height === pixelHeight) return;

    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private snapToTarget(): void {
    if (this.targetCorners.length !== CORNER_COUNT) return;
    this.corners.length = 0;
    for (const point of this.targetCorners) {
      this.corners.push({ ...point, velocityX: 0, velocityY: 0 });
    }
  }

  private limitTrail(): void {
    if (!this.targetCenter || this.corners.length !== CORNER_COUNT) return;
    const center = this.cornerCenter();
    const deltaX = center.x - this.targetCenter.x;
    const deltaY = center.y - this.targetCenter.y;
    const distance = Math.hypot(deltaX, deltaY);
    const maximum = Math.hypot(this.cellWidth, this.cellHeight) * MAXIMUM_TRAIL_CELLS;
    if (distance <= maximum) return;

    const scale = maximum / distance;
    const shiftX = this.targetCenter.x + deltaX * scale - center.x;
    const shiftY = this.targetCenter.y + deltaY * scale - center.y;
    for (const corner of this.corners) {
      corner.x += shiftX;
      corner.y += shiftY;
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

  private animate(time: number): void {
    this.animationFrame = null;
    if (this.mode === "disabled") return;

    const deltaTime = Math.min((time - this.lastFrameAt) / 1_000, 1 / 30);
    this.lastFrameAt = time;
    let moving = false;

    for (let index = 0; index < this.corners.length; index += 1) {
      const corner = this.corners[index];
      const target = this.targetCorners[index];
      if (!target || !this.targetCenter) continue;

      const relativeX = target.x - this.targetCenter.x;
      const relativeY = target.y - this.targetCenter.y;
      const projection = (relativeX * this.direction.x + relativeY * this.direction.y)
        / Math.max(Math.hypot(relativeX, relativeY), 1);
      const stiffness = SPRING_STIFFNESS * (1 + projection * DIRECTIONAL_STRETCH);
      const damping = 2 * Math.sqrt(stiffness) * SPRING_DAMPING_RATIO;

      corner.velocityX += (stiffness * (target.x - corner.x) - damping * corner.velocityX) * deltaTime;
      corner.velocityY += (stiffness * (target.y - corner.y) - damping * corner.velocityY) * deltaTime;
      corner.x += corner.velocityX * deltaTime;
      corner.y += corner.velocityY * deltaTime;

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

    this.pulse *= Math.exp(-deltaTime * TYPING_PULSE_DECAY);
    if (this.pulse > 0.01) moving = true;
    this.draw();
    if (moving) this.animationFrame = requestAnimationFrame((nextTime) => this.animate(nextTime));
  }

  private draw(): void {
    this.context.clearRect(0, 0, this.screenWidth, this.screenHeight);
    if (
      this.mode === "disabled"
      || !this.terminalCursorVisible
      || !this.cursorInsideViewport
      || this.corners.length !== CORNER_COUNT
      || !this.isBlinkVisible()
    ) return;

    const points = this.scaledCorners();
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
