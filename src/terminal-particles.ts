export interface ParticleEmitter {
  key: string;
  x: number;
  y: number;
  width: number;
  color: string;
  fontSize: number;
}

interface Particle {
  source: ParticleEmitter;
  x: number;
  age: number;
  lifetime: number;
  radius: number;
  rise: number;
  drift: number;
  phase: number;
}

// A global budget, not a budget per word: dense output cannot multiply the cost.
const MAX_PARTICLES = 160;
const FRAME_INTERVAL = 1000 / 30;

export class TerminalParticles {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private emitters: ParticleEmitter[] = [];
  private particles: Particle[] = [];
  private readonly pool: Particle[] = [];
  private frameId?: number;
  private lastFrame = 0;
  private credit = 0;
  private rate = 0;
  private width = 0;
  private height = 0;
  private disposed = false;
  private readonly synchronize = (): void => {
    if (document.hidden || !document.hasFocus()) this.clear();
    else this.start();
  };

  constructor(screen: HTMLElement) {
    const context = this.canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Terminal particle canvas unavailable.");
    this.context = context;
    this.canvas.className = "terminal-motion-particles";
    this.canvas.setAttribute("aria-hidden", "true");
    screen.append(this.canvas);
    window.addEventListener("blur", this.synchronize);
    window.addEventListener("focus", this.synchronize);
    document.addEventListener("visibilitychange", this.synchronize);
  }

  configure(rate: number): void {
    this.rate = rate;
    if (!rate) this.clear();
    else this.start();
  }

  resize(width: number, height: number): void {
    this.clear();
    this.width = width;
    this.height = height;
    // Small circles do not need an unbounded high-DPI backing surface.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.ceil(width * ratio);
    this.canvas.height = Math.ceil(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  setEmitters(emitters: ParticleEmitter[]): void {
    this.emitters = emitters;
    // Drop bubbles whose text was erased/recolored, without restarting unchanged words.
    const keys = new Set(emitters.map((emitter) => emitter.key));
    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (!keys.has(this.particles[i].source.key)) this.recycle(i);
    }
    if (!emitters.length) this.clear();
    else this.start();
  }

  clear(): void {
    if (this.frameId !== undefined) cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
    this.lastFrame = 0;
    this.credit = 0;
    this.pool.push(...this.particles);
    this.particles.length = 0;
    this.context.clearRect(0, 0, this.width, this.height);
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    window.removeEventListener("blur", this.synchronize);
    window.removeEventListener("focus", this.synchronize);
    document.removeEventListener("visibilitychange", this.synchronize);
    this.canvas.remove();
    this.emitters = [];
    this.pool.length = 0;
  }

  private start(): void {
    if (this.disposed || this.frameId !== undefined || !this.rate || !this.emitters.length
      || !this.width || !this.height || document.hidden || !document.hasFocus()) return;
    this.frameId = requestAnimationFrame(this.frame);
  }

  private recycle(index: number): void {
    this.pool.push(this.particles[index]);
    const last = this.particles.pop()!;
    if (index < this.particles.length) this.particles[index] = last;
  }

  private emit(): void {
    const source = this.emitters[Math.floor(Math.random() * this.emitters.length)];
    const particle = this.pool.pop() ?? {} as Particle;
    particle.source = source;
    particle.x = source.x + Math.random() * source.width;
    particle.age = 0;
    particle.lifetime = 1.2 + Math.random() * 0.8;
    particle.radius = source.fontSize * (0.055 + Math.random() * 0.105);
    particle.rise = source.fontSize * (0.85 + Math.random() * 1.3);
    particle.drift = (Math.random() - 0.5) * source.fontSize * 0.55;
    particle.phase = Math.random() * Math.PI * 2;
    this.particles.push(particle);
  }

  private readonly frame = (now: number): void => {
    this.frameId = undefined;
    if (document.hidden || !document.hasFocus()) {
      this.clear();
      return;
    }
    const elapsed = this.lastFrame ? now - this.lastFrame : FRAME_INTERVAL;
    if (elapsed >= FRAME_INTERVAL - 0.5) {
      // Never catch up with a burst after a stall or a background window.
      const dt = Math.min(elapsed / 1000, 0.067);
      this.lastFrame = now;
      this.credit = Math.min(this.credit + dt * this.rate, 6);
      while (this.credit >= 1 && this.particles.length < MAX_PARTICLES) {
        this.emit();
        this.credit--;
      }
      const context = this.context;
      context.clearRect(0, 0, this.width, this.height);
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const particle = this.particles[i];
        particle.age += dt;
        const progress = particle.age / particle.lifetime;
        if (progress >= 1) {
          this.recycle(i);
          continue;
        }
        const x = particle.x + particle.drift * particle.age
          + Math.sin(particle.phase + particle.age * 4) * particle.source.fontSize * 0.13;
        const y = particle.source.y - particle.rise * particle.age;
        const radius = particle.radius * (0.7 + progress * 0.6);
        const opacity = Math.min(1, progress * 8) * (1 - progress) * 0.55;
        context.strokeStyle = particle.source.color;
        context.fillStyle = particle.source.color;
        context.lineWidth = Math.max(0.5, particle.source.fontSize * 0.05);
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.globalAlpha = opacity * 0.22;
        context.fill();
        context.globalAlpha = opacity;
        context.stroke();
      }
      context.globalAlpha = 1;
    }
    this.start();
  };
}
