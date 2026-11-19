import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../src/keyboard-feedback.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
);

function fixture() {
  const animations = [];
  const styles = new Map();
  class MockNode extends EventTarget {}
  const window = new MockNode();
  const exports = {};
  runInNewContext(outputText, { exports, window, AbortController, Node: MockNode });
  const { KeyboardFeedback, configuredKeyboardFeedbackSettings: normalize } = exports;
  const terminal = new MockNode();
  const feedback = new KeyboardFeedback({ contains: (node) => node === terminal }, {
    style: { setProperty: (name, value) => styles.set(name, value) },
    animate(keyframes, options) {
      const animation = {
        keyframes: Array.from(keyframes, (frame) => ({ ...frame })),
        options: { ...options },
        currentTime: 0,
        playState: "running",
        cancel() { this.playState = "idle"; },
      };
      animations.push(animation);
      return animation;
    },
  });
  return {
    animations, styles, window, feedback, normalize,
    update(settings) { feedback.setSettings(normalize(settings)); },
    key(key, target = terminal) {
      const event = Object.assign(new Event("keydown", { cancelable: true }), { key });
      Object.defineProperty(event, "target", { value: target });
      return window.dispatchEvent(event);
    },
  };
}

test("defaults to off and normalizes intensity, hex and durations", () => {
  const { normalize } = fixture();
  assert.deepEqual({ ...normalize() }, {
    enabled: false, level: 2, color: "#78dce8", fadeInMs: 45, fadeOutMs: 320,
  });
  assert.deepEqual({ ...normalize({ enabled: true, level: 9, color: "#AbCdEf", fadeInMs: -1, fadeOutMs: 3000 }) }, {
    enabled: true, level: 5, color: "#abcdef", fadeInMs: 0, fadeOutMs: 2000,
  });
  assert.equal(normalize({ color: "red", fadeInMs: NaN }).color, "#78dce8");
  assert.equal(normalize({ fadeInMs: NaN }).fadeInMs, 45);
});

test("previews while disabled; enabled feedback observes non-printing keys without canceling input", () => {
  const f = fixture();
  f.update({ enabled: false, level: 1 });
  const soft = f.styles.get("--keyboard-feedback-strength");
  assert.equal(f.key("a"), true);
  assert.equal(f.animations.length, 0);
  f.feedback.preview();
  assert.equal(f.animations.length, 1);

  f.animations[0].playState = "finished";
  f.update({ enabled: true, level: 5, color: "#ff8080" });
  assert.ok(parseInt(f.styles.get("--keyboard-feedback-strength")) > parseInt(soft));
  assert.equal(f.styles.get("--keyboard-feedback-color"), "#ff8080");
  assert.equal(f.key("ArrowLeft", f.window), true);
  assert.equal(f.animations.length, 1);
  assert.equal(f.key("Shift"), true);
  assert.equal(f.animations.length, 2);
});

test("uses linear fades and retriggers from the current opacity without stacking pulses", () => {
  const f = fixture();
  f.update({ enabled: true, fadeInMs: 100, fadeOutMs: 400 });
  f.key("a");
  const [first] = f.animations;
  assert.deepEqual(first.options, { duration: 500, easing: "linear" });
  assert.deepEqual(first.keyframes, [
    { opacity: 0, offset: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0, offset: 1 },
  ]);
  first.currentTime = 50;
  f.key("b");
  assert.equal(f.animations.length, 1);

  first.currentTime = 300;
  f.key("c");
  const second = f.animations[1];
  assert.equal(first.playState, "idle");
  assert.equal(second.keyframes[0].opacity, 0.5);
  assert.equal(second.options.duration, 450);
});

test("handles instant phases and clears on blur, disable, and teardown", () => {
  const f = fixture();
  f.update({ enabled: true, fadeInMs: 0, fadeOutMs: 400 });
  f.key("Enter");
  assert.deepEqual(f.animations[0].keyframes, [
    { opacity: 1, offset: 0 }, { opacity: 0, offset: 1 },
  ]);
  f.window.dispatchEvent(new Event("blur"));
  assert.equal(f.animations[0].playState, "idle");

  f.update({ enabled: true, fadeInMs: 100, fadeOutMs: 0 });
  f.key("Enter");
  assert.deepEqual(f.animations[1].keyframes, [
    { opacity: 0, offset: 0 }, { opacity: 1, offset: 1 },
  ]);
  f.update({ enabled: false });
  assert.equal(f.animations[1].playState, "idle");

  f.update({ enabled: true, fadeInMs: 0, fadeOutMs: 0 });
  f.key("Enter");
  assert.equal(f.animations.length, 2);

  f.update({ enabled: true });
  f.feedback.dispose();
  f.key("Enter");
  assert.equal(f.animations.length, 2);
});
