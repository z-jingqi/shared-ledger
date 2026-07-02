import { QueryClient } from "@tanstack/react-query";

export const ledgerQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 0,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  },
});

export function apiQueryKey(path: string | undefined, userId?: string) {
  return ["api", path ?? "disabled", userId ?? "anonymous"] as const;
}
