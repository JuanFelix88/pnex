import * as os from "os";
import * as pty from "node-pty";

/**
 * Manages a pseudo-terminal process via node-pty.
 * Handles spawning, resizing, writing and cleanup.
 */
export class ShellManager {
  private process: pty.IPty | null = null;

  /** Spawn a new shell process */
  spawn(shell?: string, cols = 80, rows = 24): pty.IPty {
    const { command, args } = this.parseShell(shell);
    this.process = pty.spawn(command, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: os.homedir(),
      env: process.env as Record<string, string>,
    });
    return this.process;
  }

  /** Write data to the shell */
  write(data: string): void {
    this.process?.write(data);
  }

  /** Resize the terminal */
  resize(cols: number, rows: number): void {
    this.process?.resize(cols, rows);
  }

  /** Kill the shell process */
  kill(): void {
    this.process?.kill();
    this.process = null;
  }

  /** Get the underlying pty process */
  getProcess(): pty.IPty | null {
    return this.process;
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
