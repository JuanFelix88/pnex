/** Shared IPC channel names between main and renderer */
export const IpcChannels = {
  TERMINAL_DATA: "terminal:data",
  TERMINAL_INPUT: "terminal:input",
  TERMINAL_RESIZE: "terminal:resize",
  TERMINAL_CLEAR: "terminal:clear",
  CONFIG_GET: "config:get",
  CONFIG_OPEN: "config:open",
  AI_COMMAND: "ai:command",
  AI_CHAT: "ai:chat",
  NEW_CHAT: "app:new-chat",
  THEME_LIST: "theme:list",
  THEME_SET: "theme:set",
  THEME_CHANGED: "theme:changed",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
