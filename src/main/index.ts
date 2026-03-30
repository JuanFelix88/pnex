import { app } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { buildAppMenu } from './menu';
import { ShellManager } from '../lib/terminal';
import { loadConfig } from '../lib/config';

/** Ensure config exists on first launch */
loadConfig();

const shellManager = new ShellManager();

app.whenReady().then(() => {
  const win = createMainWindow();

  buildAppMenu(win);
  registerIpcHandlers(win, shellManager);

  app.on('activate', () => {
    if (!win.isDestroyed()) return;
    const newWin = createMainWindow();
    buildAppMenu(newWin);
    registerIpcHandlers(newWin, shellManager);
  });
});

app.on('window-all-closed', () => {
  shellManager.kill();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
