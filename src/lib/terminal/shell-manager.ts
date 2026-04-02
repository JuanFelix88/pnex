import * as fs from "fs";
import * as os from "os";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import { PS1_PROMPT_BASH, PS1_PROMPT_PSW } from "./ps1";

/**
 * Manages a pseudo-terminal process via node-pty.
 * Handles spawning, resizing, writing and cleanup.
 */
export class ShellManager {
  private process: pty.IPty | null = null;
  private _spawnedCommand: string = "";

  /** Spawn a new shell process */
  public spawn(
    shell?: string,
    cols = 80,
    rows = 24,
    startDirectory?: string,
  ): pty.IPty {
    const { command, args } = this.parseShell(shell);
    this._spawnedCommand = command;
    this.process = pty.spawn(command, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: this.resolveStartDirectory(startDirectory),
      env: process.env as Record<string, string>,
    });
    return this.process;
  }

  private resolveStartDirectory(startDirectory?: string): string {
    const home = os.homedir();
    if (!startDirectory || startDirectory.trim() === "") {
      return home;
    }
    const dir = startDirectory.trim();
    const resolved =
      dir === "~" || dir.startsWith("~/") || dir.startsWith("~\\")
        ? dir.replace(/^~/, home)
        : dir;

    try {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        return resolved;
      }
    } catch {
      // path does not exist or is not accessible
    }

    return home;
  }

  /** Write data to the shell */
  public write(data: string): void {
    this.process?.write(data);
  }

  /** Resize the terminal */
  public resize(cols: number, rows: number): void {
    this.process?.resize(cols, rows);
  }

  /** Kill the shell process */
  public kill(): void {
    this.process?.kill();
    this.process = null;
  }

  /** Get the underlying pty process */
  public getProcess(): pty.IPty | null {
    return this.process;
  }

  /** Inject the pnex custom prompt into the spawned shell */
  public initPrompt(): void {
    if (!this.process) return;

    const spawnedCommandLowercase = this._spawnedCommand.toLowerCase();
    const isPowerShell =
      spawnedCommandLowercase.includes("powershell") ||
      spawnedCommandLowercase.includes("pwsh");

    if (isPowerShell) {
      this.process.write(PS1_PROMPT_PSW);
    } else {
      this.process.write(PS1_PROMPT_BASH);
    }
  }

  private getDefaultShell(): string {
    if (process.platform === "win32") {
      return "powershell.exe";
    }
    return process.env.SHELL || "/bin/bash";
  }

  /**
   * Parse a shell string that may contain quoted paths
   * and arguments, e.g. '"C:\path\bash.exe" --login -i'
   */
  private parseShell(shell?: string): { command: string; args: string[] } {
    if (!shell || shell.trim() === "") {
      return { command: this.getDefaultShell(), args: [] };
    }

    const trimmed = shell.trim();

    if (trimmed.startsWith('"')) {
      const endQuote = trimmed.indexOf('"', 1);
      if (endQuote > 0) {
        const command = trimmed.slice(1, endQuote);
        const rest = trimmed.slice(endQuote + 1).trim();
        const args = rest ? rest.split(/\s+/) : [];
        return { command, args };
      }
    }

    const parts = trimmed.split(/\s+/);
    return {
      command: parts[0],
      args: parts.slice(1),
    };
  }
}
