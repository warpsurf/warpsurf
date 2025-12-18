export function isAbortedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.message.includes('Aborted');
}

/**
 * Checks if an error is related to extension conflicts
 *
 * @param error - The error to check
 * @returns boolean indicating if it's an extension conflict error
 */
export function isExtensionConflictError(error: unknown): boolean {
  const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();

  return errorMessage.includes('cannot access a chrome-extension') && errorMessage.includes('of different extension');
}

export class RequestCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestCancelledError';
  }
}

export class ResponseTimeoutError extends Error {
  constructor(timeoutSeconds: number) {
    super(`Response timed out after ${timeoutSeconds} seconds`);
    this.name = 'ResponseTimeoutError';
  }
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof ResponseTimeoutError) return true;
  if (error instanceof Error) {
    return error.name === 'ResponseTimeoutError' || error.message.includes('timed out after');
  }
  return false;
}

export class ExtensionConflictError extends Error {
  /**
   * Creates a new ExtensionConflictError
   *
   * @param message - The error message
   * @param cause - The original error that caused this error
   */
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ExtensionConflictError';

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ExtensionConflictError);
    }
  }

  /**
   * Returns a string representation of the error
   */
  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

export const EXTENSION_CONFLICT_ERROR_MESSAGE = `Cannot access a chrome-extension:// URL of different extension.

  This is likely due to conflicting extensions. 
  
      We suggest to create a new profile in Chrome and install warpsurf in the new profile.
  `;
