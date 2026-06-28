import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../hooks/useApi";
import { countUnviewedPendingInvitations, onInvitationViewsChanged } from "./viewed";

export type ReceivedInvitation = {
  id: string;
  bookId: string;
  inviterUserId: string;
  inviteeEmail?: string;
  inviteePhone?: string;
  role: "admin" | "member";
  status: string;
  expiresAt: string;
};

export function useInvitationBadge(userId?: string) {
  const { data, error, loading, reload } = useApi<{ invitations: ReceivedInvitation[] }>(
    userId ? "/invitations/received" : undefined,
  );
  const [revision, setRevision] = useState(0);

  useEffect(() => onInvitationViewsChanged(() => setRevision((current) => current + 1)), []);

  const invitations = data?.invitations ?? [];
  const pendingInvitations = useMemo(
    () => invitations.filter((item) => item.status === "pending"),
    [invitations],
  );
  const unreadCount = useMemo(
    () => countUnviewedPendingInvitations(pendingInvitations, userId),
    [pendingInvitations, revision, userId],
  );

  return {
    error,
    invitations,
    loading,
    pendingCount: pendingInvitations.length,
    pendingInvitations,
    reload,
    unreadCount,
  };
}
