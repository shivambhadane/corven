/** Thin client for the CORVEN API. All requests are same-origin (/api/v1/...). */
export type Role = "admin" | "operator" | "approver" | "viewer";
export interface Session {
  org: string;
  actor: string;
  role: Role;
}

const KEY = "corven.session";
export const loadSession = (): Session | null => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.org && s.actor && s.role ? s : null;
  } catch {
    return null;
  }
};
export const saveSession = (s: Session | null) => (s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY));
export const uuid = () => crypto.randomUUID();

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

let current: Session | null = loadSession();
export const setSession = (s: Session | null) => {
  current = s;
  saveSession(s);
};
export const session = () => current;

/**
 * DEVELOPMENT SIGN-IN: the API's development authenticator trusts these headers. It exists only while real
 * authentication (planned: Firebase) is not built, and the server refuses it in production.
 */
async function call<T>(method: string, path: string, body?: unknown, as?: Session): Promise<T> {
  const s = as ?? current;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (s) Object.assign(headers, { "x-dev-actor-id": s.actor, "x-dev-org-id": s.org, "x-dev-role": s.role });
  const res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "HTTP_" + res.status, json?.error?.message ?? res.statusText, json?.error?.details);
  return json as T;
}
export const api = {
  get: <T = any>(p: string, as?: Session) => call<T>("GET", p, undefined, as),
  post: <T = any>(p: string, b: unknown = {}, as?: Session) => call<T>("POST", p, b, as),
  put: <T = any>(p: string, b: unknown, as?: Session) => call<T>("PUT", p, b, as),
  patch: <T = any>(p: string, b: unknown, as?: Session) => call<T>("PATCH", p, b, as),
};

export async function health(): Promise<boolean> {
  try {
    return (await fetch("/health")).ok;
  } catch {
    return false;
  }
}
