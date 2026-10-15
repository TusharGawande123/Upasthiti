// Test helper: a fake backend. Give it answers per "METHOD /path" and it replaces fetch().
// A path that has no answer fails the test, so a forgotten call is never silently ignored.
import { vi } from "vitest";

// `hang: true` never answers (to see loading states).
type Answer =
  | { status?: number; body?: unknown; hang?: boolean }
  | ((request: RecordedCall) => { status?: number; body?: unknown });

export type RecordedCall = { method: string; path: string; body: unknown };

// JSON bodies are parsed; an upload records only the file name (the file is not needed).
function readBody(body: BodyInit | null | undefined): unknown {
  if (!body) return undefined;
  if (body instanceof FormData) {
    const file = body.get("file");
    return { file: file instanceof File ? file.name : null };
  }
  return JSON.parse(String(body));
}

export function mockApi(answers: Record<string, Answer>) {
  const calls: RecordedCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = url.replace("/api/v1", "");
      const call: RecordedCall = {
        method,
        path,
        body: readBody(init?.body),
      };
      calls.push(call);

      const key = `${method} ${path.split("?")[0]}`;
      const answer = answers[key];
      if (answer === undefined) {
        throw new Error(`No fake answer for ${key}`);
      }
      if (typeof answer !== "function" && answer.hang) {
        return new Promise<Response>(() => {});
      }
      const result = typeof answer === "function" ? answer(call) : answer;
      const { status = 200, body } = result as { status?: number; body?: unknown };
      if (status === 204) {
        return new Response(null, { status });
      }
      return Response.json(body ?? {}, { status });
    }),
  );
  return calls;
}

export function apiError(status: number, code: string, details: Record<string, unknown> = {}) {
  return { status, body: { error: { code, message: code, details } } };
}

export const SUPER_ADMIN = {
  id: "u-1",
  name: "Tushar Gawande",
  username: "tushar",
  email: null,
  role: "super_admin",
  plant_ids: [],
  must_change_password: false,
};
