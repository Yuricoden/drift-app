/** A failed deployment request must never be presented as a bad password. */
export function loginErrorMessage(status: number, body: unknown): string {
  const error = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
  if (status === 401 && typeof error === 'string' && error.trim()) return error;
  if (status === 429) return 'Too many login attempts. Please wait a moment and try again.';
  return 'The login service is temporarily unavailable. Please try again later.';
}
