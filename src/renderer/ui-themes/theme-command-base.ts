import type { ThemeContext, PromptHudStatus } from "../../shared/types";

export type { ThemeContext, PromptHudStatus };

/**
 * Use this api for render UI theme
 */
export class ThemeCommandBase {
  public name: string = "Base Theme";
  public status: PromptHudStatus = "ready";
  public doRender: () => void = () => {};

  /**
   * Vertical offset (in terminal lines) applied to the marker that anchors
   * this decoration. Use negative values to shift the decoration upward
   * relative to the prompt line (e.g. `-1` places it on the blank line
   * emitted before the OSC sequences).
   */
  public markerOffset: number = 1;

  public constructor(public context: ThemeContext) {}

  /**
   * Default rendering
   */
  public render(ctx: ThemeContext): Promise<void> | void {}

  public async onInitialLoad(): Promise<void> {}
}
