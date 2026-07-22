import { invoke } from "@tauri-apps/api/core";

let lastLoading: boolean | undefined;

function publishLoading(): void {
  const loading = document.documentElement.dataset.terminalRunning === "true";
  if (loading === lastLoading) return;

  lastLoading = loading;
  void invoke("set_window_loading", { loading }).catch((error: unknown) => {
    console.warn("Could not publish window loading state.", error);
  });
}

new MutationObserver(publishLoading).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-terminal-running"],
});
publishLoading();
