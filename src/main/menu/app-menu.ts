import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from "electron";
import { IpcChannels } from "../../shared/ipc-channels";
import {
  getConfigPath,
  builtinThemes,
  loadConfig,
  saveConfig,
} from "../../lib/config";
import { shell } from "electron";

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
          click: () => shell.openPath(getConfigPath()),
        },
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            win.webContents.send(IpcChannels.NEW_CHAT);
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
      submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
