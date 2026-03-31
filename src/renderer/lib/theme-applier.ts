import { PnexTheme } from "../../shared/types";

/**
 * Apply the theme to both xterm and the HTML UI elements.
 * Updates CSS custom properties and inline styles to match.
 */
export function applyTheme(theme: PnexTheme): void {
  applyBodyTheme(theme);
  applyTitlebarTheme(theme);
  applyChatTheme(theme);
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
    titlebarIcon.style.backgroundColor = theme.blue;
    titlebarIcon.style.color = theme.brightWhite;
  }

  if (menuPopup) {
    menuPopup.style.backgroundColor = theme.background;
    menuPopup.style.color = theme.foreground;
    menuPopup.style.borderColor = theme.brightBlack;
  }

  document.documentElement.style.setProperty(
    "--pnex-titlebar-bg",
    theme.background,
  );
  document.documentElement.style.setProperty(
    "--pnex-titlebar-fg",
    theme.foreground,
  );
  document.documentElement.style.setProperty(
    "--pnex-titlebar-border",
    theme.brightBlack,
  );
  document.documentElement.style.setProperty(
    "--pnex-titlebar-hover",
    theme.selection,
  );
  document.documentElement.style.setProperty(
    "--pnex-titlebar-accent",
    theme.blue,
  );
  document.documentElement.style.setProperty(
    "--pnex-titlebar-muted",
    theme.brightBlack,
  );
  document.documentElement.style.setProperty(
    "--pnex-titlebar-icon-fg",
    theme.brightWhite,
  );
  document.documentElement.style.setProperty(
    "--pnex-titlebar-close-hover",
    theme.red,
  );
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
