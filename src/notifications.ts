import { invoke } from "@tauri-apps/api/core";

export interface SystemNotification {
  title: string;
  body: string;
  visualPath?: string;
}

export function notify(notification: SystemNotification): Promise<void> {
  return invoke("show_notification", { notification });
}
