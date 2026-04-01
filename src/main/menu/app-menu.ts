import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from "electron";
import { IpcChannels } from "../../shared/ipc-channels";
import {
  getConfigPath,
  builtinThemes,
  loadConfig,
  saveConfig,
} from "../../lib/config";
import { shell } from "electron";
import { defaultUiThemeName, listUiThemes } from "../../renderer/ui-themes";

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
  const config = loadConfig();

  const themeSubmenu: MenuItemConstructorOptions[] = builtinThemes.map(
    (theme) => ({
      label: theme.name,
      type: "radio" as const,
      checked: config.theme.name === theme.name,
      click: () => {
        const config = loadConfig();
        config.theme = theme;
        saveConfig(config);
        win.webContents.send(IpcChannels.THEME_CHANGED, theme);
      },
    }),
  );

  const uiThemeSubmenu: MenuItemConstructorOptions[] = listUiThemes().map(
    (themeName) => ({
      label: themeName,
      type: "radio" as const,
      checked: (config.uiThemeName || defaultUiThemeName) === themeName,
      click: () => {
        const config = loadConfig();
        config.uiThemeName = themeName;
        saveConfig(config);
        win.webContents.send(IpcChannels.UI_THEME_CHANGED, themeName);
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
        {
          label: "UI Themes",
          submenu: uiThemeSubmenu,
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
          label: "Toggle DevTools",
          accelerator: "F12",
          click: () => {
            win.webContents.toggleDevTools();
          },
        },
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
