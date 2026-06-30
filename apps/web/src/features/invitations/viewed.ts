type InvitationLike = { id: string; status: string };

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
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function getViewedInvitationSnapshot(userId?: string) {
  return [...getViewedInvitationIds(userId)].sort().join("|");
}

export function countUnviewedPendingInvitations(invitations: InvitationLike[], viewedSnapshot: string) {
  const viewed = new Set(viewedSnapshot ? viewedSnapshot.split("|") : []);
  let count = 0;
  for (const item of invitations) {
    if (item.status === "pending" && !viewed.has(item.id)) count += 1;
  }
  return count;
}

export function markInvitationIdsViewed(userId: string | undefined, invitationIds: string[]) {
  const key = storageKey(userId);
  const storage = safeLocalStorage();
  if (!key || !storage || invitationIds.length === 0) return;
  const viewed = getViewedInvitationIds(userId);
  for (const id of invitationIds) viewed.add(id);
  storage.setItem(key, JSON.stringify([...viewed]));
  window.dispatchEvent(new Event(eventName));
}

export function onInvitationViewsChanged(listener: () => void) {
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
