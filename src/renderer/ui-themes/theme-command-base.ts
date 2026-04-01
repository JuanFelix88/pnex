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
}

export type PromptHudStatus = "ready" | "running" | "success" | "error";

/**
 * Use this api for render UI theme
 */
export class ThemeCommandBase {
  public name: string = "Base Theme";
  public status: PromptHudStatus = "ready";
  public doRender: () => void = () => {};
  public constructor(public context: ThemeContext) {}

  /**
   * Default rendering
   */
  public render(ctx: ThemeContext): Promise<void> | void {}

  public async onInitialLoad(): Promise<void> {}
}
