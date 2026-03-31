import { Terminal } from "@xterm/xterm";

export function getCursorElement(terminal: Terminal): HTMLElement | null {
  const cursorElement = terminal.element?.querySelector(".xterm-cursor");
  return cursorElement instanceof HTMLElement ? cursorElement : null;
}

export function isCursorVisibleInContainer(
  terminal: Terminal,
  container: HTMLElement,
): boolean {
  const cursorElement = getCursorElement(terminal);
  if (!cursorElement) {
    return false;
  }

  const cursorRect = cursorElement.getBoundingClientRect();
  if (cursorRect.width === 0 && cursorRect.height === 0) {
    return false;
  }

  const containerRect = container.getBoundingClientRect();

  const isHorizontallyVisible =
    cursorRect.right > containerRect.left &&
    cursorRect.left < containerRect.right;

  const isVerticallyVisible =
    cursorRect.bottom > containerRect.top &&
    cursorRect.top < containerRect.bottom;

  return isHorizontallyVisible && isVerticallyVisible;
}
