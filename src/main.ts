import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type IMarker } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { InputShadow } from "./input-shadow";
import {
  DEFAULT_LIQUID_CURSOR_SETTINGS,
  LiquidCursor,
  type CursorAnimation,
  type LiquidCursorSettings,
} from "./liquid-cursor";
import { notify as sendSystemNotification } from "./notifications";
import { builtinThemes, type TerminalTheme } from "./themes";
import "./styles.css";

interface AppConfig {
  shell: string;
  startDirectory: string;
  fontSize: number;
  fontFamily: string;
  theme: unknown;
  uiThemeName?: string;
  cursorAnimation?: CursorAnimation;
  liquidCursor?: Partial<LiquidCursorSettings>;
}

interface LiquidCursorConfigChanged {
  sourceWindow: string;
  cursorAnimation: CursorAnimation;
  liquidCursor: LiquidCursorSettings;
}

interface TerminalSize {
  cols: number;
  rows: number;
}

interface TerminalStarted {
  sessionId: number;
}

interface TerminalExit {
  sessionId: number;
}

interface TerminalError {
  sessionId: number;
  message: string;
}

interface GitContext {
  branch: string;
  user: string;
}

type MenuAction =
  | "new-window"
  | "new-window-here"
  | "close-app"
  | "open-config"
  | "copy"
  | "paste"
  | "select-all"
  | "set-theme"
  | "set-ui-theme"
  | "open-liquid-cursor"
  | "toggle-devtools"
  | "about";

interface MenuItem {
  label?: string;
  action?: MenuAction;
  hint?: string;
  separator?: true;
  disabled?: boolean;
  theme?: TerminalTheme;
  uiThemeName?: string;
  checked?: boolean;
}

const appWindow = getCurrentWindow();
const terminalElement = requiredElement("#terminal");
const terminalContainer = requiredElement("#terminal-container");
const errorElement = requiredElement("#terminal-error");
const menuPopup = requiredElement("#menu-popup");
const windowHoverOverlay = requiredElement("#window-hover-overlay");
const windowHoverTitle = requiredElement("#window-hover-title");
const titlebarTitle = requiredElement("#titlebar-title");

let activeSessionId: number | null = null;
let currentCwd = "";
let pendingExitCode = 0;
let inputBuffer = "";
let lastCommand = "";
let shellTitle: string | null = null;
let currentWindowTitle = "pnex";
let oscProgressRunning = false;
let titleProgressRunning = false;
let terminalRunning = false;
let terminalRunningStateVersion = 0;
let lastTitleProgressFrame: string | null = null;
let lastTitleProgressFrameAt = 0;
let titleProgressTimer: number | null = null;
let isWindowFocused = true;
let isPointerInsideWindow = false;
let isWindowHoverArmed = false;
let inEscapeSequence = false;
let activeHud: PromptHud | null = null;
let focusedHud: PromptHud | null = null;
let selectionShimmerId = 0;
let terminalRevealed = false;
let liquidCursorSaveQueue = Promise.resolve();
let closingAfterCursorSave = false;
const promptHuds: PromptHud[] = [];

interface PromptHud {
  cwd: string;
  gitBranch: string;
  gitUser: string;
  exitCode: number;
  status: "ready" | "running" | "success" | "error";
  commandStartedAt: Date | null;
  commandEndedAt: Date | null;
  marker: IMarker;
  element: HTMLElement;
  disposed: boolean;
}

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

function dismissLoadingScreen(): void {
  const screen = document.querySelector<HTMLElement>("#loading-screen");
  if (!screen) return;

  screen.classList.add("loading-screen-dismissed");
  screen.addEventListener("transitionend", () => screen.remove(), { once: true });
}

function revealTerminal(): void {
  if (terminalRevealed) return;
  terminalRevealed = true;
  terminalContainer.classList.add("terminal-revealed");
}

function setupLoadingScreenDragging(): void {
  const loadingScreen = document.querySelector<HTMLElement>("#loading-screen");
  if (!loadingScreen) return;

  loadingScreen.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;

    void appWindow.startDragging().catch((error: unknown) => {
      showError(`Não foi possível mover a janela: ${String(error)}`);
    });
  });
}

function showError(message: string): void {
  errorElement.textContent = message;
  errorElement.hidden = false;
}

function clearError(): void {
  errorElement.hidden = true;
  errorElement.textContent = "";
}

function applyUiTheme(name?: string): void {
  // ponytail: one built-in HUD is enough until a second design exists.
  document.documentElement.dataset.uiTheme = name === "Default Theme" ? name : "Default Theme";
}

function updateTerminalRunningState(): void {
  const running = oscProgressRunning || titleProgressRunning;
  document.documentElement.dataset.terminalRunning = String(running);
  if (running === terminalRunning) return;

  terminalRunning = running;
  const stateVersion = ++terminalRunningStateVersion;
  if (running) return;

  queueMicrotask(() => {
    if (terminalRunning || stateVersion !== terminalRunningStateVersion || isWindowFocused) return;

    const title = currentWindowTitle;
    void sendSystemNotification({
      title,
      body: "Terminal processing has stopped.",
      activateWindowOnClick: true,
    }).catch((error: unknown) => {
      console.warn("Could not show terminal completion notification.", error);
    });
  });
}

function clearTitleProgress(): void {
  if (titleProgressTimer !== null) window.clearTimeout(titleProgressTimer);
  titleProgressTimer = null;
  titleProgressRunning = false;
  lastTitleProgressFrame = null;
  lastTitleProgressFrameAt = 0;
  updateTerminalRunningState();
}

function trackAgentTitleProgress(title: string): void {
  // Codex emits successive braille frames in its OSC 0 title every 100 ms while pending.
  const frame = title.match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u)?.[0] ?? null;
  if (frame === null) {
    clearTitleProgress();
    return;
  }

  const now = performance.now();
  if (lastTitleProgressFrame !== null
    && frame !== lastTitleProgressFrame
    && now - lastTitleProgressFrameAt <= 500) {
    titleProgressRunning = true;
    updateTerminalRunningState();
  }
  lastTitleProgressFrame = frame;
  lastTitleProgressFrameAt = now;

  if (titleProgressTimer !== null) window.clearTimeout(titleProgressTimer);
  titleProgressTimer = window.setTimeout(clearTitleProgress, 500);
}

function animateTitlebarTitle(): void {
  titlebarTitle.classList.remove("titlebar-title-enter");
  void titlebarTitle.offsetWidth;
  titlebarTitle.classList.add("titlebar-title-enter");
}

function setWindowTitle(title: string): void {
  const changed = titlebarTitle.textContent !== title;
  currentWindowTitle = title;
  windowHoverTitle.textContent = title;
  titlebarTitle.textContent = title;
  if (!changed) return;

  animateTitlebarTitle();
  void appWindow.setTitle(title);
}

function updateWindowTitle(isRunning = false): void {
  if (shellTitle !== null) {
    setWindowTitle(shellTitle);
    return;
  }

  const normalized = currentCwd.replace(/\\/g, "/").replace(/\/$/, "");
  const folder = normalized.slice(normalized.lastIndexOf("/") + 1);
  const base = folder ? `${folder} — pnex` : "pnex";
  const title = isRunning && lastCommand
    ? `● ${lastCommand} [${folder || "~"}] — pnex`
    : isRunning ? `● ${base}` : base;
  setWindowTitle(title);
}

function updateWindowHoverOverlay(): void {
  windowHoverTitle.textContent = currentWindowTitle;
  windowHoverOverlay.hidden = !isWindowHoverArmed || isWindowFocused || !isPointerInsideWindow;
}

async function setupWindowHoverOverlay(): Promise<void> {
  document.body.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    isPointerInsideWindow = true;
    updateWindowHoverOverlay();
  });
  document.body.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    isPointerInsideWindow = false;
    // Do not treat the pointer already inside a newly focused window as hover.
    // A leave followed by a new entry is an intentional hover.
    isWindowHoverArmed = true;
    updateWindowHoverOverlay();
  });

  await appWindow.onFocusChanged(({ payload: focused }) => {
    isWindowFocused = focused;
    updateWindowHoverOverlay();
  });
  isWindowFocused = await appWindow.isFocused();
  updateWindowHoverOverlay();
}

function createTerminal(config: AppConfig): {
  terminal: Terminal;
  fitAddon: FitAddon;
  liquidCursor: LiquidCursor;
  inputShadow: InputShadow;
} {
  const theme = configuredTheme(config.theme);
  const cursorAnimation = configuredCursorAnimation(config.cursorAnimation);
  const liquidCursorSettings = configuredLiquidCursorSettings(config.liquidCursor);
  config.cursorAnimation = cursorAnimation;
  config.liquidCursor = liquidCursorSettings;
  applyTheme(theme);
  document.documentElement.style.setProperty("--terminal-font-family", config.fontFamily);
  document.documentElement.style.setProperty("--terminal-font-size", `${config.fontSize}px`);
  const terminal = new Terminal({
    allowProposedApi: true,
    allowTransparency: true,
    cursorBlink: cursorAnimation === "disabled",
    cursorInactiveStyle: cursorAnimation === "disabled" ? "outline" : "none",
    cursorStyle: "block",
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    scrollback: 2_000,
    theme: toXtermTheme(theme, cursorAnimation),
  });
  const fitAddon = new FitAddon();

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  terminal.open(terminalElement);
  const liquidCursor = new LiquidCursor(
    terminal,
    cursorAnimation,
    theme.cursor,
    theme.brightBlue,
    liquidCursorSettings,
  );
  const inputShadow = new InputShadow(terminal, liquidCursorSettings);
  setupSelectionShimmer(terminal);
  loadWebglRenderer(terminal);
  return { terminal, fitAddon, liquidCursor, inputShadow };
}

function setupSelectionShimmer(terminal: Terminal): void {
  const terminalHost = terminal.element;
  const screen = terminalHost?.querySelector<HTMLElement>(".xterm-screen");
  if (!terminalHost || !screen) return;

  const id = `selection-shimmer-${selectionShimmerId++}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("selection-shimmer");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("hidden", "");
  svg.innerHTML = `
    <defs>
      <linearGradient id="${id}-gradient">
        <stop offset="0" stop-opacity="0" />
        <stop class="selection-shimmer-highlight" offset="50%" stop-opacity="0.55" />
        <stop offset="100%" stop-opacity="0" />
      </linearGradient>
      <clipPath id="${id}-clip" clipPathUnits="userSpaceOnUse">
        <path shape-rendering="crispEdges" />
      </clipPath>
    </defs>
    <g clip-path="url(#${id}-clip)">
      <rect class="selection-shimmer-sweep" x="-70%" width="70%" height="100%" fill="url(#${id}-gradient)" />
      <rect class="selection-shimmer-sweep selection-shimmer-sweep-offset" x="-70%" width="70%" height="100%" fill="url(#${id}-gradient)" />
    </g>
  `;
  const path = svg.querySelector("clipPath path");
  if (!path) return;

  const tooltip = document.createElement("div");
  const tooltipLabel = document.createElement("span");
  tooltip.className = "selection-copy-tooltip";
  tooltipLabel.textContent = "ctrl+intert";
  tooltip.append(tooltipLabel);
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.hidden = true;
  screen.append(svg, tooltip);

  let frame = 0;
  let copied = false;
  let copiedTimer = 0;
  let columnSelection = false;
  let controlPressed = false;
  const render = (): void => {
    frame = 0;
    const range = terminal.getSelectionPosition();
    const width = screen.clientWidth;
    const height = screen.clientHeight;
    if ((!controlPressed && !copied) || !range || !width || !height) {
      svg.setAttribute("hidden", "");
      tooltip.hidden = true;
      return;
    }

    const viewportY = terminal.buffer.active.viewportY;
    const firstRow = Math.max(range.start.y, viewportY);
    const lastRow = Math.min(range.end.y, viewportY + terminal.rows - 1);
    const cellWidth = width / terminal.cols;
    const cellHeight = height / terminal.rows;
    const columnStart = Math.min(range.start.x, range.end.x);
    const columnEnd = Math.max(range.start.x, range.end.x);
    const segments: string[] = [];
    let anchorX = 0;
    let anchorY = 0;

    for (let row = firstRow; row <= lastRow; row++) {
      const start = Math.max(0, columnSelection ? columnStart : row === range.start.y ? range.start.x : 0);
      const end = Math.min(terminal.cols, columnSelection ? columnEnd : row === range.end.y ? range.end.x : terminal.cols);
      if (end <= start) continue;

      const x = start * cellWidth;
      const y = (row - viewportY) * cellHeight;
      const segmentWidth = (end - start) * cellWidth;
      if (segments.length === 0) {
        anchorX = x;
        anchorY = y;
      }
      segments.push(`M${x} ${y}h${segmentWidth}v${cellHeight}h-${segmentWidth}Z`);
    }

    const visible = segments.length > 0;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    path.setAttribute("d", segments.join(""));
    svg.toggleAttribute("hidden", !visible);
    tooltip.hidden = !visible;
    if (!visible) return;

    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const gap = 4;
    const top = anchorY >= tooltipHeight + gap
      ? anchorY - tooltipHeight - gap
      : Math.min(height - tooltipHeight, anchorY + cellHeight + gap);
    tooltip.style.left = `${Math.max(0, Math.min(anchorX, width - tooltipWidth))}px`;
    tooltip.style.top = `${Math.max(0, top)}px`;
  };
  const scheduleRender = (): void => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  const setControlPressed = (pressed: boolean): void => {
    if (controlPressed === pressed) return;
    controlPressed = pressed;
    scheduleRender();
  };

  terminalHost.addEventListener("pnex:copied", () => {
    copied = true;
    tooltipLabel.textContent = "copied!";
    tooltip.classList.remove("selection-copy-tooltip-copied");
    void tooltip.offsetWidth;
    tooltip.classList.add("selection-copy-tooltip-copied");
    scheduleRender();
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copied = false;
      tooltipLabel.textContent = "ctrl+intert";
      tooltip.classList.remove("selection-copy-tooltip-copied");
      scheduleRender();
    }, 1_000);
  });

  screen.addEventListener("mousedown", (event) => {
    columnSelection = event.altKey && event.detail === 1;
    setControlPressed(event.ctrlKey);
  }, { capture: true });
  terminal.textarea?.addEventListener("keydown", () => {
    columnSelection = false;
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Control") setControlPressed(true);
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Control") setControlPressed(false);
  });
  window.addEventListener("blur", () => setControlPressed(false));
  terminal.onSelectionChange(scheduleRender);
  terminal.onScroll(scheduleRender);
  terminal.onResize(scheduleRender);
}

function loadWebglRenderer(terminal: Terminal): void {
  let webglAddon: WebglAddon | undefined;
  try {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => webglAddon?.dispose());
    terminal.loadAddon(webglAddon);
  } catch (error: unknown) {
    webglAddon?.dispose();
    console.warn("WebGL renderer unavailable; using the xterm DOM renderer.", error);
  }
}

function configuredTheme(value: unknown): TerminalTheme {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return builtinThemes[0];
  }

  const stringEntries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return { ...builtinThemes[0], ...Object.fromEntries(stringEntries) };
}

function configuredCursorAnimation(value?: CursorAnimation): CursorAnimation {
  return value === "disabled" ? "disabled" : "liquid";
}

function configuredLiquidCursorSettings(
  value?: Partial<LiquidCursorSettings>,
): LiquidCursorSettings {
  const clamp = (
    candidate: unknown,
    fallback: number,
    maximum: number,
    minimum = 0,
  ): number => {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) return fallback;
    return Math.min(Math.max(Math.round(candidate), minimum), maximum);
  };

  return {
    animationLength: clamp(
      value?.animationLength,
      DEFAULT_LIQUID_CURSOR_SETTINGS.animationLength,
      500,
    ),
    shortAnimationLength: clamp(
      value?.shortAnimationLength,
      DEFAULT_LIQUID_CURSOR_SETTINGS.shortAnimationLength,
      200,
    ),
    trailSize: clamp(value?.trailSize, DEFAULT_LIQUID_CURSOR_SETTINGS.trailSize, 100),
    typingOverlay: typeof value?.typingOverlay === "boolean"
      ? value.typingOverlay
      : DEFAULT_LIQUID_CURSOR_SETTINGS.typingOverlay,
    inputShadow: typeof value?.inputShadow === "boolean"
      ? value.inputShadow
      : DEFAULT_LIQUID_CURSOR_SETTINGS.inputShadow,
    inputShadowOpacity: clamp(
      value?.inputShadowOpacity,
      DEFAULT_LIQUID_CURSOR_SETTINGS.inputShadowOpacity,
      100,
      10,
    ),
  };
}

function toXtermTheme(theme: TerminalTheme, cursorAnimation: CursorAnimation) {
  const liquid = cursorAnimation === "liquid";
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: liquid ? "rgba(0, 0, 0, 0)" : theme.cursor,
    cursorAccent: liquid ? "rgba(0, 0, 0, 0)" : theme.cursorAccent,
    selectionBackground: theme.selection,
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
  };
}

function applyTheme(theme: TerminalTheme): void {
  const root = document.documentElement.style;
  root.setProperty("--terminal-background", theme.background);
  root.setProperty("--terminal-foreground", theme.foreground);
  root.setProperty("--terminal-border", theme.brightBlack);
  root.setProperty("--terminal-menu", theme.background);
  root.setProperty("--terminal-red", theme.brightRed);
  root.setProperty("--terminal-green", theme.brightGreen);
  root.setProperty("--terminal-yellow", theme.yellow);
  root.setProperty("--terminal-cyan", theme.cyan);
  root.setProperty("--terminal-blue", theme.blue);
  root.setProperty("--terminal-white", theme.white);
  root.setProperty("--terminal-cursor", theme.cursor);
  root.setProperty("--terminal-selection", theme.selection);
}

function currentSize(terminal: Terminal): TerminalSize {
  return {
    cols: Math.max(terminal.cols, 2),
    rows: Math.max(terminal.rows, 2),
  };
}

const terminalInputEncoder = new TextEncoder();

function sendTerminalInput(data: string | Uint8Array): void {
  if (activeSessionId === null) return;

  const bytes = typeof data === "string" ? terminalInputEncoder.encode(data) : data;
  void invoke("write_terminal", bytes.buffer as ArrayBuffer).catch((error: unknown) => {
    showError(`Não foi possível enviar dados ao terminal: ${String(error)}`);
  });
}

function binaryStringToBytes(data: string): Uint8Array {
  return Uint8Array.from(data, (character) => character.charCodeAt(0));
}

function writeTerminalOutput(
  terminal: Terminal,
  inputShadow: InputShadow,
  data: Uint8Array,
): void {
  const shadowRevision = inputShadow.currentRevision();
  terminal.write(data, () => inputShadow.clearIfRevision(shadowRevision));
}

async function connectTerminal(terminal: Terminal, inputShadow: InputShadow): Promise<void> {
  const output = new Channel<ArrayBuffer>();
  output.onmessage = (data) => writeTerminalOutput(terminal, inputShadow, new Uint8Array(data));

  await Promise.all([
    listen<TerminalExit>("terminal:exit", ({ payload }) => {
      if (payload.sessionId === activeSessionId) {
        activeSessionId = null;
        oscProgressRunning = false;
        clearTitleProgress();
        showError("A sessão do terminal foi encerrada.");
      }
    }),
    listen<TerminalError>("terminal:error", ({ payload }) => {
      if (payload.sessionId === activeSessionId) {
        oscProgressRunning = false;
        clearTitleProgress();
        showError(`Erro do terminal: ${payload.message}`);
      }
    }),
  ]);

  const started = await invoke<TerminalStarted>("start_terminal", {
    size: currentSize(terminal),
    output,
  });
  activeSessionId = started.sessionId;
  terminal.focus();
}

function setupTerminal(
  terminal: Terminal,
  fitAddon: FitAddon,
  liquidCursor: LiquidCursor,
  inputShadow: InputShadow,
): void {
  let queuedPtyResize: TerminalSize | null = null;
  let ptyResizeInFlight = false;
  let resizeTimer: number | null = null;

  const flushPtyResize = async (): Promise<void> => {
    if (ptyResizeInFlight) return;
    ptyResizeInFlight = true;

    try {
      while (queuedPtyResize && activeSessionId !== null) {
        const size = queuedPtyResize;
        queuedPtyResize = null;
        try {
          await invoke("resize_terminal", { size });
        } catch (error: unknown) {
          showError(`Não foi possível redimensionar o terminal: ${String(error)}`);
        }
      }
    } finally {
      ptyResizeInFlight = false;
      if (queuedPtyResize && activeSessionId !== null) void flushPtyResize();
    }
  };

  setupPromptHud(terminal);
  terminal.onTitleChange((title) => {
    shellTitle = title.trim() || null;
    trackAgentTitleProgress(title);
    updateWindowTitle();
  });
  terminal.parser.registerOscHandler(9, (payload) => {
    const [command, state] = payload.split(";", 3);
    if (command !== "4") return false;

    // Pi emits state 3 on agent_start and state 0 on agent_end.
    oscProgressRunning = state === "1" || state === "3";
    updateTerminalRunningState();
    return true;
  });
  terminal.onData((data) => {
    liquidCursor.pulseTyping();
    inputShadow.show(data);
    const submitted = /\r|\n/.test(data);
    trackCommand(data);

    if (submitted) {
      updateWindowTitle(true);

      if (activeHud) {
        activeHud.status = "running";
        activeHud.commandStartedAt ??= new Date();
        updatePromptHudState(activeHud);
      }
    }
    sendTerminalInput(data);
  });
  terminal.onBinary((data) => sendTerminalInput(binaryStringToBytes(data)));
  setupShortcuts(terminal);

  terminal.onResize(({ cols, rows }) => {
    if (activeSessionId === null) return;

    // Keep ConPTY resize requests ordered and discard intermediate dimensions.
    queuedPtyResize = { cols, rows };
    void flushPtyResize();
  });

  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);

    // xterm recommends debouncing resize so the PTY can finish its previous redraw.
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      if (terminalContainer.clientWidth > 0 && terminalContainer.clientHeight > 0) {
        fitAddon.fit();
      }
    }, 200);
  });

  resizeObserver.observe(terminalContainer);
  fitAddon.fit();
}

function setupPromptHud(terminal: Terminal): void {
  terminal.parser.registerOscHandler(7777, (payload) => {
    const separator = payload.indexOf("=");
    if (separator < 0) return true;

    const key = payload.slice(0, separator);
    const value = payload.slice(separator + 1);
    if (key === "exit") {
      const exitCode = Number.parseInt(value, 10);
      pendingExitCode = Number.isFinite(exitCode) ? exitCode : 1;
    } else if (key === "cwd") {
      finalizePromptHud();
      oscProgressRunning = false;
      clearTitleProgress();
      currentCwd = value;
      activeHud = createPromptHud(terminal, value);
      lastCommand = "";
      updateWindowTitle();
    }
    return true;
  });
}

function createPromptHud(terminal: Terminal, cwd: string): PromptHud | null {
  // The shell emits this OSC on the reserved HUD row itself.
  const marker = terminal.registerMarker(0);
  const decoration = terminal.registerDecoration({ marker, x: 0, width: 1, height: 1 });
  if (!decoration) return null;

  const hud: PromptHud = {
    cwd,
    gitBranch: "",
    gitUser: "",
    exitCode: 0,
    status: "ready",
    commandStartedAt: null,
    commandEndedAt: null,
    marker,
    element: document.createElement("div"),
    disposed: false,
  };
  hud.element.className = "prompt-hud-frame";
  decoration.onRender((host) => {
    host.classList.add("prompt-hud-decoration");
    host.style.overflow = "visible";
    host.style.width = "0";
    host.style.height = "0";
    host.style.pointerEvents = "none";
    host.style.zIndex = "20";
    if (hud.element.parentElement !== host) host.replaceChildren(hud.element);
  });
  decoration.onDispose(() => disposePromptHud(hud));
  marker.onDispose(() => disposePromptHud(hud));
  promptHuds.push(hud);
  renderPromptHud(hud);
  void loadGitContext(hud);
  revealTerminal();
  return hud;
}

async function loadGitContext(hud: PromptHud): Promise<void> {
  try {
    const context = await invoke<GitContext>("get_git_context", { cwd: hud.cwd });
    if (hud.disposed) return;
    hud.gitBranch = context.branch;
    hud.gitUser = context.user;
    renderPromptHud(hud);
  } catch {
    // Git metadata is optional; never delay or break the prompt for it.
  }
}

function finalizePromptHud(): void {
  if (!activeHud || activeHud.disposed) return;

  activeHud.exitCode = pendingExitCode;
  activeHud.status = pendingExitCode === 0 ? "success" : "error";
  activeHud.commandEndedAt = new Date();
  renderPromptHud(activeHud);
  activeHud = null;
}

function disposePromptHud(hud: PromptHud): void {
  if (hud.disposed) return;
  hud.disposed = true;
  hud.element.remove();
  const index = promptHuds.indexOf(hud);
  if (index >= 0) promptHuds.splice(index, 1);
  if (activeHud === hud) activeHud = null;
  if (focusedHud === hud) focusedHud = null;
}

function updatePromptHudState(hud: PromptHud): void {
  hud.element.dataset.status = hud.status;
  hud.element.dataset.focused = String(focusedHud === hud);
  hud.element.firstElementChild?.setAttribute("data-status", hud.status);
}

function renderPromptHud(hud: PromptHud): void {
  if (hud.disposed) return;

  updatePromptHudState(hud);
  const content = document.createElement("div");
  content.className = "prompt-hud";
  content.dataset.status = hud.status;

  const separator = document.createElement("hr");
  separator.className = "prompt-hud-separator";
  content.append(separator);

  const status = document.createElement("span");
  status.className = "prompt-hud-status";
  status.textContent = "•";
  content.append(status);

  const directory = document.createElement("div");
  directory.className = "prompt-hud-cwd";
  const normalizedCwd = hud.cwd.replace(/\\/g, "/");
  const www = normalizedCwd.match(/^(?:[a-z]:|\/c)\/www\/?(.*)$/i)
    ?? normalizedCwd.match(/^\/var\/www\/?(.*)$/i);
  const home = normalizedCwd.match(/^(?:[a-z]:|\/c)\/users\/[^/]+\/?(.*)$/i);
  if (www || home) {
    const icon = createHudIcon(www ? "earth" : "home");
    icon.append(document.createTextNode("/"));
    directory.append(icon, document.createTextNode((www ?? home)?.[1] ?? ""));
  } else {
    directory.textContent = hud.cwd;
  }
  content.append(directory);

  if (hud.gitBranch) {
    const git = document.createElement("div");
    git.className = "prompt-hud-git";
    git.append(document.createTextNode("("), createHudIcon("branch"), document.createTextNode(`${hud.gitBranch})`));
    content.append(git);
  }

  if (hud.gitUser) {
    const gitUser = document.createElement("div");
    gitUser.className = "prompt-hud-git-user";
    gitUser.textContent = `[${hud.gitUser}]`;
    content.append(gitUser);
  }

  const commandTime = formatCommandTime(hud);
  if (commandTime) {
    const time = document.createElement("div");
    time.className = "prompt-hud-time";
    time.textContent = commandTime;
    content.append(time);
  }

  hud.element.replaceChildren(content);
}

function createHudIcon(name: "branch" | "earth" | "home"): HTMLElement {
  const icon = document.createElement("span");
  icon.className = `prompt-hud-icon prompt-hud-icon-${name}`;
  icon.innerHTML = name === "earth"
    ? "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M 12 2 C 10.806 2 9.5241875 3.7110625 8.7421875 6.4140625 C 8.6581875 6.7050625 8.8854531 7 9.1894531 7 L 14.810547 7 C 15.113547 7 15.339859 6.7050625 15.255859 6.4140625 C 14.474859 3.7110625 13.194 2 12 2 z M 7.0605469 3.4160156 C 6.9676406 3.4045938 6.8683906 3.4229687 6.7753906 3.4804688 C 5.6123906 4.1974688 4.6082187 5.1476719 3.8242188 6.2636719 C 3.6062188 6.5736719 3.8143594 7 4.1933594 7 L 6.1503906 7 C 6.3623906 7 6.54475 6.8495781 6.59375 6.6425781 C 6.81875 5.6965781 7.1005469 4.8277812 7.4355469 4.0507812 C 7.5660469 3.7500312 7.3392656 3.4502812 7.0605469 3.4160156 z M 16.939453 3.4160156 C 16.660688 3.4503281 16.43275 3.7512344 16.5625 4.0527344 C 16.8975 4.8287344 17.18225 5.6985312 17.40625 6.6445312 C 17.45625 6.8505312 17.637609 7 17.849609 7 L 19.806641 7 C 20.185641 7 20.393781 6.5736719 20.175781 6.2636719 C 19.391781 5.1476719 18.387609 4.1984688 17.224609 3.4804688 C 17.131609 3.4229687 17.032375 3.4045781 16.939453 3.4160156 z M 2.8125 9 C 2.6055 9 2.4173281 9.1369375 2.3613281 9.3359375 C 2.1263281 10.184937 2 11.077 2 12 C 2 12.923 2.1263281 13.815063 2.3613281 14.664062 C 2.4163281 14.863063 2.6055 15 2.8125 15 L 5.6738281 15 C 5.9458281 15 6.1539531 14.769047 6.1269531 14.498047 C 6.0469531 13.696047 6 12.864 6 12 C 6 11.136 6.0469531 10.303953 6.1269531 9.5019531 C 6.1539531 9.2309531 5.9458281 9 5.6738281 9 L 2.8125 9 z M 8.6113281 9 C 8.3773281 9 8.1783906 9.1703438 8.1503906 9.4023438 C 8.0543906 10.225344 8 11.094 8 12 C 8 12.906 8.0543906 13.774656 8.1503906 14.597656 C 8.1783906 14.829656 8.3773281 15 8.6113281 15 L 15.388672 15 C 15.622672 15 15.822609 14.829656 15.849609 14.597656 C 15.946609 13.774656 16 12.906 16 12 C 16 11.094 15.945609 10.225344 15.849609 9.4023438 C 15.821609 9.1703437 15.622672 9 15.388672 9 L 8.6113281 9 z M 18.326172 9 C 18.054172 9 17.846047 9.2309531 17.873047 9.5019531 C 17.953047 10.303953 18 11.136 18 12 C 18 12.864 17.953047 13.696047 17.873047 14.498047 C 17.846047 14.769047 18.054172 15 18.326172 15 L 21.1875 15 C 21.3945 15 21.582672 14.863063 21.638672 14.664062 C 21.873672 13.815063 22 12.923 22 12 C 22 11.077 21.873672 10.184937 21.638672 9.3359375 C 21.583672 9.1369375 21.3945 9 21.1875 9 L 18.326172 9 z M 4.1933594 17 C 3.8143594 17 3.6062187 17.426328 3.8242188 17.736328 C 4.6082187 18.852328 5.6123906 19.801531 6.7753906 20.519531 C 7.1473906 20.749531 7.6105 20.349266 7.4375 19.947266 C 7.1025 19.171266 6.81775 18.301469 6.59375 17.355469 C 6.54375 17.149469 6.3623906 17 6.1503906 17 L 4.1933594 17 z M 9.1894531 17 C 8.8864531 17 8.6601406 17.294937 8.7441406 17.585938 C 9.5251406 20.288937 10.806 22 12 22 C 13.194 22 14.475812 20.288937 15.257812 17.585938 C 15.341812 17.294937 15.114547 17 14.810547 17 L 9.1894531 17 z M 17.849609 17.001953 C 17.637609 17.000953 17.45525 17.150422 17.40625 17.357422 C 17.18125 18.303422 16.899453 19.172219 16.564453 19.949219 C 16.391453 20.351219 16.851609 20.750484 17.224609 20.521484 C 18.387609 19.804484 19.391781 18.854281 20.175781 17.738281 C 20.393781 17.428281 20.185641 17.001953 19.806641 17.001953 L 17.849609 17.001953 z\"/></svg>"
    : name === "branch"
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13 12.3V7.1l-8-1V3.7a2 2 0 1 0-2 0v8.6a2 2 0 1 0 2 0V8.1l6 .8v3.4a2 2 0 1 0 2 0Z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 3 9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>';
  return icon;
}

function formatCommandTime(hud: PromptHud): string | null {
  if (!hud.commandStartedAt || !hud.commandEndedAt) return null;
  const elapsed = hud.commandEndedAt.valueOf() - hud.commandStartedAt.valueOf();
  const seconds = Math.floor(elapsed / 1_000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m and ${seconds % 60}s` : `(${seconds}s and ${elapsed % 1_000}ms)`;
}

function trackCommand(data: string): void {
  for (const character of data) {
    if (inEscapeSequence) {
      if (character === "\x7f") {
        inputBuffer = inputBuffer.trimEnd().replace(/\S+$/, "");
        inEscapeSequence = false;
      } else if (character >= "A" && character <= "z") {
        inEscapeSequence = false;
      }
      continue;
    }
    if (character === "\x1b") {
      inEscapeSequence = true;
    } else if (character === "\r" || character === "\n") {
      lastCommand = inputBuffer.trim();
      inputBuffer = "";
    } else if (character === "\x03" || character === "\x15") {
      inputBuffer = "";
    } else if (character === "\x7f" || character === "\b") {
      inputBuffer = inputBuffer.slice(0, -1);
    } else if (character >= " " || character === "\t") {
      inputBuffer += character;
    }
  }
}

function focusPreviousPromptHud(terminal: Terminal): boolean {
  const viewportLine = terminal.buffer.active.viewportY;
  const target = promptHuds.reduce<PromptHud | null>((previous, hud) => {
    if (hud.disposed || hud.marker.line < 0 || hud.marker.line >= viewportLine) return previous;
    return !previous || hud.marker.line > previous.marker.line ? hud : previous;
  }, null);
  if (!target) return false;

  if (focusedHud) {
    focusedHud.element.dataset.focused = "false";
  }
  focusedHud = target;
  target.element.dataset.focused = "true";
  terminal.scrollToLine(Math.max(target.marker.line - 2, 0));
  terminal.focus();
  return true;
}

async function copyTerminal(terminal: Terminal): Promise<void> {
  if (terminal.hasSelection()) {
    await navigator.clipboard.writeText(terminal.getSelection());
    terminal.element?.dispatchEvent(new Event("pnex:copied"));
  }
}

async function pasteTerminal(): Promise<void> {
  sendTerminalInput(await navigator.clipboard.readText());
}

function setupShortcuts(terminal: Terminal): void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;

    if (event.key === "ArrowUp" && event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      if (focusPreviousPromptHud(terminal)) {
        event.preventDefault();
        return false;
      }
      return true;
    }

    if (event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      sendTerminalInput("\n");
      return false;
    }

    if (event.key === "Backspace" && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      terminal.input("\x1b\x7f");
      return false;
    }

    if (!event.ctrlKey || event.metaKey || event.altKey) return true;

    switch (event.key.toLowerCase()) {
      case "v":
        event.preventDefault();
        void pasteTerminal().catch((error: unknown) => {
          showError(`Não foi possível colar: ${String(error)}`);
        });
        return false;
      case "a":
        event.preventDefault();
        terminal.selectAll();
        return false;
      case "c":
        if (!terminal.hasSelection()) return true;
        event.preventDefault();
        void copyTerminal(terminal).catch((error: unknown) => {
          showError(`Não foi possível copiar: ${String(error)}`);
        });
        return false;
      case "insert":
        event.preventDefault();
        if (terminal.hasSelection()) {
          void copyTerminal(terminal).catch((error: unknown) => {
            showError(`Não foi possível copiar: ${String(error)}`);
          });
        }
        return false;
      default:
        return true;
    }
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "F12") return;
      event.preventDefault();
      void invoke("toggle_devtools").catch((error: unknown) => {
        showError(`Não foi possível abrir as ferramentas de desenvolvimento: ${String(error)}`);
      });
    },
    true,
  );
}

function closeMenu(): void {
  menuPopup.hidden = true;
  menuPopup.replaceChildren();
}

function menuItems(menuName: string, config: AppConfig): MenuItem[] {
  switch (menuName) {
    case "file":
      return [
        { label: "New Window", action: "new-window" },
        { label: "New Window Here", action: "new-window-here", disabled: !currentCwd },
        { label: "Close App", action: "close-app" },
      ];
    case "options": {
      const selectedTheme = configuredTheme(config.theme);
      return [
        { label: "Options JSON", action: "open-config" },
        { separator: true },
        { label: "Themes", disabled: true },
        ...builtinThemes.map((theme) => ({
          label: theme.name,
          action: "set-theme" as const,
          theme,
          checked: theme.name === selectedTheme.name,
        })),
        { separator: true },
        { label: "Liquid Cursor…", action: "open-liquid-cursor" },
        { separator: true },
        { label: "UI Themes", disabled: true },
        {
          label: "Default Theme",
          action: "set-ui-theme",
          uiThemeName: "Default Theme",
          checked: (config.uiThemeName ?? "Default Theme") === "Default Theme",
        },
      ];
    }
    case "edit":
      return [
        { label: "Copy", action: "copy", hint: "Ctrl+C" },
        { label: "Paste", action: "paste", hint: "Ctrl+V" },
        { label: "Select All", action: "select-all", hint: "Ctrl+A" },
      ];
    case "help":
      return [
        { label: "Toggle DevTools", action: "toggle-devtools", hint: "F12" },
        { label: "About pnex", action: "about" },
      ];
    default:
      return [];
  }
}

async function runMenuAction(
  action: MenuAction,
  terminal: Terminal,
  config: AppConfig,
  liquidCursor: LiquidCursor,
  theme?: TerminalTheme,
  uiThemeName?: string,
): Promise<void> {
  switch (action) {
    case "new-window":
      await invoke("new_window");
      return;
    case "new-window-here":
      await invoke("new_window", { inheritedDirectory: currentCwd });
      return;
    case "close-app":
      await invoke("request_close_app");
      return;
    case "open-config":
      await invoke("open_config");
      return;
    case "copy":
      await copyTerminal(terminal);
      return;
    case "paste":
      await pasteTerminal();
      return;
    case "select-all":
      terminal.selectAll();
      return;
    case "set-theme":
      if (!theme) return;
      config.theme = theme;
      terminal.options.theme = toXtermTheme(theme, configuredCursorAnimation(config.cursorAnimation));
      liquidCursor.setColors(theme.cursor, theme.brightBlue);
      applyTheme(theme);
      await invoke("save_config", { config });
      return;
    case "set-ui-theme":
      config.uiThemeName = uiThemeName ?? "Default Theme";
      applyUiTheme(config.uiThemeName);
      await invoke("save_config", { config });
      return;
    case "open-liquid-cursor":
      showLiquidCursorPanel();
      return;
    case "toggle-devtools":
      await invoke("toggle_devtools");
      return;
    case "about":
      window.alert("pnex\nTerminal workspace");
  }
}

function applyCursorAnimation(
  terminal: Terminal,
  config: AppConfig,
  liquidCursor: LiquidCursor,
  animation: CursorAnimation,
): void {
  config.cursorAnimation = animation;
  liquidCursor.setMode(animation);
  terminal.options.cursorBlink = animation === "disabled";
  terminal.options.cursorInactiveStyle = animation === "disabled" ? "outline" : "none";
  terminal.options.theme = toXtermTheme(configuredTheme(config.theme), animation);
}

function positionLiquidCursorPanel(panel: HTMLElement): void {
  const trigger = document.querySelector<HTMLButtonElement>('.menu-trigger[data-menu="options"]');
  const triggerBounds = trigger?.getBoundingClientRect();
  const left = Math.min(
    Math.max(triggerBounds?.left ?? 8, 8),
    Math.max(window.innerWidth - panel.offsetWidth - 8, 8),
  );
  panel.style.left = `${left}px`;
  panel.style.top = `${triggerBounds?.bottom ?? 34}px`;
}

function showLiquidCursorPanel(): void {
  const panel = requiredElement("#liquid-cursor-panel");
  panel.hidden = false;
  positionLiquidCursorPanel(panel);
  requiredElement("#liquid-cursor-enabled").focus();
}

function setupLiquidCursorPanel(
  terminal: Terminal,
  config: AppConfig,
  liquidCursor: LiquidCursor,
  inputShadow: InputShadow,
): void {
  const panel = requiredElement("#liquid-cursor-panel");
  const close = requiredElement("#liquid-cursor-close");
  const enabled = requiredElement("#liquid-cursor-enabled") as HTMLInputElement;
  const controls = requiredElement("#liquid-cursor-controls");
  const overlayEnabled = requiredElement("#liquid-cursor-overlay-enabled") as HTMLInputElement;
  const animationLength = requiredElement("#liquid-cursor-animation-length") as HTMLInputElement;
  const shortAnimationLength = requiredElement(
    "#liquid-cursor-short-animation-length",
  ) as HTMLInputElement;
  const trail = requiredElement("#liquid-cursor-trail") as HTMLInputElement;
  const shadowControls = requiredElement("#input-shadow-controls");
  const shadowEnabled = requiredElement("#input-shadow-enabled") as HTMLInputElement;
  const shadowOpacity = requiredElement("#input-shadow-opacity") as HTMLInputElement;
  const settings = configuredLiquidCursorSettings(config.liquidCursor);
  config.liquidCursor = settings;
  overlayEnabled.checked = settings.typingOverlay;
  animationLength.value = String(settings.animationLength);
  shortAnimationLength.value = String(settings.shortAnimationLength);
  trail.value = String(settings.trailSize);
  shadowEnabled.checked = settings.inputShadow;
  shadowOpacity.value = String(settings.inputShadowOpacity);
  enabled.checked = configuredCursorAnimation(config.cursorAnimation) === "liquid";

  const persist = (): void => {
    const cursorAnimation = configuredCursorAnimation(config.cursorAnimation);
    const liquidCursorSettings = configuredLiquidCursorSettings(config.liquidCursor);
    const save = liquidCursorSaveQueue
      .catch(() => undefined)
      .then(() => invoke<void>("save_liquid_cursor", {
        cursorAnimation,
        liquidCursor: liquidCursorSettings,
      }));
    liquidCursorSaveQueue = save;
    void save.catch((error: unknown) => {
      showError(`Não foi possível salvar o Liquid Cursor: ${String(error)}`);
    });
  };
  const syncEnabledState = (): void => {
    const disabled = !enabled.checked;
    overlayEnabled.disabled = disabled;
    animationLength.disabled = disabled;
    shortAnimationLength.disabled = disabled;
    trail.disabled = disabled;
    controls.setAttribute("aria-disabled", String(disabled));
  };
  const syncShadowState = (): void => {
    const disabled = !shadowEnabled.checked;
    shadowOpacity.disabled = disabled;
    shadowControls.setAttribute("aria-disabled", String(disabled));
  };
  const applySettings = (): void => {
    const nextSettings = configuredLiquidCursorSettings({
      animationLength: Number(animationLength.value),
      shortAnimationLength: Number(shortAnimationLength.value),
      trailSize: Number(trail.value),
      typingOverlay: overlayEnabled.checked,
      inputShadow: shadowEnabled.checked,
      inputShadowOpacity: Number(shadowOpacity.value),
    });
    config.liquidCursor = nextSettings;
    liquidCursor.setSettings(nextSettings);
    inputShadow.setSettings(nextSettings);
  };
  const hidePanel = (restoreTerminalFocus: boolean): void => {
    panel.hidden = true;
    if (restoreTerminalFocus) terminal.focus();
  };

  syncEnabledState();
  syncShadowState();
  enabled.addEventListener("change", () => {
    applyCursorAnimation(
      terminal,
      config,
      liquidCursor,
      enabled.checked ? "liquid" : "disabled",
    );
    syncEnabledState();
    persist();
  });
  overlayEnabled.addEventListener("change", () => {
    applySettings();
    persist();
  });
  shadowEnabled.addEventListener("change", () => {
    applySettings();
    syncShadowState();
    persist();
  });
  shadowOpacity.addEventListener("input", applySettings);
  shadowOpacity.addEventListener("change", persist);
  for (const slider of [animationLength, shortAnimationLength, trail]) {
    slider.addEventListener("input", applySettings);
    slider.addEventListener("change", persist);
  }
  close.addEventListener("click", () => hidePanel(true));
  panel.addEventListener("click", (event) => event.stopPropagation());
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled])',
    )];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  void listen<LiquidCursorConfigChanged>(
    "liquid-cursor-config-changed",
    ({ payload }) => {
      if (payload.sourceWindow === appWindow.label) return;
      const nextSettings = configuredLiquidCursorSettings(payload.liquidCursor);
      const nextAnimation = configuredCursorAnimation(payload.cursorAnimation);
      config.liquidCursor = nextSettings;
      overlayEnabled.checked = nextSettings.typingOverlay;
      animationLength.value = String(nextSettings.animationLength);
      shortAnimationLength.value = String(nextSettings.shortAnimationLength);
      trail.value = String(nextSettings.trailSize);
      shadowEnabled.checked = nextSettings.inputShadow;
      shadowOpacity.value = String(nextSettings.inputShadowOpacity);
      enabled.checked = nextAnimation === "liquid";
      liquidCursor.setSettings(nextSettings);
      inputShadow.setSettings(nextSettings);
      applyCursorAnimation(terminal, config, liquidCursor, nextAnimation);
      syncEnabledState();
      syncShadowState();
    },
  ).catch((error: unknown) => {
    console.warn("Could not synchronize Liquid Cursor settings.", error);
  });
  document.addEventListener("click", (event) => {
    if (
      panel.hidden
      || !(event.target instanceof Node)
      || menuPopup.contains(event.target)
      || panel.contains(event.target)
    ) return;
    hidePanel(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) hidePanel(true);
  });
  window.addEventListener("resize", () => {
    if (!panel.hidden) positionLiquidCursorPanel(panel);
  });
}

function openMenu(
  trigger: HTMLButtonElement,
  terminal: Terminal,
  config: AppConfig,
  liquidCursor: LiquidCursor,
): void {
  const menuName = trigger.dataset.menu;
  if (!menuName) return;

  const items = menuItems(menuName, config);
  if (items.length === 0) return;

  menuPopup.replaceChildren();
  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement("div");
      separator.className = "menu-separator";
      menuPopup.append(separator);
      continue;
    }

    if (!item.label) continue;
    if (item.disabled) {
      const label = document.createElement("div");
      label.className = "menu-label";
      label.textContent = item.label;
      menuPopup.append(label);
      continue;
    }

    const action = item.action;
    if (!action) continue;
    const button = document.createElement("button");
    button.className = "menu-item";
    button.type = "button";
    button.textContent = item.checked ? `✓ ${item.label}` : item.label;
    if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "menu-hint";
      hint.textContent = item.hint;
      button.append(hint);
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      closeMenu();
      void runMenuAction(
        action,
        terminal,
        config,
        liquidCursor,
        item.theme,
        item.uiThemeName,
      ).catch((error: unknown) => {
        showError(`Não foi possível executar a ação: ${String(error)}`);
      });
    });
    menuPopup.append(button);
  }

  const bounds = trigger.getBoundingClientRect();
  menuPopup.style.left = `${bounds.left}px`;
  menuPopup.style.top = `${bounds.bottom}px`;
  menuPopup.hidden = false;
}

function setupTitlebar(
  terminal: Terminal,
  config: AppConfig,
  liquidCursor: LiquidCursor,
  inputShadow: InputShadow,
): void {
  setupLiquidCursorPanel(terminal, config, liquidCursor, inputShadow);
  const triggers = document.querySelectorAll<HTMLButtonElement>(".menu-trigger");
  const titlebar = requiredElement("#titlebar");
  const titlebarIcon = requiredElement("#titlebar-icon");
  const titlebarToggle = requiredElement("#titlebar-toggle") as HTMLButtonElement;
  const titlebarMenu = requiredElement("#titlebar-menu");
  const minimize = requiredElement("#window-minimize");
  const maximize = requiredElement("#window-maximize");
  const close = requiredElement("#window-close");

  titlebar.addEventListener("mousedown", (event) => {
    if (event.buttons !== 1) return;
    if (event.target instanceof Element && event.target.closest("button")) return;

    if (event.detail === 2) {
      void appWindow.toggleMaximize();
      return;
    }

    void appWindow.startDragging().catch((error: unknown) => {
      showError(`Não foi possível mover a janela: ${String(error)}`);
    });
  });

  const closeTitlebarMenu = (): void => {
    const titleWasHidden = titlebarTitle.hidden;
    titlebarIcon.setAttribute("hidden", "");
    titlebarMenu.hidden = true;
    titlebarToggle.hidden = false;
    titlebarTitle.hidden = false;
    if (titleWasHidden) animateTitlebarTitle();
    titlebarToggle.setAttribute("aria-expanded", "false");
  };

  titlebarToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    requiredElement("#liquid-cursor-panel").hidden = true;
    titlebarIcon.removeAttribute("hidden");
    titlebarMenu.hidden = false;
    titlebarToggle.hidden = true;
    titlebarTitle.hidden = true;
    titlebarToggle.setAttribute("aria-expanded", "true");
  });

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      requiredElement("#liquid-cursor-panel").hidden = true;
      if (!menuPopup.hidden) {
        closeMenu();
      } else {
        openMenu(trigger, terminal, config, liquidCursor);
      }
    });
  });

  document.addEventListener("click", (event) => {
    closeMenu();
    if (event.target instanceof Node && !titlebar.contains(event.target)) closeTitlebarMenu();
  });
  document.addEventListener("focusin", (event) => {
    if (
      titlebarMenu.hidden
      || !(event.target instanceof Node)
      || titlebarMenu.contains(event.target)
      || menuPopup.contains(event.target)
    ) return;

    closeMenu();
    closeTitlebarMenu();
  });
  window.addEventListener("blur", () => {
    closeMenu();
    closeTitlebarMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeMenu();
    closeTitlebarMenu();
  });

  minimize.addEventListener("click", () => {
    void appWindow.minimize();
  });
  maximize.addEventListener("click", () => {
    void appWindow.toggleMaximize();
  });
  close.addEventListener("click", () => {
    void appWindow.close();
  });

  const updateMaximizeGlyph = async (): Promise<void> => {
    maximize.textContent = (await appWindow.isMaximized()) ? "❐" : "□";
  };

  void updateMaximizeGlyph();
  void appWindow.onResized(() => {
    void updateMaximizeGlyph();
  });
}

async function setupCloseAfterCursorSave(): Promise<void> {
  await Promise.all([
    appWindow.onCloseRequested((event) => {
      event.preventDefault();
      if (closingAfterCursorSave) return;
      closingAfterCursorSave = true;
      void liquidCursorSaveQueue
        .then(() => appWindow.destroy())
        .catch((error: unknown) => {
          closingAfterCursorSave = false;
          showError(`Não foi possível fechar a janela: ${String(error)}`);
        });
    }),
    listen("app-close-requested", () => {
      void liquidCursorSaveQueue
        .then(() => invoke("confirm_app_close"))
        .catch((error: unknown) => {
          showError(`Não foi possível fechar o aplicativo: ${String(error)}`);
        });
    }),
  ]);
}

async function bootstrap(): Promise<void> {
  await setupCloseAfterCursorSave();
  setupLoadingScreenDragging();
  const config = await invoke<AppConfig>("get_config");
  applyUiTheme(config.uiThemeName);
  const { terminal, fitAddon, liquidCursor, inputShadow } = createTerminal(config);

  setupTerminal(terminal, fitAddon, liquidCursor, inputShadow);
  setupTitlebar(terminal, config, liquidCursor, inputShadow);
  await setupWindowHoverOverlay();

  // The shell prompt is customized at startup and can redraw several times.
  // Keep it behind the loading screen until its first HUD arrives.
  const minimumLoadingDelay = new Promise<void>((resolve) => window.setTimeout(resolve, 1_500));
  window.setTimeout(revealTerminal, 3_000);

  await connectTerminal(terminal, inputShadow);
  await minimumLoadingDelay;
  dismissLoadingScreen();
  clearError();
}

window.addEventListener("beforeunload", () => {
  void invoke("stop_terminal");
});

void bootstrap().catch((error: unknown) => {
  revealTerminal();
  dismissLoadingScreen();
  showError(`Não foi possível iniciar o terminal: ${String(error)}`);
});
