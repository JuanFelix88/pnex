/**
 * Synchronous normalizer for the raw data stream from node-pty.
 *
 * The \n that separates the prompt from the previous output now lives
 * in PS1 (after the OSC sequences), so cursor movement always happens
 * AFTER the OSC handler fires.  This class exists as a safety net:
 * if \r\n somehow still appears before a complete OSC 7777 pair it
 * moves it to after the pair, keeping registerMarker positioning stable.
 */
export class PtyFlowControl {
  /**
   * Matches \r\n immediately before a complete OSC 7777 exit+cwd pair.
   * Capture group 1 is the pair itself.
   */
  private static readonly CRLF_BEFORE_OSC_PAIR =
    /\r\n(\x1b\]7777;exit=[^\x07]*\x07\x1b\]7777;cwd=[^\x07]*\x07)/g;

  constructor(private writer: (data: string) => void) {}

  /** Push a raw chunk from the PTY, normalize and forward immediately. */
  feed(data: string): void {
    this.writer(this.normalize(data));
  }

  dispose(): void {}

  private normalize(data: string): string {
    return data.replace(PtyFlowControl.CRLF_BEFORE_OSC_PAIR, "$1\r\n");
  }
}
