export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function success<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function failure<E = Error>(error: E): Result<never, E> {
  return { ok: false, error };
}

export async function safeAsync<T>(
  operation: () => Promise<T>,
  context?: string,
): Promise<Result<T, Error>> {
  try {
    const value = await operation();
    return success(value);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (context) {
      console.error(`[${context}]`, err);
    }
    return failure(err);
  }
}

export function safeSync<T>(operation: () => T, context?: string): Result<T, Error> {
  try {
    const value = operation();
    return success(value);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (context) {
      console.error(`[${context}]`, err);
    }
    return failure(err);
  }
}

export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok === true;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return result.ok === false;
}

