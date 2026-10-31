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

type RequestOptions = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  // Extra request headers. The kiosk uses this for its signature headers.
  headers?: Record<string, string>;
};

// Called when any request answers "please log in" (the session ended). The app sets it once
// (see app/auth-redirect.ts) so every page returns to the login screen.
let onNotAuthenticated: (() => void) | null = null;
export function setNotAuthenticatedHandler(handler: (() => void) | null) {
  onNotAuthenticated = handler;
}

// Sends the request and turns every failure into an ApiError. Returns the answer untouched.
async function send(
  path: string,
  { method, body, headers }: RequestOptions,
  accept = "application/json",
): Promise<Response> {
  const isUpload = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers: {
        Accept: accept,
        ...headers,
        // A file upload (FormData) sets its own content type with the boundary.
        ...(body === undefined || isUpload ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : isUpload ? body : JSON.stringify(body),
    });
  } catch {
    // fetch only throws when the server cannot be reached at all.
    throw new ApiError("NETWORK_ERROR", "The server cannot be reached.", 0);
  }
  if (!response.ok) {
    const error = await readApiError(response);
    if (error.code === "NOT_AUTHENTICATED") {
      onNotAuthenticated?.();
    }
    throw error;
  }
  return response;
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const apiGet = <T>(path: string) => request<T>(path, { method: "GET" });
export const apiPost = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body ?? {} });
export const apiPut = <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body });
export const apiPatch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body });
export const apiDelete = <T>(path: string) => request<T>(path, { method: "DELETE" });

/** Sends one file as multipart/form-data in the field `file` (the Excel import). */
export const apiUpload = <T>(path: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<T>(path, { method: "POST", body: form });
};

// For callers that need their own headers (the signed kiosk requests).
export const apiSend = <T>(options: RequestOptions & { path: string }) =>
  request<T>(options.path, options);

/**
 * Downloads a file (a PDF by default; pass `accept` for a photo or a spreadsheet). Errors come
 * back as the usual ApiError.
 */
export async function apiBlob(
  path: string,
  options: { method: "GET" | "POST"; body?: unknown; accept?: string },
): Promise<Blob> {
  const response = await send(path, options, options.accept ?? "application/pdf");
  return await response.blob();
}

/**
 * Downloads a report file and also returns the file name the server chose (from the
 * Content-Disposition header), so the saved file has the name the server made.
 */
export async function apiFile(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  const response = await send(path, { method: "GET" }, "*/*");
  const header = response.headers.get("Content-Disposition") ?? "";
  const fileName = /filename="?([^";]+)"?/.exec(header)?.[1] ?? null;
  return { blob: await response.blob(), fileName };
}
