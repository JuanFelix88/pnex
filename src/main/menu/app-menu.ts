import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from "electron";
import { IpcChannels } from "../../shared/ipc-channels";
import {
  getConfigPath,
  builtinThemes,
  loadConfig,
  saveConfig,
} from "../../lib/config";
import { shell } from "electron";

type AppMenuAction = "config" | "new-chat" | "copy" | "paste" | "select-all";

function triggerRendererMenuAction(
  win: BrowserWindow,
  action: AppMenuAction,
): void {
  win.webContents.send(IpcChannels.APP_MENU_TRIGGER, action);
}

/**
 * Build the native application menu.
 * Includes "Options JSON", "New Chat", and "Themes" actions.
 */
export function buildAppMenu(win: BrowserWindow): void {
  const themeSubmenu: MenuItemConstructorOptions[] = builtinThemes.map(
    (theme) => ({
      label: theme.name,
      type: "radio" as const,
      checked: loadConfig().theme.name === theme.name,
      click: () => {
        const config = loadConfig();
        config.theme = theme;
        saveConfig(config);
        win.webContents.send(IpcChannels.THEME_CHANGED, theme);
      },
    }),
  );

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: "Options JSON",
          click: () => {
            triggerRendererMenuAction(win, "config");
          },
        },
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            win.webContents.send(IpcChannels.NEW_CHAT);
            triggerRendererMenuAction(win, "new-chat");
          },
        },
        { type: "separator" },
        {
          label: "Themes",
          submenu: themeSubmenu,
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        {
          role: "copy",
          click: () => triggerRendererMenuAction(win, "copy"),
        },
        {
          role: "paste",
          click: () => triggerRendererMenuAction(win, "paste"),
        },
        {
          role: "selectAll",
          click: () => triggerRendererMenuAction(win, "select-all"),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About pnex",
          click: () => {
            void shell.openPath(getConfigPath());
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
