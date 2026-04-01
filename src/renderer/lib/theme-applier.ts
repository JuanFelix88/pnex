import { PnexTheme } from "../../shared/types";

/**
 * Apply the theme to both xterm and the HTML UI elements.
 * Updates CSS custom properties and inline styles to match.
 */
export function applyTheme(theme: PnexTheme): void {
  applyThemeVariables(theme);
  applyBodyTheme(theme);
  applyTitlebarTheme(theme);
  applyChatTheme(theme);
}

function applyThemeVariables(theme: PnexTheme): void {
  const themeVariables: Record<string, string> = {
    "--pnex-theme-background": theme.background,
    "--pnex-theme-foreground": theme.foreground,
    "--pnex-theme-cursor": theme.cursor,
    "--pnex-theme-cursor-accent": theme.cursorAccent,
    "--pnex-theme-selection": theme.selection,
    "--pnex-theme-black": theme.black,
    "--pnex-theme-red": theme.red,
    "--pnex-theme-green": theme.green,
    "--pnex-theme-yellow": theme.yellow,
    "--pnex-theme-blue": theme.blue,
    "--pnex-theme-magenta": theme.magenta,
    "--pnex-theme-cyan": theme.cyan,
    "--pnex-theme-white": theme.white,
    "--pnex-theme-bright-black": theme.brightBlack,
    "--pnex-theme-bright-red": theme.brightRed,
    "--pnex-theme-bright-green": theme.brightGreen,
    "--pnex-theme-bright-yellow": theme.brightYellow,
    "--pnex-theme-bright-blue": theme.brightBlue,
    "--pnex-theme-bright-magenta": theme.brightMagenta,
    "--pnex-theme-bright-cyan": theme.brightCyan,
    "--pnex-theme-bright-white": theme.brightWhite,
  };

  for (const [name, value] of Object.entries(themeVariables)) {
    document.documentElement.style.setProperty(name, value);
  }
}

function applyBodyTheme(theme: PnexTheme): void {
  document.body.style.backgroundColor = theme.background;
  document.body.style.color = theme.foreground;
}

function applyTitlebarTheme(theme: PnexTheme): void {
  const titlebar = document.getElementById("titlebar");
  const titlebarIcon = document.getElementById("titlebar-icon");
  const menuPopup = document.getElementById("menu-popup");

  if (titlebar) {
    titlebar.style.backgroundColor = theme.background;
    titlebar.style.color = theme.foreground;
    titlebar.style.borderBottomColor = theme.brightBlack;
  }

  if (titlebarIcon) {
    titlebarIcon.style.color = theme.brightWhite;
  }

  if (menuPopup) {
    menuPopup.style.backgroundColor = theme.background;
    menuPopup.style.color = theme.foreground;
    menuPopup.style.borderColor = theme.brightBlack;
  }
}

function applyChatTheme(theme: PnexTheme): void {
  const chatBox = document.getElementById("chat-box");
  const chatInput = document.getElementById("chat-input");
  const chatSend = document.getElementById("chat-send");
  const chatResponse = document.getElementById("chat-response");
  const chatModeLabel = document.getElementById("chat-mode-label");

  if (chatBox) {
    chatBox.style.backgroundColor = theme.background;
    chatBox.style.borderColor = theme.brightBlack;
  }
  if (chatModeLabel) {
    chatModeLabel.style.color = theme.blue;
  }
  if (chatInput) {
    (chatInput as HTMLInputElement).style.color = theme.foreground;
  }
  if (chatSend) {
    chatSend.style.backgroundColor = theme.blue;
    chatSend.style.color = theme.brightWhite;
  }
  if (chatResponse) {
    chatResponse.style.color = theme.foreground;
  }
}

/** Convert PnexTheme to xterm ITheme format */
export function toXtermTheme(theme: PnexTheme) {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.cursorAccent,
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
