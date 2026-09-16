/** Error envelope from docs/api/conventions.md. `code` is stable; `message` is for humans. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const errors = {
  validation: (details: Record<string, unknown>) =>
    new ApiError(400, "validation_failed", "request body failed validation", details),
  missingIdempotencyKey: () =>
    new ApiError(
      400,
      "idempotency_key_required",
      "Idempotency-Key header is required on this write",
    ),
  idempotencyConflict: () =>
    new ApiError(
      409,
      "idempotency_conflict",
      "Idempotency-Key was already used with a different payload",
    ),
  notFound: (what: string) => new ApiError(404, "not_found", `${what} not found`),
  conflict: (message: string) => new ApiError(409, "conflict", message),
  illegalTransition: (from: string, to: string) =>
    new ApiError(409, "illegal_transition", `intent cannot move from ${from} to ${to}`),
  unsupported: (message: string) => new ApiError(422, "unsupported_intent", message),
  policyDenied: (message: string, details?: Record<string, unknown>) =>
    new ApiError(422, "policy_denied", message, details),
  executionFailed: (message: string, details?: Record<string, unknown>) =>
    new ApiError(502, "execution_failed", message, details),
};
