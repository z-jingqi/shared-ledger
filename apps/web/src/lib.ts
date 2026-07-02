export const API = import.meta.env.VITE_API_URL || "/api";

type ApiErrorPayload = {
  error?: string;
  code?: string;
  requestId?: string;
  details?: unknown;
};
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let refreshPromise: Promise<boolean> | undefined;

async function parseError(response: Response): Promise<ApiErrorPayload> {
  const text = await response.text().catch(() => "");
  if (!text) return { error: "请求失败" };
  try {
    const payload = JSON.parse(text) as ApiErrorPayload;
    return { ...payload, error: payload.error ?? "请求失败" };
  } catch {
    return { error: readableErrorText(text) };
  }
}

function readableErrorText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "请求失败";
  if (trimmed.includes("Error occurred while trying to proxy")) return "API 服务未启动或代理失败";
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return "请求失败";
  return trimmed;
}

async function refreshSession() {
  refreshPromise ??= fetch(`${API}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  })
    .then((response) => response.ok)
    .finally(() => {
      refreshPromise = undefined;
    });
  return refreshPromise;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const error = await parseError(response);
    throw new ApiError(
      error.error ?? "请求失败",
      response.status,
      error.code,
      error.requestId,
      error.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const isFormData = init?.body instanceof FormData;
  return fetch(`${API}${path}`, {
    credentials: "include",
    headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), ...init?.headers },
    ...init,
  });
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && path !== "/auth/refresh") {
      if (await refreshSession()) return request<T>(path, init);
      window.dispatchEvent(new Event("ledger:unauthorized"));
    }
    throw error;
  }
}
export async function apiFetchWithRefresh(path: string, init?: RequestInit): Promise<Response> {
  const response = await apiFetch(path, init);
  if (response.status !== 401 || path === "/auth/refresh") return response;
  if (await refreshSession()) return apiFetch(path, init);
  window.dispatchEvent(new Event("ledger:unauthorized"));
  return response;
}
