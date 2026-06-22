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
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), ...init?.headers },
    ...init,
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  if (response.status === 204) return undefined as T;
  return response.json();
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
export const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(value);
