import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Exercise the actual TS modules with a deterministic canvas/RAF, without adding dependencies.
function fixture(webgl = null) {
  const frames = new Map();
  let nextFrame = 0;
  let now = 0;
  let focused = true;
  const stats = { arcs: [], reads: 0, clears: [], transforms: [], warnings: [], text: [] };
  const context2d = () => ({
    fillStyle: "#ffffff", globalAlpha: 1,
    setTransform(...args) { stats.transforms.push(args); },
    clearRect(...args) { stats.clears.push(args); },
    save() {}, restore() {}, beginPath() {},
    rect() {}, clip() {}, fill() {}, stroke() {},
    fillText(...args) { stats.text.push(args); },
    arc(x, y, radius) { stats.arcs.push({ x, y, radius }); },
  });
  class Element extends EventTarget {
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
    getContext(kind) {
      if (kind === "webgl2" && webgl) {
        this.hasWebgl = true;
        return webgl;
      }
      return kind === "2d" && !this.hasWebgl ? context2d() : null;
    }
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
    console: { warn: (...args) => stats.warnings.push(args) },
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
  const webglModule = load("../src/terminal-particles-webgl.ts");
  const particlesModule = load("../src/terminal-particles.ts", { "./terminal-particles-webgl": webglModule });
  const glowModule = load("../src/terminal-glow-webgl.ts");
  const motionModule = load("../src/terminal-motion.ts", {
    "./terminal-particles": particlesModule, "./terminal-glow-webgl": glowModule,
  });
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

test("focus requirement defaults on and accepts only booleans", () => {
  const f = fixture();
  assert.equal(f.configuredTerminalMotionSettings().particlesRequireFocus, true);
  assert.equal(f.configuredTerminalMotionSettings({ particlesRequireFocus: false }).particlesRequireFocus, false);
  assert.equal(f.configuredTerminalMotionSettings({ particlesRequireFocus: "false" }).particlesRequireFocus, true);
});

test("HUD text crossing a grid edge still emits from its visible portion", () => {
  const f = fixture();
  const ink = f.document.createElement("span");
  ink.textContent = "long-directory";
  ink.computed = { color: "#00ff00", fontSize: "14px" };
  ink.getBoundingClientRect = () => ({ top: -2, bottom: 18, left: -5, right: 450, width: 455, height: 20 });
  f.screen.querySelectorAll = () => [ink];
  const motion = new f.TerminalMotion(f.terminal);
  f.tick();
  assert.equal(motion.hudEmitters.length, 1);
  assert.equal(motion.hudEmitters[0].x, 0);
  assert.equal(motion.hudEmitters[0].width, 400);
  assert.equal(motion.hudEmitters[0].y, 18 * 0.65);
  ink.getBoundingClientRect = () => ({ top: -30, bottom: -10, left: 0, right: 50, width: 50, height: 20 });
  assert.equal(motion.readHudEmitters().length, 0);
  motion.dispose();
});

test("padded canvas draws and clears bubbles outside the grid without shifting emitters", () => {
  const f = fixture();
  const particles = new f.TerminalParticles(f.screen);
  particles.resize(400, 100);
  particles.setEmitters([{ ...source(), y: 2 }]);
  particles.configure(30);
  f.tick(30);
  assert.equal(particles.canvas.style.width, "528px");
  assert.equal(particles.canvas.style.height, "228px");
  assert.equal(particles.canvas.width, 792);
  assert.equal(particles.canvas.height, 342);
  assert.equal(particles.canvas.style.transform, "translate(-64px, -64px)");
  assert.deepEqual(f.stats.transforms[0], [1.5, 0, 0, 1.5, 96, 96]);
  assert.ok(f.stats.arcs.some(({ y }) => y < 0));
  assert.deepEqual(f.stats.clears.at(-1), [-64, -64, 528, 228]);
  particles.dispose();
});

test("optional window focus requirement preserves bubbles on blur and still pauses when hidden", () => {
  const f = fixture();
  f.lines[0][0] = cell("R");
  const settings = f.configuredTerminalMotionSettings({ particlesRequireFocus: false });
  const motion = new f.TerminalMotion(f.terminal, settings);
  f.tick(30);
  const bubble = motion.particles.particles[0];
  f.focus(false);
  assert.ok(motion.particles.particles.includes(bubble));
  f.tick(10);
  assert.ok(motion.particles.particles.includes(bubble));
  assert.ok(f.frames.size > 0);
  motion.setSettings({ ...settings, particlesRequireFocus: true });
  assert.equal(motion.particles.particles.length, 0);
  f.tick(); // Drain the one-shot emitter refresh; no animation loop should remain.
  assert.equal(f.frames.size, 0);
  motion.setSettings(settings);
  f.tick(30);
  assert.ok(motion.particles.particles.length > 0);
  f.document.hidden = true;
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(motion.particles.particles.length, 0);
  assert.equal(f.frames.size, 0);
  f.document.hidden = false;
  f.document.dispatchEvent(new Event("visibilitychange"));
  f.tick(30);
  assert.ok(motion.particles.particles.length > 0);
  motion.dispose();
});

function fakeWebgl({ compile = true } = {}) {
  const calls = { allocations: [], uploads: [], draws: [], viewport: [], deleted: [], losses: 0 };
  const gl = {
    calls, lost: false,
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, DYNAMIC_DRAW: 6, FLOAT: 7, BLEND: 8, ONE: 9,
    ONE_MINUS_SRC_ALPHA: 10, TRIANGLE_STRIP: 11, COLOR_BUFFER_BIT: 12,
    createProgram: () => ({}), createShader: () => ({}), createBuffer: () => ({}),
    createVertexArray: () => ({}), getUniformLocation: () => ({}),
    shaderSource() {}, compileShader() {}, getShaderParameter: () => compile,
    getShaderInfoLog: () => "test compilation failure", attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, detachShader() {}, deleteShader() {},
    useProgram() {}, bindVertexArray() {}, bindBuffer() {}, enableVertexAttribArray() {},
    vertexAttribPointer() {}, vertexAttribDivisor() {}, clearColor() {}, enable() {},
    blendFunc() {}, uniform1f() {}, uniform2f() {}, clear() {},
    viewport(...args) { calls.viewport.push(args); },
    bufferData(_target, bytes) { calls.allocations.push(bytes); },
    bufferSubData(_target, _byteOffset, data, offset, length) {
      calls.uploads.push(Array.from(data.slice(offset, offset + length)));
    },
    drawArraysInstanced(_mode, _first, vertices, count) { calls.draws.push({ vertices, count }); },
    deleteVertexArray() { calls.deleted.push("vao"); },
    deleteBuffer() { calls.deleted.push("buffer"); },
    deleteProgram() { calls.deleted.push("program"); },
    isContextLost() { return this.lost; },
    getExtension: () => ({ loseContext() { calls.losses++; } }),
  };
  return gl;
}

test("WebGL uses one bounded instance buffer and one draw per frame; stable batches are not uploaded again", () => {
  const gl = fakeWebgl();
  const f = fixture(gl);
  const particles = new f.TerminalParticles(f.screen);
  particles.resize(400, 100);
  particles.setEmitters([source()]);
  assert.equal(f.screen.children.length, 0, "an idle effect needs no GL context");
  particles.configure(80);
  f.tick();
  assert.deepEqual(gl.calls.allocations, [160 * 12 * 4]);
  assert.deepEqual(gl.calls.viewport, [[0, 0, 792, 342]]);
  assert.deepEqual(gl.calls.draws, [{ vertices: 4, count: 2 }]);
  assert.equal(gl.calls.uploads[0].length, 24);
  assert.deepEqual(gl.calls.uploads[0].slice(0, 2), [99, 144]);
  assert.deepEqual(gl.calls.uploads[0].slice(9, 12), [1, 0, 0]);
  assert.equal(f.stats.arcs.length, 0);
  particles.setEmitters([]);
  f.tick(30);
  assert.ok(gl.calls.draws.length > 1);
  assert.equal(gl.calls.uploads.length, 1);
  f.tick(120);
  assert.equal(f.frames.size, 0);
  const canvas = particles.canvas;
  particles.configure(0);
  assert.equal(canvas.removed, true);
  assert.deepEqual(gl.calls.deleted, ["vao", "buffer", "program"]);
  assert.equal(gl.calls.losses, 1);
  particles.dispose();
});

test("a shader compile failure falls back to a fresh Canvas 2D surface", () => {
  const gl = fakeWebgl({ compile: false });
  const f = fixture(gl);
  const particles = new f.TerminalParticles(f.screen);
  particles.resize(400, 100);
  particles.setEmitters([source()]);
  particles.configure(80);
  f.tick(8);
  assert.equal(f.stats.warnings.length, 1);
  assert.equal(gl.calls.losses, 1);
  assert.equal(particles.canvas.hasWebgl, undefined);
  assert.ok(f.stats.arcs.length > 0);
  particles.dispose();
});

test("WebGL context loss switches to Canvas 2D without resetting live particles", () => {
  const gl = fakeWebgl();
  const f = fixture(gl);
  const particles = new f.TerminalParticles(f.screen);
  particles.resize(400, 100);
  particles.setEmitters([source()]);
  particles.configure(80);
  f.tick();
  const canvas = particles.canvas;
  const bubble = particles.particles[0];
  gl.lost = true;
  canvas.dispatchEvent(new Event("webglcontextlost"));
  assert.equal(canvas.removed, true);
  const draws = gl.calls.draws.length;
  f.tick(8);
  assert.equal(gl.calls.draws.length, draws);
  assert.ok(particles.particles.includes(bubble));
  assert.ok(f.stats.arcs.length > 0);
  assert.equal(gl.calls.losses, 0);
  particles.dispose();
});

test("glow caches identical runs and repaints changes, erasures and font changes in CSS fallback", () => {
  const f = fixture();
  f.lines[0][0] = cell("A");
  f.lines[2][0] = cell("B");
  const motion = new f.TerminalMotion(f.terminal, { particleCount: 0 });
  assert.equal(motion.glow, undefined);
  assert.equal(f.stats.text.length, 2);
  f.render(0, 4);
  assert.equal(f.stats.text.length, 2);
  f.lines[2][0] = cell("B", 0x00ff00);
  f.render(2);
  assert.equal(f.stats.text.length, 3);
  f.lines[0][0] = cell(" ");
  f.render(0);
  assert.deepEqual(f.stats.clears.at(-1), [0, 0, 400, 20]);
  f.terminal.options.fontFamily = "Consolas";
  f.render(0);
  assert.equal(f.stats.text.length, 4);
  motion.dispose();
});

function fakeGlowWebgl() {
  const gl = fakeWebgl();
  let skip = 0;
  const calls = { draws: 0, uploads: [], textures: [], scissors: [] };
  return Object.assign(gl, {
    glowCalls: calls, TEXTURE_2D: 20, FRAMEBUFFER: 21, MAX_TEXTURE_SIZE: 22,
    FRAMEBUFFER_COMPLETE: 23, NO_ERROR: 0, UNPACK_SKIP_ROWS: 24,
    createTexture: () => ({}), createFramebuffer: () => ({}),
    getParameter: () => 4096, getError: () => 0, checkFramebufferStatus: () => 23,
    bindTexture() {}, texParameteri() {}, bindFramebuffer() {}, framebufferTexture2D() {},
    deleteFramebuffer() {}, deleteTexture() {}, uniform1i() {}, disable() {},
    scissor(...args) { calls.scissors.push(args); },
    texImage2D(_target, _level, _internalFormat, width, height) { calls.textures.push([width, height]); },
    pixelStorei(parameter, value) { if (parameter === this.UNPACK_SKIP_ROWS) skip = value; },
    texSubImage2D(_target, _level, _x, y, width, height) { calls.uploads.push({ y, width, height, skip }); },
    drawArrays() { calls.draws++; },
  });
}

test("GPU glow redraws only on mask changes, updates only the dirty strip and restores CSS after context loss", () => {
  const gl = fakeGlowWebgl();
  const f = fixture(gl);
  f.lines[2][0] = cell("A");
  const motion = new f.TerminalMotion(f.terminal, { particleCount: 0 });
  assert.equal(motion.canvas.style.visibility, "hidden");
  assert.deepEqual(gl.glowCalls.textures, [[248, 98], [124, 49]]);
  assert.deepEqual(gl.glowCalls.uploads, [{ y: 24, width: 200, height: 50, skip: 0 }]);
  assert.equal(gl.glowCalls.draws, 2);
  f.render(1, 3);
  assert.equal(gl.glowCalls.draws, 2);
  f.lines[2][0] = cell("B");
  f.render(2);
  assert.deepEqual(gl.glowCalls.uploads.at(-1), { y: 44, width: 200, height: 10, skip: 20 });
  assert.deepEqual(gl.glowCalls.scissors.at(-1), [0, 21, 124, 7]);
  assert.equal(gl.glowCalls.draws, 4);
  f.screen.clientHeight = 120;
  assert.equal(motion.resize(), true);
  f.render(2);
  assert.deepEqual(gl.glowCalls.uploads.at(-1), { y: 24, width: 200, height: 60, skip: 0 });
  const canvas = motion.glow.canvas;
  gl.lost = true;
  canvas.dispatchEvent(new Event("webglcontextlost"));
  assert.equal(canvas.removed, true);
  assert.equal(motion.canvas.style.visibility, "");
  assert.equal(motion.glow, undefined);
  f.lines[2][0] = cell("C");
  f.render(2);
  assert.equal(f.stats.text.at(-1)[0].trim(), "C");
  motion.dispose();
});
