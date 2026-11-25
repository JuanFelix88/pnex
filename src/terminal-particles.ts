import { ParticleWebglRenderer } from "./terminal-particles-webgl";

export interface ParticleEmitter {
  x: number;
  y: number;
  width: number;
  color: string;
  fontSize: number;
}

export interface Particle {
  x: number;
  y: number;
  color: string;
  rgb: number;
  fontSize: number;
  bornAt: number;
  lifetime: number;
  radius: number;
  rise: number;
  drift: number;
  phase: number;
}

// A global budget, not a budget per word: dense output cannot multiply the cost.
const MAX_PARTICLES = 160;
const FRAME_INTERVAL = 1000 / 30;
const CANVAS_MARGIN = 64;

export class TerminalParticles {
  private canvas?: HTMLCanvasElement;
  private context?: CanvasRenderingContext2D;
  private webgl?: ParticleWebglRenderer;
  private useWebgl = true;
  private painted = false;
  private emitters: ParticleEmitter[] = [];
  private particles: Particle[] = [];
  private readonly pool: Particle[] = [];
  private frameId?: number;
  private lastFrame = 0;
  private time = 0;
  private credit = 0;
  private rate = 0;
  private requireFocus = true;
  private width = 0;
  private height = 0;
  private disposed = false;
  private readonly synchronize = (): void => {
    if (this.isPaused()) this.clear();
    else this.start();
  };

  constructor(private readonly screen: HTMLElement) {
    window.addEventListener("blur", this.synchronize);
    window.addEventListener("focus", this.synchronize);
    document.addEventListener("visibilitychange", this.synchronize);
  }

  configure(rate: number, requireFocus = true): void {
    this.rate = rate;
    this.requireFocus = requireFocus;
    if (!rate) {
      this.clear();
      this.releaseSurface();
    } else if (this.isPaused()) this.clear();
    else this.start();
  }

  resize(width: number, height: number): void {
    this.clear();
    this.width = width;
    this.height = height;
    this.sizeSurface();
  }

  setEmitters(emitters: ParticleEmitter[]): void {
    this.emitters = emitters;
    // Emission follows visible content; bubbles already emitted have their own lifetime.
    if (!emitters.length) this.credit = 0;
    if (!emitters.length && !this.particles.length) this.clear();
    else this.start();
  }

  clear(): void {
    if (this.frameId !== undefined) cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
    this.lastFrame = 0;
    this.time = 0;
    this.credit = 0;
    this.pool.push(...this.particles);
    this.particles.length = 0;
    this.clearCanvas();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    window.removeEventListener("blur", this.synchronize);
    window.removeEventListener("focus", this.synchronize);
    document.removeEventListener("visibilitychange", this.synchronize);
    this.releaseSurface();
    this.emitters = [];
    this.pool.length = 0;
  }

  private isPaused(): boolean {
    return document.hidden || (this.requireFocus && !document.hasFocus());
  }

  private createSurface(): void {
    let canvas = document.createElement("canvas");
    if (this.useWebgl) {
      let gl: WebGL2RenderingContext | null = null;
      try {
        gl = canvas.getContext("webgl2", {
          alpha: true, premultipliedAlpha: true, antialias: false,
          depth: false, stencil: false, failIfMajorPerformanceCaveat: true,
        });
        if (gl) this.webgl = new ParticleWebglRenderer(gl, MAX_PARTICLES);
      } catch (error: unknown) {
        console.warn("Particle WebGL renderer unavailable; using Canvas 2D.", error);
        if (gl) {
          gl.getExtension("WEBGL_lose_context")?.loseContext();
          // A canvas that acquired WebGL cannot be reused for a 2D context.
          canvas = document.createElement("canvas");
        }
      }
      this.useWebgl = this.webgl !== undefined;
    }
    if (this.webgl) canvas.addEventListener("webglcontextlost", this.onContextLost);
    else {
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Terminal particle canvas unavailable.");
      this.context = context;
    }
    this.canvas = canvas;
    canvas.className = "terminal-motion-particles";
    canvas.setAttribute("aria-hidden", "true");
    this.sizeSurface();
    this.screen.append(canvas);
  }

  private readonly onContextLost = (): void => {
    this.useWebgl = false;
    this.releaseSurface();
    // Keep live bubbles and use the existing animation loop to resume in Canvas 2D.
  };

  private releaseSurface(): void {
    this.canvas?.removeEventListener("webglcontextlost", this.onContextLost);
    this.webgl?.dispose();
    this.canvas?.remove();
    this.canvas = this.webgl = this.context = undefined;
    this.painted = false;
  }

  private sizeSurface(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    // Small circles do not need an unbounded high-DPI backing surface.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = this.width + CANVAS_MARGIN * 2;
    const height = this.height + CANVAS_MARGIN * 2;
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.transform = `translate(${-CANVAS_MARGIN}px, ${-CANVAS_MARGIN}px)`;
    this.webgl?.resize(canvas, width, height, ratio);
    this.context?.setTransform(ratio, 0, 0, ratio, CANVAS_MARGIN * ratio, CANVAS_MARGIN * ratio);
  }

  private clearCanvas(): void {
    if (!this.painted) return;
    this.webgl?.clear();
    this.context?.clearRect(-CANVAS_MARGIN, -CANVAS_MARGIN,
      this.width + CANVAS_MARGIN * 2, this.height + CANVAS_MARGIN * 2);
    this.painted = false;
  }

  private render(changed: boolean): void {
    if (!this.particles.length) {
      this.clearCanvas();
      return;
    }
    if (!this.canvas) this.createSurface();
    if (this.webgl) this.webgl.render(this.particles, this.time, CANVAS_MARGIN, changed);
    else if (this.context) this.render2d(this.context);
    this.painted = true;
  }

  private render2d(context: CanvasRenderingContext2D): void {
    this.clearCanvas();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      const age = this.time - particle.bornAt;
      const progress = age / particle.lifetime;
      const x = particle.x + particle.drift * age
        + Math.sin(particle.phase + age * 4) * particle.fontSize * 0.13;
      const y = particle.y - particle.rise * age;
      const radius = particle.radius * (0.7 + progress * 0.6);
      const opacity = Math.min(1, progress * 8) * (1 - progress) * 0.55;
      context.strokeStyle = particle.color;
      context.fillStyle = particle.color;
      context.lineWidth = Math.max(0.5, particle.fontSize * 0.05);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.globalAlpha = opacity * 0.22;
      context.fill();
      context.globalAlpha = opacity;
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  private start(): void {
    if (this.disposed || this.frameId !== undefined || !this.rate || (!this.emitters.length && !this.particles.length)
      || !this.width || !this.height || this.isPaused()) return;
    this.frameId = requestAnimationFrame(this.frame);
  }

  private recycle(index: number): void {
    this.pool.push(this.particles[index]);
    const last = this.particles.pop()!;
    if (index < this.particles.length) this.particles[index] = last;
  }

  private emit(dt: number): void {
    const source = this.emitters[Math.floor(Math.random() * this.emitters.length)];
    const particle = this.pool.pop() ?? {} as Particle;
    // Snapshot the emitter. Terminal Motion supplies canonical #rrggbb colors.
    particle.y = source.y;
    particle.color = source.color;
    particle.rgb = Number.parseInt(source.color.slice(1), 16);
    particle.fontSize = source.fontSize;
    particle.x = source.x + Math.random() * source.width;
    particle.bornAt = this.time - dt;
    particle.lifetime = 1.2 + Math.random() * 0.8;
    particle.radius = source.fontSize * (0.055 + Math.random() * 0.105);
    particle.rise = source.fontSize * (0.85 + Math.random() * 1.3);
    particle.drift = (Math.random() - 0.5) * source.fontSize * 0.55;
    particle.phase = Math.random() * Math.PI * 2;
    this.particles.push(particle);
  }

  private readonly frame = (now: number): void => {
    this.frameId = undefined;
    if (this.isPaused()) {
      this.clear();
      return;
    }
    const elapsed = this.lastFrame ? now - this.lastFrame : FRAME_INTERVAL;
    if (elapsed >= FRAME_INTERVAL - 0.5) {
      // Never catch up with a burst after a stall or a background window.
      const dt = Math.min(elapsed / 1000, 0.067);
      this.lastFrame = now;
      this.time += dt;
      let changed = false;
      this.credit = this.emitters.length ? Math.min(this.credit + dt * this.rate, 6) : 0;
      while (this.emitters.length && this.credit >= 1 && this.particles.length < MAX_PARTICLES) {
        this.emit(dt);
        this.credit--;
        changed = true;
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const particle = this.particles[i];
        if (this.time - particle.bornAt >= particle.lifetime) {
          this.recycle(i);
          changed = true;
        }
      }
      this.render(changed);
    }
    if (!this.emitters.length && !this.particles.length) this.clear();
    else this.start();
  };
}
