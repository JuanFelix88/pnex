export interface FrameLoop {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

/**
 * Executes a callback once per animation frame while running.
 * Keeps DOM-following overlays aligned with visual updates.
 */
export function createFrameLoop(callback: () => void): FrameLoop {
  let animationFrameId: number | null = null;

  const tick = (): void => {
    callback();
    animationFrameId = window.requestAnimationFrame(tick);
  };

  return {
    start(): void {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(tick);
    },

    stop(): void {
      if (animationFrameId === null) {
        return;
      }

      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    },

    isRunning(): boolean {
      return animationFrameId !== null;
    },
  };
}
