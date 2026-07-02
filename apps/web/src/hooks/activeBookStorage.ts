const LAST_ACTIVE_BOOK_STORAGE_KEY = "shared-ledger:last-active-book-id";

export function readLastActiveBookId(userId?: string) {
  if (!userId) return null;
  try {
    return window.localStorage.getItem(activeBookStorageKey(userId));
  } catch {
    return null;
  }
}

export function writeLastActiveBookId(bookId: string, userId?: string) {
  if (!userId) return;
  try {
    window.localStorage.setItem(activeBookStorageKey(userId), bookId);
  } catch {
    // localStorage may be unavailable in private browsing or SSR-like tests.
  }
}

export function clearLastActiveBookId(userId?: string) {
  try {
    window.localStorage.removeItem(LAST_ACTIVE_BOOK_STORAGE_KEY);
    if (userId) {
      window.localStorage.removeItem(activeBookStorageKey(userId));
      return;
    }
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(`${LAST_ACTIVE_BOOK_STORAGE_KEY}:`)) window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable in private browsing or SSR-like tests.
  }
}

export function activeBookStorageKey(userId: string) {
  return `${LAST_ACTIVE_BOOK_STORAGE_KEY}:${userId}`;
}
