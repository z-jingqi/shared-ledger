import type { SubscriptionPlan } from "@shared-ledger/shared";
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib";
import { ledgerQueryClient } from "../data/queryClient";
import { clearLastActiveBookId } from "../../hooks/activeBookStorage";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  plan: SubscriptionPlan;
  avatarUrl?: string;
};
type AuthValue = {
  user?: SessionUser;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user?: SessionUser) => void;
};
const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setSessionUser] = useState<SessionUser>();
  const [loading, setLoading] = useState(true);
  const setUser = useCallback((nextUser?: SessionUser) => {
    setSessionUser((previousUser) => {
      if (previousUser?.id !== nextUser?.id) ledgerQueryClient.clear();
      if (!nextUser) clearLastActiveBookId(previousUser?.id);
      return nextUser;
    });
  }, []);
  const refresh = useCallback(async () => {
    try {
      setUser((await api<{ user: SessionUser }>("/auth/me")).user);
    } catch {
      setUser(undefined);
    } finally {
      setLoading(false);
    }
  }, [setUser]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const unauthorized = () => {
      setUser(undefined);
      setLoading(false);
    };
    window.addEventListener("ledger:unauthorized", unauthorized);
    return () => window.removeEventListener("ledger:unauthorized", unauthorized);
  }, []);
  const value = useMemo(() => ({ user, loading, refresh, setUser }), [user, loading, refresh, setUser]);
  return <AuthContext value={value}>{children}</AuthContext>;
}
export function useAuth() {
  const value = use(AuthContext);
  if (!value) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return value;
}
