import { ledgerQueryClient } from "./queryClient";

export type LedgerDataScope =
  | "books"
  | "book"
  | "transactions"
  | "transaction"
  | "imports"
  | "members"
  | "invitations"
  | "categories"
  | "all";

type LedgerDataInvalidation = {
  scopes?: LedgerDataScope[];
  bookId?: string;
  transactionId?: string;
};

const eventName = "ledger:data-invalidated";

export function invalidateLedgerData(detail: LedgerDataInvalidation = {}) {
  window.dispatchEvent(new CustomEvent<LedgerDataInvalidation>(eventName, { detail }));
  void ledgerQueryClient.invalidateQueries({
    predicate: (query) => {
      const [, path] = query.queryKey;
      return typeof path === "string" && shouldReloadApiPath(path, detail);
    },
  });
}

export function onLedgerDataInvalidated(listener: (detail: LedgerDataInvalidation) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<LedgerDataInvalidation>).detail ?? {});
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}

export function shouldReloadApiPath(path: string | undefined, detail: LedgerDataInvalidation) {
  if (!path) return false;
  const scopes = new Set(detail.scopes ?? ["all"]);
  if (scopes.has("all")) return true;
  const bookPrefix = detail.bookId ? `/books/${detail.bookId}` : undefined;
  if (bookPrefix && !path.startsWith(bookPrefix) && !path.startsWith("/transactions/")) return false;
  if (scopes.has("books") && path === "/books") return true;
  if (scopes.has("book") && /^\/books\/[^/]+$/.test(path)) return true;
  if (scopes.has("transactions") && /^\/books\/[^/]+\/transactions/.test(path)) return true;
  if (scopes.has("transaction") && path === `/transactions/${detail.transactionId ?? ""}`) return true;
  if (scopes.has("imports") && /^\/books\/[^/]+\/imports/.test(path)) return true;
  if (scopes.has("members") && /^\/books\/[^/]+\/members/.test(path)) return true;
  if (scopes.has("invitations") && (path === "/invitations/received" || /^\/books\/[^/]+\/invitations/.test(path))) return true;
  if (scopes.has("categories") && /^\/books\/[^/]+\/categories/.test(path)) return true;
  return false;
}
