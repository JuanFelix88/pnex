import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Exercise the actual TS modules with a deterministic canvas/RAF, without adding dependencies.
function fixture() {
  const frames = new Map();
  let nextFrame = 0;
  let now = 0;
  let focused = true;
  const stats = { arcs: [], reads: 0 };
  const context2d = () => ({
    fillStyle: "#ffffff", globalAlpha: 1,
    setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
    rect() {}, clip() {}, fillText() {}, fill() {}, stroke() {},
    arc(x, y, radius) { stats.arcs.push({ x, y, radius }); },
  });
  class Element {
    style = { setProperty() {} };
    dataset = {};
    children = [];
    clientWidth = 400;
    clientHeight = 100;
    setAttribute() {}
    append(child) { this.children.push(child); }
    remove() { this.removed = true; }
    querySelector() { return this; }
    querySelectorAll() { return []; }
    closest() { return null; }
    matches() { return false; }
    getBoundingClientRect() { return { top: 0, left: 0, right: 400, bottom: 100 }; }
    getContext() { return context2d(); }
  }
  const screen = new Element();
  const document = Object.assign(new EventTarget(), {
    hidden: false, hasFocus: () => focused, createElement: () => new Element(),
  });
  const window = Object.assign(new EventTarget(), { devicePixelRatio: 2 });
  const math = Object.create(Math);
  math.random = () => 0.5;
  const scope = createContext({
    document, window, Element, HTMLElement: Element, Math: math,
    performance: { now: () => now },
    getComputedStyle: (element) => element.computed,
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  function load(path, imports = {}) {
    scope.exports = {};
    scope.require = (name) => imports[name];
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    runInContext(outputText, scope);
    return scope.exports;
  }
  const particlesModule = load("../src/terminal-particles.ts");
  const motionModule = load("../src/terminal-motion.ts", { "./terminal-particles": particlesModule });
  const lines = Array.from({ length: 5 }, () => Array.from({ length: 40 }, () => cell(" ")));
  let render;
  const buffer = {
    viewportY: 0, getNullCell: () => ({}),
    getLine(row) { stats.reads++; return { getCell: (column) => lines[row]?.[column] }; },
  };
  const terminal = {
    element: screen, cols: 40, rows: 5, buffer: { active: buffer },
    options: { fontSize: 14, fontFamily: "monospace", theme: {
      foreground: "#ffffff", background: "#000000", red: "#ff0000", green: "#00ff00",
    } },
    onRender(fn) { render = fn; return { dispose() { render = undefined; } }; },
  };
  return {
    ...particlesModule, ...motionModule, terminal, lines, screen, stats, frames, document,
    render: (start, end = start) => render?.({ start, end }),
    focus(value) { focused = value; window.dispatchEvent(new Event(value ? "focus" : "blur")); },
    tick(count = 1, interval = 1000 / 60) {
      for (let i = 0; i < count; i++) {
        now += interval;
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((fn) => fn(now));
      }
    },
  };
}

function cell(chars, rgb = 0xff0000, extra = {}) {
  return {
    getChars: () => chars, getWidth: () => 1, getFgColor: () => rgb,
    isInverse: () => false, isBgRGB: () => false, isFgRGB: () => true,
    isBgPalette: () => false, isFgPalette: () => false, isBold: () => false,
    isDim: () => false, isItalic: () => false, isInvisible: () => false, ...extra,
  };
}

const source = (fontSize = 14) => ({
  x: 10, y: 80, width: 50, color: "#ff0000", fontSize,
});

test("normalizes legacy, disabled and malformed particle settings", () => {
  const f = fixture();
  const settings = f.configuredTerminalMotionSettings;
  assert.equal(settings().particleCount, 12);
  assert.equal(settings({ particleCount: 0 }).particleCount, 0);
  assert.equal(settings({ particleCount: -5 }).particleCount, 0);
  assert.equal(settings({ particleCount: 1000 }).particleCount, 80);
  assert.equal(settings({ particleCount: NaN }).particleCount, 12);
  assert.equal(settings({ particleCount: Infinity }).particleCount, 12);
  assert.equal(settings({ particleCount: 7.8 }).particleCount, 8);
});

test("emits from visible colored text and structures; respects spaces, dim, invisibility and cell widths", () => {
  const f = fixture();
  f.lines[0][0] = cell("R");
  f.lines[0][1] = cell("e");
  f.lines[0][2] = cell("d");
  f.lines[0][4] = cell("W", 0xffffff);
  f.lines[0][6] = cell("D", 0xff0000, { isDim: () => true });
  f.lines[0][8] = cell("H", 0xff0000, { isInvisible: () => true });
  f.lines[0][10] = cell("界", 0x00ff00, { getWidth: () => 2 });
  f.lines[0][11] = cell("", 0x00ff00, { getWidth: () => 0 });
  f.lines[0][13] = cell("e\u0301", 0x00ff00);
  f.lines[0][15] = cell("─");
  const motion = new f.TerminalMotion(f.terminal);
  const emitters = motion.emitterRows.get(0);
  assert.equal(emitters.length, 4);
  assert.equal(emitters[0].x, 0);
  assert.equal(emitters[0].width, 30);
  assert.equal(emitters[0].color, "#ff0000");
  assert.equal(emitters[1].x, 100);
  assert.equal(emitters[1].width, 20);
  assert.equal(emitters[2].width, 10);
  assert.equal(emitters[3].x, 150);
  assert.equal(emitters[3].width, 10);
  motion.dispose();
  assert.equal(f.frames.size, 0);
});

test("dirty renders scan only changed rows; erasure stops emission but lets existing bubbles expire", () => {
  const f = fixture();
  f.lines[0][0] = cell("R");
  const motion = new f.TerminalMotion(f.terminal);
  f.tick(120);
  assert.ok(motion.particles.particles.length > 0);
  f.stats.reads = 0;
  f.render(2);
  assert.equal(f.stats.reads, 1);
  f.tick();
  assert.ok(motion.particles.particles.length > 0);
  f.lines[0][0] = cell(" ");
  f.render(0);
  f.tick();
  assert.equal(motion.particles.emitters.length, 0);
  assert.ok(motion.particles.particles.length > 0);
  f.tick(180);
  assert.equal(motion.particles.particles.length, 0);
  assert.equal(f.frames.size, 0);
  motion.dispose();
});

test("scroll, buffer replacement and theme changes preserve emitted bubbles", () => {
  const f = fixture();
  f.lines[0][0] = cell("R");
  const motion = new f.TerminalMotion(f.terminal);
  f.tick(120);
  const bubble = motion.particles.particles[0];
  f.terminal.options.theme = { foreground: "#eeeeee", background: "#111111" };
  f.render(0);
  assert.ok(motion.particles.particles.includes(bubble));
  f.terminal.buffer.active = { ...f.terminal.buffer.active, viewportY: 1 };
  f.render(0);
  assert.ok(motion.particles.particles.includes(bubble));
  f.tick();
  assert.equal(motion.particles.emitters.length, 0);
  assert.ok(motion.particles.particles.length > 0);
  f.tick(180);
  assert.equal(motion.particles.particles.length, 0);
  assert.equal(f.frames.size, 0);
  motion.dispose();
});

test("box drawing, blocks, braille and ASCII structures emit without letters or numbers", () => {
  const f = fixture();
  const structures = ["┌──┐", "│└─┘", "█▓▒░", "⠋⠙⠹⠸", "|-+=[]"];
  structures.forEach((text, row) => [...text].forEach((char, column) => {
    f.lines[row][column] = cell(char, 0x00ff00);
  }));
  const motion = new f.TerminalMotion(f.terminal);
  structures.forEach((text, row) => {
    const emitters = motion.emitterRows.get(row);
    assert.equal(emitters.length, 1);
    assert.equal(emitters[0].width, [...text].length * 10);
    assert.equal(emitters[0].color, "#00ff00");
  });
  motion.dispose();
});

test("HUD structures emit too, but whitespace remains excluded", () => {
  const f = fixture();
  const ink = f.document.createElement("span");
  ink.textContent = "│──│";
  ink.computed = { color: "#00ff00", fontSize: "14px" };
  ink.getBoundingClientRect = () => ({ top: 20, bottom: 40, left: 10, right: 50, width: 40, height: 20 });
  f.screen.querySelectorAll = () => [ink];
  const motion = new f.TerminalMotion(f.terminal);
  f.tick();
  assert.equal(motion.hudEmitters.length, 1);
  assert.equal(motion.hudEmitters[0].color, "#00ff00");
  ink.textContent = "   ";
  assert.equal(motion.readHudEmitters().length, 0);
  motion.dispose();
});

test("bubbles snapshot emitter appearance and drain independently without accumulating emission credit", () => {
  const f = fixture();
  const particles = new f.TerminalParticles(f.screen);
  particles.resize(400, 100);
  const emitter = source();
  particles.setEmitters([emitter]);
  particles.configure(80);
  f.tick(60);
  const bubble = particles.particles[0];
  emitter.y = 10;
  emitter.color = "#00ff00";
  emitter.fontSize = 28;
  particles.setEmitters([]);
  assert.ok(particles.particles.includes(bubble));
  assert.equal(bubble.y, 80);
  assert.equal(bubble.color, "#ff0000");
  assert.equal(bubble.fontSize, 14);
  f.tick(30);
  assert.equal(particles.credit, 0);
  f.tick(180);
  assert.equal(particles.particles.length, 0);
  assert.equal(f.frames.size, 0);
  particles.setEmitters([emitter]);
  f.tick();
  assert.ok(particles.particles.length <= 3);
  particles.dispose();
});

test("palette, bold-bright, inverse and truecolor use the rendered foreground", () => {
  const f = fixture();
  f.terminal.options.drawBoldTextInBrightColors = true;
  f.terminal.options.theme.brightRed = "#ff5555";
  f.lines[0][0] = cell("A", 1, { isFgRGB: () => false, isFgPalette: () => true });
  f.lines[0][2] = cell("B", 1, { isFgRGB: () => false, isFgPalette: () => true, isBold: () => true });
  f.lines[0][4] = cell("C", 0, { isInverse: () => true, isBgRGB: () => true, getBgColor: () => 0x00ff00 });
  const motion = new f.TerminalMotion(f.terminal);
  assert.deepEqual(Array.from(motion.emitterRows.get(0), (e) => e.color), ["#ff0000", "#ff5555", "#00ff00"]);
  motion.dispose();
});

test("particle radius and travel scale proportionally with each source font", () => {
  const radii = [];
  for (const fontSize of [10, 20, 30]) {
    const f = fixture();
    const particles = new f.TerminalParticles(f.screen);
    particles.resize(400, 100);
    particles.setEmitters([source(fontSize)]);
    particles.configure(30);
    f.tick(4);
    assert.ok(particles.particles.length > 0);
    const particle = particles.particles[0];
    assert.ok(particle.radius >= fontSize * 0.055 && particle.radius <= fontSize * 0.16);
    radii.push(particle.radius);
    particles.dispose();
  }
  assert.ok(Math.abs(radii[1] - radii[0] * 2) < 1e-12);
  assert.ok(Math.abs(radii[2] - radii[0] * 3) < 1e-12);
});

test("global budget does not grow with word count; pool and paint rate stay bounded", () => {
  const totals = [];
  for (const count of [1, 1000]) {
    const f = fixture();
    const particles = new f.TerminalParticles(f.screen);
    particles.resize(400, 100);
    particles.setEmitters(Array.from({ length: count }, () => source()));
    particles.configure(80);
    let maximum = 0;
    for (let i = 0; i < 1200; i++) {
      f.tick();
      maximum = Math.max(maximum, particles.particles.length + particles.pool.length);
    }
    assert.ok(maximum <= 160);
    totals.push(f.stats.arcs.length);
    assert.ok(particles.particles.length > 80);
    particles.dispose();
    assert.equal(f.frames.size, 0);
  }
  assert.equal(totals[0], totals[1]);
});

test("zero, blur, hidden document and no targets stop animation; focus resumes without catch-up", () => {
  const f = fixture();
  const particles = new f.TerminalParticles(f.screen);
  particles.resize(400, 100);
  particles.setEmitters([source()]);
  particles.configure(80);
  f.tick(60);
  f.focus(false);
  assert.equal(f.frames.size, 0);
  assert.equal(particles.particles.length, 0);
  f.tick(100, 1000);
  f.focus(true);
  f.tick();
  assert.ok(particles.particles.length <= 3);
  f.document.hidden = true;
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.frames.size, 0);
  f.document.hidden = false;
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.frames.size, 1);
  particles.configure(0);
  assert.equal(f.frames.size, 0);
  particles.configure(80);
  particles.setEmitters([]);
  assert.equal(f.frames.size, 0);
  particles.dispose();
});

test("disabling Motion cancels animation, releases the render listener and can be reenabled", () => {
  const f = fixture();
  f.lines[0][0] = cell("R");
  const motion = new f.TerminalMotion(f.terminal);
  f.tick(60);
  motion.setSettings(f.configuredTerminalMotionSettings({ enabled: false }));
  assert.equal(f.frames.size, 0);
  assert.equal(motion.particles.particles.length, 0);
  assert.equal(motion.renderListener, undefined);
  motion.setSettings(f.configuredTerminalMotionSettings());
  f.tick(60);
  assert.ok(motion.particles.particles.length > 0);
  motion.dispose();
});
