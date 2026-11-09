// ============================================================================
// treelet.js - Cancellation errors
//
// One convention for "cancelled" across the library, the worker and the UI:
// an Error named 'AbortError', as fetch() and AbortSignal use.
// ============================================================================

/** An error meaning the operation was cancelled (name 'AbortError'). */
export function abortError(message = 'treelet: cancelled'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/** Whether `err` means "cancelled" (an AbortError from treelet, fetch or an AbortSignal). */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}
