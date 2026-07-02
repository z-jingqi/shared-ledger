export type InvitationLike = { id: string; status: string; direction?: "sent" | "received" };

const eventName = "ledger:invitation-views-changed";

function storageKey(userId?: string) {
  return userId ? `shared-ledger:viewed-invitations:${userId}` : "";
}

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function getViewedInvitationIds(userId?: string) {
  const key = storageKey(userId);
  const storage = safeLocalStorage();
  if (!key || !storage) return new Set<string>();
  try {
    const value = JSON.parse(storage.getItem(key) || "[]");
    return new Set(
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
    );
  } catch {
    return new Set<string>();
  }
}

export function getViewedInvitationSnapshot(userId?: string) {
  return [...getViewedInvitationIds(userId)].sort().join("|");
}

function viewedToken(item: InvitationLike) {
  return `${item.id}:${item.status}`;
}

export function isBadgeInvitation(item: InvitationLike) {
  if (item.direction === "received") return item.status === "pending";
  if (item.direction === "sent") return item.status === "pending" || item.status === "declined";
  return item.status === "pending";
}

export function countUnviewedBadgeInvitations(invitations: InvitationLike[], viewedSnapshot: string) {
  const viewed = new Set(viewedSnapshot ? viewedSnapshot.split("|") : []);
  let count = 0;
  for (const item of invitations) {
    if (isBadgeInvitation(item) && !viewed.has(viewedToken(item))) count += 1;
  }
  return count;
}

export function markInvitationItemsViewed(userId: string | undefined, invitations: InvitationLike[]) {
  const key = storageKey(userId);
  const storage = safeLocalStorage();
  if (!key || !storage || invitations.length === 0) return;
  const viewed = getViewedInvitationIds(userId);
  for (const invitation of invitations) viewed.add(viewedToken(invitation));
  storage.setItem(key, JSON.stringify([...viewed]));
  window.dispatchEvent(new Event(eventName));
}

export function markInvitationIdsViewed(userId: string | undefined, invitationIds: string[]) {
  markInvitationItemsViewed(
    userId,
    invitationIds.map((id) => ({ id, status: "pending" })),
  );
}

export function onInvitationViewsChanged(listener: () => void) {
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
