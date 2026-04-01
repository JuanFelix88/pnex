export interface UiThemeCommandOptions {
  cwd?: string;
}

export type UiThemeContextRequest =
  | {
      type: "readFile";
      filePath: string;
    }
  | {
      type: "readDir";
      directoryPath: string;
    }
  | {
      type: "writeFile";
      filePath: string;
      content: string;
    }
  | {
      type: "execCommand";
      command: string;
      args: string[];
      options?: UiThemeCommandOptions;
    }
  | {
      type: "isFile";
      filePath: string;
    }
  | {
      type: "resolvePath";
      segments: string[];
    };
