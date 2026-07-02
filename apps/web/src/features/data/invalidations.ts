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

function shouldReloadApiPath(path: string | undefined, detail: LedgerDataInvalidation) {
  if (!path) return false;
  const scopes = new Set(detail.scopes ?? ["all"]);
  if (scopes.has("all")) return true;
  const bookPrefix = detail.bookId ? `/books/${detail.bookId}` : undefined;
  if (
    bookPrefix &&
    !path.startsWith(bookPrefix) &&
    !path.startsWith("/transactions/") &&
    path !== "/me/categories"
  )
    return false;
  if (scopes.has("books") && path === "/books") return true;
  if (scopes.has("book") && /^\/books\/[^/]+$/.test(path)) return true;
  if (scopes.has("transactions") && /^\/books\/[^/]+\/transactions/.test(path)) return true;
  if (scopes.has("transaction") && path === `/transactions/${detail.transactionId ?? ""}`) return true;
  if (scopes.has("imports") && /^\/books\/[^/]+\/imports/.test(path)) return true;
  if (scopes.has("members") && /^\/books\/[^/]+\/members/.test(path)) return true;
  if (
    scopes.has("invitations") &&
    (path === "/invitations/received" || /^\/books\/[^/]+\/invitations/.test(path))
  )
    return true;
  if (scopes.has("categories") && path === "/me/categories") return true;
  return false;
}
