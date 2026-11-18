import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../src/liquid-cursor.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
);

function fixture(settings = {}) {
  let now = 0;
  let nextFrame = 0;
  let path;
  let paint;
  let blink;
  let layoutReads = 0;
  const frames = new Map();
  const events = new Map();
  const handlers = new Map();
  const context = {
    save() {}, restore() {}, setTransform() {}, closePath() {},
    clearRect() { paint = null; },
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    fill() { paint = { style: "fill", path }; },
    stroke() { paint = { style: "stroke", path }; },
  };
  const canvas = { style: {}, setAttribute() {}, getContext: () => context };
  const screen = {
    width: 400,
    height: 100,
    getBoundingClientRect() {
      layoutReads++;
      return this;
    },
    append() {},
  };
  const buffer = { cursorX: 5, cursorY: 2, baseY: 0, viewportY: 0 };
  const textarea = new EventTarget();
  const terminal = {
    cols: 40,
    rows: 5,
    element: { querySelector: () => screen },
    textarea,
    buffer: { active: buffer, onBufferChange: (fn) => events.set("buffer", fn) },
    onCursorMove: (fn) => events.set("move", fn),
    onWriteParsed: (fn) => events.set("write", fn),
    onScroll: (fn) => events.set("scroll", fn),
    onResize: (fn) => events.set("resize", fn),
    parser: {
      registerCsiHandler: ({ prefix, intermediates, final }, fn) => {
        handlers.set(`${prefix ?? intermediates ?? ""}${final}`, fn);
      },
      registerEscHandler: ({ final }, fn) => handlers.set(final, fn),
    },
  };
  const scope = createContext({
    exports: {},
    document: { createElement: () => canvas },
    window: { devicePixelRatio: 1, setInterval(fn) { blink = fn; } },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  runInContext(outputText, scope);
  const { LiquidCursor, DEFAULT_LIQUID_CURSOR_SETTINGS } = scope.exports;
  const cursor = new LiquidCursor(terminal, "liquid", "#ffffff", "#ffff00", {
    ...DEFAULT_LIQUID_CURSOR_SETTINGS,
    ...settings,
  });
  function tick(ms = 16) {
    now += ms;
    for (const id of [...frames.keys()]) {
      const fn = frames.get(id);
      frames.delete(id);
      fn?.(now);
    }
  }
  textarea.dispatchEvent(new Event("focus"));
  tick();
  return {
    buffer, terminal, screen, frames, tick, cursor,
    get paint() { return paint; },
    get layoutReads() { return layoutReads; },
    emit: (name) => events.get(name)(),
    parse: (name, params = []) => handlers.get(name)(params),
    focus: (focused) => textarea.dispatchEvent(new Event(focused ? "focus" : "blur")),
    settle() {
      for (let i = 0; frames.size > 0 && i < 200; i++) tick();
      assert.equal(frames.size, 0);
      // If the cursor settled during its off phase, inspect the next blink paint.
      if (!paint) {
        now += 140;
        blink();
      }
    },
  };
}

function cell(left, top = 40, width = 10) {
  return [[left, top], [left + width, top], [left + width, top + 20], [left, top + 20]];
}

test("a confirmed one-cell move reaches the target on the first frame in either direction", () => {
  const f = fixture({ animationLength: 500 });
  assert.deepEqual(f.paint.path, cell(50));
  f.buffer.cursorX = 6;
  f.emit("move");
  f.emit("write");
  assert.equal(f.frames.size, 1);
  assert.deepEqual(f.paint.path, cell(50));
  f.tick(0);
  assert.deepEqual(f.paint.path.slice(1, 3), [[70, 40], [70, 60]]);
  assert.equal(f.frames.size, 1, "only the trail needs another frame");
  const rear = f.paint.path[0][0];
  assert.ok(rear >= 50 && rear < 60);
  f.tick();
  assert.ok(f.paint.path[0][0] > rear, "the rear edge catches up");
  assert.equal(f.paint.path[1][0], 70, "the front stays in the confirmed cell");

  f.buffer.cursorX = 5;
  f.emit("write");
  assert.equal(f.frames.size, 1, "a running animation also consumes the new target");
  f.tick();
  assert.deepEqual([f.paint.path[0], f.paint.path[3]], [[50, 40], [50, 60]]);
  assert.ok(f.paint.path[1][0] > 60 && f.paint.path[1][0] <= 70);
  f.tick();
  assert.equal(f.paint.path[0][0], 50);
  assert.ok(f.paint.path[1][0] < 70);
  f.settle();
  assert.deepEqual(f.paint.path, cell(50));
});

test("repeated short moves keep the trail within one step of the confirmed cell", () => {
  const f = fixture({ animationLength: 500 });
  for (let col = 6; col <= 20; col++) {
    f.buffer.cursorX = col;
    f.emit("move");
    f.tick(8);
    assert.equal(f.paint.path[1][0], (col + 1) * 10);
    assert.ok(f.paint.path[0][0] >= (col - 1) * 10 && f.paint.path[0][0] < col * 10);
  }
});

test("typing feedback never moves the cursor without a confirmed buffer change", () => {
  const f = fixture({ typingOverlay: true });
  f.cursor.pulseTyping();
  f.emit("write");
  f.tick();
  assert.deepEqual(f.paint.path, cell(50));
  f.settle();
  assert.deepEqual(f.paint.path, cell(50));
});

test("writes coalesce to the latest position and a jump already animates on its first frame", () => {
  const f = fixture({ animationLength: 250, trailSize: 0 });
  const layoutReads = f.layoutReads;
  f.buffer.cursorX = 35;
  f.emit("move");
  f.buffer.cursorX = 18;
  f.emit("move");
  f.emit("write");
  assert.equal(f.frames.size, 1);
  f.tick();
  assert.equal(f.layoutReads, layoutReads + 1);
  assert.ok(f.paint.path[1][0] > 60 && f.paint.path[1][0] < 190);
  f.settle();
  assert.deepEqual(f.paint.path, cell(180));
});

test("instant short moves retain their configurable distance and trail delay", () => {
  const f = fixture({ instantShortMoves: true, instantShortMoveDistance: 2 });
  f.buffer.cursorX = 7;
  f.emit("move");
  f.tick();
  assert.deepEqual(f.paint.path, cell(50, 40, 30));
  f.tick(29);
  assert.deepEqual(f.paint.path, cell(50, 40, 30));
  f.tick(11);
  assert.deepEqual(f.paint.path, cell(70));
  assert.equal(f.frames.size, 0);
});

test("turning off the trail places the whole cursor on the first frame", () => {
  const f = fixture({ trailSize: 0 });
  f.buffer.cursorX = 6;
  f.emit("move");
  f.tick();
  assert.deepEqual(f.paint.path, cell(60));
  assert.equal(f.frames.size, 0);
});

test("focus and layout changes snap, and the cursor is cleared outside the viewport", () => {
  const f = fixture();
  f.focus(false);
  f.buffer.cursorX = 6;
  f.emit("move");
  f.tick();
  assert.deepEqual(f.paint, { style: "stroke", path: cell(60) });
  f.focus(true);
  f.buffer.cursorX = 7;
  f.emit("move");
  f.tick();
  assert.deepEqual(f.paint, { style: "fill", path: cell(70) });

  f.buffer.baseY = 10;
  f.emit("scroll");
  f.tick();
  assert.equal(f.paint, null);
  f.buffer.viewportY = 10;
  f.screen.width = 800;
  f.emit("scroll");
  f.emit("resize");
  f.tick();
  assert.deepEqual(f.paint.path, cell(140, 40, 20));

  f.terminal.buffer.active = { ...f.buffer, cursorY: 3, cursorX: 8 };
  f.emit("buffer");
  f.emit("write");
  f.tick();
  assert.deepEqual(f.paint.path, cell(160, 60, 20));
  assert.equal(f.frames.size, 0);
});

test("DECTCEM cancels paint while hidden and uses the latest parsed position when shown", () => {
  const f = fixture();
  f.buffer.cursorX = 6;
  f.emit("move");
  f.parse("?l", [25]);
  assert.equal(f.paint, null);
  assert.equal(f.frames.size, 0);
  f.tick();
  assert.equal(f.paint, null);

  f.buffer.cursorX = 8;
  f.parse("?h", [25]);
  f.buffer.cursorX = 6;
  f.emit("write");
  f.tick();
  assert.deepEqual(f.paint.path.slice(1, 3), [[70, 40], [70, 60]]);

  f.parse("?l", [25]);
  f.parse("c");
  f.buffer.cursorX = 12;
  f.emit("write");
  f.tick();
  assert.deepEqual(f.paint.path, cell(120));
  assert.equal(f.frames.size, 0);
});
