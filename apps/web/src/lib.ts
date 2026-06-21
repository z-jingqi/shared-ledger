export const API = import.meta.env.VITE_API_URL || "/api";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), ...init?.headers },
    ...init,
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({ error: "请求失败" }))).error);
  return response.json();
}
export const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(value);
