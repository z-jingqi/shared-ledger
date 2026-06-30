import { useMemo, useSyncExternalStore } from "react";
import { useApi } from "../../hooks/useApi";
import { countUnviewedPendingInvitations, getViewedInvitationSnapshot, onInvitationViewsChanged } from "./viewed";

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

const emptyInvitations: ReceivedInvitation[] = [];

export function useInvitationBadge(userId?: string) {
  const { data, error, loading, reload } = useApi<{ invitations: ReceivedInvitation[] }>(
    userId ? "/invitations/received" : undefined,
  );
  const viewedSnapshot = useSyncExternalStore(
    onInvitationViewsChanged,
    () => getViewedInvitationSnapshot(userId),
    () => "",
  );

  const invitations = data?.invitations ?? emptyInvitations;
  const pendingInvitations = useMemo(
    () => invitations.filter((item) => item.status === "pending"),
    [invitations],
  );
  const unreadCount = useMemo(
    () => countUnviewedPendingInvitations(pendingInvitations, viewedSnapshot),
    [pendingInvitations, viewedSnapshot],
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
