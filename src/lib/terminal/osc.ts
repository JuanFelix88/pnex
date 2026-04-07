export const PNEX_OSC_ID = 7777;

interface OscSplitResult {
  /**
   * \\[\\e]7777 codes, e.g. exit=0, cwd=/home/user, etc.
   */
  oscCommands: string;
  /**
   * Any remaining data after the last \\[\\e]7777...\\a sequence, which should be rendered as normal terminal output. This is needed because the OSC codes can appear anywhere in the stream, even in the middle of a line of output.
   */
  remainingData: string;
}

export class OscHandler {
  /**
   *
   * @param data chunk of render
   */
  public static splitData(data: string): OscSplitResult {
    const oscPrefix = `\x1b]${PNEX_OSC_ID};`;
    let oscCommands = "";
    let currentIndex = 0;
    const remainingParts: string[] = [];

    while (currentIndex < data.length) {
      const oscStart = data.indexOf(oscPrefix, currentIndex);

      if (oscStart === -1) {
        remainingParts.push(data.slice(currentIndex));
        break;
      }

      remainingParts.push(data.slice(currentIndex, oscStart));

      const payloadStart = oscStart + oscPrefix.length;
      const oscEnd = data.indexOf("\x07", payloadStart);

      if (oscEnd === -1) {
        remainingParts.push(data.slice(oscStart));
        break;
      }

      const payload = data.slice(payloadStart, oscEnd);
      oscCommands = oscCommands ? `${oscCommands}\n${payload}` : payload;
      currentIndex = oscEnd + 1;
    }

    return {
      oscCommands,
      remainingData: remainingParts.join(""),
    };
  }

  public static hasOscCommands(data: string): boolean {
    const oscPrefix = `\x1b]${PNEX_OSC_ID};`;
    const oscStart = data.indexOf(oscPrefix);

    if (oscStart === -1) {
      return false;
    }

    const payloadStart = oscStart + oscPrefix.length;
    return data.indexOf("\x07", payloadStart) !== -1;
  }
}
