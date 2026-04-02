/**
 * Status of a prompt HUD entry
 */
export type PromptHudStatus = "ready" | "running" | "success" | "error";

/**
 * Context provided to UI themes for rendering
 */
export interface ThemeContext {
  elementContainer: HTMLElement;
  directoryPath: string;
  clearUi(): void;
  readFile(filePath: string): Promise<string>;
  readDir(directoryPath: string): Promise<string[]>;
  writeFile(filePath: string, content: string): Promise<void>;
  execCommand(
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): Promise<string>;
  isFile(filePath: string): Promise<boolean>;
  /**
   * Equivalent for path.resolve
   */
  resolvePath(...segments: string[]): string;
  username: string;
}
