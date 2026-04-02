/**
 * Error thrown when a stale/invalid operation is detected
 */
export class StaleOperationError extends Error {
  public constructor(message: string = "Stale operation") {
    super(message);
    this.name = "StaleOperationError";
  }
}

/**
 * Represents a versioned context that can become stale
 */
export interface StaleGuardContext {
  /** Unique version incremented on each render */
  renderVersion: number;
  /** Whether the context has been disposed */
  isDisposed: boolean;
}

/**
 * Creates a guard function for async operations that checks for stale state
 */
export function createStaleGuard<TContext extends StaleGuardContext>(
  context: TContext,
) {
  return async <T>(promise: Promise<T>): Promise<T> => {
    const renderVersion = context.renderVersion;
    const result = await promise;

    if (context.isDisposed || renderVersion !== context.renderVersion) {
      throw new StaleOperationError();
    }

    return result;
  };
}

/**
 * Throws if the context is disposed
 */
export function ensureActive<TContext extends StaleGuardContext>(
  context: TContext,
): void {
  if (context.isDisposed) {
    throw new StaleOperationError();
  }
}
