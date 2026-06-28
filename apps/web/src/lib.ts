export const API = import.meta.env.VITE_API_URL || "/api";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let refreshPromise: Promise<boolean> | undefined;

async function parseError(response: Response) {
  return (await response.json().catch(() => ({ error: "请求失败" }))).error ?? "请求失败";
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
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
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
export const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(value);
