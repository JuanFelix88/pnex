type ChatModeListener = (isChatMode: boolean) => void;

let _isChatMode = false;
const _listeners = new Set<ChatModeListener>();

export function isChatMode(): boolean {
  return _isChatMode;
}

export function setChatMode(active: boolean): void {
  if (_isChatMode === active) {
    return;
  }

  _isChatMode = active;
  _listeners.forEach((listener) => listener(_isChatMode));
}

export function onChatModeChange(listener: ChatModeListener): () => void {
  _listeners.add(listener);
  listener(_isChatMode);

  return () => {
    _listeners.delete(listener);
  };
}
