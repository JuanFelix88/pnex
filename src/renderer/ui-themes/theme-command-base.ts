import type { ThemeContext, PromptHudStatus } from "../../shared/types";

export type { ThemeContext, PromptHudStatus };

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
