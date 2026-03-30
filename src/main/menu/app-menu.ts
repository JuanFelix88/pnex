import {
  app,
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
} from 'electron';
import { IpcChannels } from '../../shared/ipc-channels';
import { getConfigPath } from '../../lib/config';
import { shell } from 'electron';

/**
 * Build the native application menu.
 * Only includes "Options JSON" and "New Chat" actions.
 */
export function buildAppMenu(win: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: 'Options JSON',
          click: () => shell.openPath(getConfigPath()),
        },
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            win.webContents.send(IpcChannels.NEW_CHAT);
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
