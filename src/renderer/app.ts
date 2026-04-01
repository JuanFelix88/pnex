import { PnexConfig } from "../shared/types";
import { initTerminal } from "./lib/terminal-setup";
import { initInlineChat } from "./lib/inline-chat";
import { initAiHint } from "./lib/ai-hint";
import { applyTheme, toXtermTheme } from "./lib/theme-applier";
import type { AppMenuAction } from "../preload/preload";
import type { PnexTheme } from "../shared/types";

declare const pnex: import("../preload/preload").PnexApi;

function applyConfigCssVariables(config: PnexConfig): void {
  document.documentElement.style.setProperty(
    "--pnex-font-family",
    config.fontFamily || 'Consolas, "Courier New", monospace',
  );
  document.documentElement.style.setProperty(
    "--pnex-font-size",
    `${config.fontSize || 14}px`,
  );
}

function setupTitlebar(): void {
  const menuPopup = document.getElementById("menu-popup");
  const fileButton =
    document.querySelector<HTMLButtonElement>('[data-menu="file"]');
  const editButton =
    document.querySelector<HTMLButtonElement>('[data-menu="edit"]');
  const helpButton =
    document.querySelector<HTMLButtonElement>('[data-menu="help"]');
  const minimizeButton = document.getElementById("window-minimize");
  const maximizeButton = document.getElementById("window-maximize");
  const closeButton = document.getElementById("window-close");

  if (
    !(menuPopup instanceof HTMLDivElement) ||
    !fileButton ||
    !editButton ||
    !helpButton ||
    !minimizeButton ||
    !maximizeButton ||
    !closeButton
  ) {
    throw new Error("Titlebar elements not found");
  }

  let activeThemeName = "";

  type MenuItem =
    | { type: "action"; label: string; action: AppMenuAction }
    | { type: "theme"; label: string; themeName: string; checked: boolean }
    | { type: "separator" }
    | { type: "label"; label: string };

  const getMenuItems = async (menuKey: string): Promise<MenuItem[]> => {
    if (menuKey === "file") {
      const themes = await pnex.listThemes();
      const themeItems: MenuItem[] = themes.map((theme) => ({
        type: "theme",
        label: theme.name,
        themeName: theme.name,
        checked: theme.name === activeThemeName,
      }));

      return [
        { type: "action", label: "Options JSON", action: "config" },
        { type: "action", label: "New Chat", action: "new-chat" },
        { type: "separator" },
        { type: "label", label: "Themes" },
        ...themeItems,
      ];
    }

    if (menuKey === "edit") {
      return [
        { type: "action", label: "Copy", action: "copy" },
        { type: "action", label: "Paste", action: "paste" },
        { type: "action", label: "Select All", action: "select-all" },
      ];
    }

    if (menuKey === "help") {
      return [
        { type: "action", label: "Toggle DevTools", action: "toggle-devtools" },
        { type: "action", label: "About pnex", action: "config" },
      ];
    }

    return [];
  };

  const runMenuAction = async (action: AppMenuAction): Promise<void> => {
    switch (action) {
      case "config":
        await pnex.openConfig();
        break;
      case "new-chat":
        await pnex.newChat();
        break;
      case "copy":
        document.execCommand("copy");
        break;
      case "paste":
        document.execCommand("paste");
        break;
      case "select-all":
        document.execCommand("selectAll");
        break;
      case "toggle-devtools":
        await pnex.toggleDevTools();
        break;
    }
  };

  const closeMenu = (): void => {
    menuPopup.classList.add("hidden");
    menuPopup.innerHTML = "";
  };

  const openMenu = async (
    anchor: HTMLButtonElement,
    menuKey: string,
  ): Promise<void> => {
    const items = await getMenuItems(menuKey);
    if (items.length === 0) return;

    menuPopup.innerHTML = "";
    items.forEach((item) => {
      if (item.type === "separator") {
        const separator = document.createElement("div");
        separator.className = "menu-popup-separator";
        menuPopup.appendChild(separator);
        return;
      }

      if (item.type === "label") {
        const label = document.createElement("div");
        label.className = "menu-popup-label";
        label.textContent = item.label;
        menuPopup.appendChild(label);
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-popup-item";
      button.textContent =
        item.type === "theme"
          ? `${item.checked ? "✓ " : "   "}${item.label}`
          : item.label;
      button.addEventListener("click", async () => {
        closeMenu();

        if (item.type === "theme") {
          const theme = await pnex.setTheme(item.themeName);
          if (theme) {
            activeThemeName = theme.name;
          }
          return;
        }

        await runMenuAction(item.action);
      });
      menuPopup.appendChild(button);
    });

    const rect = anchor.getBoundingClientRect();
    menuPopup.style.left = `${rect.left}px`;
    menuPopup.style.top = `${rect.bottom + 4}px`;
    menuPopup.classList.remove("hidden");
  };

  [fileButton, editButton, helpButton].forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const menuKey = button.dataset.menu;
      if (!menuKey) return;
      if (
        !menuPopup.classList.contains("hidden") &&
        menuPopup.style.left === `${button.getBoundingClientRect().left}px`
      ) {
        closeMenu();
        return;
      }
      void openMenu(button, menuKey);
    });
  });

  document.addEventListener("click", () => closeMenu());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  minimizeButton.addEventListener("click", () => {
    void pnex.minimizeWindow();
  });

  maximizeButton.addEventListener("click", async () => {
    const isMaximized = await pnex.toggleMaximizeWindow();
    maximizeButton.textContent = isMaximized ? "❐" : "□";
  });

  closeButton.addEventListener("click", () => {
    void pnex.closeWindow();
  });

  void pnex.isWindowMaximized().then((isMaximized) => {
    maximizeButton.textContent = isMaximized ? "❐" : "□";
  });

  pnex.onWindowMaximizedChanged((isMaximized) => {
    maximizeButton.textContent = isMaximized ? "❐" : "□";
  });

  pnex.onMenuAction((action) => {
    void runMenuAction(action);
  });

  void pnex.getConfig().then((config) => {
    activeThemeName = config.theme.name;
  });

  pnex.onThemeChanged((theme: PnexTheme) => {
    activeThemeName = theme.name;
  });
}

async function main(): Promise<void> {
  const config: PnexConfig = await pnex.getConfig();

  applyConfigCssVariables(config);
  applyTheme(config.theme);
  setupTitlebar();

  const container = document.getElementById("terminal");
  if (!container) {
    throw new Error("Terminal container not found");
  }

  const { terminal } = initTerminal(container, config);

  initInlineChat(terminal);
  initAiHint(terminal);

  pnex.onNewChat(() => {
    pnex.newChat();
  });

  pnex.onThemeChanged((theme) => {
    applyTheme(theme);
    terminal.options.theme = toXtermTheme(theme);
  });

  terminal.focus();
}

main();
