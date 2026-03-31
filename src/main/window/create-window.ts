import { BrowserWindow, app } from "electron";
import * as path from "path";

/** Create the main application window */
export function createMainWindow(): BrowserWindow {
  const iconPath = path.join(app.getAppPath(), "assets", "icon.ico");

  const win = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 480,
    minHeight: 320,
    title: "pnex",
    icon: iconPath,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const htmlPath = path.join(__dirname, "..", "..", "renderer", "index.html");
  win.loadFile(htmlPath);

  if (process.argv.includes("--dev")) {
    win.webContents.openDevTools();
  }

  return win;
}
