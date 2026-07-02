import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { apiQueryKey } from "../features/data/queryClient";
import { useAuth } from "../features/auth/AuthProvider";
import { api } from "../lib";

export function useApi<T>(path: string | undefined) {
  const { user } = useAuth();
  const shouldCacheBooks = path === "/books" && import.meta.env.MODE !== "test";
  const {
    data,
    error: queryError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: apiQueryKey(path, user?.id),
    queryFn: () => api<T>(path ?? ""),
    enabled: Boolean(path),
    gcTime: shouldCacheBooks ? 10 * 60 * 1000 : undefined,
    staleTime: shouldCacheBooks ? 5 * 60 * 1000 : undefined,
    refetchOnMount: shouldCacheBooks ? false : undefined,
  });
  const reload = useCallback(async () => {
    if (!path) return;
    await refetch();
  }, [path, refetch]);
  const error = queryError ? (queryError instanceof Error ? queryError.message : "请求失败") : undefined;
  return { data, error, loading: isLoading, fetching: isFetching, reload };
}
