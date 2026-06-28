import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "./useApi";

export const LAST_ACTIVE_BOOK_STORAGE_KEY = "shared-ledger:last-active-book-id";

type Book = { id: string; name: string; currency: string };
export function useActiveBook() {
  const [search, setSearch] = useSearchParams();
  const { data, ...state } = useApi<{ books: Book[] }>("/books");
  const requested = search.get("bookId");
  const books = data?.books ?? [];
  const stored = useMemo(() => readLastActiveBookId(), []);
  const book =
    books.find((item) => item.id === requested) ??
    books.find((item) => item.id === stored) ??
    books[0];

  useEffect(() => {
    if (!book) return;
    writeLastActiveBookId(book.id);
  }, [book]);

  useEffect(() => {
    if (state.loading || state.error) return;
    const requestedMissing = requested && !books.some((item) => item.id === requested);
    if (!requestedMissing && (book || !stored)) return;
    if (!book) {
      clearLastActiveBookId();
      if (requested) {
        const next = new URLSearchParams(search);
        next.delete("bookId");
        setSearch(next, { replace: true });
      }
      return;
    }
    const next = new URLSearchParams(search);
    next.set("bookId", book.id);
    setSearch(next, { replace: true });
  }, [book, books, requested, search, setSearch, state.error, state.loading, stored]);

  const setActiveBook = (bookId: string) => {
    writeLastActiveBookId(bookId);
    const next = new URLSearchParams(search);
    next.set("bookId", bookId);
    setSearch(next);
  };

  return { ...state, book, books, setActiveBook };
}

export function readLastActiveBookId() {
  try {
    return window.localStorage.getItem(LAST_ACTIVE_BOOK_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastActiveBookId(bookId: string) {
  try {
    window.localStorage.setItem(LAST_ACTIVE_BOOK_STORAGE_KEY, bookId);
  } catch {
    // localStorage may be unavailable in private browsing or SSR-like tests.
  }
}

export function clearLastActiveBookId() {
  try {
    window.localStorage.removeItem(LAST_ACTIVE_BOOK_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in private browsing or SSR-like tests.
  }
}
