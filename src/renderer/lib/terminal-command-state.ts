type CommandStateListener = (isRunning: boolean) => void;

let _isCommandRunning = false;
const _listeners = new Set<CommandStateListener>();

export function isCommandRunning(): boolean {
  return _isCommandRunning;
}

export function markCommandRunning(): void {
  updateCommandState(true);
}

export function markPromptReady(): void {
  updateCommandState(false);
}

export function onCommandStateChange(
  listener: CommandStateListener,
): () => void {
  _listeners.add(listener);
  listener(_isCommandRunning);

  return () => {
    _listeners.delete(listener);
  };
}

function updateCommandState(nextState: boolean): void {
  if (_isCommandRunning === nextState) {
    return;
  }

  _isCommandRunning = nextState;
  _listeners.forEach((listener) => listener(_isCommandRunning));
}
