// Typed error for bad estimate input or an unresolved rate selection.
// API routes translate this into a 400 (client's fault), while any other thrown
// error becomes a 500.

export class EstimateError extends Error {
  /** marks this as a client-input problem so routes can map it to HTTP 400. */
  readonly isEstimateError = true;
  constructor(message: string) {
    super(message);
    this.name = "EstimateError";
  }
}

export function isEstimateError(err: unknown): err is EstimateError {
  return err instanceof EstimateError;
}
