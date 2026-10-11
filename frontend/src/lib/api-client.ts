// Small helper for calling our backend. All calls use relative /api/v1 paths (same origin),
// and every failure becomes an ApiError with a stable code from the standard error format:
// { "error": { "code", "message", "details" } }.

const API_PREFIX = "/api/v1";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type ErrorEnvelope = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

async function readApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ErrorEnvelope;
    if (body.error?.code) {
      return new ApiError(
        body.error.code,
        body.error.message ?? "",
        response.status,
        body.error.details,
      );
    }
  } catch {
    // Not our JSON format (for example a proxy error page); handled below.
  }
  return new ApiError("HTTP_ERROR", response.statusText, response.status);
}

export async function apiGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, { headers: { Accept: "application/json" } });
  } catch {
    // fetch only throws when the server cannot be reached at all.
    throw new ApiError("NETWORK_ERROR", "The server cannot be reached.", 0);
  }
  if (!response.ok) {
    throw await readApiError(response);
  }
  return (await response.json()) as T;
}
