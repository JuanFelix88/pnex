/** Shared IPC channel names between main and renderer */
export const IpcChannels = {
  TERMINAL_DATA: "terminal:data",
  TERMINAL_INPUT: "terminal:input",
  TERMINAL_RESIZE: "terminal:resize",
  TERMINAL_HUD: "terminal:hud",
  TERMINAL_CLEAR: "terminal:clear",
  CONFIG_GET: "config:get",
  CONFIG_OPEN: "config:open",
  AI_COMMAND: "ai:command",
  AI_CHAT: "ai:chat",
  NEW_CHAT: "app:new-chat",
  APP_MENU_TRIGGER: "app:menu-trigger",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:is-maximized",
  WINDOW_MAXIMIZED_CHANGED: "window:maximized-changed",
  THEME_LIST: "theme:list",
  THEME_SET: "theme:set",
  THEME_CHANGED: "theme:changed",
  UI_THEME_CONTEXT: "ui-theme:context",
  UI_THEME_CONTEXT_SYNC: "ui-theme:context-sync",
  UI_THEME_SET: "ui-theme:set",
  UI_THEME_CHANGED: "ui-theme:changed",
  DEVTOOLS_TOGGLE: "devtools:toggle",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
