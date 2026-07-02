import { useMemo, useSyncExternalStore } from "react";
import { useApi } from "../../hooks/useApi";
import {
  countUnviewedBadgeInvitations,
  getViewedInvitationSnapshot,
  isBadgeInvitation,
  onInvitationViewsChanged,
} from "./viewed";

export type InvitationUserSummary = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  plan?: "free" | "pro";
};
export type ReceivedInvitation = {
  id: string;
  bookId: string;
  inviterUserId: string;
  inviteeEmail?: string;
  inviteePhone?: string;
  inviteeUserId?: string;
  inviter?: InvitationUserSummary;
  invitee?: InvitationUserSummary;
  book?: { id: string; name: string; currency: string };
  direction?: "sent" | "received";
  role: "admin" | "member";
  status: string;
  expiresAt: string;
  createdAt?: string;
  updatedAt?: string;
};

const emptyInvitations: ReceivedInvitation[] = [];

export function useInvitationBadge(userId?: string) {
  const { data, error, loading, reload } = useApi<{ invitations: ReceivedInvitation[] }>(
    userId ? "/invitations" : undefined,
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
  const badgeInvitations = useMemo(() => invitations.filter(isBadgeInvitation), [invitations]);
  const unreadCount = useMemo(
    () => countUnviewedBadgeInvitations(invitations, viewedSnapshot),
    [invitations, viewedSnapshot],
  );

  return {
    error,
    invitations,
    loading,
    pendingCount: pendingInvitations.length,
    pendingInvitations,
    badgeInvitations,
    reload,
    unreadCount,
  };
}
