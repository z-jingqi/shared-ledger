import { useCallback, useEffect, useState } from "react";
import { api } from "../lib";

export function useApi<T>(path: string | undefined) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(Boolean(path));
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}
