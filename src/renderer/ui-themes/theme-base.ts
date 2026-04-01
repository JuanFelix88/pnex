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

/**
 * Use this api for render UI theme
 */
export class ThemeBase {
  public name: string = "Base Theme";
  public constructor(public context: ThemeContext) {}

  public render(ctx: ThemeContext): Promise<void> | void {}
}
