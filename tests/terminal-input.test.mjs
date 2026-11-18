import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

// Substitute Vite's production flag before loading the frontend script in the VM.
const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8").replaceAll("import.meta.env.DEV", "false");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

// Register the real xterm handlers against a stubbed IPC bridge and minimal DOM.
function fixture() {
  const order = [];
  const writes = [];
  const events = new Map();
  const error = { hidden: true };
  const hud = { status: "ready", element: {
    dataset: {}, querySelector() {},
    querySelectorAll() { order.push("hud"); return []; },
  } };
  let sessionId = 0;
  const terminal = {
    cols: 80, rows: 24,
    parser: { registerOscHandler() {} },
    onTitleChange() {}, onResize() {}, attachCustomKeyEventHandler() {}, focus() {},
    onData(handler) { this.data = handler; },
    onBinary(handler) { this.binary = handler; },
  };
  const appWindow = {
    async onCloseRequested() {},
    setTitle() { order.push("title"); },
  };
  const scope = createContext({
    exports: {}, TextEncoder, terminal, hud,
    inputShadow: { show() { order.push("shadow"); } },
    liquidCursor: { pulseTyping() { order.push("cursor"); } },
    terminalMotion: { pulseTyping() { order.push("motion"); } },
    fitAddon: { fit() {} },
    ResizeObserver: class { observe() {} },
    window: new EventTarget(),
    document: {
      documentElement: { dataset: {} },
      querySelector: (selector) => selector === "#terminal-error" ? error : {
        classList: { add() {}, remove() {} }, addEventListener() {},
      },
    },
    require(name) {
      switch (name) {
        case "@tauri-apps/api/core": return {
          Channel: class {},
          invoke(command, bytes) {
            if (command === "get_config") return new Promise(() => {}); // Pause unrelated app bootstrap.
            if (command === "start_terminal") return Promise.resolve({ sessionId: ++sessionId, outputMode: "channel" });
            assert.equal(command, "write_terminal");
            assert.equal(Object.prototype.toString.call(bytes), "[object ArrayBuffer]");
            order.push("write");
            return new Promise((resolve, reject) => {
              writes.push({ bytes: [...new Uint8Array(bytes)], resolve, reject });
            });
          },
        };
        case "@tauri-apps/api/window": return { getCurrentWindow: () => appWindow };
        case "@tauri-apps/api/event": return { async listen(event, handler) { events.set(event, handler); } };
        case "./terminal-output": return { async prepareSharedTerminalOutput() {} };
        default: return {};
      }
    },
  });
  runInContext(outputText, scope);
  runInContext("setupTerminal(terminal, fitAddon, liquidCursor, inputShadow, terminalMotion)", scope);
  return {
    terminal, order, writes, error, hud,
    connect: () => runInContext("connectTerminal(terminal, inputShadow)", scope),
    enableHud: () => runInContext("activeHud = hud; acceptingShellCommand = true", scope),
    exit: () => events.get("terminal:exit")({ payload: { sessionId } }),
    payloads: () => writes.map(({ bytes }) => bytes),
  };
}

test("idle input invokes IPC before typing effects, title and HUD, and does so again after draining", async () => {
  const f = fixture();
  await f.connect();
  f.enableHud();
  f.terminal.data("é\r");
  assert.deepEqual(f.order, ["write", "cursor", "shadow", "motion", "title", "hud"]);
  assert.deepEqual(f.payloads(), [[0xc3, 0xa9, 13]]);
  assert.equal(f.hud.element.dataset.status, "running");

  f.writes[0].resolve();
  await setImmediate();
  f.order.length = 0;
  f.terminal.data("x");
  assert.deepEqual(f.order, ["write", "cursor", "shadow", "motion"]);
  f.writes[1].resolve();
});

test("text and binary share a FIFO while effects stay responsive and errors do not stall writes", async () => {
  const f = fixture();
  await f.connect();
  f.terminal.data("A");
  f.terminal.binary("\x00\xff");
  f.terminal.data("B");
  assert.deepEqual(f.order, ["write", "cursor", "shadow", "motion", "cursor", "shadow", "motion"]);
  assert.deepEqual(f.payloads(), [[65]]);

  f.writes[0].reject(new Error("write failed"));
  await setImmediate();
  assert.equal(f.error.textContent, "Could not send data to the terminal: Error: write failed");
  assert.equal(f.error.hidden, false);
  assert.deepEqual(f.payloads(), [[65], [0, 255]]);

  f.writes[1].resolve();
  await setImmediate();
  assert.deepEqual(f.payloads(), [[65], [0, 255], [66]]);
  f.writes[2].resolve();
});

test("a new session discards queued old input without overtaking an in-flight write", async () => {
  const f = fixture();
  await f.connect();
  f.terminal.data("A");
  f.terminal.data("stale");
  f.exit();
  f.terminal.data("inactive");
  await f.connect();
  f.terminal.data("N");
  assert.deepEqual(f.payloads(), [[65]]);

  f.writes[0].resolve();
  await setImmediate();
  assert.deepEqual(f.payloads(), [[65], [78]]);
  f.writes[1].resolve();
});
