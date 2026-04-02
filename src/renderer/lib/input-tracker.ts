type CommandSubmitListener = (command: string) => void;

const CTRL_C = "\x03";
const CTRL_U = "\x15";
const BACKSPACE = "\x7f";
const BACKSPACE_ALT = "\b";
const ESC = "\x1b";

let _inputBuffer = "";
let _inEscapeSequence = false;
const _listeners = new Set<CommandSubmitListener>();

/**
 * Feed raw PTY input data into the tracker.
 * Accumulates printable characters, handles backspace, and emits
 * the buffered command when the user presses Enter.
 *
 * Must be called with every chunk sent to the PTY before dispatching it.
 */
export function trackInput(data: string): void {
  for (const char of data) {
    if (_inEscapeSequence) {
      // Consume until a letter terminates the CSI sequence (e.g. \x1b[A)
      if (char >= "A" && char <= "z") {
        _inEscapeSequence = false;
      }
      continue;
    }

    if (char === ESC) {
      _inEscapeSequence = true;
      continue;
    }

    if (char === "\r" || char === "\n") {
      flushBuffer();
      continue;
    }

    if (char === CTRL_C || char === CTRL_U) {
      _inputBuffer = "";
      continue;
    }

    if (char === BACKSPACE || char === BACKSPACE_ALT) {
      _inputBuffer = _inputBuffer.slice(0, -1);
      continue;
    }

    if (char >= " " || char === "\t") {
      _inputBuffer += char;
    }
  }
}

/**
 * Subscribe to command submissions.
 * The listener receives the trimmed command string each time the user presses Enter.
 * Returns an unsubscribe function.
 */
export function onCommandSubmit(listener: CommandSubmitListener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function flushBuffer(): void {
  const command = _inputBuffer.trim();
  _inputBuffer = "";
  if (command.length > 0) {
    _listeners.forEach((l) => l(command));
  }
}
